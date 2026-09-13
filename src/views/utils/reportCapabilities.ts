"use strict";
import { ref, watch, onScopeDispose } from "vue";
import { getAIContentReportCapabilities } from "@/views/api/aiContentReport";
import type { AIContentReportCapabilities } from "@/entityTypes/aiContentReportTypes";

/**
 * Conversation-report capability state with bounded retry and a slow-poll tail.
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
 *  - a bounded fast-backoff chain whenever eligible reportable content
 *    exists but capabilities have not resolved to `enabled: true`. The
 *    chain is re-armed (budget reset) on every eligibility gain (false→true
 *    transition) AND on every `rearmKey` change (active conversation
 *    switch) — including true→true switches between two conversations that
 *    both hold eligible output, where no eligibility transition fires.
 *  - once the fast chain exhausts, a slow-poll tail keeps re-asking at
 *    SLOW_POLL_MS while eligible content exists and the envelope is not
 *    enabled, so an outage longer than the fast chain still heals without
 *    requiring another conversation switch.
 *
 * Fail-closed semantics are preserved: callers may enable the button only
 * when a fetched envelope really says `conversationReporting.enabled ===
 * true`. The renderer cannot distinguish a legitimately-disabled envelope
 * from the fail-closed one (the main process returns the same shape), so
 * the tail also re-asks deliberately-disabled backends — but the main
 * process serves those from its module-level 5-minute TTL cache, so the
 * steady state costs one IPC round-trip per SLOW_POLL_MS per instance and
 * at most one real HTTP GET per TTL window across all instances.
 *
 * Cost bounds: the fast chain fires at most RETRY_DELAYS_MS.length retries
 * per re-arm, and re-arms are user-driven (conversation switches /
 * history loads). Concurrent fetches across the always-mounted AiChatV2
 * and AiChatBox instances share one in-flight promise (see below).
 */
export interface UseReportCapabilitiesOptions {
  /**
   * Whether the caller currently has eligible reportable content. Retries
   * only happen while this is true — an empty chat never re-asks.
   */
  hasEligibleOutput: () => boolean;
  /**
   * Identity of the content being reported (the active conversation id).
   * Every change re-arms the fast retry chain even when eligibility stays
   * true throughout (true→true conversation switches). The value is only a
   * watch source — it is never read, so callers may return undefined.
   */
  rearmKey?: () => string | null | undefined;
  /**
   * Fast-chain backoff schedule in ms. Tests pass a same-shape table with
   * tiny delays; production uses RETRY_DELAYS_MS.
   */
  retryDelays?: readonly number[];
  /**
   * Slow-poll interval in ms once the fast chain exhausts. Defaults to the
   * main process's capability TTL so a cached "no" never triggers HTTP.
   */
  slowPollMs?: number;
}

/** Capped fast-backoff schedule, in ms (transient outages heal within minutes). */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000] as const;

/** Slow-poll interval; matches the main-process CAPABILITY_TTL_MS cache. */
const SLOW_POLL_MS = 5 * 60 * 1000;

export interface ReportCapabilitiesHandle {
  capabilities: ReturnType<typeof ref<AIContentReportCapabilities | null>>;
  loading: ReturnType<typeof ref<boolean>>;
}

/**
 * Module-level in-flight fetch: the always-mounted AiChatV2 and AiChatBox
 * surfaces create separate composable instances whose mount fetches and
 * retry chains often overlap; sharing the promise collapses concurrent
 * attempts into one IPC round-trip. Never caches a result — the slot is
 * cleared the moment the promise settles (success or rejection).
 */
let inFlightCapabilities: Promise<AIContentReportCapabilities> | null = null;

function sharedFetchCapabilities(): Promise<AIContentReportCapabilities> {
  if (inFlightCapabilities === null) {
    const promise = getAIContentReportCapabilities().finally(() => {
      // Guarded so a stale promise's cleanup can never clobber a newer
      // in-flight fetch (only possible after the test-only reset below).
      if (inFlightCapabilities === promise) {
        inFlightCapabilities = null;
      }
    });
    inFlightCapabilities = promise;
  }
  return inFlightCapabilities;
}

/** Test-only: clear the shared in-flight slot between tests. */
export function resetReportCapabilitiesForTest(): void {
  inFlightCapabilities = null;
}

export function useReportCapabilities(
  options: UseReportCapabilitiesOptions
): ReportCapabilitiesHandle {
  const capabilities = ref<AIContentReportCapabilities | null>(null);
  const loading = ref(false);

  let retryIndex = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const isCapabilityEnabled = (): boolean =>
    capabilities.value?.conversationReporting.enabled === true;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /**
   * Schedule the next fetch: the fast chain while budget remains, then the
   * slow-poll tail. All state is re-checked both at schedule time and at
   * fire time.
   */
  const scheduleNext = (): void => {
    if (disposed || timer !== null) return;
    if (loading.value) return; // a fetch is already in flight
    if (!options.hasEligibleOutput()) return;
    if (isCapabilityEnabled()) return;
    const delays = options.retryDelays ?? RETRY_DELAYS_MS;
    const delay =
      retryIndex < delays.length
        ? delays[retryIndex]
        : options.slowPollMs ?? SLOW_POLL_MS;
    retryIndex += 1;
    timer = setTimeout(() => {
      timer = null;
      // Re-check at fire time: eligibility may have dropped, capabilities
      // may have resolved, or the scope may have been disposed.
      if (disposed) return;
      if (!options.hasEligibleOutput()) return;
      if (isCapabilityEnabled()) return;
      void fetchCapabilities();
    }, delay);
  };

  /** Reset the fast-chain budget and restart scheduling from its head. */
  const rearm = (): void => {
    retryIndex = 0;
    clearTimer();
    scheduleNext();
  };

  const fetchCapabilities = async (): Promise<void> => {
    if (disposed) return;
    loading.value = true;
    try {
      capabilities.value = await sharedFetchCapabilities();
    } catch {
      capabilities.value = null;
    } finally {
      if (!disposed) {
        loading.value = false;
      }
    }
    // Chain: this fetch did not produce an enabled envelope and eligible
    // content still exists → keep the bounded backoff / tail going.
    scheduleNext();
  };

  // Initial fetch first, so the in-flight loading guard suppresses any
  // watch-triggered scheduling until it settles.
  void fetchCapabilities();

  // Re-arm signal 1: the caller gained eligible content (e.g. loaded a
  // history conversation) while capabilities are unknown/disabled — the
  // reported bug scenario.
  watch(
    () => options.hasEligibleOutput(),
    (hasEligible, wasEligible) => {
      if (!hasEligible || wasEligible) return;
      rearm();
    }
  );

  // Re-arm signal 2: the active conversation changed (e.g. switched from
  // one eligible history conversation to another — a true→true switch that
  // signal 1 cannot see).
  if (options.rearmKey !== undefined) {
    watch(options.rearmKey, () => rearm());
  }

  onScopeDispose(() => {
    disposed = true;
    clearTimer();
  });

  return { capabilities, loading };
}
