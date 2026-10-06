import { describe, expect, it } from "vitest";
import {
  TaskRunBudget,
  MANUAL_BUDGET_DEFAULTS,
  HARD_CAPS,
  BudgetReservationResult,
  decodeLedgerPolicyLimits,
  ledgerPolicyLimitsSchema,
} from "@/service/aiTaskExecution/TaskRunBudget";
import type { BudgetLimits } from "@/service/aiTaskExecution/TaskRunBudget";
import {
  buildScheduledBudgetLimits,
  SCHEDULED_LOOP_RUN_TIMEOUT_MS,
} from "@/service/aiTaskExecution/budgetDefaults";

describe("TaskRunBudget defaults (FR-08)", () => {
  it("manual defaults match the PRD FR-08 table", () => {
    expect(MANUAL_BUDGET_DEFAULTS.maxContinuations).toBe(3);
    expect(MANUAL_BUDGET_DEFAULTS.maxProviderAttempts).toBe(60);
    expect(MANUAL_BUDGET_DEFAULTS.maxCheckerAttempts).toBe(6);
    expect(MANUAL_BUDGET_DEFAULTS.maxToolExecutions).toBe(50);
    expect(MANUAL_BUDGET_DEFAULTS.maxTokens).toBe(128_000);
    expect(MANUAL_BUDGET_DEFAULTS.maxActiveRuntimeMs).toBe(10 * 60 * 1000);
  });

  it("hard caps are at least as large as the manual defaults", () => {
    expect(HARD_CAPS.maxContinuations).toBe(10);
    expect(HARD_CAPS.maxActiveRuntimeMs).toBe(30 * 60 * 1000);
  });
});

describe("TaskRunBudget reservation (shadow mode)", () => {
  it("records a reservation and decrements remaining", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const result = budget.reserveProviderAttempt("req-1");
    expect(result).toBe(BudgetReservationResult.Reserved);
    expect(budget.getConsumed().providerAttempts).toBe(1);
    expect(budget.getRemaining().providerAttempts).toBe(59);
  });

  it("reserving the same stable request ID twice returns the prior reservation without incrementing", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    expect(budget.reserveProviderAttempt("req-dup")).toBe(
      BudgetReservationResult.Reserved
    );
    expect(budget.reserveProviderAttempt("req-dup")).toBe(
      BudgetReservationResult.AlreadyReserved
    );
    expect(budget.getConsumed().providerAttempts).toBe(1);
  });

  it("returns Exhausted when the counter is spent", () => {
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxProviderAttempts: 1,
    });
    expect(budget.reserveProviderAttempt("req-a")).toBe(
      BudgetReservationResult.Reserved
    );
    expect(budget.reserveProviderAttempt("req-b")).toBe(
      BudgetReservationResult.Exhausted
    );
  });

  it("shadow mode does not gate dispatch (Slice 1: no throw, caller decides)", () => {
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxContinuations: 0,
    });
    // Shadow: reserveContinuation records exhaustion but does not throw.
    const result = budget.reserveContinuation("cont-1");
    expect(result).toBe(BudgetReservationResult.Exhausted);
    expect(budget.getConsumed().continuations).toBe(0);
  });
});

