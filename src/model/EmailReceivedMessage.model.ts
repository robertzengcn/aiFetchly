import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { SortBy } from "@/entityTypes/commonType";
import {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReceivedMessageWriteSchema } from "@/schemas/entity/emailReceivedMessage";

/** Filter inputs for listing received messages. */
export interface ReceivedMessageListInput {
  emailServiceId: number;
  page: number;
  size: number;
  where?: string;
  sortby?: SortBy;
  unreadOnly?: boolean;
  replyStatus?: EmailReplyStatus;
  classification?: EmailMessageClassification;
}

export class EmailReceivedMessageModel extends BaseDb {
  private repository: Repository<EmailReceivedMessageEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReceivedMessageEntity
    );
  }

  /**
   * Upsert by the unique `(emailServiceId, providerUid)` key.
   *
   * On conflict, provider-supplied metadata (subject, body, addresses, headers,
   * receivedAt, unread flag, answered flag + provenance) is refreshed with a
   * TARGETED update while LOCAL processing state (`replyStatus`,
   * `classification`, `classificationConfidence`, `processedAt`) and the
   * detection-owned evidence columns (`replyDetectedAt`,
   * `replyDetectionSource`, `replyMatchedMessageId`, `replyNegativeCheckAt`,
   * `replyNegativeContextHash`) are preserved — repeated syncs must never
   * reset reply state, clobber a concurrently changed lifecycle, or erase a
   * sticky positive (FR-030, technical design §5.1).
   */
  async upsertByProviderUid(
    entity: EmailReceivedMessageEntity
  ): Promise<EmailReceivedMessageEntity> {
    const stripped = parseAndStrip(
      entity,
      emailReceivedMessageWriteSchema()
    ) as unknown as EmailReceivedMessageEntity;

    const existing = await this.repository.findOne({
      where: {
        emailServiceId: stripped.emailServiceId,
        providerUid: stripped.providerUid,
      },
    });

    if (existing) {
      const providerPatch = this.buildProviderFieldPatch(stripped);
      // Historical sent promotion stays the ONLY replyStatus write sync may
      // perform, and only strengthens (never downgrades) — narrowed to also
      // require the freshly-observed \Answered flag (FR-030).
      const promote = shouldPromoteReplyStatusFromProvider(
        stripped.isAnswered === 1 ? "sent" : undefined,
        existing.replyStatus
      );
      if (promote) {
        await this.repository.update(
          { id: existing.id },
          {
            ...providerPatch,
            replyStatus: "sent",
            processedAt: new Date(),
          }
        );
      } else {
        await this.repository.update({ id: existing.id }, providerPatch);
      }
      const refreshed = await this.repository.findOne({
        where: { id: existing.id },
      });
      return refreshed ?? existing;
    }

    const created = this.repository.create(stripped);
    // Same narrowed historical promotion on FIRST insert: an inbound message
    // observed \Answered is already answered in the mailbox (possibly by a
    // human mail client) — the app must not draft another reply to it.
    if (
      shouldPromoteReplyStatusFromProvider(
        stripped.isAnswered === 1 ? "sent" : undefined,
        created.replyStatus
      )
    ) {
      created.replyStatus = "sent";
      created.processedAt = new Date();
    }
    return await this.repository.save(created);
  }

  /**
   * Provider-owned field patch for the targeted sync update. Deliberately
   * excludes every write-owned-by-someone-else column: `replyStatus` /
   * `processedAt` (app delivery), classification fields (classifier), and the
   * detection evidence columns (detector). Only the raw flag observation
   * (`isAnswered` + check time) and UID provenance belong to sync.
   */
  private buildProviderFieldPatch(
    stripped: EmailReceivedMessageEntity
  ): Partial<EmailReceivedMessageEntity> {
    return {
      messageId: stripped.messageId,
      threadKey: stripped.threadKey,
      inReplyTo: stripped.inReplyTo,
      referencesHeader: stripped.referencesHeader,
      fromAddress: stripped.fromAddress,
      fromName: stripped.fromName,
      replyToAddress: stripped.replyToAddress,
      toAddressesJson: stripped.toAddressesJson,
      ccAddressesJson: stripped.ccAddressesJson,
      subject: stripped.subject,
      bodyText: stripped.bodyText,
      bodyHtmlSanitized: stripped.bodyHtmlSanitized,
      snippet: stripped.snippet,
      receivedAt: stripped.receivedAt,
      isUnread: stripped.isUnread,
      isAnswered: stripped.isAnswered,
      answeredFlagCheckedAt: stripped.answeredFlagCheckedAt ?? new Date(),
      providerFolder: stripped.providerFolder,
      providerUidValidity: stripped.providerUidValidity,
    };
  }

  /**
   * Detection-owned evidence write (FR-030/FR-031, technical design §5.1).
   *
   * STICKY POSITIVE FENCE: once `replyDetectedAt` is set it is never cleared
   * and never overwritten — a later observation carrying no positive evidence
   * (zero flag, empty search) cannot reset a protected message. Negative
   * fields are written only while no positive evidence exists; once positive,
   * negatives are not written at all.
   */
  async updateReplyEvidence(input: {
    id: number;
    replyDetectedAt?: Date | null;
    replyDetectionSource?: string | null;
    replyMatchedMessageId?: string | null;
    replyNegativeCheckAt?: Date | null;
    replyNegativeContextHash?: string | null;
    isAnswered?: number;
    answeredFlagCheckedAt?: Date | null;
  }): Promise<boolean> {
    const positive = input.replyDetectedAt != null;

    if (positive) {
      // Strengthen only: fill the first-positive timestamp when unset; never
      // move it, never clear it. Provenance fields ride along.
      const result = await this.repository
        .createQueryBuilder()
        .update(EmailReceivedMessageEntity)
        .set({
          replyDetectedAt: () => "COALESCE(replyDetectedAt, :detectedAt)",
          replyDetectionSource: input.replyDetectionSource ?? undefined,
          replyMatchedMessageId: input.replyMatchedMessageId ?? undefined,
          ...(input.isAnswered != null ? { isAnswered: input.isAnswered } : {}),
          ...(input.answeredFlagCheckedAt != null
            ? { answeredFlagCheckedAt: input.answeredFlagCheckedAt }
            : {}),
        })
        .where("id = :id", { id: input.id })
        .setParameters({ detectedAt: input.replyDetectedAt })
        .execute();
      return (result.affected ?? 0) === 1;
    }

    // Negative observation: only when NO positive evidence exists on the row.
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailReceivedMessageEntity)
      .set({
        replyNegativeCheckAt: input.replyNegativeCheckAt ?? null,
        replyNegativeContextHash: input.replyNegativeContextHash ?? null,
        ...(input.isAnswered != null ? { isAnswered: input.isAnswered } : {}),
        ...(input.answeredFlagCheckedAt != null
          ? { answeredFlagCheckedAt: input.answeredFlagCheckedAt }
          : {}),
      })
      .where("id = :id AND replyDetectedAt IS NULL", { id: input.id })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /**
   * Adopt a legacy bare-UID row into the namespaced providerUid scheme
   * (T03 step 3). Targeted update: preserves ALL local state (replyStatus,
   * classification, evidence, processedAt) — only the dedupe key + UID
   * provenance change. The caller must have validated the source identity
   * (fetched header matches the expected RFC Message-ID) first.
   *
   * COLLISION-SAFE: the rebase is refused (returns false, no write) when
   * another row in the same service already holds the target namespaced
   * key — e.g. a prior sync inserted the namespaced row while the legacy
   * row lingered. The unique `(emailServiceId, providerUid)` index would
   * otherwise abort the whole sync; the caller falls through to the normal
   * upsert, which refreshes the existing namespaced row and leaves the
   * legacy row guarded by its own canonical reply keys.
   */
  async updateProviderUidNamespacing(input: {
    id: number;
    emailServiceId: number;
    providerUid: string;
    providerFolder: string | null;
    providerUidValidity: string | null;
  }): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailReceivedMessageEntity)
      .set({
        providerUid: input.providerUid,
        providerFolder: input.providerFolder,
        providerUidValidity: input.providerUidValidity,
      })
      .where(
        "id = :id AND NOT EXISTS (" +
          "SELECT 1 FROM email_received_message" +
          " WHERE emailServiceId = :emailServiceId" +
          " AND providerUid = :targetUid AND id <> :id" +
          ")",
        {
          id: input.id,
          emailServiceId: input.emailServiceId,
          targetUid: input.providerUid,
        }
      )
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /**
   * Find a legacy bare-UID row for the same service whose providerUid equals
   * the raw UID string (pre-namespacing syncs stored `String(uid)`). Returns
   * null when no legacy row exists for adoption consideration.
   */
  async findLegacyBareUidRow(input: {
    emailServiceId: number;
    bareUid: string;
  }): Promise<EmailReceivedMessageEntity | null> {
    return await this.repository.findOne({
      where: {
        emailServiceId: input.emailServiceId,
        providerUid: input.bareUid,
      },
    });
  }

  async read(id: number): Promise<EmailReceivedMessageEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Find every received-message row in the same configured email service that
   * shares the canonical inbound reply identity with the seed row (FR-029,
   * FR-038, technical design §4.1).
   *
   * Canonical equivalence is resolved by the normalized RFC Message-ID. The
   * `(emailServiceId, normalizedMessageId)` index makes this lookup cheap. The
   * seed row itself is always included in the result so callers can treat the
   * cluster uniformly.
   *
   * Legacy rows whose `normalizedMessageId` was never populated are handled by
   * the caller (the identity module normalizes their raw `messageId` on the fly
   * before binding the guard). A row with no usable RFC ID falls back to a
   * `row:<id>` singleton key and matches only itself — it is never merged with
   * another missing-id row by subject or conversation.
   */
  async findCanonicalEquivalents(input: {
    emailServiceId: number;
    normalizedMessageId: string | null;
  }): Promise<EmailReceivedMessageEntity[]> {
    if (!input.normalizedMessageId) {
      // No RFC id → singleton. Caller passes the seed row id separately if it
      // wants the row included; here we just return nothing for an empty key.
      return [];
    }
    return await this.repository.find({
      where: {
        emailServiceId: input.emailServiceId,
        normalizedMessageId: input.normalizedMessageId,
      },
      order: { id: "ASC" },
    });
  }

  /** Associate a received message with a conversation (P1, FR-001). */
  async setConversation(
    messageId: number,
    conversationId: number
  ): Promise<void> {
    await this.repository.update({ id: messageId }, { conversationId });
  }

  /** Messages not yet placed in a conversation (conversation backfill input). */
  async listWithoutConversation(
    emailServiceId?: number,
    limit = 100000
  ): Promise<EmailReceivedMessageEntity[]> {
    const qb = this.repository
      .createQueryBuilder("msg")
      .where("msg.conversationId IS NULL")
      .orderBy("msg.emailServiceId", "ASC")
      .addOrderBy("msg.receivedAt", "ASC")
      .take(limit);
    if (emailServiceId != null) {
      qb.andWhere("msg.emailServiceId = :emailServiceId", { emailServiceId });
    }
    return await qb.getMany();
  }

  /** Bulk-set normalization + conversation fields at sync time (P1/P2). */
  async updateNormalization(
    messageId: number,
    fields: {
      normalizedMessageId?: string | null;
      normalizedInReplyTo?: string | null;
      normalizedReferencesJson?: string | null;
      normalizedBodyText?: string | null;
      newContentText?: string | null;
      autoSubmittedHeader?: string | null;
      precedenceHeader?: string | null;
      listIdHeader?: string | null;
      listUnsubscribeHeader?: string | null;
      hasAttachments?: number;
      attachmentMetadataJson?: string | null;
      conversationId?: number | null;
    }
  ): Promise<void> {
    await this.repository.update({ id: messageId }, fields);
  }

  async updateReplyStatus(
    id: number,
    status: EmailReplyStatus,
    processedAt: Date | null = null
  ): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.replyStatus = status;
    if (processedAt) {
      entity.processedAt = processedAt;
    }
    await this.repository.save(entity);
  }

  /** Record classification provenance so deterministic results are auditable (FR-007). */
  async updateClassificationProvenance(
    id: number,
    source: string,
    version: string
  ): Promise<void> {
    await this.repository.update(
      { id },
      {
        classificationSource: source,
        classificationVersion: version,
        classifiedAt: new Date(),
      }
    );
  }

  async updateClassification(
    id: number,
    classification: EmailMessageClassification | null,
    confidence: number | null
  ): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.classification = classification;
    entity.classificationConfidence = confidence;
    await this.repository.save(entity);
  }

  async markRead(id: number, isUnread: boolean): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.isUnread = isUnread ? 1 : 0;
    await this.repository.save(entity);
  }

  async listByEmailService(
    input: ReceivedMessageListInput
  ): Promise<EmailReceivedMessageEntity[]> {
    let qb = this.repository
      .createQueryBuilder("msg")
      .where("msg.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });

    if (input.unreadOnly) {
      qb = qb.andWhere("msg.isUnread = 1");
    }
    if (input.replyStatus) {
      qb = qb.andWhere("msg.replyStatus = :replyStatus", {
        replyStatus: input.replyStatus,
      });
    }
    if (input.classification) {
      qb = qb.andWhere("msg.classification = :classification", {
        classification: input.classification,
      });
    }
    if (input.where) {
      qb = qb.andWhere(
        "(msg.subject LIKE :search OR msg.fromAddress LIKE :search OR msg.fromName LIKE :search)",
        { search: `%${input.where}%` }
      );
    }

    if (input.sortby?.key && input.sortby?.order) {
      const key = input.sortby.key.toLowerCase();
      const order = input.sortby.order.toLowerCase();
      const allowKeys = [
        "id",
        "receivedat",
        "subject",
        "replystatus",
        "isunread",
      ];
      const allowOrders = ["asc", "desc"];
      if (allowKeys.includes(key) && allowOrders.includes(order)) {
        qb = qb.orderBy(`msg.${key}`, order.toUpperCase() as "ASC" | "DESC");
      } else {
        qb = qb.orderBy("msg.receivedAt", "DESC");
      }
    } else {
      qb = qb.orderBy("msg.receivedAt", "DESC");
    }

    qb = qb.skip(input.page).take(input.size);
    return await qb.getMany();
  }

  async countByEmailService(
    input: Omit<ReceivedMessageListInput, "page" | "size" | "sortby">
  ): Promise<number> {
    let qb = this.repository
      .createQueryBuilder("msg")
      .where("msg.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    if (input.unreadOnly) {
      qb = qb.andWhere("msg.isUnread = 1");
    }
    if (input.replyStatus) {
      qb = qb.andWhere("msg.replyStatus = :replyStatus", {
        replyStatus: input.replyStatus,
      });
    }
    if (input.classification) {
      qb = qb.andWhere("msg.classification = :classification", {
        classification: input.classification,
      });
    }
    if (input.where) {
      qb = qb.andWhere(
        "(msg.subject LIKE :search OR msg.fromAddress LIKE :search OR msg.fromName LIKE :search)",
        { search: `%${input.where}%` }
      );
    }
    return await qb.getCount();
  }
}

/**
 * Historical sent promotion (FR-030 narrowing): sync may strengthen the
 * replyStatus projection to `sent` only when the freshly-observed IMAP
 * `\Answered` flag is set (caller passes "sent" only in that case) and the
 * existing projection is not already `sent`. A cleared flag or later
 * zero/negative observation NEVER downgrades — that is the sticky-positive
 * rule enforced by `updateReplyEvidence`.
 */
export function shouldPromoteReplyStatusFromProvider(
  incomingStatus: EmailReplyStatus | undefined,
  existingStatus: EmailReplyStatus
): boolean {
  return incomingStatus === "sent" && existingStatus !== "sent";
}
