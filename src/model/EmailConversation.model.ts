import { BaseDb } from "@/model/Basedb";
import { Repository, IsNull, In } from "typeorm";
import { EmailConversationEntity } from "@/entity/EmailConversation.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailConversationWriteSchema } from "@/schemas/entity/emailConversation";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";
import type { EmailConversationContextConfidence } from "@/entityTypes/emailReplyReliabilityTypes";
import type { EmailConversationTurn } from "@/service/emailReply/EmailThreadContextBuilder";

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

  /**
   * Ordered inbound + outbound turns for one conversation (P1.3, FR-002).
   * Inbound turns come from received messages; outbound turns come ONLY from
   * confirmed `sent` send attempts joined to their immutable revision. Ordered
   * by provider timestamp with a deterministic id fallback.
   *
   * Outbound entries missing a provider message id (historical data) are
   * returned but flagged via providerMessageId === null — callers label them
   * partial-confidence history (NFR-005).
   */
  async listOrderedTurns(
    emailServiceId: number,
    conversationId: number,
    limit = 100
  ): Promise<EmailConversationTurn[]> {
    const msgRepo = this.sqliteDb.connection.getRepository(
      EmailReceivedMessageEntity
    );
    const inbound = await msgRepo
      .createQueryBuilder("msg")
      .where("msg.emailServiceId = :emailServiceId", { emailServiceId })
      .andWhere("msg.conversationId = :conversationId", { conversationId })
      .orderBy("msg.receivedAt", "ASC")
      .addOrderBy("msg.id", "ASC")
      .take(limit)
      .getMany();

    const attemptRepo = this.sqliteDb.connection.getRepository(
      EmailReplySendAttemptEntity
    );
    const revisionRepo = this.sqliteDb.connection.getRepository(
      EmailReplyDraftRevisionEntity
    );
    const attempts = await attemptRepo
      .createQueryBuilder("attempt")
      .where("attempt.emailServiceId = :emailServiceId", { emailServiceId })
      .andWhere("attempt.conversationId = :conversationId", { conversationId })
      .andWhere("attempt.status = :status", { status: "sent" })
      .orderBy("attempt.claimedAt", "ASC")
      .addOrderBy("attempt.id", "ASC")
      .take(limit)
      .getMany();

    const inboundTurns: EmailConversationTurn[] = inbound.map((m) => ({
      sourceType: "received_message",
      sourceId: m.id,
      direction: "inbound",
      timestamp: m.receivedAt,
      sender: m.fromAddress,
      recipients: safeParseAddresses(m.toAddressesJson),
      subject: m.subject,
      bodyText: m.normalizedBodyText ?? m.bodyText ?? "",
      providerMessageId: m.normalizedMessageId ?? m.messageId ?? null,
    }));

    const outboundTurns: EmailConversationTurn[] = [];
    for (const attempt of attempts) {
      const revision = await revisionRepo.findOne({
        where: { id: attempt.revisionId },
      });
      outboundTurns.push({
        sourceType: "send_attempt",
        sourceId: attempt.id,
        direction: "outbound",
        timestamp: attempt.claimedAt,
        sender: attempt.senderAddress,
        recipients: [attempt.recipientAddress],
        subject: revision?.subject ?? "",
        bodyText: revision?.bodyText ?? "",
        providerMessageId: attempt.providerMessageId ?? null,
      });
    }

    return [...inboundTurns, ...outboundTurns].sort(
      (a, b) =>
        a.timestamp.getTime() - b.timestamp.getTime() || a.sourceId - b.sourceId
    );
  }
}

function safeParseAddresses(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((s) => String(s)) : [];
  } catch {
    return [];
  }
}
