/**
 * Execution-wide budget reservation authority (technical-design §9).
 *
 * Slice 1 scope: structure, defaults (FR-08 table), and shadow accounting.
 * `reserve*` methods RECORD consumption and return a typed result; they do
 * NOT throw or gate live dispatch. The live enforcement gate (caller must
 * check the result and refuse dispatch on Exhausted) is wired in Slice 2.
 *
 * Linked Continue successors share lineage accounting via the persisted
 * ledger; an explicit new attempt gets a separate ledger. The in-memory
 * object here is a shadow mirror of the authoritative ledger row — it is
 * never itself the source of truth for spent allowance.
 *
 * Dedup keyspace: all four `reserve*` methods share a single dedup set
 * (`reservedRequestIds`), so caller-supplied IDs MUST be unique across
 * reservation types. Token reconciliation uses a separate
 * (`tokenReconciledIds`) set so a token reconcile for request "X" never
 * collides with a provider/continuation/tool/checker reservation of "X".
 */
export { MANUAL_BUDGET_DEFAULTS, HARD_CAPS, SCHEDULED_LOOP_RUN_TIMEOUT_MS } from "@/service/aiTaskExecution/budgetDefaults";

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

  getLimits(): BudgetLimits {
    return this.limits;
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

  reserveCheckerAttempt(checkerRequestId: string): BudgetReservationResult {
    if (this.reservedRequestIds.has(checkerRequestId)) {
      return BudgetReservationResult.AlreadyReserved;
    }
    if (this.consumed.checkerAttempts >= this.limits.maxCheckerAttempts) {
      return BudgetReservationResult.Exhausted;
    }
    this.reservedRequestIds.add(checkerRequestId);
    this.consumed = {
      ...this.consumed,
      checkerAttempts: this.consumed.checkerAttempts + 1,
    };
    return BudgetReservationResult.Reserved;
  }

  /** Reconcile actual token usage after a dispatch (§9). */
  reconcileTokens(requestId: string, actualTokens: number): void {
    // Dedup on a SEPARATE set from reservedRequestIds. The four reserve*
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
