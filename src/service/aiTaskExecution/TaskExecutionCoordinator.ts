/**
 * Creates execution-scoped identity and the trusted runtime binding
 * (technical-design §5, FR-17/20).
 *
 * The binding is MAIN-PROCESS STATE, never serializable renderer input
 * (§4A.1). The coordinator creates durable identity BEFORE slow resolution
 * so Stop already works (FR-17). Manual execution has its own durable
 * identity — not a fake schedule/run or goal record (FR-20).
 *
 * Slice 1 scope: identity creation + binding assembly + snapshot (for
 * persistence). Live lease acquisition against the
 * ConversationTurnCoordinator and live continuation dispatch land in Slice 2.
 *
 * Single completion owner (FR-20): one of "standalone" or "goal" per
 * execution. An unrelated active conversation goal cannot take over an
 * ordinary manual request.
 */
import type {
  TaskExecutionBindingSnapshot,
  TaskExecutionOrigin,
  TaskExecutionRoute,
  TaskCompletionContract,
} from "@/entityTypes/aiTaskExecutionTypes";
import { TaskRunBudget } from "@/service/aiTaskExecution/TaskRunBudget";
import { MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/budgetDefaults";
import type { BudgetLimitsInput } from "@/service/aiTaskExecution/budgetDefaults";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import {
  TaskCompletionContractService,
} from "@/service/aiTaskExecution/TaskCompletionContractService";
import type { FreezeInput } from "@/service/aiTaskExecution/TaskCompletionContractService";
import type {
  CreateExecutionResult,
  ExistingExecutionSnapshot,
  FinalizeInput,
  FinalizeResult,
  FinalizeScheduledInput,
} from "@/model/AiTaskExecution.model";

export interface TaskExecutionBinding {
  readonly executionId: string;
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly origin: TaskExecutionOrigin;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
  readonly leaseGeneration: number;
  readonly ledgerId: string;
  readonly contract: TaskCompletionContract | null;
  readonly contractHash: string | null;
  readonly controller: TaskCompletionController;
  readonly budget: TaskRunBudget;
}

/**
 * Discriminated result of `startManual`/`startScheduled` (AC-26, §4A.1).
 *
 * - `created`: a new execution was inserted; a fresh binding (with a fresh
 *   budget/controller) is returned for the caller to drive.
 * - `reused`: a same-(conversation, submission) execution with the same
 *   request_hash already exists. This is a transport retry — the caller must
 *   NOT re-dispatch effects or renew limits. No fresh budget/controller is
 *   constructed (AC-26: "no duplicated effects or renewed limits"); the
 *   existing execution's current/final status is authoritative. Resurrecting
 *   the live budget from the ledger is Slice 2 (live ledger-backed
 *   reservations).
 * - `conflict`: same submission ID, different request_hash →
 *   `SUBMISSION_CONFLICT`. The caller surfaces the conflict and must not
 *   persist a second row.
 */
export type StartBindingResult =
  | { readonly status: "created"; readonly binding: TaskExecutionBinding }
  | { readonly status: "reused"; readonly existing: ExistingExecutionSnapshot }
  | {
      readonly status: "conflict";
      readonly reasonCode: "SUBMISSION_CONFLICT";
      readonly existing: ExistingExecutionSnapshot;
    };

export interface StartManualInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly submissionId: string;
  readonly requestHash: string;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
  /**
   * Optional frozen contract (FR-19). When supplied, the coordinator persists
   * its snapshot + canonical hash at creation so a crash between enrollment
   * and finalization cannot lose the contract that authorized the work.
   * Null on response_only / best_effort routes without criteria.
   */
  readonly contract?: TaskCompletionContract | null;
  /**
   * Continue/retry lineage (FR-21/22). When set, the successor shares the
   * parent's lineage ledger (shared budget) and records its
   * `parent_execution_id`. The coordinator resurrects the budget from the
   * lineage ledger and reads `owner_generation` for the fenced lease.
   */
  readonly parentExecutionId?: string | null;
  readonly lineageLedgerId?: string | null;
}

/**
 * Continue input (FR-21, AC-27). The successor records `parent_execution_id`
 * and shares the parent's lineage ledger — spent allowance carries forward
 * and the budget mirror is resurrected from the ledger, never renewed.
 */
