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
}
