import { Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { EmailOrganizationAuditEntity } from "@/entity/EmailOrganizationAudit.entity";
import { emailOrganizationAuditWriteSchema } from "@/schemas/entity/emailOrganization";
import { parseAndStrip } from "@/utils/parseAndStrip";

/**
 * Append-only audit log for organization operations (technical design §6.2).
 * Identifiers and reason codes only — no bodies, credentials or full
 * recipient lists ever enter this table.
 */

export interface RecordAuditInput {
  readonly operationId?: string | null;
  readonly itemId?: number | null;
  readonly messageId?: number | null;
  readonly emailServiceId?: number | null;
  readonly actor?: "user" | "ai" | "system";
  readonly action: string;
  readonly status?: string | null;
  readonly reasonCode?: string | null;
  readonly detail?: Record<string, unknown>;
}

export class EmailOrganizationAuditModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  private get repository(): Repository<EmailOrganizationAuditEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationAuditEntity);
  }

  async record(input: RecordAuditInput): Promise<void> {
    const stripped = parseAndStrip(
      {
        operationId: input.operationId ?? null,
        itemId: input.itemId ?? null,
        messageId: input.messageId ?? null,
        emailServiceId: input.emailServiceId ?? null,
        actor: input.actor ?? "system",
        action: input.action,
        status: input.status ?? null,
        reasonCode: input.reasonCode ?? null,
        detailJson: input.detail ? JSON.stringify(input.detail) : null,
      },
      emailOrganizationAuditWriteSchema()
    ) as unknown as EmailOrganizationAuditEntity;
    await this.repository.save(this.repository.create(stripped));
  }

  async listByOperation(
    operationId: string,
    limit = 100
  ): Promise<EmailOrganizationAuditEntity[]> {
    return await this.repository
      .createQueryBuilder("audit")
      .where("audit.operationId = :operationId", { operationId })
      .orderBy("audit.id", "ASC")
      .take(limit)
      .getMany();
  }

  async listByMessage(
    messageId: number,
    limit = 50
  ): Promise<EmailOrganizationAuditEntity[]> {
    return await this.repository
      .createQueryBuilder("audit")
      .where("audit.messageId = :messageId", { messageId })
      .orderBy("audit.id", "DESC")
      .take(limit)
      .getMany();
  }
}
