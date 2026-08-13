import { BaseModule } from "@/modules/baseModule";
import {
  EmailReplyDraftModel,
  ReplyDraftListInput,
  AppendRevisionInput,
  ClaimSendInput,
  ClaimSendResult,
  FinalizeOutcomeInput,
} from "@/model/EmailReplyDraft.model";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { EmailReplyDraftStatus } from "@/entityTypes/emailReceiveTypes";

/** Business-logic facade over {@link EmailReplyDraftModel}. */
export class EmailReplyDraftModule extends BaseModule {
  private draftModel: EmailReplyDraftModel;

  constructor() {
    super();
    this.draftModel = new EmailReplyDraftModel(this.dbpath);
  }

  async create(entity: EmailReplyDraftEntity): Promise<EmailReplyDraftEntity> {
    try {
      await this.ensureConnection();
      return await this.draftModel.create(entity);
    } catch (error) {
      console.error("Error creating reply draft:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailReplyDraftEntity | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.read(id);
    } catch (error) {
      console.error("Error reading reply draft:", error);
      throw error;
    }
  }

  async updateStatus(
    id: number,
    status: EmailReplyDraftStatus,
    error: string | null = null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.updateStatus(id, status, error);
    } catch (e) {
      console.error("Error updating draft status:", e);
      throw e;
    }
  }

  async updateBody(
    id: number,
    bodyText: string,
    bodyHtml: string | null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.updateBody(id, bodyText, bodyHtml);
    } catch (e) {
      console.error("Error updating draft body:", e);
      throw e;
    }
  }

  async markSent(id: number, sentAt: Date): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.markSent(id, sentAt);
    } catch (e) {
      console.error("Error marking draft sent:", e);
      throw e;
    }
  }

  async listByMessage(messageId: number): Promise<EmailReplyDraftEntity[]> {
    try {
      await this.ensureConnection();
      return await this.draftModel.listByMessage(messageId);
    } catch (error) {
      console.error("Error listing drafts by message:", error);
      throw error;
    }
  }

  async list(
    input: ReplyDraftListInput
  ): Promise<{ records: EmailReplyDraftEntity[]; total: number }> {
    try {
      await this.ensureConnection();
      const records = await this.draftModel.list(input);
      const total = await this.draftModel.count(input);
      return { records, total };
    } catch (error) {
      console.error("Error listing reply drafts:", error);
      throw error;
    }
  }

  // ---- Reliability extension (Milestone 1) ----

  async readAggregate(id: number): Promise<EmailReplyDraftEntity | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.readAggregate(id);
    } catch (error) {
      console.error("Error reading reply draft aggregate:", error);
      throw error;
    }
  }

  async applyContentHash(
    draftId: number,
    revisionId: number,
    contentHash: string
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.applyContentHash(draftId, revisionId, contentHash);
    } catch (error) {
      console.error("Error applying reply draft content hash:", error);
      throw error;
    }
  }

  async markApproved(
    draftId: number,
    revisionId: number,
    approvedHash: string,
    policyVersion: string,
    at: Date
  ): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.draftModel.markApproved(
        draftId,
        revisionId,
        approvedHash,
        policyVersion,
        at
      );
    } catch (error) {
      console.error("Error marking reply draft approved:", error);
      throw error;
    }
  }

  async appendRevision(input: AppendRevisionInput): Promise<{
    revision: EmailReplyDraftRevisionEntity;
    invalidatedApprovals: number;
  }> {
    try {
      await this.ensureConnection();
      return await this.draftModel.appendRevision(input);
    } catch (error) {
      console.error("Error appending reply draft revision:", error);
      throw error;
    }
  }

  async claimApprovedRevisionForSend(
    input: ClaimSendInput
  ): Promise<ClaimSendResult> {
    try {
      await this.ensureConnection();
      return await this.draftModel.claimApprovedRevisionForSend(input);
    } catch (error) {
      console.error("Error claiming reply draft for send:", error);
      throw error;
    }
  }

  async finalizeSendOutcome(input: FinalizeOutcomeInput): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.finalizeSendOutcome(input);
    } catch (error) {
      console.error("Error finalizing reply send outcome:", error);
      throw error;
    }
  }

  async countActiveSendAttempts(draftId: number): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.draftModel.countActiveSendAttempts(draftId);
    } catch (error) {
      console.error("Error counting active reply send attempts:", error);
      throw error;
    }
  }

  async listLegacyDrafts(): Promise<EmailReplyDraftEntity[]> {
    try {
      await this.ensureConnection();
      return await this.draftModel.listLegacyDrafts();
    } catch (error) {
      console.error("Error listing legacy reply drafts:", error);
      throw error;
    }
  }

  async materializeRevision1ForLegacyDraft(input: {
    draftId: number;
    actor: "ai" | "user";
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    senderAddress: string;
    recipientAddress: string;
    contentHash: string;
    emailServiceId: number | null;
  }): Promise<{ revisionId: number; status: EmailReplyDraftStatus } | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.materializeRevision1ForLegacyDraft(input);
    } catch (error) {
      console.error("Error materializing revision 1 for legacy draft:", error);
      throw error;
    }
  }

  async reconcileDelivery(input: {
    attemptId: number;
    draftId: number;
    messageId: number;
    emailServiceId: number;
    action: "confirm_sent" | "confirm_not_sent" | "leave_unresolved";
    evidence?: string | null;
    providerMessageId?: string | null;
  }): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.reconcileDelivery(input);
    } catch (error) {
      console.error("Error reconciling reply delivery:", error);
      throw error;
    }
  }
}
