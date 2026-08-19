import { BaseDb } from "@/model/Basedb";
import { AIChatConversationEntity } from "@/entity/AIChatConversation.entity";
import { Repository, In, LessThan, MoreThan } from "typeorm";
import type { HistoryCursor } from "@/entityTypes/aiChatWorkspaceTypes";

/** Bounded lengths for navigation-safe projection fields (design §8.1). */
export const CONVERSATION_TITLE_MAX_LENGTH = 200;
export const CONVERSATION_PREVIEW_MAX_LENGTH = 300;

/**
 * Durable conversation metadata projection model (technical-design §8.1).
 *
 * All methods reject calls from worker processes — workers must send results
 * to the main process via IPC instead of touching the database.
 */
export class AIChatConversationModel extends BaseDb {
  public repository: Repository<AIChatConversationEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AIChatConversationEntity);
  }

  private assertMainProcess(): void {
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Workers must send results to the main process via IPC."
      );
    }
  }

  async getByConversationId(
    conversationId: string
  ): Promise<AIChatConversationEntity | null> {
    this.assertMainProcess();
    return this.repository.findOne({ where: { conversationId } });
  }

  async getByConversationIds(
    conversationIds: string[]
  ): Promise<AIChatConversationEntity[]> {
    this.assertMainProcess();
    if (conversationIds.length === 0) return [];
    return this.repository.find({
      where: { conversationId: In(conversationIds) },
    });
  }

  /** Create the projection row for a brand-new conversation. */
  async createProjection(input: {
    conversationId: string;
    workspaceKey?: string | null;
    title?: string | null;
    preview?: string;
    createdAt?: Date;
  }): Promise<AIChatConversationEntity> {
    this.assertMainProcess();
    const now = new Date();
    const entity = new AIChatConversationEntity();
    entity.conversationId = input.conversationId;
    entity.workspaceKey = input.workspaceKey ?? null;
    entity.title = input.title ?? null;
    entity.titleIsUserSet = false;
    entity.preview = (input.preview ?? "").slice(
      0,
      CONVERSATION_PREVIEW_MAX_LENGTH
    );
    entity.messageCount = 0;
    entity.lastMessageAt = null;
    entity.lastResultAt = null;
    entity.lastReadAt = input.createdAt ?? null;
    entity.archivedAt = null;
    entity.createdAt = input.createdAt ?? now;
    entity.updatedAt = now;
    return this.repository.save(entity);
  }

  /**
   * Idempotent projection upsert used after message persistence. Advances
   * counters/timestamps monotonically; never overwrites a user-set title.
   */
  async recordMessagePersisted(input: {
    conversationId: string;
    workspaceKey?: string | null;
    /** True when the persisted row is an assistant result (drives unread). */
    isResult: boolean;
    previewText: string;
    generatedTitle?: string | null;
    timestamp: Date;
    createdAt?: Date;
  }): Promise<AIChatConversationEntity> {
    this.assertMainProcess();
    const existing = await this.getByConversationId(input.conversationId);
    const now = new Date();
    if (!existing) {
      return this.createProjection({
        conversationId: input.conversationId,
        workspaceKey: input.workspaceKey,
        title: input.generatedTitle ?? null,
        preview: input.previewText,
        createdAt: input.createdAt ?? input.timestamp,
      });
    }
    const entity = { ...existing };
    entity.messageCount += 1;
    entity.preview = input.previewText.slice(
      0,
      CONVERSATION_PREVIEW_MAX_LENGTH
    );
    entity.lastMessageAt = input.timestamp;
    if (input.isResult) {
      entity.lastResultAt = input.timestamp;
    }
    // Persist a generated title once; never touch a user rename or an
    // already-derived title (design §8.6 precedence).
    if (
      !entity.title &&
      !entity.titleIsUserSet &&
      input.generatedTitle
    ) {
      entity.title = input.generatedTitle.slice(
        0,
        CONVERSATION_TITLE_MAX_LENGTH
      );
    }
    if (input.workspaceKey !== undefined && entity.workspaceKey === null) {
      entity.workspaceKey = input.workspaceKey;
    }
    entity.updatedAt = now;
    return this.repository.save(entity);
  }

  /** Explicit user rename. Clears the generated flag. */
  async rename(
    conversationId: string,
    title: string
  ): Promise<AIChatConversationEntity | null> {
    this.assertMainProcess();
    const existing = await this.getByConversationId(conversationId);
    if (!existing) return null;
    const entity = { ...existing };
    entity.title = title.slice(0, CONVERSATION_TITLE_MAX_LENGTH);
    entity.titleIsUserSet = true;
    entity.updatedAt = new Date();
    return this.repository.save(entity);
  }

  /**
   * Monotonic read-marker advance (design §8.5). A stale renderer cannot
   * move `lastReadAt` backward. Returns the updated entity, or null when
   * the conversation is unknown or the marker would not advance.
   */
  async markRead(
    conversationId: string,
    observedThrough: Date
  ): Promise<AIChatConversationEntity | null> {
    this.assertMainProcess();
    const existing = await this.getByConversationId(conversationId);
    if (!existing) return null;
    if (
      existing.lastReadAt &&
      existing.lastReadAt.getTime() >= observedThrough.getTime()
    ) {
      return existing;
    }
    const entity = { ...existing };
    entity.lastReadAt = observedThrough;
    entity.updatedAt = new Date();
    return this.repository.save(entity);
  }

  /** All non-archived projections ordered by recency (sidebar base query). */
  async listAll(): Promise<AIChatConversationEntity[]> {
    this.assertMainProcess();
    return this.repository.find({
      where: { archivedAt: undefined },
      order: { lastMessageAt: "DESC" },
    });
  }

  async listByWorkspaceKey(workspaceKey: string): Promise<AIChatConversationEntity[]> {
    this.assertMainProcess();
    return this.repository.find({
      where: { workspaceKey },
      order: { lastMessageAt: "DESC" },
    });
  }

  /** Conversations with an unacknowledged result newer than their read marker. */
  async listUnreadSince(marker: Date): Promise<AIChatConversationEntity[]> {
    this.assertMainProcess();
    return this.repository.find({
      where: { lastResultAt: MoreThan(marker) },
    });
  }

  /** Older-than helper used by projection repair windows. */
  async listUpdatedBefore(cutoff: Date): Promise<AIChatConversationEntity[]> {
    this.assertMainProcess();
    return this.repository.find({
      where: { updatedAt: LessThan(cutoff) },
    });
  }

  async deleteByConversationId(conversationId: string): Promise<void> {
    this.assertMainProcess();
    await this.repository.delete({ conversationId });
  }

  /**
   * True when the projection reports unread:
   * `lastResultAt != null && (lastReadAt == null || lastResultAt > lastReadAt)`.
   */
  static isUnread(entity: {
    lastResultAt: Date | null;
    lastReadAt: Date | null;
  }): boolean {
    if (!entity.lastResultAt) return false;
    if (!entity.lastReadAt) return true;
    return entity.lastResultAt.getTime() > entity.lastReadAt.getTime();
  }

  /** Build the next-older cursor from a page boundary (design §12.1). */
  static cursorFor(message: {
    timestamp: Date | string;
    messageId: string;
  }): HistoryCursor {
    const iso =
      typeof message.timestamp === "string"
        ? message.timestamp
        : message.timestamp.toISOString();
    return { timestamp: iso, messageId: message.messageId };
  }
}
