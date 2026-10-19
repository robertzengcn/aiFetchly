import { BaseModule } from "@/modules/baseModule";
import { log } from "@/modules/Logger";
import {
  EmailReplyDraftModel,
  ReplyDraftListInput,
  AppendRevisionInput,
  ClaimSendInput,
  ClaimSendResult,
  FinalizeOutcomeInput,
  CommitGeneratedDraftInput,
  CommitGeneratedDraftResult,
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
      log.error("Error creating reply draft:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailReplyDraftEntity | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.read(id);
    } catch (error) {
      log.error("Error reading reply draft:", error);
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
      log.error("Error updating draft status:", e);
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
      log.error("Error updating draft body:", e);
      throw e;
    }
  }

  async markSent(id: number, sentAt: Date): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.markSent(id, sentAt);
    } catch (e) {
      log.error("Error marking draft sent:", e);
      throw e;
    }
  }

  async listByMessage(messageId: number): Promise<EmailReplyDraftEntity[]> {
    try {
      await this.ensureConnection();
      return await this.draftModel.listByMessage(messageId);
    } catch (error) {
      log.error("Error listing drafts by message:", error);
      throw error;
    }
  }

  /** Batched {@link listByMessage} for a cluster of message ids (one query). */
  async listByMessageIds(
    messageIds: number[]
  ): Promise<EmailReplyDraftEntity[]> {
    try {
      await this.ensureConnection();
      return await this.draftModel.listByMessageIds(messageIds);
    } catch (error) {
      console.error("Error listing drafts by message ids:", error);
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
      log.error("Error listing reply drafts:", error);
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
    policyVersion: string
  ): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.draftModel.markApproved(
        draftId,
        revisionId,
        approvedHash,
        policyVersion
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

  /**
   * N04: coherent final-admission snapshot (attempt ownership + seed row +
   * canonical cluster in one short transaction) for the pre-SMTP gate and
   * fence. Read-only; freshness is enforced synchronously by the caller.
   */
  async readFinalSendAdmission(input: {
    attemptId: number;
    messageId: number;
  }): Promise<{
    readonly attempt: import("@/entity/EmailReplySendAttempt.entity").EmailReplySendAttemptEntity | null;
    readonly seedMessage: import("@/entity/EmailReceivedMessage.entity").EmailReceivedMessageEntity | null;
    readonly clusterRows: import("@/entity/EmailReceivedMessage.entity").EmailReceivedMessageEntity[] | null;
  }> {
    try {
      await this.ensureConnection();
      return await this.draftModel.readFinalSendAdmission(input);
    } catch (error) {
      console.error("Error reading final send admission:", error);
      throw error;
    }
  }

  /**
   * Atomic generation commit (Step 4, T07): persists draft + revision +
   * content hash + message replyStatus + guard transition + audit in ONE
   * transaction. Delegates to {@link EmailReplyDraftModel.commitGeneratedDraft}.
   */
  async commitGeneratedDraft(
    input: CommitGeneratedDraftInput
  ): Promise<CommitGeneratedDraftResult> {
    try {
      await this.ensureConnection();
      return await this.draftModel.commitGeneratedDraft(input);
    } catch (error) {
      console.error("Error committing generated reply draft:", error);
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

  async invalidateUnsentDraftsForMailbox(
    emailServiceId: number,
    reason: string
  ): Promise<number> {
    try {
      await this.ensureConnection();
      return await this.draftModel.invalidateUnsentDraftsForMailbox(
        emailServiceId,
        reason
      );
    } catch (error) {
      console.error("Error invalidating unsent drafts for mailbox:", error);
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
    /** T08/FR-036: guard row bound to this attempt (null = legacy data). */
    guardId?: number | null;
    /** R20: per-invocation id (operator reconcile); omitted on background sweep. */
    requestCorrelationId?: string;
  }): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.reconcileDelivery(input);
    } catch (error) {
      console.error("Error reconciling reply delivery:", error);
      throw error;
    }
  }

  /**
   * R13: fenced `failed -> draft` reopen for an explicitly re-approved
   * definitely-rejected draft. Thin wrapper over the model method (the
   * cluster fence + conditional UPDATE live in the model transaction). The
   * approval service calls this BEFORE its normal approval path when the
   * draft is `failed`.
   */
  async reopenFailedDraftForRetry(input: {
    draftId: number;
    messageId: number;
    emailServiceId: number;
  }): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.reopenFailedDraftForRetry(input);
    } catch (error) {
      console.error("Error reopening failed draft for retry:", error);
      throw error;
    }
  }

  /**
   * G02: explicit human-review resolution. Thin wrapper over the model
   * transaction (revision-bound stamp + audit). Called ONLY by the renderer
   * IPC handler (user gesture) — never by AI tools.
   */
  async resolveHumanReview(input: {
    draftId: number;
    revisionId: number;
    resolvedBy: string;
    note?: string | null;
  }): Promise<{ resolved: boolean; reason?: string }> {
    try {
      await this.ensureConnection();
      return await this.draftModel.resolveHumanReview(input);
    } catch (error) {
      console.error("Error resolving human review:", error);
      throw error;
    }
  }
}
