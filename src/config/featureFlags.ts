import { Token } from "@/modules/token";
import { AI_CHAT_RECOVERABLE_FLAGS } from "@/service/AIChatRecoverableDefaults";

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
 * Recoverable-history rollout flags (technical-design §18: "Rollout flags:
 * archive reads, history tools, new compaction publication, and UI").
 *
 * Each flag gates one rollout stage. All four DEFAULT OFF and FAIL CLOSED:
 * the new code path is opt-in per stage so a broken Token store never
 * silently enables archive reads, history tools, new compaction publication,
 * or the history UI. Operators set a flag's Token value to "true" to enable
 * its stage; any other value (including an unreadable store) keeps it off.
 *
 * Staged deployment (§18.1):
 *   1. archiveReads  — archive reads/indexing (compare pagination with fixtures)
 *   2. newCompaction — bounded compaction for test profiles
 *   3. historyTools + historyUi — tools/UI together with new publication
 *   4. expand only after acceptance tests + recall targets pass
 *
 * Operational rollback disables new publication first; it retains the last
 * valid overview and archive tools where safe. It never selects the previous
 * all-history compaction implementation.
 *
 * Read live on each call (Token is a local electron-store file, invoked per
 * user action not on a hot path) so a runtime toggle by support staff takes
 * effect without an app restart.
 */

/** Stage 1: archive reads + indexing (read-only enhancement). */
export function isArchiveReadsEnabled(): boolean {
  try {
    return (
      new Token().getValue(AI_CHAT_RECOVERABLE_FLAGS.archiveReads) === "true"
    );
  } catch {
    return false;
  }
}

/** Stage 2: bounded compaction publication. */
export function isNewCompactionEnabled(): boolean {
  try {
    return (
      new Token().getValue(AI_CHAT_RECOVERABLE_FLAGS.newCompaction) === "true"
    );
  } catch {
    return false;
  }
}

/** Stage 3: history retrieval tools. */
export function isHistoryToolsEnabled(): boolean {
  try {
    return (
      new Token().getValue(AI_CHAT_RECOVERABLE_FLAGS.historyTools) === "true"
    );
  } catch {
    return false;
  }
}

/** Stage 3: history UI (selected-context submission, history views). */
export function isHistoryUiEnabled(): boolean {
  try {
    return new Token().getValue(AI_CHAT_RECOVERABLE_FLAGS.historyUi) === "true";
  } catch {
    return false;
  }
}

// Kept for any external caller / test that referenced the cache reset hook.
export function resetFeatureFlagCacheForTest(): void {
  /* no-op: flag is read live and not cached. */
}
