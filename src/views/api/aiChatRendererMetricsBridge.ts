/**
 * Audit R2 G01 (diagnostics export consumer): the renderer keeps in-process
 * projection aggregates (`aiChatRendererMetrics.ts`) that main never sees.
 * This bridge is the join — a low-frequency bounded push of the sanitized
 * snapshot into main's `aiChatQueueCounters` so the structured `logSnapshot()`
 * soak line and the diagnostics export carry the renderer projection data
 * through the same telemetry channel as the main-process stage timings.
 *
 * Telemetry only: the payload is counts + durations with validated bounded
 * labels — never prompts, tool content, file names, paths, or credentials.
 */
import { windowInvoke } from "@/views/utils/apirequest";
import { AI_CHAT_RENDERER_METRICS_PUSH } from "@/config/channellist";
import { aiChatRendererMetricsPushPayload } from "@/views/store/aiChatRendererMetrics";

const FLUSH_INTERVAL_MS = 30_000;

/**
 * Audit R06: the renderer process owns a stable realm identity plus a
 * monotonic push sequence. Main keeps the previous RAW cumulative state per
 * realm and converts each push into deltas, so a periodic cumulative
 * snapshot (or a replayed push after transport ambiguity) can no longer
 * multiply samples. A renderer restart mints a NEW realm id, which main
 * treats as a fresh baseline.
 */
const REALM_ID: string = (() => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `realm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
})();

let pushSeq = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let beforeUnloadHandler: (() => void) | null = null;

/** Push one bounded snapshot into main (fire-and-forget, fail-soft). */
export async function flushRendererMetricsOnce(): Promise<void> {
  try {
    pushSeq += 1;
    const payload = aiChatRendererMetricsPushPayload();
    await windowInvoke(AI_CHAT_RENDERER_METRICS_PUSH, {
      realm: { realmId: REALM_ID, seq: pushSeq },
      timings: payload.timings,
      counts: payload.counts,
    });
  } catch {
    // Telemetry is best-effort — a bridge failure must never affect chat.
  }
}

/**
 * Idempotently start the bridge: periodic push (30 s) + final push on
 * window unload. Safe under tests (register only when `window` exists).
 */
export function startRendererMetricsBridge(): void {
  if (typeof window === "undefined") return;
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushRendererMetricsOnce();
  }, FLUSH_INTERVAL_MS);
  beforeUnloadHandler = () => {
    void flushRendererMetricsOnce();
  };
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

/** Stop the bridge (test isolation). */
export function stopRendererMetricsBridge(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (beforeUnloadHandler) {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}

/** Test isolation: restarts sequence numbering (and identity reset scope). */
export function resetRendererMetricsBridgeForTest(): void {
  stopRendererMetricsBridge();
  pushSeq = 0;
}
