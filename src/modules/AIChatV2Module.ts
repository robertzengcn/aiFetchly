import { BaseModule } from "@/modules/baseModule";
import { AIChatModule } from "@/modules/AIChatModule";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2ConversationSummary,
  ChatV2MessageMetadata,
} from "@/entityTypes/aiChatV2Types";

const V2_CONVERSATION_PREFIX = "v2-";
const V2_DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

function uuid(): string {
  // Crypto.randomUUID is available in Electron (Node 16+ / Chromium).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class AIChatV2Module extends BaseModule {
  private chatModule: AIChatModule;

  constructor() {
    super();
    this.chatModule = new AIChatModule();
  }

  /** Create (or reuse) a v2 conversation id. */
  createConversationIfNeeded(existingId?: string): string {
    if (existingId && existingId.startsWith(V2_CONVERSATION_PREFIX)) {
      return existingId;
    }
    return `${V2_CONVERSATION_PREFIX}${uuid()}`;
  }

  async saveUserMessage(params: {
    conversationId: string;
    content: string;
    messageId?: string;
    timestamp?: Date;
  }): Promise<AIChatMessageEntity> {
    return this.chatModule.saveMessage({
      messageId: params.messageId ?? `user-${uuid()}`,
      conversationId: params.conversationId,
      role: "user",
      content: params.content,
      timestamp: params.timestamp,
      metadata: { source: "chat-v2" } as ChatV2MessageMetadata,
      messageType: MessageType.MESSAGE,
    });
  }

  async saveAssistantMessage(params: {
    conversationId: string;
    content: string;
    messageId?: string;
    model?: string;
    tokensUsed?: number;
    metadata?: ChatV2MessageMetadata;
    timestamp?: Date;
  }): Promise<AIChatMessageEntity> {
    const meta: ChatV2MessageMetadata = {
      source: "chat-v2",
      ...(params.metadata ?? {}),
    };
    return this.chatModule.saveMessage({
      messageId: params.messageId ?? `assistant-${uuid()}`,
      conversationId: params.conversationId,
      role: "assistant",
      content: params.content,
      model: params.model,
      tokensUsed: params.tokensUsed,
      timestamp: params.timestamp,
      metadata: meta,
      messageType: MessageType.MESSAGE,
    });
  }

  async getConversationMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<AIChatMessageEntity[]> {
    return this.chatModule.getConversationMessages(conversationId, limit, offset);
  }

  async clearConversation(conversationId: string): Promise<number> {
    return this.chatModule.clearConversation(conversationId);
  }

  async clearAllV2History(): Promise<number> {
    // Scope clear to v2-tagged rows by deleting each v2 conversation.
    const summaries = await this.getConversations();
    let total = 0;
    for (const s of summaries) {
      total += await this.chatModule.clearConversation(s.conversationId);
    }
    return total;
  }

  /** List v2 conversations only (filtered by prefix + chat-v2 metadata). */
  async getConversations(): Promise<ChatV2ConversationSummary[]> {
    const all = await this.chatModule.getConversationsWithMetadata();
    const summaries: ChatV2ConversationSummary[] = [];
    for (const conv of all) {
      if (!conv.conversationId.startsWith(V2_CONVERSATION_PREFIX)) {
        continue;
      }
      // Confirm at least one row carries v2 source metadata.
      const rows = await this.getConversationMessages(conv.conversationId, 1);
      const first = rows[0];
      let isV2 = false;
      if (first?.metadata) {
        try {
          const parsed = JSON.parse(first.metadata);
          isV2 = parsed?.source === "chat-v2";
        } catch {
          isV2 = false;
        }
      }
      if (!isV2) {
        continue;
      }
      summaries.push({
        conversationId: conv.conversationId,
        title: conv.lastMessage.slice(0, 60) || "New conversation",
        lastMessage: conv.lastMessage,
        lastMessageTimestamp: conv.lastMessageTimestamp.toISOString(),
        messageCount: conv.messageCount,
        createdAt: conv.createdAt.toISOString(),
      });
    }
    summaries.sort((a, b) =>
      b.lastMessageTimestamp.localeCompare(a.lastMessageTimestamp)
    );
    return summaries;
  }

  /** Derive the default system prompt for new conversations. */
  getDefaultSystemPrompt(): string {
    return V2_DEFAULT_SYSTEM_PROMPT;
  }
}
