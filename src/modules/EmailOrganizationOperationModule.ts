import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import {
  EmailOrganizationOperationModel,
  type ClaimItemInput,
  type ClaimItemResult,
  type CreateOperationInput,
  type CreateOperationResult,
  type FinalizeItemInput,
} from "@/model/EmailOrganizationOperation.model";
import { EmailOrganizationAuditModel, type RecordAuditInput } from "@/model/EmailOrganizationAudit.model";
import { EmailOrganizationOperationEntity } from "@/entity/EmailOrganizationOperation.entity";
import { EmailOrganizationOperationItemEntity } from "@/entity/EmailOrganizationOperationItem.entity";
import { EmailOrganizationAttemptEntity } from "@/entity/EmailOrganizationAttempt.entity";

/**
 * Business facade for organization operations. IPC handlers and services
 * call this module; database access stays in the model layer.
 */
export class EmailOrganizationOperationModule extends BaseModule {
  private operationModel: EmailOrganizationOperationModel;
  private auditModel: EmailOrganizationAuditModel;

  constructor() {
    super();
    this.operationModel = new EmailOrganizationOperationModel(this.dbpath);
    this.auditModel = new EmailOrganizationAuditModel(this.dbpath);
  }

  async createOperation(input: CreateOperationInput): Promise<CreateOperationResult> {
    try {
      await this.ensureConnection();
      return await this.operationModel.createOperation(input);
    } catch (error) {
      log.error("Error creating organization operation:", error);
      throw error;
    }
  }

  async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<EmailOrganizationOperationEntity | null> {
    try {
      await this.ensureConnection();
      return await this.operationModel.findByIdempotencyKey(idempotencyKey);
    } catch (error) {
      log.error("Error finding operation by idempotency key:", error);
      throw error;
    }
  }

  async readOperation(operationId: string): Promise<EmailOrganizationOperationEntity | null> {
    try {
      await this.ensureConnection();
      return await this.operationModel.read(operationId);
    } catch (error) {
      log.error("Error reading organization operation:", error);
      throw error;
    }
  }

  async listItems(operationId: string): Promise<EmailOrganizationOperationItemEntity[]> {
    try {
      await this.ensureConnection();
      return await this.operationModel.listItems(operationId);
    } catch (error) {
      log.error("Error listing organization operation items:", error);
      throw error;
    }
  }

  async claimItem(input: ClaimItemInput): Promise<ClaimItemResult> {
    try {
      await this.ensureConnection();
      return await this.operationModel.claimItem(input);
    } catch (error) {
      log.error("Error claiming organization operation item:", error);
      throw error;
    }
  }

  async finalizeItem(input: FinalizeItemInput): Promise<void> {
    try {
      await this.ensureConnection();
      return await this.operationModel.finalizeItem(input);
    } catch (error) {
      log.error("Error finalizing organization operation item:", error);
      throw error;
    }
  }

  async listAttemptsForItem(itemId: number): Promise<EmailOrganizationAttemptEntity[]> {
    try {
      await this.ensureConnection();
      return await this.operationModel.listAttemptsForItem(itemId);
    } catch (error) {
      log.error("Error listing attempts:", error);
      throw error;
    }
  }

  async recordAttemptEvidence(attemptId: number, resultJson: string): Promise<void> {
    try {
      await this.ensureConnection();
      return await this.operationModel.recordAttemptEvidence(attemptId, resultJson);
    } catch (error) {
      log.error("Error recording attempt evidence:", error);
      throw error;
    }
  }

  async markAttemptDispatched(attemptId: number): Promise<void> {
    try {
      await this.ensureConnection();
      return await this.operationModel.markAttemptDispatched(attemptId);
    } catch (error) {
      log.error("Error marking attempt dispatched:", error);
      throw error;
    }
  }

  async cancelPending(operationId: string): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.operationModel.cancelPending(operationId);
    } catch (error) {
      log.error("Error cancelling organization operation:", error);
      throw error;
    }
  }

  async findExpiredClaims(now: Date): Promise<
    Array<{ attempt: EmailOrganizationAttemptEntity; item: EmailOrganizationOperationItemEntity }>
  > {
    try {
      await this.ensureConnection();
      return await this.operationModel.findExpiredClaims(now);
    } catch (error) {
      log.error("Error finding expired claims:", error);
      throw error;
    }
  }

  async recordAudit(input: RecordAuditInput): Promise<void> {
    try {
      await this.ensureConnection();
      return await this.auditModel.record(input);
    } catch (error) {
      log.error("Error recording organization audit:", error);
      throw error;
    }
  }
}
