/**
 * Per-invocation generation deadline (FR-035 slice, B13).
 *
 * Bounds one `createDraft` invocation to `GENERATION_INVOCATION_BUDGET_MS`
 * (5 minutes) and each individual model call to `MODEL_CALL_CAP_MS`
 * (120 seconds) or the smaller remaining aggregate budget — whichever is
 * less. Classification, the strict-reply generation call, the B06 no-hint
 * fallback retry, and the correction attempt ALL draw down the SAME
 * deadline, so nested retries cannot run unbounded (B13 trigger:
 * "nested classification/retry/correction consumes the overall budget").
 *
 * Scope note: the reservation/lease/fencing machinery of FR-035 (atomic
 * generation reservation, expired-owner fencing) is T07/T08 — NOT this
 * module. This module only threads a deadline through the model calls of
 * one in-flight invocation; the service re-checks expiry before persisting
 * a draft so late model output cannot be committed under an expired owner.
 *
 * Pure and dependency-free: the clock is injectable so tests can pass tiny
 * budgets without waiting real wall-clock time. Nothing here touches the
 * database or Electron APIs, and no module-level side effects exist (no
 * `new` of anything at top level).
 */

/**
 * Hard cap on a single model call (FR-035: "120 seconds or the smaller
 * remaining aggregate budget"). Applied by the generation service when it
 * computes `callBudgetMs` for each `openAIChatCompletion` request.
 */
export const MODEL_CALL_CAP_MS = 120_000;

/**
 * Aggregate budget for one full `createDraft` invocation (FR-035:
 * 5-minute invocation deadline). Covers classification + generation +
 * hint-fallback retry + correction, not just one call.
 */
export const GENERATION_INVOCATION_BUDGET_MS = 5 * 60_000;

/**
 * Default output budget for a reply generation call (FR-027: the 1500-token
 * default, no longer a call-site literal). A 400-word reply can approach
 * ~700 tokens with JSON framing, so the default keeps headroom for strict
 * JSON + the correction loop. Configurable per service instance so callers
 * can tune it without editing the call site; per-model clamping (reading
 * `max_output_tokens` from the provider's models list) remains deferred
 * capability detection (T09 honest scope).
 */
export const REPLY_MAX_TOKENS_DEFAULT = 1500;

/**
 * Output budget for the safety-classifier call (FR-027 sibling). The
 * constrained-JSON answer ("safe"/"needs_review"/"human_review" + confidence)
 * fits well under 60 tokens; a small budget keeps a runaway classifier
 * response from eating the invocation budget.
 */
export const CLASSIFIER_MAX_TOKENS = 60;

/**
 * Bounded length for the persisted {@link EmailReplyDraftEntity.modelName}
 * column (varchar(100)). Truncation is deliberate — provider-returned model
 * ids can exceed the column width, and the T09 fix stores the honest
 * returnedModel value rather than the pre-T09 literal.
 */
export const MODEL_NAME_MAX_CHARS = 100;
export interface GenerationDeadline {
  /** Remaining budget in ms, clamped to 0 once elapsed. */
  remainingMs(): number;
  /** True when the budget is exhausted. */
  expired(): boolean;
}

/**
 * Start a generation deadline. `now` defaults to the wall clock; tests
 * inject a controllable clock. `budgetMs` defaults to
 * {@link GENERATION_INVOCATION_BUDGET_MS}.
 */
export function startGenerationDeadline(opts?: {
  readonly now?: () => number;
  readonly budgetMs?: number;
}): GenerationDeadline {
  const now = opts?.now ?? ((): number => Date.now());
  const budgetMs =
    opts?.budgetMs !== undefined && opts.budgetMs >= 0
      ? opts.budgetMs
      : GENERATION_INVOCATION_BUDGET_MS;
  const start = now();
  return {
    remainingMs(): number {
      return Math.max(0, start + budgetMs - now());
    },
    expired(): boolean {
      return this.remainingMs() <= 0;
    },
  };
}
