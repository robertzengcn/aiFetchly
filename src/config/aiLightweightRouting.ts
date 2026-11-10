// src/config/aiLightweightRouting.ts
//
// Release-level kill switch for small-model routing. When disabled, every
// lightweight workload uses the provider-normal path and all small-specific
// retry, cooldown, and fallback behavior is bypassed. Auto-dream's own
// enablement settings are unchanged.
//
// The value is read when the shared lightweight service is constructed, so
// changing it requires an app restart.
import { log } from "@/modules/Logger";

/**
 * Environment variable name. Accept only explicit case-insensitive `true`/`1`
 * (enabled) and `false`/`0` (disabled). An invalid value is logged once and
 * resolves to DISABLED so an operator typo cannot unexpectedly enable new
 * routing.
 */
export const AI_SMALL_MODEL_ROUTING_ENV =
  "AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED";

let cached: { value: boolean; source: "env" | "default" } | null = null;

/**
 * Resolve the kill switch. Defaults to DISABLED when the env var is absent —
 * routing is inert until an operator verifies the server has an
 * `is_small_model` setting and explicitly enables it. This is the safer
 * reading of tech-design §22 Phase 1 ("kill switch remains off in production
 * during code-only validation if server readiness is incomplete").
 */
export function isSmallModelRoutingEnabled(): boolean {
  if (cached) return cached.value;
  const raw = process.env[AI_SMALL_MODEL_ROUTING_ENV];
  if (raw === undefined || raw === "") {
    cached = { value: false, source: "default" };
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    cached = { value: true, source: "env" };
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    cached = { value: false, source: "env" };
    return false;
  }
  // Invalid value: log once and resolve to disabled.
  log.warn(
    `[ai-lightweight] Invalid ${AI_SMALL_MODEL_ROUTING_ENV}="${raw}"; ` +
      "expected true/1/false/0. Resolving to disabled."
  );
  cached = { value: false, source: "env" };
  return false;
}

/** Reset the cached value. For tests and provider/runtime switches. */
export function resetSmallModelRoutingCache(): void {
  cached = null;
}
