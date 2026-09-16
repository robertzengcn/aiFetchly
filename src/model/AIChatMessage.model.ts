import { BaseDb } from "@/model/Basedb";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { Repository } from "typeorm";

export class AIChatMessageModel extends BaseDb {
  public repository: Repository<AIChatMessageEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AIChatMessageEntity);
  }

  /**
   * Save a chat message to database
   */
  async saveMessage(message: AIChatMessageEntity): Promise<number> {
    const result = await this.repository.save(message);
    return result.id;
  }

  /**
   * Get messages for a conversation
   */
  async getMessagesByConversation(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<AIChatMessageEntity[]> {
    const query = this.repository
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", { conversationId })
      .orderBy("message.timestamp", "ASC")
      .addOrderBy("message.id", "ASC");

    if (limit) {
      query.take(limit);
    }
    if (offset) {
      query.skip(offset);
    }

    return await query.getMany();
  }

  /**
   * Bounded recent-message read (newest `limit` rows, returned chronological).
   * Never materializes the full conversation (FR-01/FR-07). Enforces a
   * decoded-text byte allowance newest-first so oversized payloads cannot blow
   * the read boundary; always keeps at least the newest row so pagination and
   * continuity can advance (design §6 — row-count limits alone are
   * insufficient).
   */
  async getRecentMessages(
    conversationId: string,
    limit: number
  ): Promise<AIChatMessageEntity[]> {
    const capped = Math.max(1, Math.min(limit, 256));
    const rows = await this.repository.find({
      where: { conversationId },
      order: { timestamp: "DESC", id: "DESC" },
      take: capped,
    });
    const byteBudget = 64 * 1024;
    let bytes = 0;
    const keptNewestFirst: AIChatMessageEntity[] = [];
    for (const row of rows) {
      const rowBytes = Buffer.byteLength(row.content ?? "", "utf8");
      if (keptNewestFirst.length > 0 && bytes + rowBytes > byteBudget) break;
      keptNewestFirst.push(row);
      bytes += rowBytes;
    }
    return keptNewestFirst.reverse();
  }

  /**
   * Scoped lookup of a boundary row within a conversation. Returns the single
   * matching row, or null when there is none. Conversation-scoped so a
   * caller-supplied messageId can never resolve into another conversation.
   * A duplicated messageId is ambiguous — returns null rather than guessing
   * latest, so callers defer to a bounded coordinator rebuild instead of
   * permanently skipping the messages between duplicates.
   */
  async findBoundaryInConversation(
    conversationId: string,
    messageId: string
  ): Promise<AIChatMessageEntity | null> {
    const rows = await this.repository.find({
      where: { conversationId, messageId },
      order: { timestamp: "DESC", id: "DESC" },
      take: 2,
    });
    if (rows.length !== 1) return null;
    return rows[0];
  }

  /**
   * Get message by ID
   */
  async getMessageById(id: number): Promise<AIChatMessageEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Bounded existence check: true when any message row exists strictly after
   * (afterTimestamp, afterRowId) in (timestamp, id) order. Single COUNT query;
   * never materializes the conversation (FR-01/FR-07 bounded reads).
   */
  async hasMessagesAfter(
    conversationId: string,
    afterTimestamp: Date,
    afterRowId = 0
  ): Promise<boolean> {
    const count = await this.repository
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", { conversationId })
      .andWhere(
        "(message.timestamp > :ts OR (message.timestamp = :ts AND message.id > :id))",
        { ts: afterTimestamp, id: afterRowId }
      )
      .take(1)
      .getCount();
    return count > 0;
  }

  /**
   * Bounded delta read strictly after (afterTimestamp, afterRowId) in
   * (timestamp, id) ASC order, capped at `limit` rows. Callers enforce
   * decoded-text budgets; row-count limits alone do not bound oversized
   * payloads (design §6).
   */
  async getMessagesAfter(
    conversationId: string,
    afterTimestamp: Date,
    afterRowId: number,
    limit: number
  ): Promise<AIChatMessageEntity[]> {
    const capped = Math.max(1, Math.min(limit, 64));
    return await this.repository
      .createQueryBuilder("message")
      .where("message.conversationId = :conversationId", { conversationId })
      .andWhere(
        "(message.timestamp > :ts OR (message.timestamp = :ts AND message.id > :id))",
        { ts: afterTimestamp, id: afterRowId }
      )
      .orderBy("message.timestamp", "ASC")
      .addOrderBy("message.id", "ASC")
      .take(capped)
      .getMany();
  }

  /**
   * Get message by message ID
   */
  async getMessageByMessageId(
    messageId: string
  ): Promise<AIChatMessageEntity | null> {
    return await this.repository.findOne({ where: { messageId } });
  }

  /**
   * Delete all messages for a conversation
   */
  async deleteConversation(conversationId: string): Promise<number> {
    const result = await this.repository.delete({ conversationId });
    return result.affected || 0;
  }

  /**
   * Delete all chat messages
   */
  async deleteAllMessages(): Promise<number> {
    await this.repository.clear();
    return 1;
  }

  /**
   * Get conversation statistics
   */
  async getConversationStats(conversationId?: string): Promise<{
    totalMessages: number;
    totalConversations: number;
    messagesByRole: Record<string, number>;
  }> {
    let query = this.repository.createQueryBuilder("message");

    if (conversationId) {
      query = query.where("message.conversationId = :conversationId", {
        conversationId,
      });
    }

    const messages = await query.getMany();
    const totalMessages = messages.length;

    // Count unique conversations
    const conversations = new Set(messages.map((m) => m.conversationId));
    const totalConversations = conversations.size;

    // Count messages by role
    const messagesByRole: Record<string, number> = {};
    messages.forEach((m) => {
      messagesByRole[m.role] = (messagesByRole[m.role] || 0) + 1;
    });

    return {
      totalMessages,
      totalConversations,
      messagesByRole,
    };
  }

  /**
   * Get all conversation IDs
   */
  async getAllConversations(): Promise<string[]> {
    const result = await this.repository
      .createQueryBuilder("message")
      .select("DISTINCT message.conversationId", "conversationId")
      .getRawMany();

    return result.map((r) => r.conversationId);
  }

  /**
   * Get latest messages across all conversations
   */
  async getLatestMessages(limit = 10): Promise<AIChatMessageEntity[]> {
    return await this.repository
      .createQueryBuilder("message")
      .orderBy("message.timestamp", "DESC")
      .take(limit)
      .getMany();
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
    // Get all unique conversation IDs
    const conversations = await this.repository
      .createQueryBuilder("message")
      .select("DISTINCT message.conversationId", "conversationId")
      .getRawMany();

    // For each conversation, get the last message and message count
    const conversationsWithMetadata = await Promise.all(
      conversations.map(async (conv) => {
        const conversationId = conv.conversationId;

        // Get the last message
        const lastMessage = await this.repository
          .createQueryBuilder("message")
          .where("message.conversationId = :conversationId", { conversationId })
          .orderBy("message.timestamp", "DESC")
          .take(1)
          .getOne();

        // Get message count
        const messageCount = await this.repository
          .createQueryBuilder("message")
          .where("message.conversationId = :conversationId", { conversationId })
          .getCount();

        // Get first message timestamp (conversation created time)
        const firstMessage = await this.repository
          .createQueryBuilder("message")
          .where("message.conversationId = :conversationId", { conversationId })
          .orderBy("message.timestamp", "ASC")
          .take(1)
          .getOne();

        return {
          conversationId,
          lastMessage: lastMessage?.content || "",
          lastMessageTimestamp: lastMessage?.timestamp || new Date(),
          messageCount,
          createdAt: firstMessage?.timestamp || new Date(),
        };
      })
    );

    // Sort by last message timestamp (most recent first)
    return conversationsWithMetadata.sort(
      (a, b) =>
        b.lastMessageTimestamp.getTime() - a.lastMessageTimestamp.getTime()
    );
  }

  /**
   * Search conversations by message content. Returns conversations whose
   * any message contains the query string (case-insensitive LIKE).
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
    // Escape SQL LIKE wildcards in user input to avoid unintended matching.
    const escapedQuery = query.replace(/[%_]/g, (m) => "\\" + m);
    const likePattern = `%${escapedQuery}%`;

    // Step 1: Find distinct conversation IDs that contain the search term.
    const matchingConvos = await this.repository
      .createQueryBuilder("message")
      .select("DISTINCT message.conversationId", "conversationId")
      .where("message.content LIKE :query ESCAPE '\\'", { query: likePattern })
      .getRawMany();

    if (matchingConvos.length === 0) return [];

    // Step 2: For each matching conversation, fetch full metadata
    // (total message count, last/first message — not just matching rows).
    const results = await Promise.all(
      matchingConvos.map(async (conv) => {
        const conversationId = conv.conversationId as string;

        const lastMessage = await this.repository
          .createQueryBuilder("message")
          .where("message.conversationId = :conversationId", { conversationId })
          .orderBy("message.timestamp", "DESC")
          .take(1)
          .getOne();

        const messageCount = await this.repository
          .createQueryBuilder("message")
          .where("message.conversationId = :conversationId", { conversationId })
          .getCount();

        const firstMessage = await this.repository
          .createQueryBuilder("message")
          .where("message.conversationId = :conversationId", { conversationId })
          .orderBy("message.timestamp", "ASC")
          .take(1)
          .getOne();

        return {
          conversationId,
          lastMessage: lastMessage?.content || "",
          lastMessageTimestamp: lastMessage?.timestamp || new Date(),
          messageCount,
          createdAt: firstMessage?.timestamp || new Date(),
        };
      })
    );

    return results.sort(
      (a, b) =>
        b.lastMessageTimestamp.getTime() - a.lastMessageTimestamp.getTime()
    );
  }
}