describe("TaskRunBudget reconcileTokens (§9)", () => {
  it("accumulates reconciled token usage", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.reconcileTokens("req-t1", 100);
    budget.reconcileTokens("req-t2", 50);
    expect(budget.getConsumed().tokens).toBe(150);
  });

  it("does not double-count a reconciled request ID", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.reconcileTokens("req-dup-t", 100);
    budget.reconcileTokens("req-dup-t", 100);
    expect(budget.getConsumed().tokens).toBe(100);
  });

  it("clamps negative actual tokens to 0", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.reconcileTokens("req-neg", -50);
    expect(budget.getConsumed().tokens).toBe(0);
  });

  it("fail-closes NaN/Infinity token inputs to 0 (FR-08, §9)", () => {
    // Without a Number.isFinite guard, Math.max(0, Math.floor(NaN)) is NaN,
    // permanently corrupting consumed.tokens and defeating every downstream
    // exhaustion gate. Infinity clamps to 0 here too (the budget tracks
    // finite provider usage, not unbounded allocations).
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.reconcileTokens("req-nan", Number.NaN);
    budget.reconcileTokens("req-inf", Number.POSITIVE_INFINITY);
    budget.reconcileTokens("req-neg-inf", Number.NEGATIVE_INFINITY);
    expect(budget.getConsumed().tokens).toBe(0);
    expect(Number.isFinite(budget.getConsumed().tokens)).toBe(true);
    expect(Number.isFinite(budget.getRemaining().tokens)).toBe(true);
  });

  it("does not drop tokens when a tokens:-prefixed ID was reserved (Issue 1 case a)", () => {
    // Old code: reserveProviderAttempt("tokens:foo") added "tokens:foo" to
    // the shared set; reconcileTokens("foo") computed key "tokens:foo" and
    // hit the dedup guard → tokens silently dropped. Fixed code uses a
    // separate tokenReconciledIds set, so both count.
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.reserveProviderAttempt("tokens:foo");
    budget.reconcileTokens("foo", 100);
    expect(budget.getConsumed().providerAttempts).toBe(1);
    expect(budget.getConsumed().tokens).toBe(100);
  });

  it("does not absorb a provider attempt when the bare ID was already reconciled (Issue 1 case b)", () => {
    // Old code: reconcileTokens("x") added "tokens:x" to the shared set;
    // a later reserveProviderAttempt("tokens:x") saw it and returned
    // AlreadyReserved → wire attempt silently absorbed. Fixed code keeps
    // the sets separate, so both count.
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.reconcileTokens("x", 100);
    const result = budget.reserveProviderAttempt("tokens:x");
    expect(result).toBe(BudgetReservationResult.Reserved);
    expect(budget.getConsumed().providerAttempts).toBe(1);
    expect(budget.getConsumed().tokens).toBe(100);
  });
});

describe("TaskRunBudget accumulators (§9)", () => {
  it("addActiveRuntime accumulates across resumes", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.addActiveRuntime(5_000);
    budget.addActiveRuntime(3_500);
    expect(budget.getConsumed().activeRuntimeMs).toBe(8_500);
  });

  it("addWaitMs accumulates across pauses", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.addWaitMs(10_000);
    budget.addWaitMs(2_000);
    expect(budget.getConsumed().waitMs).toBe(12_000);
  });

  it("accumulators floor negative inputs to 0", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.addActiveRuntime(-1_000);
    budget.addWaitMs(-500);
    expect(budget.getConsumed().activeRuntimeMs).toBe(0);
    expect(budget.getConsumed().waitMs).toBe(0);
  });

  it("accumulators fail-closed NaN/Infinity inputs to 0 (FR-08, §9)", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.addActiveRuntime(Number.NaN);
    budget.addActiveRuntime(Number.POSITIVE_INFINITY);
    budget.addWaitMs(Number.NaN);
    budget.addWaitMs(Number.POSITIVE_INFINITY);
    expect(budget.getConsumed().activeRuntimeMs).toBe(0);
    expect(budget.getConsumed().waitMs).toBe(0);
    expect(Number.isFinite(budget.getRemaining().activeRuntimeMs)).toBe(true);
    expect(Number.isFinite(budget.getRemaining().waitMs)).toBe(true);
  });
});

describe("TaskRunBudget no-progress streak (§9)", () => {
  it("recordNoProgress increments and resetNoProgressStreak zeroes", () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.recordNoProgress();
    budget.recordNoProgress();
    expect(budget.getConsumed().noProgressStreak).toBe(2);
    budget.resetNoProgressStreak();
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });
});

describe("TaskRunBudget getRemaining clamping (§9)", () => {
  it("clamps remaining to 0 when consumed exceeds limits (never negative)", () => {
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxProviderAttempts: 1,
      maxToolExecutions: 1,
    });
    budget.reserveProviderAttempt("a");
    budget.reserveToolExecution("b");
    // Over-spend via accumulators (no guard in shadow mode).
    budget.addActiveRuntime(MANUAL_BUDGET_DEFAULTS.maxActiveRuntimeMs + 5_000);
    const remaining = budget.getRemaining();
    expect(remaining.providerAttempts).toBe(0);
    expect(remaining.toolExecutions).toBe(0);
    expect(remaining.activeRuntimeMs).toBe(0);
  });
});

