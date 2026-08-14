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
   * receivedAt, unread flag) is refreshed while LOCAL processing state
   * (`replyStatus`, `classification`, `classificationConfidence`, `processedAt`)
   * is preserved — repeated syncs must never reset reply state.
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
      existing.messageId = stripped.messageId;
      existing.threadKey = stripped.threadKey;
      existing.inReplyTo = stripped.inReplyTo;
      existing.referencesHeader = stripped.referencesHeader;
      existing.fromAddress = stripped.fromAddress;
      existing.fromName = stripped.fromName;
      existing.replyToAddress = stripped.replyToAddress;
      existing.toAddressesJson = stripped.toAddressesJson;
      existing.ccAddressesJson = stripped.ccAddressesJson;
      existing.subject = stripped.subject;
      existing.bodyText = stripped.bodyText;
      existing.bodyHtmlSanitized = stripped.bodyHtmlSanitized;
      existing.snippet = stripped.snippet;
      existing.receivedAt = stripped.receivedAt;
      existing.isUnread = stripped.isUnread;
      if (
        shouldPromoteReplyStatusFromProvider(
          stripped.replyStatus as EmailReplyStatus | undefined,
          existing.replyStatus
        )
      ) {
        existing.replyStatus = "sent";
        existing.processedAt = new Date();
      }
      // classification intentionally preserved.
      return await this.repository.save(existing);
    }

    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async read(id: number): Promise<EmailReceivedMessageEntity | null> {
    return await this.repository.findOne({ where: { id } });
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

export function shouldPromoteReplyStatusFromProvider(
  incomingStatus: EmailReplyStatus | undefined,
  existingStatus: EmailReplyStatus
): boolean {
  return incomingStatus === "sent" && existingStatus !== "sent";
}
