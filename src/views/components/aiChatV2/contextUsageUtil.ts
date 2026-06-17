/**
 * Pure helpers for computing AI Chat V2 context-usage percentage.
 *
 * Extracted from the AiChatV2.vue component so the math can be unit-tested
 * without mounting Vue. Kept framework-agnostic on purpose.
 */

/** Fallback context window size when the models API doesn't expose one. */
export const DEFAULT_CONTEXT_WINDOW = 128000;

export interface ContextUsageInputs {
  /** Known model id → context window size (tokens). */
  modelContextWindows: Map<string, number>;
  /** Real total-token count from the last server usage report, if any. */
  lastTotalTokens?: number;
  /** Live running estimate while tokens stream. */
  streamingEstimatedTokens: number;
  /** Model id currently in use (from start/usage events). */
  model?: string;
}

/** Resolve the context window denominator for a given model. */
export function resolveContextWindow(
  modelContextWindows: Map<string, number>,
  model?: string,
  fallback: number = DEFAULT_CONTEXT_WINDOW
): number {
  if (model) {
    const hit = modelContextWindows.get(model);
    if (typeof hit === "number" && hit > 0) return hit;
  }
  return fallback;
}

/**
 * Compute the context-usage percentage in [0, 100]. Prefers the live
 * streaming estimate; falls back to the last server-reported total; treats
 * any non-finite or negative input as 0%.
 */
export function computeContextPercent(inputs: ContextUsageInputs): number {
  const used =
    inputs.streamingEstimatedTokens || inputs.lastTotalTokens || 0;
  if (used <= 0) return 0;
  const window = resolveContextWindow(
    inputs.modelContextWindows,
    inputs.model
  );
  if (window <= 0) return 0;
  const pct = (used / window) * 100;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  if (pct > 100) return 100;
  return Math.round(pct);
}

/** Tone buckets used by the badge to pick a color. */
export type ContextUsageTone = "low" | "mid" | "high" | "critical";

export function toneForPercent(percent: number): ContextUsageTone {
  if (!Number.isFinite(percent) || percent < 0) return "low";
  const p = Math.min(100, percent);
  if (p >= 95) return "critical";
  if (p >= 80) return "high";
  if (p >= 50) return "mid";
  return "low";
}
