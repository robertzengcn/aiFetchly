import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import { ScheduleTaskEntity, ScheduleStatus } from "@/entity/ScheduleTask.entity";
import { assertNotWorker } from "@/model/workerDbGuard";
import { AsyncMutex } from "@/utils/asyncMutex";
import { randomUUID } from "node:crypto";
import {
  clampToHardCaps,
} from "@/service/aiTaskExecution/budgetDefaults";
import type {
  BudgetLimitsInput,
} from "@/service/aiTaskExecution/budgetDefaults";
import type {
  TaskExecutionOrigin,
  TaskExecutionRoute,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";
import {
  buildFinalizationCheckpointFields,
} from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Process-wide serializer for execution-create transactions. See
 * {@link AsyncMutex}: TypeORM's `connection.transaction()` over the
 * better-sqlite3 driver cannot run two transaction bodies concurrently on the
 * shared single connection — the second `BEGIN` throws "cannot start a
 * transaction within a transaction". Serializing the dedup-lookup + insert
 * makes the check-then-insert atomic relative to concurrent callers (the
 * second caller's lookup sees the first caller's committed row and resolves
 * to reused/conflict instead of colliding). The partial unique index remains
 * the SQL-level guarantee; the mutex removes the connection overlap.
 */
const executionCreateMutex = new AsyncMutex();

/**
 * Internal control-flow signals for the scheduled-finalization transaction.
 * Thrown inside the transaction body to roll back an abortive CAS (the
 * transaction must be rolled back when the execution CAS affected zero rows
 * — the run/schedule accounting that follows must never commit without a
 * finalized execution row). The module layer translates them into the typed
 * `FinalizeResult` variants.
 */
class AlreadyFinalizedError extends Error {
  constructor() {
    super("ALREADY_FINALIZED");
    this.name = "AlreadyFinalizedError";
  }
}

class StateConflictError extends Error {
  constructor() {
    super("STATE_CONFLICT");
    this.name = "StateConflictError";
  }
}

/**
 * T19 (FR-24, AC-32): the run/schedule/idempotency-key supplied to
 * `finalizeScheduledExecution` does not link back to the execution row being
 * finalized. Thrown inside the transaction so the whole finalization rolls
 * back — no partial schedule-accounting on an unrelated schedule.
 */
class LinkedRecordMismatchError extends Error {
  constructor() {
    super("LINKED_RECORD_MISMATCH");
    this.name = "LinkedRecordMismatchError";
  }
}

/**
 * T08 (FR-20/21/23/24, AC-25/27/29/32): the lineage ledger supplied to
 * `createExecution` for a Continue successor cannot be claimed. Thrown
 * inside the create transaction so the whole creation rolls back — no orphan
 * execution row pointing at a ledger it does not own. The module layer
 * translates it into a typed `denied` result so the caller surfaces a clear
 * denial instead of a raw SQLite error.
 *
 * Reasons (any one fails the CAS WHERE predicate):
 *  - the referenced ledger row does not exist (dangling `lineage_ledger_id`)
 *  - `status != 'active'` (the parent was finalized → ledger released, or
 *    was never activated)
 *  - `active_execution_id` already points at a DIFFERENT non-null successor
 *    (a concurrent Continue won the claim — one-active-successor fence)
 *
 * The claim is generation-checked: `owner_generation` is bumped atomically
 * as part of the same UPDATE, so a stale ancestor's subsequent
 * `persistBudgetConsumption`/`finalizeExecution` CAS affects zero rows.
 */
class LineageClaimError extends Error {
  readonly reason:
    | "LINEAGE_LEDGER_MISSING"
    | "LINEAGE_LEDGER_NOT_ACTIVE"
    | "LINEAGE_LEDGER_ALREADY_SUPERSEDED";
  constructor(
    reason:
      | "LINEAGE_LEDGER_MISSING"
      | "LINEAGE_LEDGER_NOT_ACTIVE"
      | "LINEAGE_LEDGER_ALREADY_SUPERSEDED"
  ) {
    super(reason);
    this.name = "LineageClaimError";
    this.reason = reason;
  }
}

/**
 * T20 (FR-03/09/24, §6.1): build the finalization checkpoint by MERGING the
 * finalization facts into the EXISTING `execution_state_json` object — never
 * replacing it. The previous form stringified a fresh
 * `{outcome, reasonCode, evidenceIds, ...}` object and wrote it over
 * `execution_state_json`, dropping evidence rows (key `evidence`), shadow
 * decisions (key `shadowDecision`), and any other per-run state accumulated
 * during the run (baselines, source evidence, progress history). Terminal
 * and Continue must retain that data (FR-03/24; AC-05/06/27/29).
 *
 * Parse failures and non-object legacy values are preserved under `__legacy`
 * (same mirror as `recordShadowDecision`), so corrupt legacy state is still
 * readable after finalization instead of silently discarded. Returns the
 * merged JSON string for the CAS UPDATE's `execution_state_json` parameter.
 */
function mergeFinalizationCheckpoint(
  existingStateJson: string | null,
  facts: {
    readonly outcome: TaskOutcome;
    readonly reasonCode: string;
    readonly evidenceIds: readonly string[];
    readonly remainingWork: readonly string[];
    readonly assistantResultMessageId?: string | null;
    readonly finalizedAt: string;
  }
): string {
  const existing: Record<string, unknown> = (() => {
    if (!existingStateJson) return {};
    try {
      const parsed = JSON.parse(existingStateJson) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { __legacy: parsed };
    } catch {
      return { __legacy: existingStateJson };
    }
  })();
  const checkpoint = buildFinalizationCheckpointFields(facts);
  const merged: Record<string, unknown> = {
    ...existing,
    finalization: checkpoint,
  };
  return JSON.stringify(merged);
}

export interface CreateExecutionInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly submissionId: string | null;
  readonly requestHash: string;
  readonly origin: TaskExecutionOrigin;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
  /**
   * Budget limits to freeze into ledger.policy_limits_json at creation time
   * (PRD §9, GAP-S1). Clamped to HARD_CAPS before persistence so a malformed
   * or hostile task config can never produce an unbounded budget ledger.
   */
  readonly budgetLimits: BudgetLimitsInput;
  /**
   * Continue/retry lineage (FR-21/22, Unit 3). When set, the new execution
   * shares the parent's lineage ledger (shared budget) and records its
   * `parent_execution_id`. A fresh start leaves both null and mints a new
   * ledger. `lineageLedgerId` defaults to the new execution's own ledger
   * when absent so the column is never null.
   */
  readonly parentExecutionId?: string | null;
  readonly lineageLedgerId?: string | null;
  /**
   * Frozen contract snapshot + canonical hash (FR-19, Unit 3). Persisted at
   * creation so a crash between enrollment and finalization cannot lose the
   * contract that authorized the work. Null when no contract was frozen
   * (response_only / best_effort without criteria).
   */
  readonly contractSnapshotJson?: string | null;
  readonly contractHash?: string | null;
}

/**
 * Read-only projection of a ledger row returned by {@link getLedgerById}.
 * The coordinator reads `owner_generation` (→ leaseGeneration fencing) and
 * the consumed/policy fields to resurrect a {@link TaskRunBudget} mirror on
 * the Continue path (FR-21/22, §9). Returned as a typed projection so the
 * coordinator layer does not depend on TypeORM column shapes.
 */
