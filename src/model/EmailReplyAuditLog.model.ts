import { BaseDb } from "@/model/Basedb";
import { log } from "@/modules/Logger";
import { Repository } from "typeorm";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { SortBy } from "@/entityTypes/commonType";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyAuditLogWriteSchema } from "@/schemas/entity/emailReplyAuditLog";
import { runWithSqliteBusyRetry } from "@/utils/sqliteBusyRetry";

export interface ReplyAuditLogListInput {
  emailServiceId?: number;
  messageId?: number;
  page: number;
  size: number;
  where?: string;
  sortby?: SortBy;
}

export class EmailReplyAuditLogModel extends BaseDb {
  private repository: Repository<EmailReplyAuditLogEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReplyAuditLogEntity
    );
  }

  async create(entity: EmailReplyAuditLogEntity): Promise<number> {
    const stripped = parseAndStrip(
      entity,
      emailReplyAuditLogWriteSchema()
    ) as unknown as EmailReplyAuditLogEntity;
    const saved = await runWithSqliteBusyRetry(
      () => this.repository.save(stripped),
      {
        maxAttempts: 2,
        delayMs: 250,
        onRetry: (nextAttempt, maxAttempts, delayMs, error) => {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(
            `Reply audit log write hit a SQLite lock; retrying attempt ${nextAttempt}/${maxAttempts} in ${delayMs}ms: ${message}`
          );
        },
      }
    );
    return saved.id;
  }

  async list(
    input: ReplyAuditLogListInput
  ): Promise<EmailReplyAuditLogEntity[]> {
    let qb = this.repository.createQueryBuilder("log");
    if (input.emailServiceId) {
      qb = qb.where("log.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    }
    if (input.messageId) {
      qb = qb.andWhere("log.messageId = :messageId", {
        messageId: input.messageId,
      });
    }
    if (input.where) {
      qb = qb.andWhere("(log.reason LIKE :search OR log.action LIKE :search)", {
        search: `%${input.where}%`,
      });
    }
    if (input.sortby?.key && input.sortby?.order) {
      const key = input.sortby.key.toLowerCase();
      const order = input.sortby.order.toLowerCase();
      const allowKeys = ["id", "createdat", "action"];
      const allowOrders = ["asc", "desc"];
      if (allowKeys.includes(key) && allowOrders.includes(order)) {
        qb = qb.orderBy(`log.${key}`, order.toUpperCase() as "ASC" | "DESC");
      } else {
        qb = qb.orderBy("log.id", "DESC");
      }
    } else {
      qb = qb.orderBy("log.id", "DESC");
    }
    qb = qb.skip(input.page).take(input.size);
    return await qb.getMany();
  }

  async count(input: ReplyAuditLogListInput): Promise<number> {
    let qb = this.repository.createQueryBuilder("log");
    if (input.emailServiceId) {
      qb = qb.where("log.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    }
    if (input.messageId) {
      qb = qb.andWhere("log.messageId = :messageId", {
        messageId: input.messageId,
      });
    }
    if (input.where) {
      qb = qb.andWhere("(log.reason LIKE :search OR log.action LIKE :search)", {
        search: `%${input.where}%`,
      });
    }
    return await qb.getCount();
  }
}
