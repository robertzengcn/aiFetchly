import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import type {
  ResolveOutboundEmailIntentInput,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Pure helper that finds the immediately preceding assistant message for a
 * given user turn, so the outbound-email intent resolver can evaluate the
 * contextual-affirmation path (technical design §9.1/§9.4).
 *
 * SECURITY: the resolver only ever consumes `userAuthoredText` and (for the
 * affirmation path) the ONE immediately preceding assistant message. This
 * helper never exposes tool results, retrieved documents, attachments, system
 * prompts, or general assistant statements — it returns only the single
 * assistant message directly before the current user message, or null when
 * none exists. The returned text is fed to the resolver's
 * `looksLikeSendConfirmationQuestion` check; a generic prior statement never
 * turns a bare "yes" into a send authorization (§9.4).
 *
 * The helper is pure over the already-loaded message list; it performs no DB
 * access, keeping the resolver's "no side effects" property intact. The engine
 * is responsible for loading the conversation's messages in chronological order
 * (the AIChatMessageModel orders by timestamp ASC, id ASC) and passing the
 * current user message id.
 */
export interface PrecedingAssistantContext {
  readonly previousAssistantMessageId: string | null;
  readonly previousAssistantText: string | null;
}

/**
 * Walk `messages` (ordered chronologically ascending) up to and including the
 * current user message, then return the nearest assistant message that came
 * BEFORE it. Returns all-null when there is no prior assistant turn or the
 * current message id is not present (defensive — the resolver treats null as
 * "no confirmation question active" and falls back to draft_only, the safe
 * default).
 */
export function findPrecedingAssistantContext(
  messages: ReadonlyArray<AIChatMessageEntity>,
  currentUserMessageId: string
): PrecedingAssistantContext {
  // Find the index of the current user message. Only messages BEFORE that
  // index are candidates — a future assistant turn must never leak in.
  const currentIndex = messages.findIndex(
    (m) => m.messageId === currentUserMessageId
  );
  if (currentIndex < 0) {
    return {
      previousAssistantMessageId: null,
      previousAssistantText: null,
    };
  }

  // Walk backwards from the message just before the current user message and
  // return the first assistant message encountered. Intervening user/system
  // messages are skipped.
  for (let i = currentIndex - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") {
      return {
        previousAssistantMessageId: m.messageId,
        previousAssistantText: m.content,
      };
    }
  }

  return {
    previousAssistantMessageId: null,
    previousAssistantText: null,
  };
}

/**
 * Build the resolver input from trusted current-turn state and the loaded
 * conversation messages. This is the single call site the engine uses so the
 * previous-assistant context is always threaded correctly (RC3).
 */
export function buildResolverInput(
  base: Pick<
    ResolveOutboundEmailIntentInput,
    "conversationId" | "sourceUserMessageId" | "userAuthoredText"
  >,
  messages: ReadonlyArray<AIChatMessageEntity>
): ResolveOutboundEmailIntentInput {
  const prior = findPrecedingAssistantContext(
    messages,
    base.sourceUserMessageId
  );
  return {
    conversationId: base.conversationId,
    sourceUserMessageId: base.sourceUserMessageId,
    userAuthoredText: base.userAuthoredText,
    previousAssistantMessageId: prior.previousAssistantMessageId,
    previousAssistantText: prior.previousAssistantText,
  };
}
