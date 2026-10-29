import { Token } from "@/modules/token";

/**
 * Automatic chat-titles feature settings (chat-titles PRD FR-08).
 *
 * The master switch is Token-backed so the main process reads it without an
 * IPC round trip. Default ON; empty/absent falls back to the default
 * (mirrors AIChatWorkspaceRollout.flagOn).
 */
export const USER_AUTO_CHAT_TITLES_ENABLED = "user_auto_chat_titles_enabled";

function flagOn(key: string, defaultOn: boolean): boolean {
  let raw: string | null = null;
  try {
    raw = new Token().getValue(key);
  } catch {
    raw = null;
  }
  if (raw === null || raw === undefined || raw === "") return defaultOn;
  return raw !== "false" && raw !== "0";
}

/** True when automatic title generation may dispatch (default on). */
export function isAutoChatTitlesEnabled(): boolean {
  return flagOn(USER_AUTO_CHAT_TITLES_ENABLED, true);
}

/** Persist the toggle. Disabling cancels future dispatches but keeps titles. */
export function setAutoChatTitlesEnabled(value: boolean): void {
  new Token().setValue(USER_AUTO_CHAT_TITLES_ENABLED, value ? "true" : "false");
}
