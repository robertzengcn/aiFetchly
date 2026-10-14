/**
 * Durable plan-continuation intents (B08, FR-PLN-005–008, AD-007).
 *
 * When a plan decision commits in main but its "begin executing" follow-up
 * cannot be sent (selection changed mid-flow, reload/crash before enqueue,
 * or a rejected continuation enqueue), the approval must not lose its
 * continuation permanently with no working retry control. The deterministic
 * continuation request id alone (planContinuationIdentity) prevents
 * duplicates but cannot recover intent nobody retained.
 *
 * This store persists the intent (decision coordinates + optional feedback)
 * in localStorage keyed by conversation. The continuation request id is
 * derived deterministically at SEND time, so retries reuse the original
 * decision identity and main collapses them idempotently (coordinator
 * request cache / pending unique index) into exactly one continuation row
 * and one execution. A null decision (no persisted transition) never
 * creates an intent and starts nothing.
 *
 * Renderer-durable + main-idempotent is the equivalent durable, retryable
 * continuation state the audit requires (an atomic main-side decision+
 * intent write would be the alternative; this achieves the same recovery
 * without a schema change).
 */

export type PlanContinuationAction =
  | "approve-plan"
  | "reject-plan"
  | "request-plan-changes";

export interface PlanContinuationIntent {
  readonly conversationId: string;
  readonly planId: string;
  readonly version: number;
  readonly action: PlanContinuationAction;
  readonly feedback: string;
  readonly savedAt: string;
}

const STORAGE_PREFIX = "aifetchly.plan-continuation.";

function storageKey(conversationId: string): string {
  return `${STORAGE_PREFIX}${conversationId}`;
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function savePlanContinuationIntent(
  intent: PlanContinuationIntent
): void {
  safeStorage()?.setItem(storageKey(intent.conversationId), JSON.stringify(intent));
}

/** Latest recoverable intent for a conversation, or null. */
export function loadPlanContinuationIntent(
  conversationId: string
): PlanContinuationIntent | null {
  const raw = safeStorage()?.getItem(storageKey(conversationId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlanContinuationIntent>;
    if (
      typeof parsed.conversationId !== "string" ||
      typeof parsed.planId !== "string" ||
      typeof parsed.version !== "number" ||
      (parsed.action !== "approve-plan" &&
        parsed.action !== "reject-plan" &&
        parsed.action !== "request-plan-changes") ||
      typeof parsed.feedback !== "string"
    ) {
      return null;
    }
    return {
      conversationId: parsed.conversationId,
      planId: parsed.planId,
      version: parsed.version,
      action: parsed.action,
      feedback: parsed.feedback,
      savedAt:
        typeof parsed.savedAt === "string"
          ? parsed.savedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Clear the intent (continuation accepted or user dismissed). */
export function clearPlanContinuationIntent(conversationId: string): void {
  try {
    safeStorage()?.removeItem(storageKey(conversationId));
  } catch {
    // Non-fatal — a stale intent simply re-surfaces the retry banner.
  }
}