describe("buildScheduledBudgetLimits (FR-08, §9)", () => {
  it("clamps continuations to min(config, 3) and caps runtime at the scheduled-loop timeout", () => {
    const limits = buildScheduledBudgetLimits({
      maxContinueCalls: 10,
      maxToolCalls: 40,
      maxRuntimeMs: 30 * 60 * 1000,
    });
    expect(limits.maxContinuations).toBe(3);
    expect(limits.maxToolExecutions).toBe(40);
    expect(limits.maxActiveRuntimeMs).toBe(SCHEDULED_LOOP_RUN_TIMEOUT_MS);
  });

  it("passes through a sub-cap config unchanged", () => {
    const limits = buildScheduledBudgetLimits({
      maxContinueCalls: 1,
      maxToolCalls: 5,
      maxRuntimeMs: 60_000,
    });
    expect(limits.maxContinuations).toBe(1);
    expect(limits.maxToolExecutions).toBe(5);
    expect(limits.maxActiveRuntimeMs).toBe(60_000);
  });

  it("fail-closes NaN / negative / non-integer task config to 0 (no unbounded budget)", () => {
    const limits = buildScheduledBudgetLimits({
      maxContinueCalls: Number.NaN,
      maxToolCalls: -3,
      maxRuntimeMs: 1.5,
    });
    expect(limits.maxContinuations).toBe(0);
    expect(limits.maxToolExecutions).toBe(0);
    expect(limits.maxActiveRuntimeMs).toBe(0);
  });
});

// ----- Slice 2 (Unit 2): live budget enforcement (D4, FR-08/09, AC-09/10) -----

function unit2Limits(overrides: Partial<BudgetLimits> = {}): BudgetLimits {
  return { ...MANUAL_BUDGET_DEFAULTS, ...overrides };
}

function unit2LedgerRow(overrides: Partial<{
  policy_limits_json: string;
  consumed_continuations: number;
  consumed_provider_attempts: number;
  consumed_checker_attempts: number;
  consumed_tool_executions: number;
  consumed_tokens: number;
  consumed_active_ms: number;
  consumed_wait_ms: number;
  no_progress_streak: number;
}> = {}): {
  policy_limits_json: string;
  consumed_continuations: number;
  consumed_provider_attempts: number;
  consumed_checker_attempts: number;
  consumed_tool_executions: number;
  consumed_tokens: number;
  consumed_active_ms: number;
  consumed_wait_ms: number;
  no_progress_streak: number;
} {
  return {
    policy_limits_json: JSON.stringify(MANUAL_BUDGET_DEFAULTS),
    consumed_continuations: 0,
    consumed_provider_attempts: 0,
    consumed_checker_attempts: 0,
    consumed_tool_executions: 0,
    consumed_tokens: 0,
    consumed_active_ms: 0,
    consumed_wait_ms: 0,
    no_progress_streak: 0,
    ...overrides,
  };
}

describe("TaskRunBudget.reserveCheckerAttempt (Slice 2, FR-09, AC-09/10)", () => {
  it("reserves within the per-run limit and increments consumed_checker_attempts", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxCheckerAttempts: 3 }));
    expect(budget.reserveCheckerAttempt("chk-1")).toBe(BudgetReservationResult.Reserved);
    expect(budget.reserveCheckerAttempt("chk-2")).toBe(BudgetReservationResult.Reserved);
    expect(budget.getConsumed().checkerAttempts).toBe(2);
  });

  it("dedups by request ID — re-reserving the same check does not double-count", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxCheckerAttempts: 3 }));
    expect(budget.reserveCheckerAttempt("chk-1")).toBe(BudgetReservationResult.Reserved);
    expect(budget.reserveCheckerAttempt("chk-1")).toBe(BudgetReservationResult.AlreadyReserved);
    expect(budget.getConsumed().checkerAttempts).toBe(1);
  });

  it("returns Exhausted when the per-run checker limit is spent (gate: qualitative skipped)", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxCheckerAttempts: 2 }));
    budget.reserveCheckerAttempt("chk-1");
    budget.reserveCheckerAttempt("chk-2");
    expect(budget.reserveCheckerAttempt("chk-3")).toBe(BudgetReservationResult.Exhausted);
    expect(budget.isCheckerBudgetExhausted()).toBe(true);
    expect(budget.getConsumed().checkerAttempts).toBe(2);
  });

  it("enforces the per-candidate cap (HARD_CAPS.maxCheckerAttemptsPerCandidate = 2) — 1 retry", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxCheckerAttempts: 100 }));
    budget.beginCheckerCandidate("cand-1");
    expect(budget.reserveCheckerAttempt("chk-1")).toBe(BudgetReservationResult.Reserved);
    expect(budget.reserveCheckerAttempt("chk-2")).toBe(BudgetReservationResult.Reserved);
    // Third attempt for the same candidate — per-candidate cap spent even
    // though the per-run counter has room.
    expect(budget.reserveCheckerAttempt("chk-3")).toBe(BudgetReservationResult.Exhausted);
    expect(budget.getConsumed().checkerAttempts).toBe(2);
  });

  it("beginCheckerCandidate resets the per-candidate window for a NEW candidate only (idempotent)", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxCheckerAttempts: 100 }));
    budget.beginCheckerCandidate("cand-1");
    budget.reserveCheckerAttempt("chk-1");
    budget.reserveCheckerAttempt("chk-2");
    expect(budget.reserveCheckerAttempt("chk-3")).toBe(BudgetReservationResult.Exhausted);
    // Same-candidate re-begin does NOT reset.
    budget.beginCheckerCandidate("cand-1");
    expect(budget.reserveCheckerAttempt("chk-4")).toBe(BudgetReservationResult.Exhausted);
    // New candidate gets a fresh 2-attempt window.
    budget.beginCheckerCandidate("cand-2");
    expect(budget.reserveCheckerAttempt("chk-5")).toBe(BudgetReservationResult.Reserved);
    expect(budget.reserveCheckerAttempt("chk-6")).toBe(BudgetReservationResult.Reserved);
    expect(budget.reserveCheckerAttempt("chk-7")).toBe(BudgetReservationResult.Exhausted);
  });

  it("checker reservations share the reservedRequestIds dedup set with other reserve types", () => {
    // The four reserve* methods share one dedup keyspace — a caller-supplied
    // ID must be unique across types (documented invariant).
    const budget = new TaskRunBudget(unit2Limits());
    budget.reserveProviderAttempt("shared-id");
    expect(budget.reserveCheckerAttempt("shared-id")).toBe(BudgetReservationResult.AlreadyReserved);
    expect(budget.getConsumed().checkerAttempts).toBe(0);
  });
});

