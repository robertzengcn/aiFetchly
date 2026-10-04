/**
 * Budget defaults and hard caps (PRD §8, technical-design §9).
 *
 * Manual defaults are conservative; trusted settings may tune within the
 * hard caps. Scheduled origin uses min(task config, 3) continuations and
 * min(task.maxRuntimeMs, SCHEDULED_LOOP_RUN_TIMEOUT_MS) active runtime.
 */
export const SCHEDULED_LOOP_RUN_TIMEOUT_MS = 10 * 60 * 1000;

export interface BudgetLimitsInput {
  readonly maxContinuations: number;
  readonly maxProviderAttempts: number;
  readonly maxCheckerAttempts: number;
  readonly maxToolExecutions: number;
  readonly maxTokens: number;
  readonly maxActiveRuntimeMs: number;
  readonly maxWaitMs: number;
  readonly maxNoProgressStreak: number;
}

export const MANUAL_BUDGET_DEFAULTS: BudgetLimitsInput = {
  maxContinuations: 3,
  maxProviderAttempts: 60,
  maxCheckerAttempts: 6,
  maxToolExecutions: 50,
  maxTokens: 128_000,
  maxActiveRuntimeMs: 10 * 60 * 1000,
  maxWaitMs: 60 * 60 * 1000, // 1 hour backstop
  maxNoProgressStreak: 3,
};

export const HARD_CAPS = {
  maxContinuations: 10,
  maxActiveRuntimeMs: 30 * 60 * 1000,
} as const;

/**
 * Build scheduled-origin limits from task configuration. Continuations are
 * min(task.maxContinueCalls, 3) per §9; tool executions use the task's
 * configured maxToolCalls; active runtime is the minimum of the task's
 * configured runtime and the scheduled-loop run timeout.
 */
export function buildScheduledBudgetLimits(input: {
  readonly maxContinueCalls: number;
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
}): BudgetLimitsInput {
  return {
    maxContinuations: Math.min(input.maxContinueCalls, 3),
    maxProviderAttempts: 60,
    maxCheckerAttempts: 6,
    maxToolExecutions: input.maxToolCalls,
    maxTokens: 128_000,
    maxActiveRuntimeMs: Math.min(input.maxRuntimeMs, SCHEDULED_LOOP_RUN_TIMEOUT_MS),
    maxWaitMs: 60 * 60 * 1000,
    maxNoProgressStreak: 3,
  };
}
