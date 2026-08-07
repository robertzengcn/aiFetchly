import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { SortBy } from "@/entityTypes/commonType";
import { EmailReplyDraftStatus } from "@/entityTypes/emailReceiveTypes";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyDraftWriteSchema } from "@/schemas/entity/emailReplyDraft";

export interface ReplyDraftListInput {
  emailServiceId?: number;
  messageId?: number;
  page: number;
  size: number;
  where?: string;
  sortby?: SortBy;
}

export class EmailReplyDraftModel extends BaseDb {
  private repository: Repository<EmailReplyDraftEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReplyDraftEntity
    );
  }

  async create(
    entity: EmailReplyDraftEntity
  ): Promise<EmailReplyDraftEntity> {
    const stripped = parseAndStrip(
      entity,
      emailReplyDraftWriteSchema()
    ) as unknown as EmailReplyDraftEntity;
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async read(id: number): Promise<EmailReplyDraftEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async updateStatus(
    id: number,
    status: EmailReplyDraftStatus,
    error: string | null = null
  ): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.status = status;
    entity.sendError = error;
    await this.repository.save(entity);
  }

  async updateBody(
    id: number,
    bodyText: string,
    bodyHtml: string | null
  ): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.bodyText = bodyText;
    entity.bodyHtml = bodyHtml;
    await this.repository.save(entity);
  }

  async markSent(id: number, sentAt: Date): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.status = "sent";
    entity.sentAt = sentAt;
    entity.sendError = null;
    await this.repository.save(entity);
  }

  async listByMessage(messageId: number): Promise<EmailReplyDraftEntity[]> {
    return await this.repository.find({
      where: { messageId },
      order: { id: "DESC" },
    });
  }

  async list(input: ReplyDraftListInput): Promise<EmailReplyDraftEntity[]> {
    let qb = this.repository.createQueryBuilder("draft");
    if (input.emailServiceId) {
      qb = qb.where("draft.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    }
    if (input.messageId) {
      qb = qb.andWhere("draft.messageId = :messageId", {
        messageId: input.messageId,
      });
    }
    if (input.where) {
      qb = qb.andWhere("(draft.subject LIKE :search)", {
        search: `%${input.where}%`,
      });
    }
    qb = qb.orderBy("draft.id", "DESC").skip(input.page).take(input.size);
    return await qb.getMany();
  }

  async count(input: ReplyDraftListInput): Promise<number> {
    let qb = this.repository.createQueryBuilder("draft");
    if (input.emailServiceId) {
      qb = qb.where("draft.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    }
    if (input.messageId) {
      qb = qb.andWhere("draft.messageId = :messageId", {
        messageId: input.messageId,
      });
    }
    if (input.where) {
      qb = qb.andWhere("(draft.subject LIKE :search)", {
        search: `%${input.where}%`,
      });
    }
    return await qb.getCount();
  }
}
