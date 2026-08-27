import { BaseModule } from "@/modules/baseModule";
import { log } from "@/modules/Logger";
import {
  EmailAutoReplyAuditLogModel,
  AutoReplyAuditListInput,
} from "@/model/EmailAutoReplyAuditLog.model";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";

/** Business-logic facade over {@link EmailAutoReplyAuditLogModel}. */
export class EmailAutoReplyAuditLogModule extends BaseModule {
  private auditModel: EmailAutoReplyAuditLogModel;

  constructor() {
    super();
    this.auditModel = new EmailAutoReplyAuditLogModel(this.dbpath);
  }

  async create(entity: EmailAutoReplyAuditLogEntity): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.auditModel.create(entity);
    } catch (error) {
      log.error("Error writing auto-reply audit log:", error);
      throw error;
    }
  }

  async list(
    input: AutoReplyAuditListInput
  ): Promise<{ records: EmailAutoReplyAuditLogEntity[]; total: number }> {
    try {
      await this.ensureConnection();
      const records = await this.auditModel.list(input);
      const total = await this.auditModel.count(input);
      return { records, total };
    } catch (error) {
      log.error("Error listing auto-reply audit logs:", error);
      throw error;
    }
  }

  async readWithRelations(
    id: number
  ): Promise<EmailAutoReplyAuditLogEntity | null> {
    try {
      await this.ensureConnection();
      return await this.auditModel.readWithRelations(id);
    } catch (error) {
      log.error("Error reading auto-reply audit log:", error);
      throw error;
    }
  }

  async countAutoSentSince(
    emailServiceId: number,
    sinceISO: string
  ): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.auditModel.countAutoSentSince(emailServiceId, sinceISO);
    } catch (error) {
      log.error("Error counting auto-sent replies:", error);
      throw error;
    }
  }

  async countAutoSentForMessageIds(
    emailServiceId: number,
    messageIds: number[]
  ): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.auditModel.countAutoSentForMessageIds(
        emailServiceId,
        messageIds
      );
    } catch (error) {
      log.error("Error counting thread auto-replies:", error);
      throw error;
    }
  }
}