export type ContinueExecutionInput = Omit<
  StartManualInput,
  "parentExecutionId" | "lineageLedgerId" | "completionOwner"
> & {
  readonly parentExecutionId: string;
  readonly lineageLedgerId: string;
  readonly completionOwner?: "standalone" | "goal";
};

/**
 * Retry input (FR-22, AC-28). A disclosed new attempt: a NEW lineage ledger
 * (fresh bounded allowances, never an auto-refresh of the parent's exhausted
 * ones), `parent_execution_id` kept for lineage, and the contract re-frozen
 * by the caller when the request changed.
 */
export type RetryExecutionInput = Omit<
  StartManualInput,
  "parentExecutionId" | "lineageLedgerId" | "completionOwner"
> & {
  readonly parentExecutionId: string;
  readonly completionOwner?: "standalone" | "goal";
};

export interface StartScheduledInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly requestHash: string;
  readonly route: TaskExecutionRoute;
  readonly taskId: number;
  readonly runId: number;
  readonly occurrenceKey: string;
  readonly budgetLimits: BudgetLimitsInput;
}

/**
 * Manual-finalization input for the engine's completed-case gate (Unit 5).
 * Same fields as the model's `FinalizeInput` minus `expectedVersion` — the
 * coordinator reads the current version from the row (see finalizeManual).
 */
export interface FinalizeManualInput {
  readonly executionId: string;
  readonly outcome: FinalizeInput["outcome"];
  readonly reasonCode: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly remainingWork: readonly string[];
  readonly assistantResultMessageId?: string | null;
}

export class TaskExecutionCoordinator {
  private readonly module: AiTaskExecutionModule;

  constructor(module?: AiTaskExecutionModule) {
    // Constructed lazily — never at module top level (BaseModule TDZ).
    this.module = module ?? new AiTaskExecutionModule();
  }

  async startManual(input: StartManualInput): Promise<StartBindingResult> {
    const origin: TaskExecutionOrigin = {
      type: "manual",
      submissionId: input.submissionId,
    };
    return this.startBinding({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      requestHash: input.requestHash,
      route: input.route,
      completionOwner: input.completionOwner,
      origin,
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
      submissionId: input.submissionId,
      contract: input.contract ?? null,
      parentExecutionId: input.parentExecutionId ?? null,
      lineageLedgerId: input.lineageLedgerId ?? null,
    });
  }

  async startScheduled(
    input: StartScheduledInput
  ): Promise<StartBindingResult> {
    const origin: TaskExecutionOrigin = {
      type: "scheduled",
      taskId: input.taskId,
      runId: input.runId,
      occurrenceKey: input.occurrenceKey,
    };
    return this.startBinding({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      requestHash: input.requestHash,
      route: input.route,
      completionOwner: "standalone",
      origin,
      budgetLimits: input.budgetLimits,
      submissionId: null,
      contract: null,
      parentExecutionId: null,
      lineageLedgerId: null,
    });
  }

  /**
   * Freeze a completion contract (FR-19/04/18). Thin pass-through to
   * {@link TaskCompletionContractService.freeze} so the enrollment seam in
   * the IPC/engine layer calls one coordinator method instead of importing
   * the contract service directly. Throws on zero required criteria for
   * verified mode (FR-04) and on unapproved source references (FR-18).
   */
  freezeContract(input: FreezeInput): TaskCompletionContract {
    const service = new TaskCompletionContractService();
    return service.freeze(input);
  }

  /**
   * Finalize a manual execution at the engine's completed-case gate (FR-10/15,
   * AC-11/15). CAS-finalizes via the module and returns a typed result the
   * gate maps to emit/no-emit behavior.
   *
   * The caller (the engine gate) does NOT supply `expectedVersion` — the
   * binding does not carry the version token, and the gate runs after the
   * loop returns when the row's version is authoritative. The coordinator
   * reads the current version here via `module.getExecution` and passes it to
   * the CAS UPDATE:
   * - no row → `MISSING_TASK_OUTCOME` (ok:false);
   * - already finalized → `ALREADY_FINALIZED` no-op (the gate treats this as
   *   success — §6.3: the second finalizer never rewrites the outcome);
   * - `STATE_CONFLICT` (concurrent finalizer bumped the version between our
   *   read and the UPDATE) → re-read + retry ONCE; a second conflict surfaces
   *   `STATE_CONFLICT` (a newer owner won — never overwrite).
   */
  async finalizeManual(
    input: FinalizeManualInput
  ): Promise<FinalizeResult> {
    return this.finalizeWithCasRetry(input.executionId, (expectedVersion) =>
      this.module.finalizeExecution({
        executionId: input.executionId,
        expectedVersion,
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        summary: input.summary,
        evidenceIds: input.evidenceIds,
        remainingWork: input.remainingWork,
        assistantResultMessageId: input.assistantResultMessageId ?? null,
      })
    );
  }

