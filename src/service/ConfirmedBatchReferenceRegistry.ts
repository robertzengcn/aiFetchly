import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";

/**
 * Trusted main-process staging area for user-confirmed generated-image batch
 * reference sets.
 *
 * When the user confirms a >3-image batch in the renderer dialog, the exact
 * confirmed reference list travels over IPC in one request and is normalized
 * by `ai-chat-v2-ipc.ts`, then staged here under the conversation id. The
 * batch tool later consumes (reads + clears) the staged set and uses it as
 * the authoritative input list, so the model can never replace, add to, or
 * omit references after the user has confirmed them.
 *
 * In-memory only: a staged set is single-use and scoped to one conversation.
 * It is cleared when consumed, when the turn is stopped, or when the chat
 * runtime is reset for a database/account switch.
 */
export class ConfirmedBatchReferenceRegistry {
  private readonly stagedByConversation = new Map<
    string,
    readonly ChatV2GeneratedImageReference[]
  >();

  /** Store the confirmed reference set for one conversation (replaces any prior). */
  stage(
    conversationId: string,
    references: readonly ChatV2GeneratedImageReference[]
  ): void {
    this.stagedByConversation.set(conversationId, Object.freeze([...references]));
  }

  /**
   * Atomically read and clear the staged set for one conversation.
   * Returns `null` when nothing is staged; otherwise returns the staged list
   * exactly as confirmed (order preserved) so it can be used verbatim.
   */
  consume(conversationId: string): readonly ChatV2GeneratedImageReference[] | null {
    const staged = this.stagedByConversation.get(conversationId);
    if (staged === undefined) return null;
    this.stagedByConversation.delete(conversationId);
    return staged;
  }

  /** Drop the staged set for one conversation without consuming it. */
  clear(conversationId: string): void {
    this.stagedByConversation.delete(conversationId);
  }

  /** Drop every staged set (global stop / database-account switch). */
  clearAll(): void {
    this.stagedByConversation.clear();
  }
}

let singleton: ConfirmedBatchReferenceRegistry | null = null;

/** Process-wide singleton so the IPC layer and the batch tool share state. */
export function getConfirmedBatchReferenceRegistry(): ConfirmedBatchReferenceRegistry {
  if (singleton === null) {
    singleton = new ConfirmedBatchReferenceRegistry();
  }
  return singleton;
}
