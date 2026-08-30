import { inject, type InjectionKey } from "vue";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { createWorkspaceConversationId } from "@/views/api/aiChatWorkspace";

/**
 * Conversation-selection contract between the persistent authenticated
 * layout and the chat center surface (chat-first shell design §8.4).
 *
 * The LAYOUT owns selection events because the sidebar persists outside the
 * chat center; the surface consumes this API via provide/inject so a sidebar
 * interaction and the surface's own empty-state affordances share one path.
 */
export interface ChatWorkspaceSelectionApi {
  /** Select a conversation, routing to the chat center first if needed. */
  openConversation(conversationId: string): Promise<void>;
  /** Create + select a fresh conversation, routing to the chat center. */
  createChat(): Promise<string>;
}

export const CHAT_WORKSPACE_SELECTION_KEY: InjectionKey<ChatWorkspaceSelectionApi> =
  Symbol("chat-workspace-selection");

export function useChatWorkspaceSelection(): ChatWorkspaceSelectionApi | null {
  return inject(CHAT_WORKSPACE_SELECTION_KEY, null);
}

/**
 * Create a local conversation row, register it in the sidebar projection,
 * and run the selection handshake. Shared by the layout coordinator and the
 * surface fallback so behavior can never drift.
 */
export async function createAndSelectWorkspaceChat(): Promise<string> {
  const workspaceStore = useChatWorkspaceStore();
  const selectedStore = useSelectedConversationStore();
  const id = createWorkspaceConversationId();
  workspaceStore.upsertLocalConversation({
    conversationId: id,
    workspaceKey: null,
    title: "",
    preview: "",
    lastActivityAt: new Date().toISOString(),
    unread: false,
    attention: "none",
    runtimeStatus: "idle",
    activeRunId: null,
  });
  await selectedStore.loadSelection(id);
  return id;
}
