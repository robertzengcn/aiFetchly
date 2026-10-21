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
/** Audit R06: bounded number of concurrently tracked renderer realms. */
const MAX_REALM_TRACKING = 16;
const MAX_TOTAL_TIMING_MS = MAX_TIMING_MS * 1_000_000;

const labelSchema = z.string().regex(/^[a-z0-9_:.-]{1,80}$/);

const realmSchema = z
  .object({
    realmId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    seq: z.number().int().min(1).max(1_000_000),
  })
  .strict();

const timingEntrySchema = z
  .object({
    count: z.number().int().min(1).max(1_000_000),
    meanMs: z.number().min(0).max(MAX_TIMING_MS),
    /** Audit R06: exact unrounded total for precise per-realm deltas. */
    totalMs: z.number().min(0).max(MAX_TOTAL_TIMING_MS).optional(),
    minMs: z.number().min(0).max(MAX_TIMING_MS),
    maxMs: z.number().min(0).max(MAX_TIMING_MS),
  })
  .strict();

const timingsSchema = z.record(labelSchema, timingEntrySchema);

const countsSchema = z.record(
  labelSchema,
  z.number().int().min(0).max(1_000_000)
);

const rendererMetricsPushSchema = z
  .object({
    realm: realmSchema,
    timings: timingsSchema,
    counts: countsSchema,
  })
  .strict();

type RendererMetricsPush = z.infer<typeof rendererMetricsPushSchema>;

/** Raw cumulative timing state of one push, per known timing key. */
interface RealmTimingRaw {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

/** Previous RAW cumulative state for one realm (audit R06). */
interface RealmPrevious {
  seq: number;
  timings: Map<string, RealmTimingRaw>;
  counts: Map<string, number>;
}

const previousByRealm = new Map<string, RealmPrevious>();

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

function rawTimingOf(aggregate: RendererMetricsPush["timings"][string]): RealmTimingRaw {
  return {
    count: aggregate.count,
    totalMs: aggregate.totalMs ?? aggregate.meanMs * aggregate.count,
    minMs: aggregate.minMs,
    maxMs: aggregate.maxMs,
  };
}

/**
 * Audit R06 delta merge. The renderer pushes its CUMULATIVE aggregates
 * under a monotonic (realmId, seq); main keeps the previous RAW state per
 * realm and converts the push into per-key deltas (clamped ≥ 0, zero-delta
 * values are no-ops) so repeated cumulative snapshots, periodic flushes and
 * replayed pushes cannot multiply samples. Gaps in timing keys or count
 * labels simply merge nothing for the missing entries.
 */
function mergeRealmPush(push: RendererMetricsPush): boolean {
  const realmId = push.realm.realmId;
  const previous = previousByRealm.get(realmId);
  if (previous && push.realm.seq <= previous.seq) {
    // Stale, replayed, or out-of-order push: dropped, fail-closed.
    return false;
  }

  for (const [rawKey, aggregate] of Object.entries(push.timings).slice(0, MAX_TIMING_ENTRIES)) {
    // Only documented timing keys merge — the whitelist is the counter
    // module's own union, guarded here through its TIMING_KEYS surface
    // (bounded vocabulary; the renderer cannot mint new main-side keys).
    const known = aiChatQueueCounters.knownTimingKey(rawKey);
    if (!known) continue;
    const raw = rawTimingOf(aggregate);
    const prev = previous?.timings.get(rawKey);
    const countDelta = raw.count - (prev?.count ?? 0);
    const totalDelta = raw.totalMs - (prev?.totalMs ?? 0);
    if (countDelta > 0) {
      // Regenerate the sampler arithmetic from the exact total delta;
      // min/max fold into the running global range (min folds lower, max
      // unfolds higher — no subtraction is meaningful for range bounds).
      aiChatQueueCounters.observeTimingAggregate(known, {
        count: countDelta,
        totalMs: Math.max(0, totalDelta),
        minMs: raw.minMs,
        maxMs: raw.maxMs,
      });
    }
  }
  for (const [label, value] of Object.entries(push.counts).slice(0, MAX_COUNT_ENTRIES)) {
    const delta = value - (previous?.counts.get(label) ?? 0);
    if (delta > 0) {
      aiChatQueueCounters.mergeLabeledCount(`renderer_${label}`, delta);
    }
  }

  const nowRaw: RealmPrevious = {
    seq: push.realm.seq,
    timings: new Map(Object.entries(push.timings).map(([key, agg]) => [key, rawTimingOf(agg)])),
    counts: new Map(Object.entries(push.counts)),
  };
  if (!previousByRealm.has(realmId) && previousByRealm.size >= MAX_REALM_TRACKING) {
    const oldest = previousByRealm.keys().next();
    if (!oldest.done) previousByRealm.delete(oldest.value);
  }
  previousByRealm.set(realmId, nowRaw);
  return true;
}

/**
 * Register the metrics push channel. No AI entitlement gate: metrics are
 * process-local telemetry and the merge is strictly validated/fail-closed.
 */
export function registerAiChatRendererMetricsIpcHandlers(): void {
  ipcMain.handle(AI_CHAT_RENDERER_METRICS_PUSH, (_e, data: unknown) => {
    const decoded = decode(data);
    if (!decoded.ok) return { status: false, msg: "Invalid metrics payload", data: null };
    const accepted = mergeRealmPush(decoded.value);
    if (!accepted) {
      return { status: false, msg: "Stale metrics push", data: null };
    }
    return { status: true, msg: "", data: null };
  });
}

/** Test isolation (unregisters the handler and forgets realm state). */
export function unregisterAiChatRendererMetricsForTest(): void {
  ipcMain.removeHandler(AI_CHAT_RENDERER_METRICS_PUSH);
  previousByRealm.clear();
}
