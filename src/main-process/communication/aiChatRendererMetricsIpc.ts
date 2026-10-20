/**
 * Audit R2 G01 (design §18.3 diagnostics export): the renderer keeps its own
 * in-process projection aggregates (`src/views/store/aiChatRendererMetrics.ts`)
 * — main cannot see them. This channel is the join: the renderer pushes its
 * bounded snapshot (counts + timing aggregates, no content) and main merges
 * it into `aiChatQueueCounters`, so the structured `logSnapshot()` soak line
 * and every diagnostics consumer downstream observe the renderer projection
 * journey through the same telemetry as the main-process stage timings.
 *
 * Telemetry-only channel: strictly validated, fail-closed, and merges never
 * originate content — labels/durations only.
 */
import { ipcMain } from "electron";
import { z } from "zod";
import {
  AI_CHAT_RENDERER_METRICS_PUSH,
} from "@/config/channellist";
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";

const MAX_COUNT_ENTRIES = 128;
const MAX_TIMING_ENTRIES = 8;
const MAX_TIMING_MS = 600_000;

const labelSchema = z.string().regex(/^[a-z0-9_:.-]{1,80}$/);

const countEntrySchema = z.tuple([
  labelSchema,
  z.number().int().min(0).max(1_000_000),
]);

const timingsSchema = z.record(
  labelSchema,
  z.object({
    count: z.number().int().min(1).max(1_000_000),
    meanMs: z.number().min(0).max(MAX_TIMING_MS),
    minMs: z.number().min(0).max(MAX_TIMING_MS),
    maxMs: z.number().min(0).max(MAX_TIMING_MS),
  })
);

const countsSchema = z.record(
  labelSchema,
  z.number().int().min(0).max(1_000_000)
);

const rendererMetricsPushSchema = z
  .object({
    timings: timingsSchema,
    counts: countsSchema,
  })
  .strict();

type RendererMetricsPush = z.infer<typeof rendererMetricsPushSchema>;

function decode(data: unknown):
  | { ok: true; value: RendererMetricsPush }
  | { ok: false } {
  let payload: unknown = data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return { ok: false };
    }
  }
  const parsed = rendererMetricsPushSchema.safeParse(payload);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

function mergePush(push: RendererMetricsPush): void {
  const timingEntries = Object.entries(push.timings).slice(0, MAX_TIMING_ENTRIES);
  for (const [rawKey, aggregate] of timingEntries) {
    // Only documented timing keys merge — the whitelist is the counter
    // module's own union, guarded here through its TIMING_KEYS surface
    // (bounded vocabulary; the renderer cannot mint new main-side keys).
    const known = aiChatQueueCounters.knownTimingKey(rawKey);
    if (!known) continue;
    // Regenerate the sampler arithmetic from mean*count (mean is rounded by
    // the snapshot, so the merged total stays within sampling error).
    aiChatQueueCounters.observeTimingAggregate(known, {
      count: aggregate.count,
      totalMs: aggregate.meanMs * aggregate.count,
      minMs: aggregate.minMs,
      maxMs: aggregate.maxMs,
    });
  }
  const countEntries = Object.entries(push.counts).slice(0, MAX_COUNT_ENTRIES);
  for (const [label, value] of countEntries) {
    aiChatQueueCounters.mergeLabeledCount(`renderer_${label}`, value);
  }
}

/**
 * Register the metrics push channel. No AI entitlement gate: metrics are
 * process-local telemetry and the merge is strictly validated/fail-closed.
 */
export function registerAiChatRendererMetricsIpcHandlers(): void {
  ipcMain.handle(AI_CHAT_RENDERER_METRICS_PUSH, (_e, data: unknown) => {
    const decoded = decode(data);
    if (!decoded.ok) return { status: false, msg: "Invalid metrics payload", data: null };
    mergePush(decoded.value);
    return { status: true, msg: "", data: null };
  });
}

/** Test isolation (unregisters the handler). */
export function unregisterAiChatRendererMetricsForTest(): void {
  ipcMain.removeHandler(AI_CHAT_RENDERER_METRICS_PUSH);
}