  /**
   * Shared CAS-finalize skeleton for the manual-style paths
   * ({@link finalizeManual}, {@link cancel}): read the current version, run
   * the CAS UPDATE, and on `STATE_CONFLICT` re-read + retry ONCE.
   *
   * The caller does NOT supply `expectedVersion` — the binding does not carry
   * the version token, and these paths run when the row's version is
   * authoritative. The coordinator reads it via `module.getExecution`:
   * - no row → `MISSING_TASK_OUTCOME` (ok:false);
   * - already finalized → `ALREADY_FINALIZED` no-op (the terminal outcome is
   *   immutable — §6.3: the second finalizer never rewrites it);
   * - `STATE_CONFLICT` (concurrent finalizer bumped the version between our
   *   read and the UPDATE) → re-read + retry ONCE; a second conflict surfaces
   *   `STATE_CONFLICT` (a newer owner won — never overwrite).
   */
  private async finalizeWithCasRetry(
    executionId: string,
    attempt: (expectedVersion: number) => Promise<FinalizeResult>
  ): Promise<FinalizeResult> {
    const exec = await this.module.getExecution(executionId);
    if (!exec) {
      return { ok: false, reasonCode: "MISSING_TASK_OUTCOME" };
    }
    if (exec.finalized) {
      return { ok: true, alreadyFinalized: true };
    }

    const first = await attempt(exec.execution_state_version);
    if (first.ok || first.alreadyFinalized) return first;
    if (first.reasonCode !== "STATE_CONFLICT") return first;

    // STATE_CONFLICT: a concurrent finalizer bumped the version between our
    // read and the UPDATE. Re-read and retry ONCE — the row was not finalized
    // (the model distinguishes ALREADY_FINALIZED from STATE_CONFLICT), so a
    // retry against the fresh version usually lands. A second conflict means
    // ownership genuinely moved; surface it rather than overwrite.
    const fresh = await this.module.getExecution(executionId);
    if (!fresh) {
      return { ok: false, reasonCode: "MISSING_TASK_OUTCOME" };
    }
    if (fresh.finalized) {
      return { ok: true, alreadyFinalized: true };
    }
    return attempt(fresh.execution_state_version);
  }

  /**
   * Cancel an execution (FR-22, AC-23/24). Wired through the engine's
   * `stopActiveTurn`/`stopConversation` path BEFORE the turn's controller is
   * aborted, so the terminal outcome is committed while the row is still
   * owned. Finalizes with `cancelled` / `USER_CANCELLED` and no evidence or
   * remaining work — cancelled work is never `verified_complete` (D6).
   *
   * Same CAS-retry semantics as {@link finalizeManual}: ALREADY_FINALIZED is
   * a success no-op (a second stop click must be idempotent), a missing row
   * surfaces `MISSING_TASK_OUTCOME`, and a STATE_CONFLICT retries once.
   */
  async cancel(
    executionId: string,
    _expectedVersion?: number
  ): Promise<FinalizeResult> {
    return this.finalizeWithCasRetry(executionId, (expectedVersion) =>
      this.module.finalizeExecution({
        executionId,
        expectedVersion,
        outcome: "cancelled",
        reasonCode: "USER_CANCELLED",
        summary: "Cancelled by user request",
        evidenceIds: [],
        remainingWork: [],
        assistantResultMessageId: null,
      })
    );
  }

