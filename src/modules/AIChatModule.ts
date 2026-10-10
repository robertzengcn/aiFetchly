import { BaseModule } from "@/modules/baseModule";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { AIChatAttachmentModule } from "@/modules/AIChatAttachmentModule";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { RecoverableHistoryError } from "@/entityTypes/aiChatArchiveTypes";
import { clearToolResultContextCache } from "@/service/agentTools/toolResultContext";

export interface SaveMessageOptions {
  messageId: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: Date;
  model?: string;
  tokensUsed?: number;
  metadata?: unknown;
  messageType?: MessageType;
}

export class AIChatModule extends BaseModule {
  private chatMessageModel: AIChatMessageModel;
  private attachmentModule: AIChatAttachmentModule;

  constructor() {
    super();
    this.chatMessageModel = new AIChatMessageModel(this.dbpath);
    this.attachmentModule = new AIChatAttachmentModule();
  }

  /**
   * Save a chat message to database
   */
  async saveMessage(options: SaveMessageOptions): Promise<AIChatMessageEntity> {
    const existing = await this.chatMessageModel.getMessageByMessageId(
      options.messageId
    );
    const message = existing ?? new AIChatMessageEntity();
    message.messageId = options.messageId;
    message.conversationId = options.conversationId;
    message.role = options.role;
    message.content = options.content;
    message.timestamp = options.timestamp || new Date();
    message.model = options.model;
    message.tokensUsed = options.tokensUsed;
    message.metadata = options.metadata
      ? JSON.stringify(options.metadata)
      : undefined;
    message.messageType = options.messageType || MessageType.MESSAGE;

    const messageId = await this.chatMessageModel.saveMessage(message);
    const savedMessage = await this.chatMessageModel.getMessageById(messageId);

    if (!savedMessage) {
      throw new Error("Failed to retrieve saved message");
    }

    return savedMessage;
  }

  /**
   * Idempotent insert for scheduled-loop turns (technical-design §14.2). If a
   * row with the message id already exists (crash-retry / restart), validate
   * that it belongs to the same conversation and role and return it WITHOUT
   * mutation. A conversation/role mismatch fails loudly (CONVERSATION_MISMATCH)
   * so a stable-id collision across conversations cannot silently corrupt the
   * transcript. When no row exists, insert as {@link saveMessage} would.
   */
  async saveMessageIfAbsent(
    options: SaveMessageOptions
  ): Promise<AIChatMessageEntity> {
    const existing = await this.chatMessageModel.getMessageByMessageId(
      options.messageId
    );
    if (existing) {
      if (
        existing.conversationId !== options.conversationId ||
        existing.role !== options.role
      ) {
        throw new Error("CONVERSATION_MISMATCH");
      }
      return existing;
    }
    return this.saveMessage(options);
  }

  /**
   * Get messages for a conversation
   */
  async getConversationMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<AIChatMessageEntity[]> {
    return await this.chatMessageModel.getMessagesByConversation(
      conversationId,
      limit,
      offset
    );
  }

  /** Bounded existence check after (timestamp, rowId) — no full load. */
  async hasMessagesAfter(
    conversationId: string,
    afterTimestamp: Date,
    afterRowId = 0
  ): Promise<boolean> {
    await this.ensureConnection();
    return this.chatMessageModel.hasMessagesAfter(
      conversationId,
      afterTimestamp,
      afterRowId
    );
  }

  /** Bounded delta read after (timestamp, rowId), capped at `limit` rows. */
  async getMessagesAfter(
    conversationId: string,
    afterTimestamp: Date,
    afterRowId: number,
    limit: number
  ): Promise<AIChatMessageEntity[]> {
    await this.ensureConnection();
    return this.chatMessageModel.getMessagesAfter(
      conversationId,
      afterTimestamp,
      afterRowId,
      limit
    );
  }

  /** Scoped boundary-row lookup — never crosses conversations. */
  async findBoundaryInConversation(
    conversationId: string,
    messageId: string
  ): Promise<AIChatMessageEntity | null> {
    await this.ensureConnection();
    return this.chatMessageModel.findBoundaryInConversation(
      conversationId,
      messageId
    );
  }

  /** Bounded recent-message read (newest `limit`, chronological). */
  async getRecentMessages(
    conversationId: string,
    limit: number
  ): Promise<AIChatMessageEntity[]> {
    await this.ensureConnection();
    return this.chatMessageModel.getRecentMessages(conversationId, limit);
  }

  /**
   * Get message by message ID
   */
  async getMessageByMessageId(
    messageId: string
  ): Promise<AIChatMessageEntity | null> {
    return await this.chatMessageModel.getMessageByMessageId(messageId);
  }