describe("TaskRunBudget live-gating accessors (Slice 2, D4, FR-08)", () => {
  it("isContinuationBudgetExhausted flips at the limit", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxContinuations: 2 }));
    expect(budget.isContinuationBudgetExhausted()).toBe(false);
    budget.reserveContinuation("cont-1");
    expect(budget.isContinuationBudgetExhausted()).toBe(false);
    budget.reserveContinuation("cont-2");
    expect(budget.isContinuationBudgetExhausted()).toBe(true);
  });

  it("isProviderBudgetExhausted flips at the limit", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxProviderAttempts: 1 }));
    expect(budget.isProviderBudgetExhausted()).toBe(false);
    budget.reserveProviderAttempt("prov-1");
    expect(budget.isProviderBudgetExhausted()).toBe(true);
  });

  it("isCheckerBudgetExhausted reflects the per-run counter without a candidate window", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxCheckerAttempts: 1 }));
    expect(budget.isCheckerBudgetExhausted()).toBe(false);
    budget.reserveCheckerAttempt("chk-1");
    expect(budget.isCheckerBudgetExhausted()).toBe(true);
  });

  it("isNoProgressStreakExhausted flips at the streak limit", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxNoProgressStreak: 2 }));
    expect(budget.isNoProgressStreakExhausted()).toBe(false);
    budget.recordNoProgress();
    budget.recordNoProgress();
    expect(budget.isNoProgressStreakExhausted()).toBe(true);
  });

  it("tool reservations stay record-but-no-gate — no accessor gates them (D4)", () => {
    const budget = new TaskRunBudget(unit2Limits({ maxToolExecutions: 1 }));
    budget.reserveToolExecution("tool-1");
    expect(budget.getConsumed().toolExecutions).toBe(1);
    // No isToolBudgetExhausted accessor exists — reserveToolExecution is
    // record-only in Slice 2 (gating mid-operation leaves tool state limbo;
    // tool volume is bounded via continuation/round caps).
    const maybeAccessor = (budget as unknown as Record<string, unknown>)["isToolBudgetExhausted"];
    expect(maybeAccessor).toBeUndefined();
  });
});

