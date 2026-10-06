/**
 * Budget defaults and hard caps (PRD FR-08, technical-design §9).
 *
 * Manual defaults are conservative; trusted settings may tune within the
 * hard caps. Scheduled origin uses min(task config, 3) continuations and
 * min(task.maxRuntimeMs, SCHEDULED_LOOP_RUN_TIMEOUT_MS) active runtime.
 *
 * SCHEDULED_LOOP_RUN_TIMEOUT_MS is re-exported from aiChatScheduledLoopConfig
 * (the existing 10-minute scheduled-loop cap, PRD FR-08) rather than redefined
 * here so the scheduled loop and the budget policy cannot drift apart.
 */
import { SCHEDULED_LOOP_RUN_TIMEOUT_MS } from "@/config/aiChatScheduledLoopConfig";
import { z } from "zod/v4";

export { SCHEDULED_LOOP_RUN_TIMEOUT_MS };

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
  // FR-08/§9: checker attempts are capped per run (6) and per candidate (2,
  // 1 retry). Unit 2 adds the per-candidate gate to the budget reservation.
  maxCheckerAttemptsPerRun: 6,
  maxCheckerAttemptsPerCandidate: 2,
} as const;

/**
 * Clamp budget limits to the hard caps (PRD §9, FR-08). Trusted task
 * configuration may tune limits, but never above the hard cap — a malformed
 * or hostile task config that sets maxContinuations=1000 collapses to 10.
 * Applies to the two fields that have hard caps; the rest pass through
 * unchanged (they are already bounded by their manual defaults and have no
 * ceiling). The result is what gets frozen into ledger.policy_limits_json at
 * createExecution time so the persisted budget can never exceed the caps,
 * even if the in-memory TaskRunBudget is later tampered with.
 *
 * GAP-S1: HARD_CAPS was previously declared but no function consumed it —
 * the caps were advisory, not enforced. This makes them enforced at the
 * freeze boundary.
 */
export function clampToHardCaps(limits: BudgetLimitsInput): BudgetLimitsInput {
  return {
    ...limits,
    maxContinuations: Math.min(limits.maxContinuations, HARD_CAPS.maxContinuations),
    maxActiveRuntimeMs: Math.min(
      limits.maxActiveRuntimeMs,
      HARD_CAPS.maxActiveRuntimeMs
    ),
  };
}

/**
 * Coerce a task-configured limit to a non-negative safe integer per
 * technical-design §9 ("Validate all configured limits as positive safe
 * integers and enforce hard caps"). NaN, non-finite, non-integer, and
 * negative values collapse to 0 (fail-closed: no budget granted for the
 * invalid field) so a malformed task config can never produce an unbounded
 * budget. Zero is preserved (a legitimate "no allowance" configuration).
 */
function asPositiveSafeInt(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * Build scheduled-origin limits from task configuration. Continuations are
 * min(task.maxContinueCalls, 3) per §9; tool executions use the task's
 * configured maxToolCalls; active runtime is the minimum of the task's
 * configured runtime and the scheduled-loop run timeout. All three
 * task-configured numbers are validated to non-negative safe integers first;
 * invalid values fail-closed to 0.
 */
export function buildScheduledBudgetLimits(input: {
  readonly maxContinueCalls: number;
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
}): BudgetLimitsInput {
  const safeContinueCalls = asPositiveSafeInt(input.maxContinueCalls);
  const safeToolCalls = asPositiveSafeInt(input.maxToolCalls);
  const safeRuntimeMs = asPositiveSafeInt(input.maxRuntimeMs);
  return {
    maxContinuations: Math.min(safeContinueCalls, 3),
    maxProviderAttempts: 60,
    maxCheckerAttempts: 6,
    maxToolExecutions: safeToolCalls,
    maxTokens: 128_000,
    maxActiveRuntimeMs: Math.min(safeRuntimeMs, SCHEDULED_LOOP_RUN_TIMEOUT_MS),
    maxWaitMs: 60 * 60 * 1000,
    maxNoProgressStreak: 3,
  };
}

// ----- Ledger policy_limits_json decode boundary -----

/**
 * Zod schema for the frozen `policy_limits_json` stored on a ledger row.
 * Persisted JSON is untrusted at read: `resurrectFromLedger` decodes through
 * this schema before trusting the values. Each field must be a non-negative
 * safe integer; `resurrectFromLedger` clamps the two hard-capped fields
 * (continuations, active runtime) down to HARD_CAPS so a tampered ledger
 * row can never produce an unbounded budget.
 */
export const ledgerPolicyLimitsSchema = z.object({
  maxContinuations: z.number().int().min(0),
  maxProviderAttempts: z.number().int().min(0),
  maxCheckerAttempts: z.number().int().min(0),
  maxToolExecutions: z.number().int().min(0),
  maxTokens: z.number().int().min(0),
  maxActiveRuntimeMs: z.number().int().min(0),
  maxWaitMs: z.number().int().min(0),
  maxNoProgressStreak: z.number().int().min(0),
});

/**
 * Decode + validate a ledger row's `policy_limits_json`. Returns the limits
 * clamped to HARD_CAPS (continuations, active runtime) so a persisted
 * budget can never exceed the caps even if the row was written by an older
 * version or tampered with. Throws on malformed JSON or a schema mismatch —
 * callers treat resurrection failure as fatal for the resume (fail-closed:
 * no budget, no dispatch) rather than silently granting an unbounded one.
 */
export function decodeLedgerPolicyLimits(policyLimitsJson: string): BudgetLimitsInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(policyLimitsJson);
  } catch {
    throw new Error(
      `Malformed ledger policy_limits_json (not JSON): ${policyLimitsJson.slice(0, 100)}`
    );
  }
  const result = ledgerPolicyLimitsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Ledger policy_limits_json failed schema validation: ${result.error.message}`
    );
  }
  return clampToHardCaps(result.data);
}
