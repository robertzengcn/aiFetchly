import { EmailConversationModule } from "@/modules/EmailConversationModule";
import {
  buildBoundedThreadContext,
  DEFAULT_CONTEXT_BUDGET,
  type BoundedThreadContext,
  type ContextBudget,
  type EmailConversationTurn,
} from "@/service/emailReply/EmailThreadContextBuilder";

/**
 * Builds the model-facing conversation context for a message (technical design
 * §9, FR-002/003/004). Loads the mailbox-scoped ordered turns through the
 * conversation module and applies the pure bounded-context builder. Deterministic
 * and fast (NFR-002: no LLM summarization on this path).
 */
export class EmailConversationContextService {
  private readonly conversationModule = new EmailConversationModule();

  async buildContextForMessage(input: {
    emailServiceId: number;
    conversationId: number;
    currentMessageId: number;
    budget?: ContextBudget;
  }): Promise<BoundedThreadContext> {
    const turns: EmailConversationTurn[] =
      await this.conversationModule.listOrderedTurns(
        input.emailServiceId,
        input.conversationId
      );
    return buildBoundedThreadContext(turns, {
      budget: input.budget ?? DEFAULT_CONTEXT_BUDGET,
      currentTurnId: input.currentMessageId,
    });
  }
}
