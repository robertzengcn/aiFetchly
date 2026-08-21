import { SqliteDb } from "@/config/SqliteDb";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailConversationEntity } from "@/entity/EmailConversation.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";
import { In } from "typeorm";

/**
 * Retention / deletion consistency for the reply-reliability subsystem
 * (P4.4, security/privacy requirements, §26 checklist): when a mailbox is
 * deleted, ALL its conversation, message, draft, revision, approval,
 * send-attempt, and audit data is deleted in one transaction — nothing
 * belonging to another mailbox is touched, and no private body content
 * survives in audit metadata (whole rows go).
 *
 * Runs in the main process only (models/entities are main-process).
 */
export class EmailReplyRetentionService {
  /**
   * Purge every reply-reliability row scoped to one mailbox. Returns counts
   * for the audit trail. Throws on failure (the caller aborts the mailbox
   * deletion so data never ends up half-deleted).
   */
  async purgeMailboxData(
    emailServiceId: number,
    dbpath?: string
  ): Promise<{
    drafts: number;
    revisions: number;
    approvals: number;
    attempts: number;
    messages: number;
    conversations: number;
    auditRows: number;
  }> {
    // Prefer the caller's dbpath (a BaseModule passes this.dbpath, which
    // already resolved the Token store); fall back to resolving it here.
    const resolved =
      dbpath && dbpath.length > 0
        ? dbpath
        : new Token().getValue(USERSDBPATH);
    const connection = SqliteDb.getInstance(resolved).connection;

    return await connection.transaction(async (manager) => {
      const draftsRepo = manager.getRepository(EmailReplyDraftEntity);
      const revisionsRepo = manager.getRepository(
        EmailReplyDraftRevisionEntity
      );
      const approvalsRepo = manager.getRepository(EmailReplyApprovalEntity);
      const attemptsRepo = manager.getRepository(EmailReplySendAttemptEntity);
      const messagesRepo = manager.getRepository(EmailReceivedMessageEntity);
      const conversationsRepo = manager.getRepository(EmailConversationEntity);
      const auditRepo = manager.getRepository(EmailReplyAuditLogEntity);
      const autoAuditRepo = manager.getRepository(EmailAutoReplyAuditLogEntity);

      // 1. Drafts for this mailbox -> their revisions / approvals / attempts.
      const drafts = await draftsRepo.find({ where: { emailServiceId } });
      const draftIds = drafts.map((d) => d.id);

      let approvals = 0;
      let attempts = 0;
      let revisions = 0;
      if (draftIds.length > 0) {
        approvals = await approvalsRepo.count({
          where: { draftId: In(draftIds) },
        });
        await approvalsRepo.delete({ draftId: In(draftIds) });

        attempts = await attemptsRepo.count({
          where: { draftId: In(draftIds) },
        });
        await attemptsRepo.delete({ draftId: In(draftIds) });

        revisions = await revisionsRepo.count({
          where: { draftId: In(draftIds) },
        });
        await revisionsRepo.delete({ draftId: In(draftIds) });
      }
      await draftsRepo.delete({ emailServiceId });

      // 2. Received messages + conversations for this mailbox.
      const messages = await messagesRepo.count({ where: { emailServiceId } });
      await messagesRepo.delete({ emailServiceId });
      const conversations = await conversationsRepo.count({
        where: { emailServiceId },
      });
      await conversationsRepo.delete({ emailServiceId });

      // 3. Audit rows reference the mailbox id (whole rows go — no body
      //    content or previews are retained anywhere else).
      const auditRows = await auditRepo.count({ where: { emailServiceId } });
      await auditRepo.delete({ emailServiceId });
      const autoAuditRows = await autoAuditRepo.count({
        where: { emailServiceId },
      });
      await autoAuditRepo.delete({ emailServiceId });

      return {
        drafts: drafts.length,
        revisions,
        approvals,
        attempts,
        messages,
        conversations,
        auditRows: auditRows + autoAuditRows,
      };
    });
  }
}
