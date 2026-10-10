import { log } from "@/modules/Logger";

/**
 * Privacy-safe metrics for the email-service identity feature (technical
 * design §21 Observability). Counters are emitted as structured JSONL via the
 * app logger (local observability; no network).
 *
 * Cardinality rules (§21): labels are only low-cardinality enums/ids. NEVER
 * label with email addresses, SMTP usernames, subjects, or raw error text.
 * The counters below take no labels at all — they are simple occurrence
 * counts so a spike in legacy fallbacks or import password gaps is visible in
 * the log stream without exposing any identity value.
 *
 * Counters (§21):
 *  - `email_service_identity_legacy_fallback_total` — a service row resolved
 *    its SMTP username via the `?? from` fallback because no explicit
 *    smtpUsername was configured (legacy compatibility path).
 *  - `email_service_import_password_preserved_total` — an import update row
 *    kept the stored password because the import row omitted/blanked it
 *    (§10.4: blank never clears on update).
 *  - `email_service_import_new_password_missing_total` — an import create row
 *    arrived without a password and was rejected by validation (FR-002).
 */

/** Counters keyed by metric name + label set. */
const counters = new Map<string, number>();

/** Emit `email_service_<name>_total` with low-cardinality labels (§21). */
export function incrementEmailServiceMetric(
  name: string,
  labels: Readonly<Record<string, string | number | boolean | null>> = {}
): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + 1);
  emit(`${name}_total`, labels, counters.get(key) ?? 1);
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
      metric: `email_service_${metric}`,
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