export interface LedgerSnapshot {
  readonly ledgerId: string;
  readonly ownerGeneration: number;
  readonly policyLimitsJson: string;
  readonly consumedContinuations: number;
  readonly consumedProviderAttempts: number;
  readonly consumedToolExecutions: number;
  readonly consumedCheckerAttempts: number;
  readonly consumedTokens: number;
  readonly consumedActiveMs: number;
  readonly consumedWaitMs: number;
  readonly noProgressStreak: number;
  readonly status: string;
  /**
   * T05: the CAS version token. Bumped by every state mutation
   * (`persistBudgetConsumption`, `applyShadowDecisionCas`, finalize).
   * Callers read it to fence their own CAS operations and to detect
   * concurrent mutations between a read and a subsequent write.
   */
  readonly executionStateVersion: number;
}

/**
 * Discriminated result of `createExecution` (AC-26, §4A.1).
 *
 * - `created`: a brand-new execution row was inserted. The caller proceeds
 *   with resolver/maker dispatch.
 * - `reused`: a row with the same `(conversation_id, submission_id)` and the
 *   same `request_hash` already exists. This is a transport retry of the same
 *   accepted submission; the caller must NOT re-dispatch effects or renew
 *   limits — the existing execution's current/final status is authoritative.
 *   `existing` carries that status snapshot.
 * - `conflict`: a row with the same `(conversation_id, submission_id)` exists
 *   but with a different `request_hash`. Same submission ID, different request
 *   payload — `SUBMISSION_CONFLICT`. The caller must surface the conflict and
 *   must not persist a second row.
 * - `denied` (T08): a Continue successor's lineage ledger could not be
 *   claimed. `reasonCode` distinguishes the failure mode — a dangling
 *   `lineage_ledger_id` (LINEAGE_LEDGER_MISSING), a finalized/released parent
 *   (LINEAGE_LEDGER_NOT_ACTIVE), or a concurrent Continue that already
 *   superseded the lease (LINEAGE_LEDGER_ALREADY_SUPERSEDED). The caller must
 *   surface the denial; NO execution row was persisted (the create
 *   transaction rolled back).
 *
 * Note that `submission_id` is nullable: scheduled-origin executions carry
 * `null` and are exempt from this dedup (their lineage key is the
 * `occurrence_key`); the partial unique index skips them.
 */
export type CreateExecutionResult =
  | {
      readonly status: "created";
      readonly executionId: string;
      readonly ledgerId: string;
      readonly executionRowId: number;
    }
  | {
      readonly status: "reused";
      readonly reasonCode?: never;
      readonly existing: ExistingExecutionSnapshot;
    }
  | {
      readonly status: "conflict";
      readonly reasonCode: "SUBMISSION_CONFLICT";
      readonly existing: ExistingExecutionSnapshot;
    }
  | {
      readonly status: "denied";
      readonly reasonCode:
        | "LINEAGE_LEDGER_MISSING"
        | "LINEAGE_LEDGER_NOT_ACTIVE"
        | "LINEAGE_LEDGER_ALREADY_SUPERSEDED";
      readonly existing?: never;
    };

/**
 * Read-only snapshot of an existing execution returned on reuse/conflict. We
 * return a typed projection rather than the raw entity so the coordinator
 * layer does not depend on TypeORM column shapes.
 */
export interface ExistingExecutionSnapshot {
  readonly executionId: string;
  readonly ledgerId: string;
  readonly conversationId: string | null;
  readonly submissionId: string | null;
  readonly requestHash: string | null;
  readonly stage: string;
  readonly finalized: boolean;
  readonly taskOutcome: string | null;
  readonly outcomeReasonCode: string | null;
  readonly executionStateVersion: number;
}

export interface FinalizeInput {
  readonly executionId: string;
  readonly expectedVersion: number;
  readonly outcome: TaskOutcome;
  readonly reasonCode: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly remainingWork: readonly string[];
  /**
   * The assistant result message produced by this execution, if any.
   * §6.3 step 2 requires the finalization to link "outcome, reason, linked
   * assistant result, evidence/counter summary". Previously this field was
   * absent and the result message id was never persisted at finalization,
   * despite being a §6.3 required field. Slice 1 has no evidence store, so
   * evidenceIds/remainingWork are persisted into execution_state_json as a
   * checkpoint instead of being silently dropped (B6).
   */
  readonly assistantResultMessageId?: string | null;
}

export interface FinalizeResult {
  readonly ok: boolean;
  readonly alreadyFinalized?: boolean;
  readonly reasonCode?: string;
}

/**
 * Input for the scheduled-finalization transaction (Unit 6, FR-12, §6.3).
 * Carries the REAL schedule id + run id explicitly — the execution row's
 * `schedule_id` column stores the TASK id (a known quirk of
 * `createExecution`), so the caller must not rely on it for schedule
 * accounting.
 */
export interface FinalizeScheduledInput {
  readonly executionId: string;
  readonly expectedVersion: number;
  readonly runId: number;
  readonly scheduleId: number;
  readonly taskOutcome: TaskOutcome;
  readonly reasonCode: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly remainingWork: readonly string[];
  readonly idempotencyKey: string;
  /**
   * Failed/incomplete/timeout increments the streak; cancelled never does.
   * Legacy boolean — still honoured for backward compatibility with the
   * ScheduledAiMessageRunner outcome mapping. When false, the streak
   * semantics derive from `taskOutcome` (T19): verified_complete resets to
   * 0, cancelled stays untouched, other outcomes increment.
   */
  readonly incrementFailure: boolean;
  /**
   * T19: explicit success override — reset consecutive_failure_count to 0
   * regardless of `incrementFailure`/`taskOutcome`. Callers that already
   * know the run succeeded (e.g. a verified contract) set this true instead
   * of relying on outcome derivation. Defaults false.
   */
  readonly resetStreak?: boolean;
  readonly nextRunAt: Date;
  readonly terminalStatus?: "expired" | "failed" | "stopped";
  readonly terminalReason?: string;
  readonly pause?: { readonly reason: string };
  readonly assistantResultMessageId?: string | null;
}

/**
 * Data-access layer for `ai_task_execution` + `ai_task_execution_ledger`
 * (technical-design §6.1/§6.3).
 *
 * Compare-and-set on `execution_state_version` guards concurrent
 * finalization: a stale-version finalizer never overwrites the outcome
 * or double-increments ledger counters (§6.3). The finalization is atomic
 * — a single `UPDATE … WHERE execution_state_version = :v AND finalized = 0`
 * with an affected-rows check, so two concurrent finalizers cannot both
 * pass the version check and the second receives `STATE_CONFLICT` or
 * `ALREADY_FINALIZED` based on the row state at update time (B2). The
 * ledger-owner release runs in the same transaction.
 *
 * `createExecution` writes the ledger and execution rows in a single
 * transaction so a crash between them cannot leave an orphan ledger whose
 * `active_execution_id` points at a nonexistent execution (B3). The dedup
 * lookup + insert run under a process-wide `AsyncMutex` so concurrent
 * same-(conversation, submission) callers serialize: the second sees the
 * first's committed row and resolves to `reused`/`conflict` instead of
 * colliding on the shared better-sqlite3 connection (AC-26, §4A.1). The
 * partial unique index on `(conversation_id, submission_id) WHERE
 * submission_id IS NOT NULL` is the SQL-level guarantee; the mutex removes
 * the connection overlap.
 *
 * Manual executions finalize without touching schedule rows; scheduled
 * origin (Slice 2) will share the transaction to update occurrence/schedule
 * counters atomically.
 *
 * Worker guard: every method calls `assertNotWorker` first — workers must
 * never touch these tables directly (NFR-03).
 */
