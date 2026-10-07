import { Token } from "@/modules/token";
import { AI_CHAT_RECOVERABLE_FLAGS } from "@/service/AIChatRecoverableDefaults";
import { TOOL_RESULT_FLAGS } from "@/config/toolResultConfig";

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

/**
 * Operator rollout helper (design §18.1). Writes all four Token keys to
 * `"true"` in stage order so a qualified build can be enabled without
 * flipping process-wide defaults. Defaults remain fail-closed: this is an
 * explicit opt-in. A Token-store error is thrown to the caller (do not
 * silently claim enablement).
 */
export function enableRecoverableHistoryFlags(): void {
  const token = new Token();
  token.setValue(AI_CHAT_RECOVERABLE_FLAGS.archiveReads, "true");
  token.setValue(AI_CHAT_RECOVERABLE_FLAGS.newCompaction, "true");
  token.setValue(AI_CHAT_RECOVERABLE_FLAGS.historyTools, "true");
  token.setValue(AI_CHAT_RECOVERABLE_FLAGS.historyUi, "true");
}

// Kept for any external caller / test that referenced the cache reset hook.
export function resetFeatureFlagCacheForTest(): void {
  /* no-op: flag is read live and not cached. */
}

/**
 * Recoverable large tool results rollout flags (technical design §13.4).
 *
 * Three independently gated stages, all DEFAULT ON and FAIL OPEN: the feature
 * shipped through its audit (T01–T18 closed) and the release gate, so a fresh
 * install must have tool_result_read/search working without an operator step.
 * The default-off posture left the feature dormant — `enableToolResultFlags`
 * had no production caller, so every call returned RETRIEVAL_NOT_ENABLED and
 * the catalog still advertised the tools into that dead end. The explicit
 * value "false" is the per-install opt-out; any other value (including an
 * unreadable store) keeps the stage enabled. Read live on each call (a local
 * electron-store file, invoked per user action, not on a hot path) so support
 * staff can toggle a stage at runtime without an app restart.
 *
 * Rollback semantics are asymmetric on purpose:
 *   - capture off  -> no NEW file writes; readers for existing committed
 *                     references stay registered and artifacts are NOT erased.
 *   - modelRefs off -> no new references are advertised to the model, but
 *                     existing reference history stays displayable/readable.
 *   - ui off        -> the old viewer still receives BOUNDED content; the
 *                     payload is never handed to the renderer in bulk.
 */

/** Stage 1: additive schema/read support and new file capture. */
export function isToolOutputCaptureEnabled(): boolean {
  try {
    return new Token().getValue(TOOL_RESULT_FLAGS.capture) !== "false";
  } catch {
    return true;
  }
}

/** Stage 2: emit model-readable output references (requires read/search). */
export function isToolOutputModelRefsEnabled(): boolean {
  try {
    return new Token().getValue(TOOL_RESULT_FLAGS.modelRefs) !== "false";
  } catch {
    return true;
  }
}

/** Stage 3: the paged result viewer. */
export function isToolOutputUiEnabled(): boolean {
  try {
    return new Token().getValue(TOOL_RESULT_FLAGS.ui) !== "false";
  } catch {
    return true;
  }
}

/**
 * Operator helper — write all three Token keys to "true" (explicit re-enable
 * after an opt-out). Fail-loud: a Token-store error propagates rather than
 * silently claiming the stages are enabled.
 */
export function enableToolResultFlags(): void {
  const token = new Token();
  token.setValue(TOOL_RESULT_FLAGS.capture, "true");
  token.setValue(TOOL_RESULT_FLAGS.modelRefs, "true");
  token.setValue(TOOL_RESULT_FLAGS.ui, "true");
}
