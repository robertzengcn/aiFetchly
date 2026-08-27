/** Canonical built-in tool names for contact extraction and verification. */
export const EXTRACT_CONTACT_INFO_TOOL_NAME = "extract_contact_info";
export const VERIFY_CONTACT_INFO_TOOL_NAME = "verify_contact_info";

/**
 * Contact Verification configuration constants (design §12.3).
 *
 * All limits and tuning values live here rather than scattered literals so
 * the behavior is auditable in one place. Values are based on the technical
 * design's initial recommendations and should be re-tuned from measured
 * latency (design Phase 3).
 */

/** Rules version for the deterministic email/phone rule sets. Bump when
 * placeholder/role/suspicious/disposable rules change so re-verification
 * can detect stale results (PRD FR-15). */
export const RULES_VERSION = "1.0.0";

/** Bounded batch / concurrency limits. */
export const CONTACT_VERIFICATION_LIMITS = {
  /** Max contact groups per single tool call. */
  maxGroups: 25,
  /** Max total email + phone values across the whole call. */
  maxTotalValues: 100,
  /** Max email values in a single group. */
  maxEmailsPerGroup: 50,
  /** Max phone values in a single group. */
  maxPhonesPerGroup: 50,
  /** Max concurrent unique-domain DNS checks within a call. */
  dnsConcurrency: 8,
  /** Per-DNS-operation timeout (ms). */
  dnsOperationTimeoutMs: 3_000,
  /** Overall service soft deadline (ms). Partial results returned after. */
  serviceDeadlineMs: 30_000,
  /** Max progress events per second (anti-spam). */
  progressEventsPerSecond: 4,
  /** Max reasons attached to a single contact result. */
  maxReasonsPerContact: 5,
  /** Max characters of a single reason string. */
  maxReasonChars: 160,
} as const;

/** In-memory domain cache configuration (design §13.2). */
export const CONTACT_VERIFICATION_CACHE = {
  /** Max domains retained per process. */
  maxDomains: 1_000,
  /** TTL for positive mail-routing results (ms). */
  positiveTtlMs: 15 * 60_000,
  /** TTL for negative (null_mx / no_route / nxdomain) results (ms). */
  negativeTtlMs: 5 * 60_000,
  /** TTL for temporary / resolver failures (ms). */
  temporaryTtlMs: 30_000,
} as const;

/**
 * Fixed limitations surfaced on EVERY verification result (PRD §8.2, FR-12,
 * design §8.4). The model must never claim deliverability/ownership.
 */
export const CONTACT_VERIFICATION_LIMITATIONS: readonly string[] = [
  "Mailbox existence was not checked (Standard depth only).",
  "Phone line activity was not checked (Standard depth only).",
  "Ownership, reachability, and marketing consent were not verified.",
  "DNS mail-routing checks query the email domain only and disclose it to the configured DNS resolver.",
] as const;

/**
 * Map internal verification phases onto the fixed
 * `SkillExecutionContext.emitProgress` phase enum (queued|running|fetching|
 * extracting|finalizing). The design's precise phase name is carried in the
 * progress `message` string because widening the shared enum would ripple
 * across SkillExecutor / AIChatQueryLoop.
 */
export function mapVerificationPhaseToEmitPhase(
  phase:
    | "validating"
    | "checking_email_domains"
    | "checking_phones"
    | "finalizing"
): "queued" | "running" | "fetching" | "extracting" | "finalizing" {
  switch (phase) {
    case "validating":
      return "running";
    case "checking_email_domains":
      return "fetching";
    case "checking_phones":
      return "extracting";
    case "finalizing":
      return "finalizing";
  }
}
