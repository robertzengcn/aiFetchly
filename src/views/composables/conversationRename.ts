import { nextTick, ref } from "vue";
import { renameConversation } from "@/views/api/aiChatWorkspace";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";

/**
 * Shared manual-rename action (chat-titles design §10.4). Used by the
 * workspace layout (sidebar rows) and the center surface (header overflow)
 * so rename logic can never drift between entry points.
 *
 * The target conversation id is captured when the dialog OPENS — never read
 * from a reactive selected-id after awaiting user input. Save failures keep
 * the dialog open with the draft preserved (FR-06/AC-08); a missing
 * conversation is surfaced as "unavailable" (AC-13).
 */
export function useConversationRename() {
  const chatWorkspace = useChatWorkspaceStore();
  const renameTargetId = ref<string | null>(null);
  const renameInitialTitle = ref("");
  const renameSaving = ref(false);
  /** null | "unavailable" | "save_failed" */
  const renameError = ref<string | null>(null);
  /** Element to return focus to when the dialog closes (a11y §7.5). */
  let activatorEl: HTMLElement | null = null;
  /**
   * r3 G09: monotonic dialog generation — a save started for an EARLIER
   * dialog open (or a previous authenticated scope reusing the same
   * conversation id) can never apply its response to the current one.
   */
  let renameGeneration = 0;

  function openRename(
    conversationId: string,
    currentTitle: string,
    sourceEl?: HTMLElement | null
  ): void {
    renameGeneration += 1; // invalidate any in-flight save from before
    renameTargetId.value = conversationId;
    renameInitialTitle.value = currentTitle;
    renameError.value = null;
    activatorEl = sourceEl ?? null;
  }

  function isRenameOpen(conversationId: string): boolean {
    return renameTargetId.value === conversationId;
  }

  /** Persist; true closes the dialog, false keeps it open with the error. */
  async function commitRename(title: string): Promise<boolean> {
    const conversationId = renameTargetId.value;
    if (!conversationId || renameSaving.value) return false;
    const generation = renameGeneration;
    renameSaving.value = true;
    renameError.value = null;
    try {
      const response = await renameConversation({
        conversationId,
        title,
      });
      // r3 G09: a newer dialog open (or scope reset) superseded this save —
      // its response owns nothing.
      if (generation !== renameGeneration) return false;
      // Authoritative post-commit response wins; the title-only event is an
      // idempotent second source (revision-guarded in the store).
      chatWorkspace.applyTitleUpdate({
        conversationId,
        title: response.title,
        titleRevision: response.titleRevision,
        titleSource: "user",
      });
      closeDialog();
      return true;
    } catch (err) {
      if (generation !== renameGeneration) return false; // superseded
      const message = err instanceof Error ? err.message : String(err);
      renameError.value = message.includes("conversation_not_found")
        ? "unavailable"
        : "save_failed";
      return false;
    } finally {
      renameSaving.value = false;
    }
  }

  function cancelRename(): void {
    closeDialog();
  }

  function closeDialog(): void {
    renameTargetId.value = null;
    renameError.value = null;
    // F14/r3 G10: restore focus AFTER actual dialog deactivation — Vuetify's
    // focus trap is released on leave, so a synchronous call is overridden.
    // Two ticks cover the trap teardown + DOM restore.
    const target = activatorEl;
    activatorEl = null;
    void nextTick(() => {
      void nextTick(() => {
        if (
          target &&
          target.isConnected &&
          !target.hasAttribute("disabled")
        ) {
          target.focus?.();
        }
      });
    });
  }

  return {
    renameTargetId,
    renameInitialTitle,
    renameSaving,
    renameError,
    openRename,
    isRenameOpen,
    commitRename,
    cancelRename,
  };
}
