/**
 * AiFeatureGate — single source of truth for the USER_AI_ENABLED check.
 *
 * Project rule (CLAUDE.md): AI-feature IPC handlers must check AI enable
 * first, before parsing request data or calling AI APIs. This helper makes
 * that check reusable from both `registerAiValidatedHandler` (handle-based)
 * and the streaming `ipcMain.on` upload path (SAVE_TEMP_FILE), which cannot
 * use the wrapper directly because it pushes progress over `event.sender`.
 *
 * Fail-closed: if the Token store is unreachable (DB not initialized,
 * encrypted store corrupted), the helper returns false rather than letting a
 * broken gate silently enable paid features.
 */
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";

export function isAiEnabled(): boolean {
  try {
    return new Token().getValue(USER_AI_ENABLED) === "true";
  } catch {
    return false;
  }
}
