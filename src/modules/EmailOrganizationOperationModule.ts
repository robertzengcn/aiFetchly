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

  async findItemById(itemId: number): Promise<EmailOrganizationOperationItemEntity | null> {
    try {
      await this.ensureConnection();
      return await this.operationModel.findItemById(itemId);
    } catch (error) {
      log.error("Error finding organization operation item:", error);
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

  async findSucceededTrashDestinations(
    messageIds: readonly number[]
  ): Promise<
    Record<
      number,
      {
        folder: string;
        trashFolder: string | null;
        destinationUid: string | null;
        destinationUidValidity: string | null;
        resultingVersion: number;
        originOperationId: string;
      }
    >
  > {
    try {
      await this.ensureConnection();
      return await this.operationModel.findSucceededTrashDestinations(messageIds);
    } catch (error) {
      log.error("Error finding succeeded trash destinations:", error);
      throw error;
    }
  }

  /** R7-01/R8-01: the account-wide restorable Trash operation IDS. */
  async findRestorableTrashOperationIds(emailServiceId: number): Promise<string[]> {
    try {
      await this.ensureConnection();
      return await this.operationModel.findRestorableTrashOperationIds(emailServiceId);
    } catch (error) {
      log.error("Error finding restorable trash operation ids:", error);
      throw error;
    }
  }

  /** R6-03: reply-gate fallback marker query (design §10.4). */
  async hasUnresolvedInvalidationPendingItem(messageId: number): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.operationModel.hasUnresolvedInvalidationPendingItem(messageId);
    } catch (error) {
      log.error("Error checking invalidation-pending item:", error);
      // Fail closed: an unreadable marker state must not let a reply send
      // past the §10.4 gate.
      return true;
    }
  }

  async findMovedAwayOccurrence(input: {
    readonly emailServiceId: number;
    readonly folderPath: string;
    readonly uidValidity: string;
    readonly providerUid: string;
  }): Promise<{ messageId: number; operationId: string } | null> {
    try {
      await this.ensureConnection();
      return await this.operationModel.findMovedAwayOccurrence(input);
    } catch (error) {
      log.error("Error finding moved-away occurrence:", error);
      throw error;
    }
  }

  async findOpenOperationForMessage(
    messageId: number
  ): Promise<EmailOrganizationOperationEntity | null> {
    try {
      await this.ensureConnection();
      return await this.operationModel.findOpenOperationForMessage(messageId);
    } catch (error) {
      log.error("Error finding open operation for message:", error);
      throw error;
    }
  }

  async findNonTerminalOperations(): Promise<EmailOrganizationOperationEntity[]> {
    try {
      await this.ensureConnection();
      return await this.operationModel.findNonTerminalOperations();
    } catch (error) {
      log.error("Error finding non-terminal operations:", error);
      throw error;
    }
  }

  async aggregateDiagnostics(): Promise<
    Array<{ kind: string; status: string; count: number }>
  > {
    try {
      await this.ensureConnection();
      return await this.operationModel.aggregateDiagnostics();
    } catch (error) {
      log.error("Error aggregating organization diagnostics:", error);
      throw error;
    }
  }

  async listRecentOperations(input: {
    readonly emailServiceId?: number | null;
    readonly messageId?: number | null;
    readonly limit?: number;
  }): Promise<EmailOrganizationOperationEntity[]> {
    try {
      await this.ensureConnection();
      return await this.operationModel.listRecentOperations(input);
    } catch (error) {
      log.error("Error listing recent operations:", error);
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
