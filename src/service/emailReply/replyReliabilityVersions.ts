/**
 * Version identifiers recorded with every reliability decision so audits and
 * send-time re-checks can tell which policy/validator produced them (FR-024,
 * technical design §10.3, §12.3). Bump these when the deterministic rules,
 * forbidden-phrase lists, or submission classification change.
 */
export const REPLY_POLICY_VERSION = "reply-policy-v2-1";
export const REPLY_VALIDATOR_VERSION = "reply-validator-v2-1";

/** Recovery threshold: an in-flight attempt older than this is ambiguous. */
export const REPLY_SEND_RECOVERY_THRESHOLD_MS = 5 * 60 * 1000;
