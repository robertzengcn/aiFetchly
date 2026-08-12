import { Token } from "@/modules/token";

/**
 * Feature flags evaluated in the Electron MAIN process only (design §15).
 * The renderer may display availability but cannot force-enable an import path.
 *
 * Browser-profile import is enabled by default. The Token store may opt out
 * by containing the explicit value "false"; any other value (including an
 * unreadable or missing store) keeps the feature enabled.
 *
 * Read on each call (no process-lifetime cache): Token is a local electron-store
 * file read and this is invoked per user action, not on a hot path — so a runtime
 * toggle by support staff takes effect without an app restart.
 */
export const BROWSER_PROFILE_IMPORT_FLAG = "browser_profile_import_enabled";

export function isBrowserProfileImportEnabled(): boolean {
  try {
    return new Token().getValue(BROWSER_PROFILE_IMPORT_FLAG) !== "false";
  } catch {
    // Token store unreadable (DB not initialized, encrypted store corrupt):
    // enable by default rather than blocking the feature on a storage hiccup.
    return true;
  }
}

/**
 * Thread-aware reply reliability (Milestone 1: send safety). When enabled, the
 * send path requires an approved immutable revision + one-time approval token
 * and routes through the idempotent delivery service (no mailbox override,
 * at-most-once SMTP, ambiguous-delivery handling). When disabled, the legacy
 * send path is preserved verbatim.
 *
 * DEFAULTS OFF: enabling changes the send contract (the UI must approve-then-
 * send), so it ships behind an explicit opt-in per the rollout plan (technical
 * design §23 step 3 — enable approval/revision and idempotent delivery
 * together, never split across states that permit legacy sending).
 */
export const EMAIL_REPLY_APPROVAL_V2_FLAG = "email_reply_approval_v2";

export function isEmailReplyApprovalV2Enabled(): boolean {
  try {
    return new Token().getValue(EMAIL_REPLY_APPROVAL_V2_FLAG) === "true";
  } catch {
    // Token store unreadable: keep the legacy path (fail closed to the new
    // contract rather than silently changing send behavior on a storage hiccup).
    return false;
  }
}

// Kept for any external caller / test that referenced the cache reset hook.
export function resetFeatureFlagCacheForTest(): void {
  /* no-op: flag is read live and not cached. */
}
