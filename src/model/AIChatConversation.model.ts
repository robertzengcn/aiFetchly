import { BaseDb } from "@/model/Basedb";
import { AIChatConversationEntity } from "@/entity/AIChatConversation.entity";
import { Repository, In, LessThan, MoreThan } from "typeorm";
import type { HistoryCursor } from "@/entityTypes/aiChatWorkspaceTypes";
import {
  GENERATED_TITLE_MAX_CODEPOINTS,
  sanitizeExcerpt,
} from "@/service/aiChatTitle/AIChatTitleText";
import type {
  ChatTitleFailureCode,
  ChatTitleGenerationStatus,
  ChatTitleSource,
} from "@/service/aiChatTitle/AIChatTitleTypes";

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
    /**
     * Explicit title provenance (titles design §4). Interactive creation
     * chooses excerpt/pending; other producers default to legacy/suppressed
     * so upgrades never trigger paid naming work.
     */
    titleSource?: ChatTitleSource;
    titleGenerationStatus?: ChatTitleGenerationStatus;
  }): Promise<AIChatConversationEntity> {
    this.assertMainProcess();
    const now = new Date();
    const entity = new AIChatConversationEntity();
    entity.conversationId = input.conversationId;
    entity.workspaceKey = input.workspaceKey ?? null;
    entity.title = input.title ?? null;
    entity.titleIsUserSet = false;
    entity.titleSource = input.titleSource ?? "legacy";
    entity.titleRevision = 0;
    entity.titleEpoch = 0;
    entity.titleGenerationStatus = input.titleGenerationStatus ?? "suppressed";
    entity.titleAttemptCount = 0;
    entity.titleRequestId = null;
    entity.titleFailureCode = null;
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
   * counters/timestamps monotonically using column-scoped updates — a stale
   * read can never restore an older title or user-set flag (titles design
   * §5.3 writer audit). Legacy rows (pre-feature) are never auto-titled.
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
        title: input.generatedTitle
          ? sanitizeExcerpt(input.generatedTitle, GENERATED_TITLE_MAX_CODEPOINTS)
          : null,
        titleSource: input.generatedTitle ? "excerpt" : "placeholder",
        titleGenerationStatus: "pending",
        preview: input.previewText,
        createdAt: input.createdAt ?? input.timestamp,
      });
    }
    await this.repository
      .createQueryBuilder()
      .update()
      .set({
        preview: input.previewText.slice(0, CONVERSATION_PREVIEW_MAX_LENGTH),
        lastMessageAt: input.timestamp,
        ...(input.isResult ? { lastResultAt: input.timestamp } : {}),
        updatedAt: now,
      })
      .where("conversationId = :conversationId", {
        conversationId: input.conversationId,
      })
      .execute();
    await this.repository.increment(
      { conversationId: input.conversationId },
      "messageCount",
      1
    );
    if (input.workspaceKey !== undefined && existing.workspaceKey === null) {
      await this.repository
        .createQueryBuilder()
        .update()
        .set({ workspaceKey: input.workspaceKey, updatedAt: now })
        .where("conversationId = :conversationId AND workspaceKey IS NULL", {
          conversationId: input.conversationId,
        })
        .execute();
    }
    if (input.generatedTitle) {
      // Seed the provisional excerpt only while unclaimed, nonmanual, and
      // still placeholder-owned (post-clear re-seeding included).
      await this.repository
        .createQueryBuilder()
        .update()
        .set({
          title: sanitizeExcerpt(
            input.generatedTitle,
            GENERATED_TITLE_MAX_CODEPOINTS
          ),
          titleSource: "excerpt" as ChatTitleSource,
          updatedAt: now,
        })
        .where(
          "conversationId = :conversationId AND title IS NULL" +
            " AND titleIsUserSet = 0 AND titleSource = 'placeholder'" +
            " AND titleGenerationStatus = 'pending'",
          { conversationId: input.conversationId }
        )
        .execute();
    }
    return (await this.getByConversationId(input.conversationId)) ?? existing;
  }

  /**
   * Explicit user rename (compatibility wrapper). Manual ownership wins over
   * every automatic title operation (titles design §5.3).
   */
  async rename(
    conversationId: string,
    title: string
  ): Promise<AIChatConversationEntity | null> {
    return this.renameWithOwnership(conversationId, title);
  }

  /**
   * Atomic manual rename: column-scoped update that locks ownership to the
   * user, suppresses generation, invalidates any live claim, and increments
   * the title revision in the same statement (titles design §5.3).
   */
  async renameWithOwnership(
    conversationId: string,
    title: string
  ): Promise<AIChatConversationEntity | null> {
    this.assertMainProcess();
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({
        title: title.slice(0, CONVERSATION_TITLE_MAX_LENGTH),
        titleIsUserSet: true,
        titleSource: "user" as ChatTitleSource,
        titleGenerationStatus: "suppressed" as ChatTitleGenerationStatus,
        titleRequestId: null,
        titleFailureCode: null,
        titleRevision: () => "titleRevision + 1",
        updatedAt: new Date(),
      })
      .where("conversationId = :conversationId", { conversationId })
      .execute();
    if ((result.affected ?? 0) === 0) return null;
    return this.getByConversationId(conversationId);
  }

  /**
   * Conditionally claim the single automatic-generation attempt (titles
   * design §5.1). Returns true only for the one writer that flipped the row
   * from pending/unclaimed to running.
   */
  async claimTitleAttempt(input: {
    conversationId: string;
    epoch: number;
    revision: number;
    requestId: string;
  }): Promise<boolean> {
    this.assertMainProcess();
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({
        titleGenerationStatus: "running" as ChatTitleGenerationStatus,
        titleAttemptCount: 1,
        titleRequestId: input.requestId,
        titleFailureCode: null,
        updatedAt: new Date(),
      })
      .where(
        "conversationId = :conversationId AND titleEpoch = :epoch" +
          " AND titleRevision = :revision AND titleIsUserSet = 0" +
          " AND titleSource IN ('placeholder','excerpt')" +
          " AND titleGenerationStatus = 'pending' AND titleAttemptCount = 0" +
          " AND archivedAt IS NULL",
        input
      )
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /**
   * Conditionally save a validated generated title (titles design §5.2).
   * A zero-row update is expected when the user renamed/cleared meanwhile —
   * it is not a chat failure.
   */
  async applyGeneratedTitle(input: {
    conversationId: string;
    epoch: number;
    revision: number;
    requestId: string;
    title: string;
  }): Promise<
    | { outcome: "applied"; title: string; revision: number }
    | { outcome: "stale" }
    | { outcome: "missing" }
  > {
    this.assertMainProcess();
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({
        title: input.title.slice(0, CONVERSATION_TITLE_MAX_LENGTH),
        titleSource: "ai" as ChatTitleSource,
        titleGenerationStatus: "succeeded" as ChatTitleGenerationStatus,
        titleFailureCode: null,
        titleRevision: () => "titleRevision + 1",
        updatedAt: new Date(),
      })
      .where(
        "conversationId = :conversationId AND titleEpoch = :epoch" +
          " AND titleRevision = :revision AND titleRequestId = :requestId" +
          " AND titleGenerationStatus = 'running' AND titleIsUserSet = 0",
        input
      )
      .execute();
    if ((result.affected ?? 0) === 1) {
      const row = await this.getByConversationId(input.conversationId);
      return {
        outcome: "applied",
        title: row?.title ?? input.title,
        revision: row?.titleRevision ?? input.revision + 1,
      };
    }
    const row = await this.getByConversationId(input.conversationId);
    return row ? { outcome: "stale" } : { outcome: "missing" };
  }

  /** Mark the live claim failed without retry (bounded internal code only). */
  async markTitleAttemptFailed(input: {
    conversationId: string;
    requestId: string;
    failureCode: ChatTitleFailureCode;
  }): Promise<void> {
    this.assertMainProcess();
    await this.repository
      .createQueryBuilder()
      .update()
      .set({
        titleGenerationStatus: "failed" as ChatTitleGenerationStatus,
        titleFailureCode: input.failureCode,
        updatedAt: new Date(),
      })
      .where(
        "conversationId = :conversationId AND titleRequestId = :requestId" +
          " AND titleGenerationStatus = 'running'",
        input
      )
      .execute();
  }

  /**
   * Refresh the provisional excerpt while still pending and nonmanual
   * (greeting → substantive replacement, titles design §5.3). Frozen once a
   * claim starts.
   */
  async updateExcerptIfPending(input: {
    conversationId: string;
    epoch: number;
    excerpt: string;
  }): Promise<void> {
    this.assertMainProcess();
    await this.repository
      .createQueryBuilder()
      .update()
      .set({
        title: input.excerpt.slice(0, CONVERSATION_TITLE_MAX_LENGTH),
        titleSource: "excerpt" as ChatTitleSource,
        // The excerpt is the visible title: bump the revision so
        // revision-guarded renderers accept the updated excerpt.
        titleRevision: () => "titleRevision + 1",
        updatedAt: new Date(),
      })
      .where(
        "conversationId = :conversationId AND titleEpoch = :epoch" +
          " AND titleGenerationStatus = 'pending' AND titleIsUserSet = 0" +
          " AND titleSource IN ('placeholder','excerpt')",
        input
      )
      .execute();
  }

  /** Transition pending → suppressed (three non-substantive exchanges). */
  async suppressTitleGeneration(conversationId: string): Promise<void> {
    this.assertMainProcess();
    await this.repository
      .createQueryBuilder()
      .update()
      .set({
        titleGenerationStatus: "suppressed" as ChatTitleGenerationStatus,
        updatedAt: new Date(),
      })
      .where(
        "conversationId = :conversationId AND titleGenerationStatus = 'pending'",
        { conversationId }
      )
      .execute();
  }

  /**
   * History-clear title lifecycle (titles design §4): a fresh epoch. Manual
   * names survive; nonmanual titles restart a pending lifecycle.
   */
  async clearTitleLifecycleForHistoryClear(
    conversationId: string
  ): Promise<void> {
    this.assertMainProcess();
    const existing = await this.getByConversationId(conversationId);
    if (!existing) return;
    if (existing.titleIsUserSet) {
      await this.repository
        .createQueryBuilder()
        .update()
        .set({
          titleEpoch: () => "titleEpoch + 1",
          titleRevision: () => "titleRevision + 1",
          titleGenerationStatus: "suppressed" as ChatTitleGenerationStatus,
          titleRequestId: null,
          titleFailureCode: null,
          updatedAt: new Date(),
        })
        .where("conversationId = :conversationId", { conversationId })
        .execute();
      return;
    }
    await this.repository
      .createQueryBuilder()
      .update()
      .set({
        title: null,
        titleSource: "placeholder" as ChatTitleSource,
        titleEpoch: () => "titleEpoch + 1",
        titleRevision: () => "titleRevision + 1",
        titleGenerationStatus: "pending" as ChatTitleGenerationStatus,
        titleAttemptCount: 0,
        titleRequestId: null,
        titleFailureCode: null,
        updatedAt: new Date(),
      })
      .where("conversationId = :conversationId", { conversationId })
      .execute();
  }

  /** Startup reconciliation: an interrupted dispatched attempt stays failed. */
  async reconcileInterruptedTitleClaims(): Promise<number> {
    this.assertMainProcess();
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({
        titleGenerationStatus: "failed" as ChatTitleGenerationStatus,
        titleFailureCode: "interrupted" as ChatTitleFailureCode,
        updatedAt: new Date(),
      })
      .where("titleGenerationStatus = 'running'")
      .execute();
    return result.affected ?? 0;
  }

  /** Idempotent upgrade repair: user-set rows read as user-owned. */
  async repairLegacyUserTitles(): Promise<number> {
    this.assertMainProcess();
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({ titleSource: "user" as ChatTitleSource, updatedAt: new Date() })
      .where("titleIsUserSet = 1 AND titleSource != 'user'")
      .execute();
    return result.affected ?? 0;
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
    // Column-scoped: never carries stale title columns forward (§5.3 audit).
    await this.repository.update(
      { id: existing.id },
      { lastReadAt: observedThrough, updatedAt: new Date() }
    );
    return (await this.getByConversationId(conversationId)) ?? existing;
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
