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

/**
 * Managed-browser APPLICATION RELEASE FLAG (PRD FR-SETTING-002). Separate from
 * the user preference `managed-browser-enabled` (system_setting): this flag is
 * the emergency rollout control. Effective enablement requires BOTH; neither
 * can be overridden by renderer or LLM arguments. Default ON; the Token store
 * may suspend new sessions with the explicit value "false" without rewriting
 * the stored user preference.
 */
export const MANAGED_BROWSER_ENABLED_FLAG = "managed_browser_release_enabled";

export function isManagedBrowserReleaseFlagEnabled(): boolean {
  try {
    return new Token().getValue(MANAGED_BROWSER_ENABLED_FLAG) !== "false";
  } catch {
    // Unreadable store: keep the release flag enabled; the user preference
    // and remaining gates still apply.
    return true;
  }
}

// Kept for any external caller / test that referenced the cache reset hook.
export function resetFeatureFlagCacheForTest(): void {
  /* no-op: flag is read live and not cached. */
}
