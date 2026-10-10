import { log } from "@/modules/Logger";

/**
 * Privacy-safe metrics for the intent-aware outbound-email pipeline
 * (NFR-004, technical design §23.1). Outcome counters and stage durations,
 * emitted as structured JSONL via the app logger (local observability; no
 * network).
 *
 * Cardinality rules (§23): labels are only low-cardinality enums/ids — delivery
 * mode, reason code, outcome, stage, resolver/validator version identifiers.
 * NEVER label with email addresses, subjects, bodies, document names, or raw
 * error text.
 */

/** Counters keyed by metric name + label set. */
const counters = new Map<string, number>();

/** Emit `outbound_email_<name>_total` with low-cardinality labels (§23.1). */
export function incrementOutboundMetric(
  name: string,
  labels: Readonly<Record<string, string | number | boolean | null>> = {}
): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + 1);
  emit(`${name}_total`, labels, counters.get(key) ?? 1);
}

/** Emit `outbound_email_<stage>_duration_ms` for one observed stage duration. */
export function observeOutboundDurationMs(
  stage: string,
  durationMs: number,
  labels: Readonly<Record<string, string | number | boolean | null>> = {}
): void {
  emit(`${stage}_duration_ms`, { stage, ...labels }, Math.round(durationMs));
}

/** Time an async stage and emit its duration; rethrows on failure. */
export async function timedOutboundStage<T>(
  stage: string,
  fn: () => Promise<T>,
  labels: Readonly<Record<string, string | number | boolean | null>> = {}
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    observeOutboundDurationMs(stage, Date.now() - start, labels);
    return result;
  } catch (error) {
    observeOutboundDurationMs(stage, Date.now() - start, {
      ...labels,
      failed: true,
    });
    throw error;
  }
}

function metricKey(
  name: string,
  labels: Readonly<Record<string, unknown>>
): string {
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(",");
  return labelStr ? `${name}{${labelStr}}` : name;
}

function emit(
  metric: string,
  labels: Readonly<Record<string, unknown>>,
  value: number
): void {
  try {
    const line = JSON.stringify({
      metric: `outbound_email_${metric}`,
      labels: sanitizeLabels(labels),
      value,
      ts: new Date().toISOString(),
    });
    log.info(`[metrics] ${line}`);
  } catch {
    // Metrics must never break the workflow they observe.
  }
}

/** Defensive: drop any label whose value could carry private content. */
function sanitizeLabels(
  labels: Readonly<Record<string, unknown>>
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v === "string") {
      // Strings allowed only as short enum-ish codes; bound their length.
      out[k] = v.slice(0, 60);
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    } else {
      out[k] = null;
    }
  }
  return out;
}

/** Test hook: read and reset in-memory counters. */
export function drainCountersForTest(): Map<string, number> {
  const drained = new Map(counters);
  counters.clear();
  return drained;
}