describe("TaskRunBudget.resurrectFromLedger (Slice 2, D4/D6)", () => {
  it("round-trips consumed counters and limits from a ledger row", () => {
    const row = unit2LedgerRow({
      consumed_continuations: 2,
      consumed_provider_attempts: 10,
      consumed_checker_attempts: 4,
      consumed_tool_executions: 7,
      consumed_tokens: 5000,
      consumed_active_ms: 60_000,
      consumed_wait_ms: 120_000,
      no_progress_streak: 1,
    });
    const budget = TaskRunBudget.resurrectFromLedger(row);
    expect(budget.getConsumed()).toEqual({
      continuations: 2,
      providerAttempts: 10,
      checkerAttempts: 4,
      toolExecutions: 7,
      tokens: 5000,
      activeRuntimeMs: 60_000,
      waitMs: 120_000,
      noProgressStreak: 1,
    });
  });

  it("a resurrected budget enforces restored limits — continuation exhausted when the ledger says spent", () => {
    const row = unit2LedgerRow({
      policy_limits_json: JSON.stringify({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 2 }),
      consumed_continuations: 2,
    });
    const budget = TaskRunBudget.resurrectFromLedger(row);
    expect(budget.isContinuationBudgetExhausted()).toBe(true);
    expect(budget.reserveContinuation("cont-new")).toBe(BudgetReservationResult.Exhausted);
  });

  it("a resurrected budget can still reserve within remaining allowance", () => {
    const row = unit2LedgerRow({
      policy_limits_json: JSON.stringify({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 3 }),
      consumed_continuations: 1,
    });
    const budget = TaskRunBudget.resurrectFromLedger(row);
    expect(budget.reserveContinuation("cont-new")).toBe(BudgetReservationResult.Reserved);
    expect(budget.getConsumed().continuations).toBe(2);
  });

  it("clamps a tampered ledger row whose limits exceed HARD_CAPS", () => {
    const row = unit2LedgerRow({
      policy_limits_json: JSON.stringify({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 1000 }),
    });
    const budget = TaskRunBudget.resurrectFromLedger(row);
    // Hard cap 10: exactly 10 reservations succeed, the 11th is refused.
    for (let i = 1; i <= 10; i += 1) {
      expect(budget.reserveContinuation(`c-${i}`)).toBe(BudgetReservationResult.Reserved);
    }
    expect(budget.reserveContinuation("c-11")).toBe(BudgetReservationResult.Exhausted);
  });

  it("guards NaN/Infinity/negative consumed counters from a corrupt ledger row (fail-closed to 0)", () => {
    const row = unit2LedgerRow({
      consumed_tokens: Number.NaN,
      consumed_active_ms: Number.POSITIVE_INFINITY,
      consumed_continuations: -5,
    });
    const budget = TaskRunBudget.resurrectFromLedger(row);
    expect(budget.getConsumed().tokens).toBe(0);
    expect(budget.getConsumed().activeRuntimeMs).toBe(0);
    expect(budget.getConsumed().continuations).toBe(0);
  });

  it("throws on malformed policy_limits_json (fail-closed: no budget, no dispatch)", () => {
    const row = unit2LedgerRow({ policy_limits_json: "not-json{{{" });
    expect(() => TaskRunBudget.resurrectFromLedger(row)).toThrow(/Malformed/);
  });

  it("throws on schema-mismatched policy_limits_json (wrong types / missing fields)", () => {
    const row = unit2LedgerRow({
      policy_limits_json: JSON.stringify({ maxContinuations: "three" }),
    });
    expect(() => TaskRunBudget.resurrectFromLedger(row)).toThrow(/schema validation/);
  });
});

describe("decodeLedgerPolicyLimits (Slice 2 persistence boundary)", () => {
  it("decodes a valid limits JSON clamped to hard caps", () => {
    const decoded = decodeLedgerPolicyLimits(
      JSON.stringify({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 25, maxActiveRuntimeMs: 999_999_999 })
    );
    expect(decoded.maxContinuations).toBe(HARD_CAPS.maxContinuations);
    expect(decoded.maxActiveRuntimeMs).toBe(HARD_CAPS.maxActiveRuntimeMs);
    // Non-capped fields pass through unchanged.
    expect(decoded.maxProviderAttempts).toBe(MANUAL_BUDGET_DEFAULTS.maxProviderAttempts);
    expect(decoded.maxCheckerAttempts).toBe(MANUAL_BUDGET_DEFAULTS.maxCheckerAttempts);
  });

  it("preserves zero as a legitimate no-allowance configuration", () => {
    const zeroed = ledgerPolicyLimitsSchema.parse({
      maxContinuations: 0,
      maxProviderAttempts: 0,
      maxCheckerAttempts: 0,
      maxToolExecutions: 0,
      maxTokens: 0,
      maxActiveRuntimeMs: 0,
      maxWaitMs: 0,
      maxNoProgressStreak: 0,
    });
    expect(zeroed.maxContinuations).toBe(0);
    expect(zeroed.maxTokens).toBe(0);
  });
});
