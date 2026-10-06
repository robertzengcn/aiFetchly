/**
 * Execution-wide budget reservation authority (technical-design §9).
 *
 * Slice 2: `reserve*` methods RECORD consumption and return a typed result.
 * Callers GATE live dispatch on the result — refuse to dispatch when the
 * result is `Exhausted` (FR-08/09): continuation dispatch checks
 * `reserveContinuation`, the checker LLM checks `reserveCheckerAttempt`,
 * provider retry checks `reserveProviderAttempt`. `reserveToolExecution`
 * remains record-but-no-gate (gating mid-operation leaves tool state in
 * limbo; the tool volume is bounded via the continuation/round caps).
 *
 * Checker budget (§9): 6 attempts per run, 2 per candidate (1 retry).
 * `reserveCheckerAttempt` tracks both counters; the per-candidate counter
 * is reset by `resetCheckerCandidate`.
 *
 * Linked Continue successors share lineage accounting via the persisted
 * ledger; an explicit new attempt gets a separate ledger. The in-memory
 * object here is a mirror of the authoritative ledger row — it is never
 * itself the source of truth for spent allowance. `resurrectFromLedger`
 * rebuilds the mirror from a persisted ledger row on Continue/resume.
 *
 * Dedup keyspace: the four `reserve*` methods (provider/continuation/tool/
 * checker) share a single dedup set (`reservedRequestIds`), so
 * caller-supplied IDs MUST be unique across reservation types. Token
 * reconciliation uses a separate (`tokenReconciledIds`) set so a token
 * reconcile for request "X" never collides with a reservation of "X".
 */
import {
  MANUAL_BUDGET_DEFAULTS,
  HARD_CAPS,
  SCHEDULED_LOOP_RUN_TIMEOUT_MS,
  decodeLedgerPolicyLimits,
  ledgerPolicyLimitsSchema,
} from "@/service/aiTaskExecution/budgetDefaults";

export {
  MANUAL_BUDGET_DEFAULTS,
  HARD_CAPS,
  SCHEDULED_LOOP_RUN_TIMEOUT_MS,
  decodeLedgerPolicyLimits,
  ledgerPolicyLimitsSchema,
};

export enum BudgetReservationResult {
  Reserved = "reserved",
  AlreadyReserved = "already_reserved",
  Exhausted = "exhausted",
}

export interface BudgetConsumed {
  readonly continuations: number;
  readonly providerAttempts: number;
  readonly checkerAttempts: number;
  readonly toolExecutions: number;
  readonly tokens: number;
  readonly activeRuntimeMs: number;
  readonly waitMs: number;
  readonly noProgressStreak: number;
}

export interface BudgetRemaining extends BudgetConsumed {}

export interface BudgetLimits {
  readonly maxContinuations: number;
  readonly maxProviderAttempts: number;
  readonly maxCheckerAttempts: number;
  readonly maxToolExecutions: number;
  readonly maxTokens: number;
  readonly maxActiveRuntimeMs: number;
  readonly maxWaitMs: number;
  readonly maxNoProgressStreak: number;
}

export class TaskRunBudget {
  private readonly limits: BudgetLimits;
  private readonly reservedRequestIds: Set<string> = new Set();
  private readonly tokenReconciledIds: Set<string> = new Set();
  private consumed: BudgetConsumed;
  /** Checker attempts consumed against the CURRENT candidate (per-candidate cap, §9). */
  private checkerCandidateAttempts = 0;
  private activeCandidateId: string | null = null;

  constructor(limits: BudgetLimits) {
    this.limits = limits;
    this.consumed = {
      continuations: 0,
      providerAttempts: 0,
      checkerAttempts: 0,
      toolExecutions: 0,
      tokens: 0,
      activeRuntimeMs: 0,
      waitMs: 0,
      noProgressStreak: 0,
    };
  }

  getConsumed(): BudgetConsumed {
    return { ...this.consumed };
  }