  /**
   * Continue an incomplete execution (FR-21, AC-27). Creates a successor
   * execution that shares the parent's lineage ledger: spent allowance
   * carries forward (the budget mirror is resurrected from the persisted
   * ledger counters) and the model bumps the ledger's `owner_generation` so
   * the successor holds the fenced lease — a stale ancestor's consult or
   * finalization CAS no longer matches. Exactly one active successor per
   * lineage; never auto-renews exhausted allowances.
   */
  async continueExecution(
    input: ContinueExecutionInput
  ): Promise<StartBindingResult> {
    return this.startManual({
      ...input,
      completionOwner: input.completionOwner ?? "standalone",
      parentExecutionId: input.parentExecutionId,
      lineageLedgerId: input.lineageLedgerId,
    });
  }

  /**
   * Explicitly retry a failed or cancelled execution (FR-22, AC-28). A
   * disclosed new attempt: a NEW lineage ledger with fresh bounded
   * allowances from the manual defaults (never an auto-refresh of the
   * parent's exhausted ones), `parent_execution_id` recorded for lineage,
   * and the contract re-frozen by the caller when the request changed.
   */
  async retryExecution(
    input: RetryExecutionInput
  ): Promise<StartBindingResult> {
    return this.startManual({
      ...input,
      completionOwner: input.completionOwner ?? "standalone",
      parentExecutionId: input.parentExecutionId,
      lineageLedgerId: null,
    });
  }

  /**
   * Finalize a scheduled execution (FR-12/13/15/17/18, §6.3). Thin
   * pass-through to {@link AiTaskExecutionModule.finalizeScheduledExecution}
   * — the runChatScheduledLoop runner supplies `expectedVersion` from the
   * binding captured at enrollment, and the model runs the multi-statement
   * transaction (CAS-finalize + ledger release + run row + schedule
   * counters + pause) serialized via `executionCreateMutex`.
   *
   * Unlike {@link finalizeManual}, no version retry here: the scheduled
   * binding's version is the enrollment snapshot, and a STATE_CONFLICT means
   * another finalizer genuinely owns the row — the model returns the typed
   * result and the runner maps a missing/conflicted outcome to
   * missing_outcome (never success, AC-15/17).
   */
  async finalizeScheduled(
    input: FinalizeScheduledInput
  ): Promise<FinalizeResult> {
    return this.module.finalizeScheduledExecution(input);
  }

  private async startBinding(input: {
    conversationId: string;
    sourceUserMessageId: string;
    requestHash: string;
    route: TaskExecutionRoute;
    completionOwner: "standalone" | "goal";
    origin: TaskExecutionOrigin;
    budgetLimits: BudgetLimitsInput;
    submissionId: string | null;
    contract: TaskCompletionContract | null;
    parentExecutionId: string | null;
    lineageLedgerId: string | null;
  }): Promise<StartBindingResult> {
    // Persist the frozen contract snapshot + hash at creation (FR-19) and
    // thread Continue/retry lineage through to the model (FR-21/22). The
    // contract snapshot is JSON we control; the canonical hash is the
    // contract's own contractHash field, recomputable by verifyHash on load.
    const contractSnapshotJson = input.contract
      ? JSON.stringify(input.contract)
      : null;
    const contractHash = input.contract?.contractHash ?? null;

    const started: CreateExecutionResult = await this.module.startExecution({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      submissionId: input.submissionId,
      requestHash: input.requestHash,
      origin: input.origin,
      route: input.route,
      completionOwner: input.completionOwner,
      budgetLimits: input.budgetLimits,
      parentExecutionId: input.parentExecutionId,
      lineageLedgerId: input.lineageLedgerId,
      contractSnapshotJson,
      contractHash,
    });

    // AC-26: a reused or conflicting submission must NOT construct a fresh
    // budget/controller — that would renew limits or duplicate the binding.
    // Propagate the typed result; the caller surfaces the existing/conflict
    // status and never re-dispatches effects.
    if (started.status === "reused") {
      return { status: "reused", existing: started.existing };
    }
    if (started.status === "conflict") {
      return {
        status: "conflict",
        reasonCode: "SUBMISSION_CONFLICT",
        existing: started.existing,
      };
    }

    // FR-21/22: a Continue successor shares the parent's lineage ledger. Its
    // budget mirror must be resurrected from the persisted ledger counters so
    // spent allowance carries forward — a fresh budget would silently reset
    // the lineage caps. A fresh start mints a new budget from the input
    // limits. The ledger row is the authoritative source of truth (§9); the
    // in-memory mirror is never authoritative itself.
    const budget = await this.resurrectOrFreshBudget(
      input.lineageLedgerId,
      input.budgetLimits
    );
    const controller = new TaskCompletionController();

    // FR-20 single-owner lease: the fenced owner_generation on the ledger is
    // the binding's leaseGeneration. The model bumps owner_generation when a
    // Continue successor takes ownership of the shared lineage ledger, so a
    // stale ancestor's consult/finalization CAS no longer matches and returns
    // STATE_CONFLICT. Read it from the ledger row so the in-memory binding
    // matches the persisted fence token.
    const leaseGeneration = await this.readLeaseGeneration(started.ledgerId);

    return {
      status: "created",
      binding: {
        executionId: started.executionId,
        conversationId: input.conversationId,
        sourceUserMessageId: input.sourceUserMessageId,
        origin: input.origin,
        route: input.route,
        completionOwner: input.completionOwner,
        leaseGeneration,
        ledgerId: started.ledgerId,
        contract: input.contract,
        contractHash,
        controller,
        budget,
      },
    };
  }

