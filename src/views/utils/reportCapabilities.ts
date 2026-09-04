"use strict";
import { ref, watch, onScopeDispose } from "vue";
import { getAIContentReportCapabilities } from "@/views/api/aiContentReport";
import type { AIContentReportCapabilities } from "@/entityTypes/aiContentReportTypes";

/**
 * Conversation-report capability state with bounded lazy retry.
 *
 * Bug context (2026-09-04): every report surface (AiChatV2, AiChatBox,
 * Knowledge ChatInterface) fetched capabilities exactly once at mount. When
 * that one fetch failed — a transient backend 502/network blip — the
 * renderer kept `reportCapabilities` at null / fail-closed `enabled:false`
 * for the whole session, so the "Report conversation" header button stayed
 * grey forever, even after the user loaded a history conversation full of
 * eligible content. The main-process service intentionally fail-closes and
 * does not cache failures ("a transient outage heals on the next call") —
 * but no next call ever came.
 *
 * This composable owns that state and performs the "next call":
 *  - an initial fetch at scope creation (unchanged behavior),
 *  - a bounded backoff chain whenever eligible reportable content exists
 *    but capabilities have not resolved to `enabled: true` yet,
 *  - a fresh budget on every ineligible→eligible transition (each history
 *    conversation load gets a new chance), never more than
 *    MAX_RETRY_ATTEMPTS fetches per chain.
 *
 * Fail-closed semantics are preserved: callers may enable the button only
 * when a fetched envelope really says `conversationReporting.enabled ===
 * true`. A permanently-disabled backend costs at most four extra requests
 * per eligible transition, bounded by the schedule below.
 */
export interface UseReportCapabilitiesOptions {
  /**
   * Whether the caller currently has eligible reportable content. Retries
   * only happen while this is true — an empty chat never re-asks.
   */
  hasEligibleOutput: () => boolean;
  /** Backoff base in ms. 0 (tests) collapses the schedule to immediate. */
  retryDelayMs?: number;
}

/** Capped backoff schedule, in ms (transient outages heal within minutes). */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000] as const;

/** Total retry fetches per eligible transition. */
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length;

export interface ReportCapabilitiesHandle {
  capabilities: ReturnType<typeof ref<AIContentReportCapabilities | null>>;
  loading: ReturnType<typeof ref<boolean>>;
}

export function useReportCapabilities(
  options: UseReportCapabilitiesOptions
): ReportCapabilitiesHandle {
  const capabilities = ref<AIContentReportCapabilities | null>(null);
  const loading = ref(false);

  let retryIndex = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const isCapabilityEnabled = (): boolean =>
    capabilities.value?.conversationReporting.enabled === true;

  /** Schedule the next retry in the chain, with fire-time state re-checks. */
  const maybeScheduleRetry = (): void => {
    if (disposed || retryTimer !== null) return;
    if (loading.value) return; // a fetch is already in flight
    if (!options.hasEligibleOutput()) return;
    if (isCapabilityEnabled()) return;
    if (retryIndex >= MAX_RETRY_ATTEMPTS) return;
    const delay =
      options.retryDelayMs !== undefined
        ? options.retryDelayMs * Math.pow(2, retryIndex)
        : RETRY_DELAYS_MS[retryIndex];
    retryIndex += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      // Re-check at fire time: the initial fetch may have resolved, the
      // user may have switched to an empty conversation, or the scope may
      // have been disposed since this was scheduled.
      if (disposed) return;
      if (!options.hasEligibleOutput()) return;
      if (isCapabilityEnabled()) return;
      void fetchCapabilities();
    }, delay);
  };

  const fetchCapabilities = async (): Promise<void> => {
    if (disposed) return;
    loading.value = true;
    try {
      capabilities.value = await getAIContentReportCapabilities();
    } catch {
      capabilities.value = null;
    } finally {
      if (!disposed) {
        loading.value = false;
      }
    }
    // Chain: this fetch did not produce an enabled envelope and eligible
    // content still exists → keep the bounded backoff going.
    maybeScheduleRetry();
  };

  // Initial fetch first, so the in-flight loading guard suppresses any
  // watch-triggered scheduling until it settles.
  void fetchCapabilities();

  // Retry signal: the caller gained eligible content (e.g. loaded a history
  // conversation) while capabilities are unknown/disabled — the reported
  // bug scenario. Each false→true transition resets the budget.
  watch(
    () => options.hasEligibleOutput(),
    (hasEligible, wasEligible) => {
      if (!hasEligible || wasEligible) return;
      retryIndex = 0;
      maybeScheduleRetry();
    }
  );

  onScopeDispose(() => {
    disposed = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  });

  return { capabilities, loading };
}
