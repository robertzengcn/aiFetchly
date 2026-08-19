import { BaseModule } from "@/modules/baseModule";
import { log } from "@/modules/Logger";
import {
  EmailReplyAuditLogModel,
  ReplyAuditLogListInput,
} from "@/model/EmailReplyAuditLog.model";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";

/** Business-logic facade over {@link EmailReplyAuditLogModel}. */
export class EmailReplyAuditLogModule extends BaseModule {
  private auditModel: EmailReplyAuditLogModel;

  constructor() {
    super();
    this.auditModel = new EmailReplyAuditLogModel(this.dbpath);
  }

  async create(entity: EmailReplyAuditLogEntity): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.auditModel.create(entity);
    } catch (error) {
      log.error("Error writing reply audit log:", error);
      throw error;
    }
  }

  async list(
    input: ReplyAuditLogListInput
  ): Promise<{ records: EmailReplyAuditLogEntity[]; total: number }> {
    try {
      await this.ensureConnection();
      const records = await this.auditModel.list(input);
      const total = await this.auditModel.count(input);
      return { records, total };
    } catch (error) {
      log.error("Error listing reply audit logs:", error);
      throw error;
    }
  }
}
