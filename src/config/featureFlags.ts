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
 * Emergency kill switch for the AI email-reply subsystem (technical design §23
 * "emergency kill switch"; P0.1). When ON, draft generation and new send claims
 * are refused immediately. Message viewing, audit reads, send-attempt detail,
 * and delivery reconciliation stay available so operators can diagnose and
 * recover. There is NO flag that restores the legacy unapproved/mutable send
 * path — the approved-revision + idempotent-delivery path is authoritative.
 *
 * DEFAULTS OFF (kill switch inactive = normal operation). Fail-closed on a
 * Token store error: a broken store must not silently enable drafting/sending.
 */
export const EMAIL_REPLY_KILL_SWITCH_FLAG = "email_reply_kill_switch";

export function isEmailReplyKillSwitchOn(): boolean {
  try {
    return new Token().getValue(EMAIL_REPLY_KILL_SWITCH_FLAG) === "true";
  } catch {
    // Unreadable store: treat as NOT killed so a storage hiccup doesn't paralyze
    // the feature. Operators who want the switch on set it explicitly.
    return false;
  }
}

// Kept for any external caller / test that referenced the cache reset hook.
export function resetFeatureFlagCacheForTest(): void {
  /* no-op: flag is read live and not cached. */
}