export class AiTaskExecutionModel extends BaseDb {
  private executionRepo: Repository<AiTaskExecutionEntity>;
  private ledgerRepo: Repository<AiTaskExecutionLedgerEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.executionRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionEntity
    );
    this.ledgerRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
  }

  protected override onSqliteDbRebound(): void {
    this.executionRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionEntity
    );
    this.ledgerRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
  }

  async createExecution(
    input: CreateExecutionInput
  ): Promise<CreateExecutionResult> {
    assertNotWorker("createExecution");

    // Serialize the dedup-lookup + insert + (Continue) CAS claim. The mutex
    // makes check-then-insert atomic relative to concurrent callers: a racing
    // same-(conversation, submission) caller that reads null before the first
    // inserts instead waits, then sees the committed row and resolves to
    // reused/conflict. It also prevents two `createQueryRunner()` transaction
    // bodies from overlapping on the shared better-sqlite3 connection (which
    // would raise "cannot start a transaction within a transaction"). See
    // {@link AsyncMutex}. The mutex is NOT re-entered inside
    // `createExecutionInner` — the transaction body relies on this outer
    // serialization, so `AsyncMutex`'s non-re-entrant semantics are safe.
    return executionCreateMutex.run(() => this.createExecutionInner(input));
  }

  private async createExecutionInner(
    input: CreateExecutionInput
  ): Promise<CreateExecutionResult> {
    // AC-26 / §4A.1: scoped submission uniqueness. A non-null submissionId is
    // a transport-retry correlation key — the renderer generates and retains
    // it across retries. Before inserting, look up the existing row by
    // (conversation_id, submission_id). A null submissionId (scheduled origin)
    // is exempt: the partial unique index skips it, and the lineage key is the
    // occurrence_key, not the submission_id.
    if (input.submissionId !== null) {
      const existing = await this.executionRepo.findOne({
        where: {
          conversation_id: input.conversationId,
          submission_id: input.submissionId,
        },
      });
      if (existing) {
        // Same submission ID, different request payload — the canonical
        // request_hash mismatch means this is NOT a retry of the same
        // accepted message (§4A.1: "Same ID with a different request hash is
        // SUBMISSION_CONFLICT"). Surface the conflict; do not persist a
        // second row and do not overwrite the existing request.
        if (existing.request_hash !== input.requestHash) {
          return {
            status: "conflict",
            reasonCode: "SUBMISSION_CONFLICT",
            existing: this.toSnapshot(existing),
          };
        }
        // Same ID, same request hash — a genuine transport retry of the same
        // accepted submission. Return the existing execution's current/final
        // status; the caller must NOT re-dispatch effects or renew limits
        // (AC-26: "no duplicated effects or renewed limits").
        return {
          status: "reused",
          existing: this.toSnapshot(existing),
        };
      }
    }

    const executionId = `exec-${randomUUID()}`;
    // T08 (FR-20/21/23/24, AC-25/27/29/32): a Continue successor SHARES the
    // parent's lineage ledger — `ledger_id` points at the same row, so the
    // successor's spent allowance IS the parent's persisted counters (the
    // budget mirror resurrects them). A fresh start (manual/retry) mints a
    // new ledger with zero counters. The shared ledger is claimed atomically
    // inside the create transaction: the CAS UPDATE below bumps
    // `owner_generation`, repoints `active_execution_id` to the successor,
    // and flips `status` released→active (the parent finalize released it;
    // the successor reactivates it so its own spend CAS, which requires
    // status='active', can spend against it). The predicate requires the
    // ledger be in `released` state with no active successor — a concurrent
    // Continue that won the claim leaves it `active` with a non-null
    // `active_execution_id`, so this UPDATE affects zero rows and the whole
    // transaction rolls back, surfacing as a typed `denied` result. A
    // missing/dangling ledger fails closed the same way.
    // Loose-equality `!= null` covers both `null` and `undefined`: a fresh
    // start omits `lineageLedgerId` entirely (it arrives as `undefined`), and
    // `undefined !== null` is `true` — which would wrongly route fresh starts
    // into the Continue branch and deny them. `!= null` is the deliberate
    // exception to the project's `!==` default and is called out here so a
    // future lint pass does not "fix" it back into the bug.
    const isContinueSuccessor = input.lineageLedgerId != null;
    const sharedLedgerId = input.lineageLedgerId ?? `ledger-${randomUUID()}`;

    // Both rows in one transaction so a crash between saves cannot leave an
    // orphan ledger pointing at a nonexistent execution (B3, §6.2). The outer
    // `createExecution` mutex guarantees no concurrent transaction overlaps
    // this one on the shared connection, so the unique-constraint catch below
    // is defense-in-depth.
    //
    // T08: we use `createQueryRunner()` + `startTransaction()` (matching
    // `finalizeExecution`) rather than `connection.transaction(async (manager)
    // => ...)` because the Continue branch must run a CAS UPDATE that reads
    // `.affected`. `manager.query()` / `connection.query()` only forward
    // `(sql, params)` to the driver — they drop any third argument — so the
    // structured-result flag (`useStructuredResult=true`) that exposes
    // `.affected` on better-sqlite3 must go through the driver QueryRunner
    // directly (see the long note in `finalizeExecution`).
    try {
      const saved = await (async () => {
        const runner = this.sqliteDb.connection.createQueryRunner();
        await runner.startTransaction();
        try {
          const manager = runner.manager;
          if (isContinueSuccessor) {
            // T08: validate parent eligibility inside the trusted model
            // boundary (defense-in-depth alongside the IPC check). The
            // parent execution must exist, be finalized, and have a
            // continuable outcome. A missing parent (or a lineage_ledger_id
            // that does not match the parent's own lineage pointer) means
            // the caller wired the wrong ledger — fail closed. An active
            // (non-finalized) parent must be stopped first. A
            // verified_complete/cancelled parent is immutable — use Retry.
            const parentExecutionId = input.parentExecutionId;
            if (parentExecutionId === null) {
              // Continue successor without a parent_execution_id is a
              // wiring error (the coordinator always pairs them). Fail
              // closed rather than persisting an orphan lineage pointer.
              throw new LineageClaimError("LINEAGE_LEDGER_MISSING");
            }
            const parent = await manager.findOne(AiTaskExecutionEntity, {
              where: { execution_id: parentExecutionId },
            });
            if (!parent || parent.lineage_ledger_id !== sharedLedgerId) {
              throw new LineageClaimError("LINEAGE_LEDGER_MISSING");
            }
            if (!parent.finalized) {
              // Parent still running — cannot continue an active execution.
              throw new LineageClaimError("LINEAGE_LEDGER_NOT_ACTIVE");
            }
            const parentOutcome = parent.task_outcome;
            const continuable =
              parentOutcome === "incomplete" ||
              parentOutcome === "needs_user_input" ||
              parentOutcome === "blocked_by_policy" ||
              parentOutcome === "timeout" ||
              parentOutcome === "failed";
            if (!continuable) {
              // verified_complete (immutable) or cancelled (use Retry) —
              // the parent's lineage is not continuable.
              throw new LineageClaimError("LINEAGE_LEDGER_NOT_ACTIVE");
            }

            // CAS-claim the shared lineage ledger. The SET flips
            // status released→active: the successor reactivates the
            // ledger so its persistBudgetConsumption CAS (which requires
            // status='active') can spend against it. `owner_generation +
            // 1` is the fenced lease token — the successor's binding reads
            // it as leaseGeneration, so a stale ancestor's subsequent
            // persistBudgetConsumption / finalizeExecution CAS (still
            // keyed on the old generation) affects zero rows. The
            // execution_state_version bump lets a re-read detect the
            // concurrent claim.
            //
            // The WHERE predicate enforces one-active-successor +
            // immutable parent outcome:
            //  - `status = 'released'` — the parent finalized and its
            //    finalize transaction released the ledger (T11 made the
            //    outcome CAS + ledger release atomic, so finalized=true
            //    implies status='released'). An active (non-finalized)
            //    parent still holds status='active' and was rejected above.
            //  - `active_execution_id IS NULL` — finalize set it to NULL
            //    on release; a concurrent Continue that won the claim
            //    leaves active_execution_id non-null and status='active',
            //    so this UPDATE affects zero rows and throws
            //    LineageClaimError, rolling the whole create back so only
            //    one successor exists.
            const claim = (await runner.query(
              `UPDATE ai_task_execution_ledger
                  SET active_execution_id = ?,
                      owner_generation = owner_generation + 1,
                      execution_state_version = execution_state_version + 1,
                      status = 'active'
                WHERE ledger_id = ?
                  AND status = 'released'
                  AND active_execution_id IS NULL`,
              [executionId, sharedLedgerId],
              true // useStructuredResult — exposes .affected on the driver
            )) as { affected?: number };
            if ((claim.affected ?? 0) !== 1) {
              // The CAS failed despite the eligibility check passing. The
              // mutex serializes creates, so no concurrent create
              // interleaved between the parent read and this UPDATE. The
              // only remaining causes are a dangling ledger row (the
              // parent execution exists but its lineage ledger row does
              // not) or a concurrent Continue that already claimed the
              // ledger in a prior committed critical section. Re-read to
              // distinguish.
              const ledgerRow = await manager.findOne(
                AiTaskExecutionLedgerEntity,
                { where: { ledger_id: sharedLedgerId } }
              );
              if (!ledgerRow) {
                throw new LineageClaimError("LINEAGE_LEDGER_MISSING");
              }
              throw new LineageClaimError("LINEAGE_LEDGER_ALREADY_SUPERSEDED");
            }
          } else {
            // Fresh start: mint a new ledger with zero counters + the clamped
            // budget limits frozen in (GAP-S1).
            const ledger = new AiTaskExecutionLedgerEntity();
            ledger.ledger_id = sharedLedgerId;
            // GAP-S1: freeze the clamped budget limits into
            // policy_limits_json so the persisted ledger never exceeds
            // HARD_CAPS, even if the in-memory TaskRunBudget is later
            // tampered with. Previously this wrote "{}", losing the budget
            // entirely.
            ledger.policy_limits_json = JSON.stringify(
              clampToHardCaps(input.budgetLimits)
            );
            ledger.consumed_continuations = 0;
            ledger.consumed_provider_attempts = 0;
            ledger.consumed_tool_executions = 0;
            ledger.consumed_checker_attempts = 0;
            ledger.consumed_tokens = 0;
            ledger.consumed_active_ms = 0;
            ledger.consumed_wait_ms = 0;
            ledger.no_progress_streak = 0;
            ledger.active_execution_id = executionId;
            ledger.owner_generation = 0;
            ledger.status = "active";
            await manager
              .getRepository(AiTaskExecutionLedgerEntity)
              .save(ledger);
          }

          const exec = new AiTaskExecutionEntity();
          exec.execution_id = executionId;
          exec.conversation_id = input.conversationId;
          exec.source_user_message_id = input.sourceUserMessageId;
          exec.submission_id = input.submissionId;
          exec.assistant_result_message_id = null;
          exec.request_hash = input.requestHash;
          exec.origin_type = input.origin.type;
          exec.route = input.route;
          exec.completion_owner = input.completionOwner;
          exec.stage = "resolving";
          exec.schedule_id =
            input.origin.type === "scheduled" ? input.origin.taskId : null;
          exec.run_id =
            input.origin.type === "scheduled" ? input.origin.runId : null;
          exec.occurrence_key =
            input.origin.type === "scheduled"
              ? input.origin.occurrenceKey
              : null;
          // T08: on Continue the successor's own ledger_id IS the shared
          // parent ledger; on a fresh start it's the new ledger just minted.
          exec.ledger_id = sharedLedgerId;
          // Lineage points at the shared parent ledger on Continue, or this
          // row's own ledger on a fresh start (FR-21/22).
          exec.lineage_ledger_id = sharedLedgerId;
          // parent_execution_id is set only on Continue/retry successors.
          exec.parent_execution_id = input.parentExecutionId ?? null;
          // FR-19: persist the frozen contract snapshot + canonical hash at
          // creation so a crash between enrollment and finalization cannot
          // lose the contract that authorized the work. Null when no
          // contract was frozen (response_only / best_effort without
          // criteria).
          exec.contract_snapshot_json = input.contractSnapshotJson ?? null;
          exec.contract_hash = input.contractHash ?? null;
          exec.policy_snapshot_json = null;
          exec.execution_state_json = null;
          exec.execution_state_version = 0;
          exec.finalized = false;
          exec.finalized_at = null;
          exec.task_outcome = null;
          exec.outcome_reason_code = null;
          exec.outcome_summary = null;
          exec.final_event_identity = null;
          exec.delivery_state = null;
          const savedExec = await manager
            .getRepository(AiTaskExecutionEntity)
            .save(exec);
          await runner.commitTransaction();
          return savedExec;
        } catch (err) {
          await runner.rollbackTransaction();
          throw err;
        } finally {
          await runner.release();
        }
      })();

      return {
        status: "created",
        executionId,
        ledgerId: sharedLedgerId,
        executionRowId: saved.id,
      };
    } catch (error) {
      // T08: a lineage claim failure must surface as a typed denial, not a
      // raw throw. The transaction already rolled back, so no orphan
      // execution/ledger rows exist.
      if (error instanceof LineageClaimError) {
        return {
          status: "denied",
          reasonCode: error.reason,
        };
      }
      // Defense-in-depth: the mutex serializes callers, so a unique-constraint
      // violation here means the row appeared between the lookup and the
      // insert within this same critical section (only possible if a separate
      // code path inserts without the mutex — none exists today). Resolve to
      // reused/conflict instead of surfacing a raw SQLite UNIQUE error, then
      // fall through to re-throw for any other error.
      if (this.isUniqueConstraintError(error) && input.submissionId !== null) {
        const winner = await this.executionRepo.findOne({
          where: {
            conversation_id: input.conversationId,
            submission_id: input.submissionId,
          },
        });
        if (winner) {
          if (winner.request_hash !== input.requestHash) {
            return {
              status: "conflict",
              reasonCode: "SUBMISSION_CONFLICT",
              existing: this.toSnapshot(winner),
            };
          }
          return {
            status: "reused",
            existing: this.toSnapshot(winner),
          };
        }
      }
      throw error;
    }
  }

  /**
   * Project a loaded entity into the read-only snapshot returned on
   * reuse/conflict. Centralizes the column→field mapping so the coordinator
   * layer never touches TypeORM column shapes.
   */
  private toSnapshot(
    exec: AiTaskExecutionEntity
  ): ExistingExecutionSnapshot {
    return {
      executionId: exec.execution_id,
      ledgerId: exec.ledger_id,
      conversationId: exec.conversation_id,
      submissionId: exec.submission_id,
      requestHash: exec.request_hash,
      stage: exec.stage,
      finalized: exec.finalized,
      taskOutcome: exec.task_outcome,
      outcomeReasonCode: exec.outcome_reason_code,
      executionStateVersion: exec.execution_state_version,
    };
  }

  async getById(executionId: string): Promise<AiTaskExecutionEntity | null> {
    assertNotWorker("getById");
    return this.executionRepo.findOne({
      where: { execution_id: executionId },
    });
  }

  /**
   * Load a ledger row as a typed projection (FR-21/22, §9). The coordinator
   * reads `owner_generation` (→ leaseGeneration fencing) and the consumed +
   * policy fields to resurrect a {@link TaskRunBudget} mirror on the
   * Continue path so a successor shares the parent's spent allowance.
   */
  async getLedgerById(ledgerId: string): Promise<LedgerSnapshot | null> {
    assertNotWorker("getLedgerById");
    const ledger = await this.ledgerRepo.findOne({
      where: { ledger_id: ledgerId },
    });
    if (!ledger) return null;
    return {
      ledgerId: ledger.ledger_id,
      ownerGeneration: ledger.owner_generation,
      policyLimitsJson: ledger.policy_limits_json,
      consumedContinuations: ledger.consumed_continuations,
      consumedProviderAttempts: ledger.consumed_provider_attempts,
      consumedToolExecutions: ledger.consumed_tool_executions,
      consumedCheckerAttempts: ledger.consumed_checker_attempts,
      consumedTokens: ledger.consumed_tokens,
      consumedActiveMs: ledger.consumed_active_ms,
      consumedWaitMs: ledger.consumed_wait_ms,
      noProgressStreak: ledger.no_progress_streak,
      status: ledger.status,
      executionStateVersion: ledger.execution_state_version,
    };
  }

  /**
   * T05 (FR-08/10/23, AC-06/08/22/27/29): atomically increment the ledger's
   * consumed counters and bump the CAS version, fenced by `owner_generation`
   * and `active_execution_id`. This is the durable counterpart to the
   * in-memory {@link TaskRunBudget.reserve*} / `addActiveRuntime` /
   * `addWaitMs` / `reconcileTokens` calls — the in-memory object is a mirror;
   * the ledger row is authoritative. Persisting consumption at actual dispatch
   * (not only at finalize) is what makes a pause/reconstruct/resume/Continue
   * carry exact spent totals forward and prevent exhausted work from
   * dispatching (T05 regression).
   *
   * The WHERE predicate enforces single-owner lease fencing:
   *  - `active_execution_id = ?` — only the currently-active execution may
   *    spend against this ledger. A released ledger (post-finalize) is
   *    immutable; a successor that has not yet claimed the lineage ledger
   *    cannot spend against the parent's row.
   *  - `owner_generation = ?` — the fenced lease generation. A stale
   *    binding whose `leaseGeneration` was superseded by a Continue successor
   *    (which bumps `owner_generation` when it claims the shared lineage
   *    ledger) affects zero rows and returns false.
   *  - `status = 'active'` — defense-in-depth: a released ledger is immutable
   *    even if `active_execution_id` lags the release.
   *
   * Returns true when exactly one row was affected (the consumption was
   * durably recorded and the version bumped). Returns false when the ledger
   * is missing, released, owned by a different execution, or at a different
   * generation — callers must fail-closed (FR-08: refuse to dispatch when
   * persistence fails). The in-memory mirror has already incremented by the
   * time this is called; a false return therefore desynchronizes the mirror
   * from the ledger, which the caller surfaces as a persistence error rather
   * than silently accepting.
   *
   * Single atomic statement (no transaction wrapper): the UPDATE is the
   * atomic unit — better-sqlite3 evaluates the WHERE predicate and SET in one
   * step, so two concurrent dispatches cannot both succeed against the same
   * generation. The `execution_state_version + 1` bump is the CAS token a
   * subsequent finalizer or resurrector re-reads.
   */
  async persistBudgetConsumption(input: {
    readonly ledgerId: string;
    readonly expectedOwnerGeneration: number;
    readonly activeExecutionId: string;
    readonly delta: {
      readonly continuations?: number;
      readonly providerAttempts?: number;
      readonly toolExecutions?: number;
      readonly checkerAttempts?: number;
      readonly tokens?: number;
      readonly activeRuntimeMs?: number;
      readonly waitMs?: number;
      readonly noProgressStreak?: number;
    };
  }): Promise<boolean> {
    assertNotWorker("persistBudgetConsumption");
    const d = input.delta;
    const runner = this.sqliteDb.connection.createQueryRunner();
    try {
      const result = (await runner.query(
        `UPDATE ai_task_execution_ledger
            SET consumed_continuations = consumed_continuations + ?,
                consumed_provider_attempts = consumed_provider_attempts + ?,
                consumed_tool_executions = consumed_tool_executions + ?,
                consumed_checker_attempts = consumed_checker_attempts + ?,
                consumed_tokens = consumed_tokens + ?,
                consumed_active_ms = consumed_active_ms + ?,
                consumed_wait_ms = consumed_wait_ms + ?,
                no_progress_streak = no_progress_streak + ?,
                execution_state_version = execution_state_version + 1
          WHERE ledger_id = ?
            AND active_execution_id = ?
            AND owner_generation = ?
            AND status = 'active'`,
        [
          d.continuations ?? 0,
          d.providerAttempts ?? 0,
          d.toolExecutions ?? 0,
          d.checkerAttempts ?? 0,
          d.tokens ?? 0,
          d.activeRuntimeMs ?? 0,
          d.waitMs ?? 0,
          d.noProgressStreak ?? 0,
          input.ledgerId,
          input.activeExecutionId,
          input.expectedOwnerGeneration,
        ],
        true // useStructuredResult — exposes .affected (see finalizeExecution)
      )) as { affected?: number };
      return (result.affected ?? 0) === 1;
    } finally {
      await runner.release();
    }
  }

  async finalizeExecution(input: FinalizeInput): Promise<FinalizeResult> {
    assertNotWorker("finalizeExecution");

    // First detect missing execution (no row to update) before the CAS. This
    // is a read, not a check-then-act on the CAS field — the CAS UPDATE below
    // is the atomic guard.
    const exec = await this.executionRepo.findOne({
      where: { execution_id: input.executionId },
    });
    if (!exec) {
      return { ok: false, reasonCode: "MISSING_TASK_OUTCOME" };
    }
    if (exec.finalized) {
      // §6.3: a second finalizer returns the existing outcome; counters
      // never increment twice.
      return {
        ok: false,
        alreadyFinalized: true,
        reasonCode: "ALREADY_FINALIZED",
      };
    }

    // B6 + T20: persist the evidenceIds/remainingWork checkpoint and the
    // assistant result message id so caller inputs are not silently dropped.
    // T20: MERGE into the existing execution_state_json (preserving evidence
    // rows, shadow decisions, and any prior state) instead of replacing it —
    // see {@link mergeFinalizationCheckpoint}.
    const checkpoint = mergeFinalizationCheckpoint(
      exec.execution_state_json,
      {
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        evidenceIds: input.evidenceIds,
        remainingWork: input.remainingWork,
        assistantResultMessageId: input.assistantResultMessageId ?? null,
        finalizedAt: new Date().toISOString(),
      }
    );

    // T11 (FR-12/20/24, NFR-10, AC-15/32): the terminal CAS and the fenced
    // owner release commit in ONE transaction serialized via the same
    // `executionCreateMutex` that serializes `createExecution` and
    // `finalizeScheduledExecution`. The previous form ran two independent
    // atomic statements with no shared transaction: a real SQLite trigger
    // failure on the ledger UPDATE left `finalized=1`, outcome incomplete,
    // and the ledger still `active`; a retry returned `ALREADY_FINALIZED`
    // and could not repair the release. A competing transaction that
    // rolled back a sibling QueryRunner could also roll back a manual
    // outcome that had already reported committed success. Wrapping both
    // writes in one committed transaction makes the durable outcome and the
    // owner release all-or-nothing; on any ledger-release failure the CAS
    // rolls back too, so the execution stays unfinalized and a retry
    // succeeds. The CAS predicate (`execution_state_version = ? AND
    // finalized = 0`) still guarantees exactly one competing finalizer wins.
    //
    // IMPORTANT: `manager.query()` / `connection.query()` only forward
    // (sql, params) to the driver — they drop any third argument.
    // better-sqlite3 exposes the affected-row count ONLY when
    // `useStructuredResult=true` is passed directly to the driver
    // QueryRunner.query(); the plain return is `lastInsertRowid` (a number),
    // not `{changes}`. So we reach the driver QueryRunner via
    // `this.sqliteDb.connection.createQueryRunner().query(..., true)` (a
    // fresh runner we release ourselves) to get `.affected`. Calling
    // `connection.query(sql, params, true)` would silently return
    // lastInsertRowid, `.affected` would be undefined, and every finalization
    // would wrongly report STATE_CONFLICT.
    const finalEventIdentity = `execution-result:${input.executionId}`;
    try {
      await executionCreateMutex.run(async () => {
        const runner = this.sqliteDb.connection.createQueryRunner();
        await runner.startTransaction();
        try {
          const manager = runner.manager;

          // 1. CAS-finalize the execution row (B2). A single UPDATE is
          // atomic in SQLite — the WHERE predicate is evaluated atomically
          // with the SET, so two concurrent finalizers racing on the same
          // expectedVersion cannot both succeed: exactly one UPDATE affects
          // a row, the other affects zero rows. The transaction wrapper
          // does not change the CAS semantics; it couples the outcome to
          // the ledger release below so neither commits without the other.
          const casResult = (await runner.query(
            `UPDATE ai_task_execution
               SET finalized = 1,
                   finalized_at = ?,
                   task_outcome = ?,
                   outcome_reason_code = ?,
                   outcome_summary = ?,
                   final_event_identity = ?,
                   execution_state_version = execution_state_version + 1,
                   stage = 'terminal',
                   execution_state_json = ?,
                   assistant_result_message_id = COALESCE(?, assistant_result_message_id)
             WHERE execution_id = ?
               AND execution_state_version = ?
               AND finalized = 0`,
            [
              new Date().toISOString(),
              input.outcome,
              input.reasonCode,
              input.summary,
              finalEventIdentity,
              checkpoint,
              input.assistantResultMessageId ?? null,
              input.executionId,
              input.expectedVersion,
            ],
            true // useStructuredResult — exposes .affected on the driver result
          )) as { affected?: number };
          if ((casResult.affected ?? 0) !== 1) {
            // Between our read and the UPDATE, a concurrent finalizer either
            // bumped the version (STATE_CONFLICT) or finalized the row
            // (ALREADY_FINALIZED). Re-read inside the transaction to
            // distinguish. Either way the CAS affected zero rows — nothing
            // is committed by this transaction.
            const fresh = await manager.findOne(AiTaskExecutionEntity, {
              where: { execution_id: input.executionId },
            });
            if (fresh?.finalized) {
              throw new AlreadyFinalizedError();
            }
            throw new StateConflictError();
          }

          // 2. Release the ledger owner (§6.3). Spent allowance persists. Now
          // inside the same transaction as the CAS — a failure here rolls
          // back the CAS too, so the execution stays unfinalized and a retry
          // can repair the release instead of returning ALREADY_FINALIZED
          // (the original T11 bug).
          await manager.query(
            `UPDATE ai_task_execution_ledger
                SET active_execution_id = NULL,
                    status = 'released',
                    execution_state_version = execution_state_version + 1
              WHERE ledger_id = ?`,
            [exec.ledger_id]
          );

          await runner.commitTransaction();
        } catch (txError) {
          await runner.rollbackTransaction();
          throw txError;
        } finally {
          await runner.release();
        }
      });
    } catch (error) {
      if (error instanceof AlreadyFinalizedError) {
        return {
          ok: false,
          alreadyFinalized: true,
          reasonCode: "ALREADY_FINALIZED",
        };
      }
      if (error instanceof StateConflictError) {
        return { ok: false, reasonCode: "STATE_CONFLICT" };
      }
      throw error;
    }

    return { ok: true };
  }

  /**
   * Scheduled finalization in ONE transaction (GAP-S2 #9, FR-12, §6.3,
   * AC-32): CAS-finalize the execution + release the ledger + update the run
   * row + update schedule counters + pause-if-needed, all serialized via the
   * `executionCreateMutex` so the multi-statement transaction cannot overlap
   * a concurrent `createExecution` on the single better-sqlite3 connection.
   *
   * Missing execution → `MISSING_TASK_OUTCOME` (ok:false) and NO schedule
   * accounting happens (never fall back to success). Already finalized →
   * ok:false alreadyFinalized (the outcome is immutable; counters increment
   * at most once). CAS conflict → STATE_CONFLICT; the caller re-reads.
   */
  async finalizeScheduledExecution(
    input: FinalizeScheduledInput
  ): Promise<FinalizeResult> {
    assertNotWorker("finalizeScheduledExecution");

    const exec = await this.executionRepo.findOne({
      where: { execution_id: input.executionId },
    });
    if (!exec) {
      return { ok: false, reasonCode: "MISSING_TASK_OUTCOME" };
    }
    if (exec.finalized) {
      // §6.3: counters increment at most once — repeated finalization
      // never re-applies schedule accounting.
      return {
        ok: false,
        alreadyFinalized: true,
        reasonCode: "ALREADY_FINALIZED",
      };
    }

    // T20: MERGE the finalization facts into the existing
    // execution_state_json (preserving evidence rows, shadow decisions, and
    // prior state) instead of replacing it — see
    // {@link mergeFinalizationCheckpoint}.
    const checkpoint = mergeFinalizationCheckpoint(
      exec.execution_state_json,
      {
        outcome: input.taskOutcome,
        reasonCode: input.reasonCode,
        evidenceIds: input.evidenceIds,
        remainingWork: input.remainingWork,
        assistantResultMessageId: input.assistantResultMessageId ?? null,
        finalizedAt: new Date().toISOString(),
      }
    );
    const finalEventIdentity = `execution-result:${input.executionId}`;

    // T19 (FR-12/24, AC-04/05/10/15/32): three-way failure-streak semantics
    // derived from taskOutcome. The prior `incrementFailure` boolean only
    // encoded increment-vs-leave-untouched, so verified_complete (callers pass
    // incrementFailure=false) LEFT the streak untouched — a failure → success
    // → failure sequence grew the streak across the success and triggered
    // premature REPEATED_RUN_FAILURE. The fix:
    //   - verified_complete → reset consecutive_failure_count to 0 (success
    //     breaks the failure streak, matching ScheduleTask.model.ts:869).
    //   - cancelled → leave untouched (FR-12: cancellation is neither a
    //     failure nor a success; neither reset nor increment).
    //   - incomplete/failed/timeout/blocked_by_policy/needs_user_input →
    //     increment (failure streak grows).
    // `resetStreak` on the input (set explicitly by callers that want
    // success-semantics without relying on the outcome) takes precedence;
    // otherwise the outcome decides. `incrementFailure=true` still honoured
    // for backward compatibility with the existing mapping at
    // ScheduledAiMessageRunner.ts:1505 — when set it forces increment.
    const streakMode: "reset" | "increment" | "untouched" = (() => {
      if (input.resetStreak === true) return "reset";
      if (input.incrementFailure) return "increment";
      if (input.taskOutcome === "verified_complete") return "reset";
      if (input.taskOutcome === "cancelled") return "untouched";
      return "increment";
    })();

    try {
      await executionCreateMutex.run(async () => {
        // Manually-managed QueryRunner transaction (mirrors TypeORM's own
        // `transaction()` internals). We CANNOT use
        // `connection.transaction((manager) => ...)` here: EntityManager.query
        // forwards only (sql, params) to DataSource.query, which drops any
        // third argument — so the transaction manager can never request
        // `useStructuredResult=true` and `.affected` stays undefined. A manual
        // runner reaches the driver QueryRunner directly (3-arg query works)
        // while `runner.manager` still provides the transactional entity
        // manager for the entity updates below.
        const runner = this.sqliteDb.connection.createQueryRunner();
        await runner.startTransaction();
        try {
          const manager = runner.manager;

          // 0. T19 (FR-24, AC-32): linked-record validation — the run row
          // must belong to this execution (exec.run_id set at create time)
          // and to the supplied schedule, and the run's idempotency key must
          // match the finalize input. A mismatch means the caller wired the
          // wrong run/schedule to the execution — abort the whole transaction
          // with LINKED_RECORD_MISMATCH and update nothing (no partial
          // finalization, no schedule accounting). This guards against a
          // wrong-schedule count increment that would silently corrupt the
          // streak/next-run accounting of an unrelated schedule.
          const runRow = await manager.findOne(AiMessageTaskRunEntity, {
            where: { id: input.runId },
          });
          const scheduleRow = await manager.findOne(ScheduleTaskEntity, {
            where: { id: input.scheduleId },
          });
          const linkedOk =
            runRow !== null &&
            scheduleRow !== null &&
            (exec.run_id === null || exec.run_id === input.runId) &&
            runRow.schedule_id === input.scheduleId &&
            runRow.task_id === scheduleRow.task_id &&
            (runRow.idempotency_key === null ||
              runRow.idempotency_key === input.idempotencyKey);
          if (!linkedOk) {
            throw new LinkedRecordMismatchError();
          }

          // 1. CAS-finalize the execution row (same predicate as
          // finalizeExecution so a concurrent finalizer still loses).
          const casResult = (await runner.query(
            `UPDATE ai_task_execution
               SET finalized = 1,
                   finalized_at = ?,
                   task_outcome = ?,
                   outcome_reason_code = ?,
                   outcome_summary = ?,
                   final_event_identity = ?,
                   execution_state_version = execution_state_version + 1,
                   stage = 'terminal',
                   execution_state_json = ?,
                   assistant_result_message_id = COALESCE(?, assistant_result_message_id)
             WHERE execution_id = ?
               AND execution_state_version = ?
               AND finalized = 0`,
            [
              new Date().toISOString(),
              input.taskOutcome,
              input.reasonCode,
              input.summary,
              finalEventIdentity,
              checkpoint,
              input.assistantResultMessageId ?? null,
              input.executionId,
              input.expectedVersion,
            ],
            true // useStructuredResult — exposes .affected on the driver result
          )) as { affected?: number };
          if ((casResult.affected ?? 0) !== 1) {
            const fresh = await manager.findOne(AiTaskExecutionEntity, {
              where: { execution_id: input.executionId },
            });
            if (fresh?.finalized) {
              throw new AlreadyFinalizedError();
            }
            throw new StateConflictError();
          }

          // 2. Release the ledger owner (§6.3). Spent allowance persists.
          await manager.query(
            `UPDATE ai_task_execution_ledger
                SET active_execution_id = NULL,
                    status = 'released',
                    execution_state_version = execution_state_version + 1
              WHERE ledger_id = ?`,
            [exec.ledger_id]
          );

          // 3. Update the run row: link the execution + outcome + terminal
          // status (FR-12 §6.3 step 2 — outcome, reason, summary linked and
          // the row leaves "pending"/"running" before terminal events). The
          // run status derives from the task outcome: verified_complete →
          // completed; incomplete → incomplete; needs_user_input →
          // needs_user_input; failed/timeout → failed/timeout; everything
          // else (cancelled, blocked_by_policy) maps 1:1.
          const runStatus: AiMessageTaskRunEntity["status"] = (() => {
            switch (input.taskOutcome) {
              case "verified_complete":
                return "completed";
              case "incomplete":
                return "incomplete";
              case "needs_user_input":
                return "needs_user_input";
              case "failed":
                return "failed";
              case "timeout":
                return "timeout";
              case "blocked_by_policy":
                return "blocked_by_policy";
              case "cancelled":
                return "cancelled";
              default:
                return "failed";
            }
          })();
          await manager.update(
            AiMessageTaskRunEntity,
            { id: input.runId },
            {
              execution_id: input.executionId,
              status: runStatus,
              finished_at: new Date(),
              task_outcome: input.taskOutcome,
              task_outcome_reason: input.reasonCode,
              task_result_summary: input.summary,
            }
          );

          // 4. Schedule accounting — exactly once inside the transaction.
          if (input.pause) {
            await manager.update(ScheduleTaskEntity, { id: input.scheduleId }, {
              is_active: false,
              status: ScheduleStatus.PAUSED,
              terminal_reason: input.pause.reason,
              last_modified: new Date(),
            });
          } else {
            const update: QueryDeepPartialEntity<ScheduleTaskEntity> = {
              next_run_time: input.nextRunAt,
              last_modified: new Date(),
            };
            // T19: three-way streak semantics. reset → 0 (success);
            // increment → +1 (failure); untouched → no change (cancelled).
            // failure_count is cumulative — only ever incremented, never
            // reset (a success does not erase the historical failure tally).
            if (streakMode === "increment") {
              update.failure_count = () => "failure_count + 1";
              update.consecutive_failure_count = () =>
                "consecutive_failure_count + 1";
            } else if (streakMode === "reset") {
              update.consecutive_failure_count = 0;
              // failure_count intentionally NOT reset — it tracks total
              // failures across the schedule's lifetime, not the streak.
            }
            // streakMode === "untouched" (cancelled, FR-12): neither reset
            // nor increment — cancellation is not a failure and not a
            // success, so the streak is left as-is.
            if (input.terminalStatus === "expired") {
              update.is_active = false;
              update.status = ScheduleStatus.EXPIRED;
              update.terminal_reason =
                input.terminalReason ?? "SCHEDULE_EXPIRED";
            } else if (input.terminalStatus === "failed") {
              update.is_active = false;
              update.status = ScheduleStatus.FAILED;
              update.terminal_reason =
                input.terminalReason ?? "REPEATED_RUN_FAILURE";
            } else if (input.terminalStatus === "stopped") {
              update.is_active = false;
              update.status = ScheduleStatus.STOPPED;
              update.terminal_reason = input.terminalReason ?? "STOPPED";
            }
            await manager.update(
              ScheduleTaskEntity,
              { id: input.scheduleId },
              update
            );
          }
          await runner.commitTransaction();
        } catch (txError) {
          await runner.rollbackTransaction();
          throw txError;
        } finally {
          await runner.release();
        }
      });
    } catch (error) {
      if (error instanceof AlreadyFinalizedError) {
        return {
          ok: false,
          alreadyFinalized: true,
          reasonCode: "ALREADY_FINALIZED",
        };
      }
      if (error instanceof StateConflictError) {
        return { ok: false, reasonCode: "STATE_CONFLICT" };
      }
      if (error instanceof LinkedRecordMismatchError) {
        return { ok: false, reasonCode: "LINKED_RECORD_MISMATCH" };
      }
      throw error;
    }

    return { ok: true };
  }

  async getUnfinalized(): Promise<AiTaskExecutionEntity[]> {
    assertNotWorker("getUnfinalized");
    return this.executionRepo.find({
      where: { finalized: false },
    });
  }

  /**
   * T13 (PRD FR-13/14, AC-16/24/25/27/32): load the latest execution row for a
   * conversation so history reload can restore the badge honestly. Orders by
   * `createdAt` DESC (AuditableEntity) and returns the single newest row —
   * finalized or not — so the renderer shows the most recent execution's
   * outcome/state. Returns null when the conversation has no executions
   * (response-only answers never enroll, so no badge is shown for them).
   */
  async getLatestByConversation(
    conversationId: string
  ): Promise<AiTaskExecutionEntity | null> {
    assertNotWorker("getLatestByConversation");
    return this.executionRepo.findOne({
      where: { conversation_id: conversationId },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Persist an already-loaded execution entity (e.g. after mutating
   * `execution_state_json` for a shadow decision). Used by the module's
   * `recordShadowDecision` so it does not need bracket-access to a private
   * repository field.
   *
   * NOTE: this is a full-row UPSERT with no CAS guard. It is retained for
   * callers that hold the executionCreateMutex or otherwise serialize access.
   * `recordShadowDecision` does NOT hold that mutex and must use
   * {@link applyShadowDecisionCas} instead, which guards against the
   * finalize-then-shadow interleaving the full-row save would clobber.
   */
  async saveExecution(exec: AiTaskExecutionEntity): Promise<void> {
    assertNotWorker("saveExecution");
    await this.executionRepo.save(exec);
  }

  /**
   * Atomically merge a shadow decision into `execution_state_json` and bump
   * the CAS version, guarded by `finalized = 0` and the expected version.
   *
   * This is the CAS-protected counterpart to {@link saveExecution} for the
   * shadow-decision path. The previous full-row `saveExecution` was a
   * read-then-write UPSERT with no WHERE predicate: a finalizer that
   * committed its atomic CAS UPDATE *between* the shadow path's `getById`
   * read and its `saveExecution` would have its `finalized=1`, outcome, and
   * `finalized_at` silently reverted to the stale in-memory entity's
   * `finalized=0` — an inconsistent row with a released ledger but no
   * outcome. The B8.2 version bump only protected the shadow-THEN-finalize
   * ordering (the finalizer's stale CAS rejects); it did NOT protect
   * finalize-THEN-shadow.
   *
   * This single atomic statement fixes both directions:
   *  - finalize-THEN-shadow: the `finalized = 0` predicate fails (the
   *    finalizer set `finalized = 1`), so `affected = 0` and the shadow
   *    decision is silently dropped — the terminal outcome wins, as it must.
   *  - shadow-THEN-finalize: the version bump (`+ 1` in the SET, matched
   *    against `= :expectedVersion` in the WHERE) means the finalizer's
   *    stale `expectedVersion` CAS no longer matches and it returns
   *    STATE_CONFLICT — the shadow decision wins and the finalizer must
   *    re-read.
   *
   * Returns true if the shadow decision was applied (1 row affected), false
   * if the row was missing, already finalized, or at a different version
   * (concurrent shadow or finalize won). The caller treats false as a no-op.
   */
  async applyShadowDecisionCas(input: {
    executionId: string;
    expectedVersion: number;
    mergedStateJson: string;
  }): Promise<boolean> {
    assertNotWorker("applyShadowDecisionCas");
    const runner = this.sqliteDb.connection.createQueryRunner();
    try {
      const result = (await runner.query(
        `UPDATE ai_task_execution
            SET execution_state_json = ?,
                execution_state_version = execution_state_version + 1
          WHERE execution_id = ?
            AND finalized = 0
            AND execution_state_version = ?`,
        [
          input.mergedStateJson,
          input.executionId,
          input.expectedVersion,
        ],
        true // useStructuredResult — exposes .affected (see finalizeExecution)
      )) as { affected?: number };
      return (result.affected ?? 0) === 1;
    } finally {
      await runner.release();
    }
  }

  /**
   * Detect a SQLite unique-constraint violation from a thrown driver error.
   * better-sqlite3 surfaces `SQLITE_CONSTRAINT_UNIQUE` messages containing
   * "UNIQUE constraint failed"; TypeORM wraps these in `QueryFailedError`.
   * Mirrors `AiTaskOperation.model.ts`. Reachable only via the
   * defense-in-depth catch in `createExecutionInner` — the
   * `executionCreateMutex` serializes callers so concurrent inserts cannot
   * both reach the INSERT, but a unique-constraint violation is still the
   * typed fallback if a row appears between the lookup and the insert.
   */
  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Error && /unique constraint/i.test(error.message)
    );
  }
}
