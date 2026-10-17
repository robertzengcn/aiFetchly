import { BaseModule } from "./baseModule";
import { AiTaskExecutionModel } from "@/model/AiTaskExecution.model";
import type {
  CreateExecutionInput,
  CreateExecutionResult,
  FinalizeInput,
  FinalizeResult,
  FinalizeScheduledInput,
  LedgerSnapshot,
} from "@/model/AiTaskExecution.model";
import type { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import type {
  TaskExecutionStateProjection,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";

/** Outcomes on which a Continue successor is allowed (mirrors the successor IPC eligibility). */
const CONTINUABLE_OUTCOMES: ReadonlySet<string> = new Set([
  "incomplete",
  "needs_user_input",
  "blocked_by_policy",
  "timeout",
  "failed",
]);

/**
 * G01-314: roll up persisted evidence rows into progress. Rows are
 * append-only across checks — the LAST row per criterion wins. Malformed
 * rows are skipped (never fail the projection); a wholly unparseable
 * payload yields undefined (fail-soft — the badge still restores).
 */
function readEvidenceProgress(
  executionStateJson: string | null
): TaskExecutionStateProjection["progress"] {
  if (!executionStateJson) return undefined;
  try {
    const parsed: unknown = JSON.parse(executionStateJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const rows = (parsed as { evidence?: unknown }).evidence;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const lastByCriterion = new Map<string, string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      if (typeof record.criterionId !== "string" || record.criterionId === "") {
        continue;
      }
      if (
        record.state !== "pass" &&
        record.state !== "fail" &&
        record.state !== "unknown"
      ) {
        continue;
      }
      lastByCriterion.set(record.criterionId, record.state);
    }
    if (lastByCriterion.size === 0) return undefined;
    const unmetCriterionIds = [...lastByCriterion.entries()]
      .filter(([, state]) => state !== "pass")
      .map(([criterionId]) => criterionId);
    return {
      totalCriteria: lastByCriterion.size,
      passedCriteria: lastByCriterion.size - unmetCriterionIds.length,
      unmetCriterionIds,
    };
  } catch {
    return undefined;
  }
}

/**
 * G01-314: follow-ups the durable state actually allows. Running rows can
 * only stop; terminal continuable rows offer continue + retry; other
 * finalized rows offer retry (repair path) except verified_complete, which
 * offers nothing (matches the hidden-actions renderer rule + successor IPC
 * eligibility).
 */
function deriveSafeActions(
  finalized: boolean,
  outcome: TaskOutcome | null
): string[] {
  if (!finalized) return ["stop"];
  if (outcome === "verified_complete") return [];
  if (outcome !== null && CONTINUABLE_OUTCOMES.has(outcome)) {
    return ["continue", "retry"];
  }
  return ["retry"];
}

/**
 * Business logic for task executions (technical-design §6.3, FR-24).
 *
 * Manual executions finalize WITHOUT touching schedules. Scheduled origin
 * (Slice 2) participates in the same transaction to update occurrence/
 * schedule counters atomically. Slice 1 implements manual finalization
 * only.
 *
 * Worker guard: every model method calls assertNotWorker; workers must
 * never access these tables directly (NFR-03).
 */
export class AiTaskExecutionModule extends BaseModule {
  private readonly model: AiTaskExecutionModel;

  constructor() {
    super();
    this.model = new AiTaskExecutionModel(this.dbpath);
  }

  async startExecution(
    input: CreateExecutionInput
  ): Promise<CreateExecutionResult> {
    await this.ensureConnection();
    return this.model.createExecution(input);
  }

  async getExecution(
    executionId: string
  ): Promise<AiTaskExecutionEntity | null> {
    await this.ensureConnection();
    return this.model.getById(executionId);
  }

  /**
   * Load a ledger row for the coordinator to resurrect a budget mirror on
   * the Continue path (FR-21/22, §9). Passthrough to the model so IPC and
   * engine layers never touch TypeORM repositories.
   */
  async getLedgerById(ledgerId: string): Promise<LedgerSnapshot | null> {
    await this.ensureConnection();
    return this.model.getLedgerById(ledgerId);
  }

  /**
   * T05 (FR-08/10/23, AC-06/08/22/27/29): durably persist budget consumption
   * to the lineage ledger at actual dispatch time. The in-memory
   * `TaskRunBudget` is a mirror; the ledger row is authoritative. This is
   * the atomic CAS-guarded counterpart to the in-memory `reserve*` /
   * `addActiveRuntime` / `addWaitMs` / `reconcileTokens` calls — fenced by
   * `owner_generation` + `active_execution_id` so only the currently-active
   * execution may spend against the ledger. Returns false when the lease no
   * longer holds (released, superseded by a Continue successor, or missing);
   * callers fail-closed on false (FR-08: refuse to dispatch when persistence
   * fails).
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
    await this.ensureConnection();
    return this.model.persistBudgetConsumption(input);
  }

  async finalizeExecution(input: FinalizeInput): Promise<FinalizeResult> {
    await this.ensureConnection();
    return this.model.finalizeExecution(input);
  }

  async getUnfinalizedExecutions(): Promise<AiTaskExecutionEntity[]> {
    await this.ensureConnection();
    return this.model.getUnfinalized();
  }

  /**
   * T24 (PRD NFR-05, AC-13): passthrough to the model's stranded-ledger
   * reconcile. Releases leases whose active owner is finalized or missing;
   * race-safe against a concurrent Continue claim via the lease predicate.
   */
  async releaseStrandedLedgerOwners(): Promise<number> {
    await this.ensureConnection();
    return this.model.releaseStrandedLedgerOwners();
  }

  /**
   * T13 (PRD FR-13/14, AC-16/24/25/27/32): passthrough to the model's
   * latest-by-conversation query. Used by the history-reload IPC to restore
   * the badge from the stored execution row. Never raises to the IPC layer —
   * returns null when the conversation has no enrolled execution.
   */
  async getLatestByConversation(
    conversationId: string
  ): Promise<AiTaskExecutionEntity | null> {
    await this.ensureConnection();
    return this.model.getLatestByConversation(conversationId);
  }

  /**
   * G01-314 (FR-10/13/14; AC-06/16/27): reload-restore projection for the
   * latest execution of a conversation (badge + progress + remaining limits
   * + safe actions). Pure derivation over the execution row, its evidence
   * rows, and the lineage ledger — no IPC shapes here. Every enrichment is
   * best-effort: a missing/unparseable source yields `undefined` for that
   * section, never a throw, so reload always restores at least the core
   * identity/outcome.
   */
  async getExecutionStateProjection(
    conversationId: string
  ): Promise<TaskExecutionStateProjection | null> {
    await this.ensureConnection();
    const exec = await this.model.getLatestByConversation(conversationId);
    if (!exec) return null;
    const progress = readEvidenceProgress(exec.execution_state_json);
    const remainingLimits = await this.readRemainingLimits(
      exec.lineage_ledger_id
    );
    return {
      executionId: exec.execution_id,
      conversationId: exec.conversation_id ?? conversationId,
      status: exec.stage,
      reasonCode: exec.outcome_reason_code ?? undefined,
      outcome: exec.task_outcome ?? undefined,
      finalEventIdentity: exec.final_event_identity ?? undefined,
      progress,
      remainingLimits,
      safeActions: deriveSafeActions(exec.finalized, exec.task_outcome),
    };
  }

  private async readRemainingLimits(
    lineageLedgerId: string | null
  ): Promise<TaskExecutionStateProjection["remainingLimits"]> {
    if (!lineageLedgerId) return undefined;
    try {
      const ledger = await this.model.getLedgerById(lineageLedgerId);
      if (!ledger) return undefined;
      const limits = JSON.parse(ledger.policyLimitsJson) as Record<
        string,
        unknown
      >;
      const lane = (limitKey: string, consumed: unknown): number => {
        const limit = Number(limits[limitKey]);
        const spent = Number(consumed);
        if (!Number.isFinite(limit) || !Number.isFinite(spent)) return 0;
        return Math.max(0, Math.floor(limit) - Math.floor(spent));
      };
      return {
        tokens: lane("maxTokens", ledger.consumedTokens),
        providerAttempts: lane(
          "maxProviderAttempts",
          ledger.consumedProviderAttempts
        ),
        toolExecutions: lane(
          "maxToolExecutions",
          ledger.consumedToolExecutions
        ),
        checkerAttempts: lane(
          "maxCheckerAttempts",
          ledger.consumedCheckerAttempts
        ),
        continuations: lane("maxContinuations", ledger.consumedContinuations),
        activeRuntimeMs: lane("maxActiveRuntimeMs", ledger.consumedActiveMs),
        waitMs: lane("maxWaitMs", ledger.consumedWaitMs),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Scheduled finalization (FR-12/13/15/17/18, §6.3). Runs the multi-statement
   * transaction in the model: CAS-finalize the execution + release the ledger
   * + update the run row + update schedule counters + pause-if-needed, all
   * serialized via `executionCreateMutex` on the shared better-sqlite3
   * connection. Missing execution → MISSING_TASK_OUTCOME (ok:false, never
   * success); already finalized → ok:false alreadyFinalized (counters
   * increment at most once); CAS conflict → STATE_CONFLICT.
   */
  async finalizeScheduledExecution(
    input: FinalizeScheduledInput
  ): Promise<FinalizeResult> {
    await this.ensureConnection();
    return this.model.finalizeScheduledExecution(input);
  }

  /**
   * Record a shadow decision (FR-16). Slice 1 stores the decision summary
   * in execution_state_json; live enforcement is Slice 2.
   *
   * B8 — three defects fixed here:
   *  1. Finalized guard: a terminal execution is immutable; recording a
   *     shadow decision against one would silently overwrite the final
   *     checkpoint. No-op on terminal instead.
   *  2. Version bump: execution_state_version is a CAS token; mutating
   *     execution_state_json without bumping it would let a concurrent
   *     finalizer's CAS still match the stale version and double-finalize.
   *  3. Merge semantics: execution_state_json may already hold a contract
   *     checkpoint or a prior shadow decision. Overwriting it (the previous
   *     behavior) destroyed that data. Merge under a stable key instead.
   *
   * §6.1: never replace execution_state_json with a partial recovery
   * update — merge fields into the existing object.
   */
  async recordShadowDecision(input: {
    executionId: string;
    decision: unknown;
  }): Promise<void> {
    await this.ensureConnection();
    const exec = await this.model.getById(input.executionId);
    if (!exec) return;
    // B8.1: terminal executions are immutable — never record shadow state.
    if (exec.finalized) return;

    // B8.3: merge into the existing checkpoint rather than clobbering it.
    // §6.1 forbids replacing execution_state_json with a partial update.
    const SHADOW_KEY = "shadowDecision";
    const existing: Record<string, unknown> = (() => {
      if (!exec.execution_state_json) return {};
      try {
        const parsed = JSON.parse(exec.execution_state_json) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { __legacy: parsed };
      } catch {
        // Corrupt or non-JSON legacy value — preserve under __legacy rather
        // than discarding, so downstream readers can still see it.
        return { __legacy: exec.execution_state_json };
      }
    })();
    const merged: Record<string, unknown> = {
      ...existing,
      [SHADOW_KEY]: input.decision,
    };

    // B8.2: atomic CAS update of execution_state_json + version bump. The
    // `finalized = 0` predicate guards the finalize-THEN-shadow interleaving
    // (a finalizer that committed between our read and this UPDATE sets
    // finalized = 1, so affected = 0 and we silently drop the shadow
    // decision — the terminal outcome wins, as it must). The
    // `execution_state_version = :expectedVersion` predicate guards the
    // shadow-THEN-finalize ordering (a concurrent finalizer's stale CAS
    // rejects with STATE_CONFLICT). The previous full-row `saveExecution`
    // had no WHERE predicate and would clobber a concurrent finalizer's
    // committed `finalized = 1`, outcome, and `finalized_at` with the stale
    // in-memory entity — an inconsistent row with a released ledger but no
    // outcome. Returns false (no-op) if the row was missing, already
    // finalized, or at a different version (a concurrent shadow won).
    await this.model.applyShadowDecisionCas({
      executionId: input.executionId,
      expectedVersion: exec.execution_state_version,
      mergedStateJson: JSON.stringify(merged),
    });
  }

  /**
   * T03 (FR-03/24, AC-32): persist authoritative evidence rows into
   * `execution_state_json.evidence` via the same atomic CAS primitive used
   * by {@link recordShadowDecision}. The caller ({@link TaskEvidenceService.
   * persistEvidence}) already reads the snapshot, checks finalized (B8.1),
   * and merges new rows into the existing evidence array (B8.3 append-only
   * dedup by evidenceId); this method is the thin CAS passthrough that
   * ensures the DB connection and commits the merged JSON atomically.
   *
   * The `applyShadowDecisionCas` WHERE clause (`finalized = 0` AND
   * `execution_state_version = :expectedVersion`) is the defense-in-depth
   * against a finalizer committing between the snapshot read and this
   * UPDATE: a finalized row yields affected = 0 (the terminal outcome
   * wins), and a version mismatch yields affected = 0 (a concurrent
   * evidence write won). Returns true only when the row was applied.
   */
  async mergeExecutionStateEvidence(input: {
    executionId: string;
    expectedVersion: number;
    mergedStateJson: string;
  }): Promise<boolean> {
    await this.ensureConnection();
    return this.model.applyShadowDecisionCas({
      executionId: input.executionId,
      expectedVersion: input.expectedVersion,
      mergedStateJson: input.mergedStateJson,
    });
  }
}
