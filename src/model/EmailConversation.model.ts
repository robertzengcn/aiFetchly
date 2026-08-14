import { BaseDb } from "@/model/Basedb";
import { Repository, IsNull, In } from "typeorm";
import { EmailConversationEntity } from "@/entity/EmailConversation.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailConversationWriteSchema } from "@/schemas/entity/emailConversation";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";
import type { EmailConversationContextConfidence } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Data access for mailbox-scoped email conversations (technical design §6.1,
 * §7.2, FR-001). All queries are scoped by `emailServiceId`; subject-only
 * merging is never performed.
 */
export class EmailConversationModel extends BaseDb {
  private repository: Repository<EmailConversationEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailConversationModel");
    this.repository = this.sqliteDb.connection.getRepository(
      EmailConversationEntity
    );
  }

  async read(id: number): Promise<EmailConversationEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findByRootKey(
    emailServiceId: number,
    rootMessageKey: string
  ): Promise<EmailConversationEntity | null> {
    return await this.repository.findOne({
      where: { emailServiceId, rootMessageKey },
    });
  }

  /**
   * Resolve-or-create a conversation for a message (§7.2). Steps:
   *   1. Exact (emailServiceId, rootKey) match.
   *   2. matchCandidates: look for an existing conversation whose rootMessageKey
   *      is one of the candidates, OR a received message whose
   *      normalizedMessageId is a candidate (-> its conversation).
   *   3. Otherwise create a new conversation keyed by rootKey.
   * Cross-mailbox safety: every query is scoped by emailServiceId.
   */
  async resolveOrCreate(input: {
    emailServiceId: number;
    rootKey: string;
    matchCandidates: readonly string[];
    confidence: EmailConversationContextConfidence;
    ambiguityReason: string | null;
    displaySubject: string | null;
    lastMessageAt: Date;
  }): Promise<EmailConversationEntity> {
    // 1. Exact root-key match.
    const existing = await this.repository.findOne({
      where: {
        emailServiceId: input.emailServiceId,
        rootMessageKey: input.rootKey,
      },
    });
    if (existing) {
      await this.touch(existing, input.lastMessageAt);
      return existing;
    }

    // 2. Match candidates against conversation roots and received-message ids.
    const candidates = [input.rootKey, ...input.matchCandidates].filter(
      (c, i, arr) => c && arr.indexOf(c) === i
    );
    if (candidates.length) {
      const byRoot = await this.repository.findOne({
        where: {
          emailServiceId: input.emailServiceId,
          rootMessageKey: In(candidates),
        },
      });
      if (byRoot) {
        await this.touch(byRoot, input.lastMessageAt);
        return byRoot;
      }
      const msgRepo = this.sqliteDb.connection.getRepository(
        EmailReceivedMessageEntity
      );
      const byMsg = await msgRepo.findOne({
        where: {
          emailServiceId: input.emailServiceId,
          normalizedMessageId: In(candidates),
        },
      });
      if (byMsg?.conversationId) {
        const linked = await this.repository.findOne({
          where: { id: byMsg.conversationId },
        });
        if (linked) {
          await this.touch(linked, input.lastMessageAt);
          return linked;
        }
      }
    }

    // 3. Create.
    const entity = new EmailConversationEntity();
    entity.emailServiceId = input.emailServiceId;
    entity.rootMessageKey = input.rootKey;
    entity.displaySubject = input.displaySubject;
    entity.contextConfidence = input.confidence;
    entity.ambiguityReason = input.ambiguityReason;
    entity.lastMessageAt = input.lastMessageAt;
    entity.contextVersion = 1;
    const stripped = parseAndStrip(
      entity,
      emailConversationWriteSchema()
    ) as unknown as EmailConversationEntity;
    return await this.repository.save(this.repository.create(stripped));
  }

  /** Bump recency + context version so cached context is invalidated. */
  async touch(
    conversation: EmailConversationEntity,
    lastMessageAt: Date
  ): Promise<void> {
    const newer =
      !conversation.lastMessageAt || lastMessageAt > conversation.lastMessageAt;
    if (!newer) return;
    await this.repository.update(
      { id: conversation.id },
      {
        lastMessageAt,
        contextVersion: () => "contextVersion + 1",
      }
    );
  }

  /**
   * Merge two conversations when an exact message-id relationship bridges them
   * (§7.2). Re-roots the source conversation's messages onto the target and
   * deletes the source. Requires an email-service match. Caller must verify the
   * exact-id relationship.
   */
  async mergeExactConversations(
    targetId: number,
    sourceId: number
  ): Promise<void> {
    if (targetId === sourceId) return;
    await this.sqliteDb.connection.transaction(async (manager) => {
      const msgRepo = manager.getRepository(EmailReceivedMessageEntity);
      const convRepo = manager.getRepository(EmailConversationEntity);
      await msgRepo.update(
        { conversationId: sourceId },
        { conversationId: targetId }
      );
      await convRepo.delete(sourceId);
    });
  }

  async listByEmailService(
    emailServiceId: number,
    limit = 50
  ): Promise<EmailConversationEntity[]> {
    return await this.repository.find({
      where: { emailServiceId },
      order: { lastMessageAt: "DESC" },
      take: limit,
    });
  }
}
