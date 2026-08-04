import { BaseDb } from "@/model/Basedb";
import { Repository, MoreThan, In } from "typeorm";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";
import { SortBy } from "@/entityTypes/commonType";
import {
  EmailAutoReplyDecisionStatus,
  EmailMessageClassification,
} from "@/entityTypes/emailReceiveTypes";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailAutoReplyAuditLogWriteSchema } from "@/schemas/entity/emailAutoReplyAuditLog";

export interface AutoReplyAuditListInput {
  emailServiceId?: number;
  decisionStatus?: EmailAutoReplyDecisionStatus;
  classification?: EmailMessageClassification;
  senderSearch?: string;
  dateStart?: string;
  dateEnd?: string;
  search?: string;
  page: number;
  size: number;
  sortby?: SortBy;
}

export class EmailAutoReplyAuditLogModel extends BaseDb {
  private repository: Repository<EmailAutoReplyAuditLogEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailAutoReplyAuditLogEntity
    );
  }

  async create(entity: EmailAutoReplyAuditLogEntity): Promise<number> {
    const stripped = parseAndStrip(
      entity,
      emailAutoReplyAuditLogWriteSchema()
    ) as unknown as EmailAutoReplyAuditLogEntity;
    const saved = await this.repository.save(stripped);
    return saved.id;
  }

  private applyFilters(
    qb: ReturnType<
      Repository<EmailAutoReplyAuditLogEntity>["createQueryBuilder"]
    >,
    input: AutoReplyAuditListInput
  ) {
    if (input.emailServiceId) {
      qb = qb.andWhere("log.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    }
    if (input.decisionStatus) {
      qb = qb.andWhere("log.decisionStatus = :decisionStatus", {
        decisionStatus: input.decisionStatus,
      });
    }
    if (input.classification) {
      qb = qb.andWhere("log.classification = :classification", {
        classification: input.classification,
      });
    }
    if (input.dateStart) {
      qb = qb.andWhere("log.createdAt >= :dateStart", {
        dateStart: input.dateStart,
      });
    }
    if (input.dateEnd) {
      qb = qb.andWhere("log.createdAt <= :dateEnd", { dateEnd: input.dateEnd });
    }
    if (input.senderSearch) {
      qb = qb.andWhere("log.metadataJson LIKE :senderSearch", {
        senderSearch: `%${input.senderSearch}%`,
      });
    }
    if (input.search) {
      qb = qb.andWhere(
        "(log.reason LIKE :search OR log.generatedSubject LIKE :search OR log.sentSubject LIKE :search OR log.errorMessage LIKE :search)",
        { search: `%${input.search}%` }
      );
    }
    return qb;
  }

  async list(
    input: AutoReplyAuditListInput
  ): Promise<EmailAutoReplyAuditLogEntity[]> {
    let qb = this.repository.createQueryBuilder("log");
    qb = this.applyFilters(qb, input);

    if (input.sortby?.key && input.sortby?.order) {
      const key = input.sortby.key.toLowerCase();
      const order = input.sortby.order.toLowerCase();
      const allowKeys = ["id", "createdat", "decisionstatus", "confidence"];
      const allowOrders = ["asc", "desc"];
      if (allowKeys.includes(key) && allowOrders.includes(order)) {
        qb = qb.orderBy(`log.${key}`, order.toUpperCase() as "ASC" | "DESC");
      } else {
        qb = qb.orderBy("log.createdAt", "DESC");
      }
    } else {
      qb = qb.orderBy("log.createdAt", "DESC");
    }
    qb = qb.skip(input.page).take(input.size);
    return await qb.getMany();
  }

  async count(input: AutoReplyAuditListInput): Promise<number> {
    let qb = this.repository.createQueryBuilder("log");
    qb = this.applyFilters(qb, input);
    return await qb.getCount();
  }

  async readWithRelations(
    id: number
  ): Promise<EmailAutoReplyAuditLogEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  // ---- Policy-evaluator send counters ----

  /** Count auto-replies sent for a service since the given UTC timestamp. */
  async countAutoSentSince(
    emailServiceId: number,
    sinceISO: string
  ): Promise<number> {
    return await this.repository.count({
      where: {
        emailServiceId,
        decisionStatus: "auto_sent",
        createdAt: MoreThan(new Date(sinceISO)),
      },
    });
  }

  /** Count auto-replies sent for a thread (by the message ids sharing its thread key). */
  async countAutoSentForMessageIds(
    emailServiceId: number,
    messageIds: number[]
  ): Promise<number> {
    if (messageIds.length === 0) return 0;
    return await this.repository.count({
      where: {
        emailServiceId,
        decisionStatus: "auto_sent",
        messageId: In(messageIds),
      },
    });
  }

  /** Most-recent auto-reply timestamp for a service (cooldown / quiet-hours use). */
  async lastAutoSentAt(emailServiceId: number): Promise<Date | null> {
    const row = await this.repository.findOne({
      where: { emailServiceId, decisionStatus: "auto_sent" },
      order: { createdAt: "DESC" },
    });
    return row?.createdAt ?? null;
  }
}