  /**
   * Resurrect the budget from the lineage ledger on Continue, or mint a fresh
   * one on a new execution. A missing lineage ledger (e.g. test stub without
   * a seeded row) falls back to a fresh budget so enrollment never crashes on
   * a coordinator-only test path — the authoritative counters come from the
   * ledger when it exists.
   */
  private async resurrectOrFreshBudget(
    lineageLedgerId: string | null,
    freshLimits: BudgetLimitsInput
  ): Promise<TaskRunBudget> {
    if (!lineageLedgerId) return new TaskRunBudget(freshLimits);
    const ledger = await this.module.getLedgerById(lineageLedgerId);
    if (!ledger) return new TaskRunBudget(freshLimits);
    return TaskRunBudget.resurrectFromLedger({
      policy_limits_json: ledger.policyLimitsJson,
      consumed_continuations: ledger.consumedContinuations,
      consumed_provider_attempts: ledger.consumedProviderAttempts,
      consumed_checker_attempts: ledger.consumedCheckerAttempts,
      consumed_tool_executions: ledger.consumedToolExecutions,
      consumed_tokens: ledger.consumedTokens,
      consumed_active_ms: ledger.consumedActiveMs,
      consumed_wait_ms: ledger.consumedWaitMs,
      no_progress_streak: ledger.noProgressStreak,
    });
  }

  /**
   * Read the fenced owner_generation for the lease (FR-20). Returns 0 when
   * the ledger is missing (coordinator-only test paths) so enrollment never
   * crashes before the model layer is wired.
   */
  private async readLeaseGeneration(ledgerId: string): Promise<number> {
    const ledger = await this.module.getLedgerById(ledgerId);
    return ledger?.ownerGeneration ?? 0;
  }

  /**
   * Single-owner lease guard (FR-20). Every consult/finalization must verify
   * the caller's `leaseGeneration` matches the binding's expected value; a
   * mismatch means a stale ancestor (a Continue successor has since taken
   * ownership of the lineage ledger) is attempting to act, and the operation
   * must be rejected with `STATE_CONFLICT` rather than overwriting a newer
   * owner's state.
   */
  assertOwnership(
    holder: { readonly leaseGeneration: number },
    expected: number
  ): { readonly ok: true } | { readonly ok: false; readonly reasonCode: "STATE_CONFLICT" } {
    if (holder.leaseGeneration !== expected) {
      return { ok: false, reasonCode: "STATE_CONFLICT" };
    }
    return { ok: true };
  }

  /** Serialize the binding for persistence; excludes runtime objects. */
  toSnapshot(binding: TaskExecutionBinding): TaskExecutionBindingSnapshot {
    return {
      executionId: binding.executionId,
      conversationId: binding.conversationId,
      sourceUserMessageId: binding.sourceUserMessageId,
      origin: binding.origin,
      route: binding.route,
      completionOwner: binding.completionOwner,
      leaseGeneration: binding.leaseGeneration,
      ledgerId: binding.ledgerId,
      contractHash: binding.contractHash,
    };
  }
}