  getRemaining(): BudgetRemaining {
    return {
      continuations: Math.max(
        0,
        this.limits.maxContinuations - this.consumed.continuations
      ),
      providerAttempts: Math.max(
        0,
        this.limits.maxProviderAttempts - this.consumed.providerAttempts
      ),
      checkerAttempts: Math.max(
        0,
        this.limits.maxCheckerAttempts - this.consumed.checkerAttempts
      ),
      toolExecutions: Math.max(
        0,
        this.limits.maxToolExecutions - this.consumed.toolExecutions
      ),
      tokens: Math.max(0, this.limits.maxTokens - this.consumed.tokens),
      activeRuntimeMs: Math.max(
        0,
        this.limits.maxActiveRuntimeMs - this.consumed.activeRuntimeMs
      ),
      waitMs: Math.max(0, this.limits.maxWaitMs - this.consumed.waitMs),
      noProgressStreak: Math.max(
        0,
        this.limits.maxNoProgressStreak - this.consumed.noProgressStreak
      ),
    };
  }

  /**
   * Reserve a provider dispatch attempt by stable request ID. Reserving an
   * existing ID returns AlreadyReserved without incrementing (§9: dedup by
   * request ID). Returns Exhausted (and does NOT increment) when the limit
   * is spent.
   */
  reserveProviderAttempt(requestId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(requestId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (this.consumed.providerAttempts >= this.limits.maxProviderAttempts) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(requestId);
    this.consumed = {
      ...this.consumed,
      providerAttempts: this.consumed.providerAttempts + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  reserveContinuation(continuationId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(continuationId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (this.consumed.continuations >= this.limits.maxContinuations) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(continuationId);
    this.consumed = {
      ...this.consumed,
      continuations: this.consumed.continuations + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  reserveToolExecution(toolRequestId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(toolRequestId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (this.consumed.toolExecutions >= this.limits.maxToolExecutions) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(toolRequestId);
    this.consumed = {
      ...this.consumed,
      toolExecutions: this.consumed.toolExecutions + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  /**
   * Reserve a checker-LLM attempt for the current candidate (§9: 6/run,
   * 2/candidate, 1 retry). Dedup by request ID (an AlreadyReserved retry of
   * the same check does not double-count). Exhausted when either the
   * per-run or the per-candidate cap is spent — the caller must skip the
   * qualitative check (fail-closed "unknown") rather than dispatch.
   *
   * Slice 2 live gate: the qualitative evaluator calls this BEFORE each
   * checker dispatch and refuses on Exhausted.
   */
  reserveCheckerAttempt(requestId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(requestId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (
      this.consumed.checkerAttempts >= this.limits.maxCheckerAttempts ||
      this.checkerCandidateAttempts >= HARD_CAPS.maxCheckerAttemptsPerCandidate
    ) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(requestId);
    this.checkerCandidateAttempts += 1;
    this.consumed = {
      ...this.consumed,
      checkerAttempts: this.consumed.checkerAttempts + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  /**
   * Begin a new candidate's checking window (per-candidate counter reset).
   * Called when the controller starts evaluating a new end candidate so
   * each candidate gets its own 2-attempt allowance (§9).
   */
  beginCheckerCandidate(candidateId: string): void {
    if (this.activeCandidateId !== candidateId) {
      this.activeCandidateId = candidateId;
      this.checkerCandidateAttempts = 0;
    }
  }

  /** Consume a no-progress streak unit and report whether the streak cap is hit. */
  isNoProgressStreakExhausted(): boolean {
    return this.consumed.noProgressStreak >= this.limits.maxNoProgressStreak;
  }

  // ----- Live-gating accessors (Slice 2, D4) -----

  /** True when no continuation allowance remains — dispatch must finish(incomplete). */
  isContinuationBudgetExhausted(): boolean {
    return this.consumed.continuations >= this.limits.maxContinuations;
  }

  /** True when no provider-attempt allowance remains — dispatch must finish(incomplete). */
  isProviderBudgetExhausted(): boolean {
    return this.consumed.providerAttempts >= this.limits.maxProviderAttempts;
  }

  /** True when no checker allowance remains (per-run) — qualitative evidence is skipped. */
  isCheckerBudgetExhausted(): boolean {
    return (
      this.consumed.checkerAttempts >= this.limits.maxCheckerAttempts ||
      this.checkerCandidateAttempts >= HARD_CAPS.maxCheckerAttemptsPerCandidate
    );
  }

  /**
   * Rebuild a budget mirror from a persisted ledger row (Continue/resume,
   * D4/D6). The ledger is authoritative: consumed counters and the frozen
   * `policy_limits_json` are restored so a Continue successor shares the
   * lineage budget. Dedup sets start empty (fresh in-memory keyspace — the
   * ledger has no request-ID history), matching §9's "shared lineage
   * accounting via the persisted ledger".
   */
  static resurrectFromLedger(ledgerRow: {
    readonly policy_limits_json: string;
    readonly consumed_continuations: number;
    readonly consumed_provider_attempts: number;
    readonly consumed_checker_attempts: number;
    readonly consumed_tool_executions: number;
    readonly consumed_tokens: number;
    readonly consumed_active_ms: number;
    readonly consumed_wait_ms: number;
    readonly no_progress_streak: number;
  }): TaskRunBudget {
    const limits = decodeLedgerPolicyLimits(ledgerRow.policy_limits_json);
    const budget = new TaskRunBudget(limits);
    budget.restoreConsumed({
      continuations: ledgerRow.consumed_continuations,
      providerAttempts: ledgerRow.consumed_provider_attempts,
      checkerAttempts: ledgerRow.consumed_checker_attempts,
      toolExecutions: ledgerRow.consumed_tool_executions,
      tokens: ledgerRow.consumed_tokens,
      activeRuntimeMs: ledgerRow.consumed_active_ms,
      waitMs: ledgerRow.consumed_wait_ms,
      noProgressStreak: ledgerRow.no_progress_streak,
    });
    return budget;
  }

  /**
   * Replace the consumed counters (resurrection path only). Values pass
   * through the same finite/non-negative guard as runtime accumulation so a
   * corrupt ledger row cannot poison the mirror with NaN/Infinity.
   */
  private restoreConsumed(consumed: BudgetConsumed): void {
    this.consumed = {
      continuations: this.asFiniteNonNegative(consumed.continuations),
      providerAttempts: this.asFiniteNonNegative(consumed.providerAttempts),
      checkerAttempts: this.asFiniteNonNegative(consumed.checkerAttempts),
      toolExecutions: this.asFiniteNonNegative(consumed.toolExecutions),
      tokens: this.asFiniteNonNegative(consumed.tokens),
      activeRuntimeMs: this.asFiniteNonNegative(consumed.activeRuntimeMs),
      waitMs: this.asFiniteNonNegative(consumed.waitMs),
      noProgressStreak: this.asFiniteNonNegative(consumed.noProgressStreak),
    };
  }

  /**
   * Reconcile actual token usage after a dispatch (§9).
   */
  reconcileTokens(requestId: string, actualTokens: number): void {
    // Dedup on a SEPARATE set from reservedRequestIds. The three reserve*
    // methods share `reservedRequestIds`; token reconciliation tracks its
    // own keyspace so a reservation of "X" and a token reconcile of "X"
    // (the same logical request) both count independently. Sharing one set
    // with a `tokens:`-prefixed key caused bidirectional collisions: a
    // reservation of "tokens:foo" silently dropped a later reconcile of
    // "foo", and a reconcile of "x" silently absorbed a later reservation
    // of "tokens:x".
    if (this.tokenReconciledIds.has(requestId)) {
      return;
    }
    this.tokenReconciledIds.add(requestId);
    this.consumed = {
      ...this.consumed,
      tokens: this.consumed.tokens + this.asFiniteNonNegative(actualTokens),
    };
  }

  /** Accumulate active runtime across resumes (§9). */
  addActiveRuntime(ms: number): void {
    this.consumed = {
      ...this.consumed,
      activeRuntimeMs: this.consumed.activeRuntimeMs + this.asFiniteNonNegative(ms),
    };
  }

  addWaitMs(ms: number): void {
    this.consumed = {
      ...this.consumed,
      waitMs: this.consumed.waitMs + this.asFiniteNonNegative(ms),
    };
  }

  /**
   * Clamp a provider/runtime numeric input to a non-negative finite integer,
   * failing closed to 0 on NaN/Infinity/negative (FR-08, §9). Without this
   * guard `Math.max(0, Math.floor(NaN))` is NaN, which permanently corrupts
   * `consumed.*` and defeats every downstream exhaustion gate.
   */
  private asFiniteNonNegative(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return Math.floor(value);
  }

  recordNoProgress(): void {
    this.consumed = {
      ...this.consumed,
      noProgressStreak: this.consumed.noProgressStreak + 1,
    };
  }

  resetNoProgressStreak(): void {
    this.consumed = {
      ...this.consumed,
      noProgressStreak: 0,
    };
  }
}
