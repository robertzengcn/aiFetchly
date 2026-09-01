/**
 * Version identifiers recorded with every outbound-email reliability decision
 * so audits and send-time re-checks can tell which policy/validator produced
 * them (technical design §9.2, §12, §23). Bump these when the deterministic
 * intent phrases, hashing rules, preflight checks, or worker protocol change.
 */
export const OUTBOUND_RESOLVER_VERSION = "outbound-resolver-v1";

export const OUTBOUND_POLICY_VERSION = "outbound-policy-v1";

export const OUTBOUND_VALIDATOR_VERSION = "outbound-validator-v1";

/**
 * Recovery threshold: a claimed attempt with no worker-start acknowledgement
 * older than this is treated as "worker never started" (technical design §21).
 */
export const OUTBOUND_SEND_RECOVERY_THRESHOLD_MS = 2 * 60 * 1000;

/** Direct-send authorization TTL (technical design §7.5). */
export const OUTBOUND_DIRECT_AUTH_TTL_MS = 15 * 60 * 1000;

/** Review-approval authorization TTL (technical design §7.5). */
export const OUTBOUND_REVIEW_AUTH_TTL_MS = 30 * 60 * 1000;

/** Batch limits (technical design §10.2). */
export const OUTBOUND_MAX_RECIPIENTS_PER_BATCH = 100;
export const OUTBOUND_MAX_BODY_TEXT_CHARS = 50_000;
export const OUTBOUND_MAX_BODY_HTML_CHARS = 50_000;
export const OUTBOUND_MAX_WORKER_PAYLOAD_BYTES = 5 * 1024 * 1024;

/** Worker SMTP submission concurrency (technical design §16.2). */
export const OUTBOUND_WORKER_SMTP_CONCURRENCY = 5;

/** Minimum confidence for a deterministic send_now decision. */
export const OUTBOUND_SEND_NOW_MIN_CONFIDENCE = 0.9;