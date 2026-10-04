import { describe, expect, it } from "vitest";
import {
  TaskRunBudget,
  MANUAL_BUDGET_DEFAULTS,
  HARD_CAPS,
  BudgetReservationResult,
} from "@/service/aiTaskExecution/TaskRunBudget";
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