  /**
   * Get message by conversation ID and message ID
   */
  async getMessageByConversationAndMessageId(
    conversationId: string,
    messageId: string
  ): Promise<AIChatMessageEntity | null> {
    await this.ensureConnection();
    return await this.chatMessageModel.getMessageByConversationAndMessageId(
      conversationId,
      messageId
    );
  }

  /**
   * Clear conversation history.
   *
   * The preserved-tool-output scope is invalidated BEFORE the messages are
   * deleted, mirroring `AIChatV2Module.clearConversation`: rotating the epoch
   * marks the rows `deleting` and revokes their grants, so an in-flight writer
   * cannot publish and a cleared conversation cannot be retrieved. A failed
   * fence aborts the clear — a successful delete with a stale epoch would
   * silently reopen the resurrection window (every captured artifact would
   * stay readable).
   */
  async clearConversation(conversationId: string): Promise<number> {
    try {
      await new ToolResultModule().invalidateScope("default", conversationId);
    } catch (err) {
      console.error(
        "[ai-chat] clearConversation: tool output scope invalidate failed, aborting clear:",
        err
      );
      throw new RecoverableHistoryError(
        "COMPACTION_CONTEXT_REJECTED",
        `clear aborted: tool output scope invalidate failed for ${conversationId}`
      );
    }
    // Delete attachment bytes first to keep storage consistent.
    await this.attachmentModule.deleteByConversation(conversationId);
    const deleted = await this.chatMessageModel.deleteConversation(conversationId);
    // Drop the cached tool-result wiring for this conversation so the
    // long-lived main process does not retain a CachedWiring (with a
    // ToolResultModule + DB-connection refs) for a cleared conversation.
    clearToolResultContextCache(conversationId);
    return deleted;
  }

  /**
   * Clear all chat history.
   *
   * Each conversation's preserved-output scope is invalidated before its
   * messages are deleted, using the same fence as `clearConversation`. A
   * per-conversation fence failure is logged and that conversation is skipped
   * (its messages are NOT deleted) rather than aborting the whole bulk clear —
   * matching `AIChatV2Module.clearAllV2History`'s per-conversation isolation
   * while still respecting the invariant that a failed fence must not be
   * followed by a successful delete.
   */
  async clearAllHistory(): Promise<number> {
    const conversationIds = await this.chatMessageModel.getAllConversations();
    let total = 0;
    for (const conversationId of conversationIds) {
      try {
        await new ToolResultModule().invalidateScope("default", conversationId);
      } catch (err) {
        console.error(
          `[ai-chat] clearAllHistory: tool output scope invalidate failed for ${conversationId}, skipping:`,
          err
        );
        // A failed fence must not be followed by a delete: skip this
        // conversation so its artifacts stay consistent with its messages.
        // The epoch was not rotated, so reads remain valid for both.
        continue;
      }
      await this.attachmentModule.deleteByConversation(conversationId);
      total += await this.chatMessageModel.deleteConversation(conversationId);
      // Drop the cached tool-result wiring for this cleared conversation so
      // the long-lived main process does not retain a CachedWiring (with a
      // ToolResultModule + DB-connection refs) for a cleared conversation.
      clearToolResultContextCache(conversationId);
    }
    return total;
  }

  /**
   * Get conversation statistics
   */
  async getStats(conversationId?: string): Promise<{
    totalMessages: number;
    totalConversations: number;
    messagesByRole: Record<string, number>;
  }> {
    return await this.chatMessageModel.getConversationStats(conversationId);
  }

  /**
   * Get all conversation IDs
   */
  async getAllConversations(): Promise<string[]> {
    return await this.chatMessageModel.getAllConversations();
  }

  /**
   * Get latest messages
   */
  async getLatestMessages(limit = 10): Promise<AIChatMessageEntity[]> {
    return await this.chatMessageModel.getLatestMessages(limit);
  }

  /**
   * Get all conversations with metadata (last message, timestamp, message count)
   */
  async getConversationsWithMetadata(): Promise<
    Array<{
      conversationId: string;
      lastMessage: string;
      lastMessageTimestamp: Date;
      messageCount: number;
      createdAt: Date;
    }>
  > {
    return await this.chatMessageModel.getConversationsWithMetadata();
  }

  /**
   * Search conversations by message content (LIKE on content column).
   */
  async searchConversationsWithMetadata(query: string): Promise<
    Array<{
      conversationId: string;
      lastMessage: string;
      lastMessageTimestamp: Date;
      messageCount: number;
      createdAt: Date;
    }>
  > {
    return await this.chatMessageModel.searchConversationsWithMetadata(query);
  }
}
