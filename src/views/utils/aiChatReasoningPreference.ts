export const AI_CHAT_REASONING_VISIBLE_STORAGE_KEY = "aiChatV2.showReasoning";
export const AI_CHAT_REASONING_VISIBILITY_CHANGED_EVENT =
  "aifetchly:ai-chat-reasoning-visibility-changed";

export interface AiChatReasoningVisibilityChangedDetail {
  visible: boolean;
}

export function readAiChatReasoningVisible(): boolean {
  try {
    const stored = window.localStorage.getItem(
      AI_CHAT_REASONING_VISIBLE_STORAGE_KEY
    );
    return stored !== "false";
  } catch {
    return true;
  }
}

export function writeAiChatReasoningVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(
      AI_CHAT_REASONING_VISIBLE_STORAGE_KEY,
      visible ? "true" : "false"
    );
  } catch {
    /* localStorage unavailable - keep the current in-memory UI state only. */
  }

  window.dispatchEvent(
    new CustomEvent<AiChatReasoningVisibilityChangedDetail>(
      AI_CHAT_REASONING_VISIBILITY_CHANGED_EVENT,
      { detail: { visible } }
    )
  );
}
