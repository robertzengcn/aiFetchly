import { describe, expect, it } from "vitest";
import {
  TaskRunBudget,
  MANUAL_BUDGET_DEFAULTS,
  HARD_CAPS,
  BudgetReservationResult,
} from "@/service/aiTaskExecution/TaskRunBudget";

describe("TaskRunBudget defaults (FR-08)", () => {
  it("manual defaults match the PRD §8 table", () => {
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
