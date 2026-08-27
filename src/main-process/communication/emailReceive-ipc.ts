import { log } from "@/modules/Logger";
import {
  registerValidatedHandler,
  registerAiValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  EMAIL_RECEIVE_SYNC,
  EMAIL_RECEIVE_CONNECTION_TEST,
  EMAIL_RECEIVE_MESSAGE_LIST,
  EMAIL_RECEIVE_MESSAGE_DETAIL,
  EMAIL_REPLY_MARK_PROCESSED,
  EMAIL_REPLY_IDENTITY_GET,
  EMAIL_REPLY_IDENTITY_UPDATE,
  EMAIL_REPLY_DRAFT_CREATE,
  EMAIL_REPLY_DRAFT_DETAIL,
  EMAIL_REPLY_DRAFT_UPDATE,
  EMAIL_REPLY_SEND,
  EMAIL_REPLY_DRAFT_APPROVE,
  EMAIL_REPLY_SEND_ATTEMPT_DETAIL,
  EMAIL_REPLY_DELIVERY_RECONCILE,
  EMAIL_REPLY_KNOWLEDGE_SCOPE_GET,
  EMAIL_REPLY_KNOWLEDGE_SCOPE_UPDATE,
  EMAIL_AUTO_REPLY_AUDIT_LIST,
  EMAIL_AUTO_REPLY_AUDIT_DETAIL,
} from "@/config/channellist";
import {
  emailReceiveSyncInputSchema,
  emailReceiveConnectionTestInputSchema,
  emailReceiveMessageListInputSchema,
  emailReceiveMessageDetailInputSchema,
  emailReplyMarkProcessedInputSchema,
} from "@/schemas/ipc/emailReceive";
import {
  emailReplyIdentityGetInputSchema,
  emailReplyIdentityUpdateInputSchema,
  emailReplyDraftCreateInputSchema,
  emailReplyDraftDetailInputSchema,
  emailReplyDraftUpdateInputSchema,
  emailReplySendInputSchema,
  emailReplyDraftApproveInputSchema,
  emailReplySendAttemptDetailInputSchema,
  emailReplyDeliveryReconcileInputSchema,
  emailReplyKnowledgeScopeGetInputSchema,
  emailReplyKnowledgeScopeUpdateInputSchema,
  emailAutoReplyAuditListInputSchema,
  emailAutoReplyAuditDetailInputSchema,
} from "@/schemas/ipc/emailReply";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import { EmailReplyDraftGenerationService } from "@/service/emailReply/EmailReplyDraftGenerationService";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { isEmailReplyKillSwitchOn } from "@/config/featureFlags";
import { EmailReplyIdentityProfileModule } from "@/modules/EmailReplyIdentityProfileModule";
import { EmailAutoReplyAuditLogModule } from "@/modules/EmailAutoReplyAuditLogModule";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyIdentityProfileEntity } from "@/entity/EmailReplyIdentityProfile.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import {
  ReceivedMessageListDto,
  ReceivedMessageDetailDto,
  ReplyIdentityProfileDto,
  AutoReplyAuditDto,
} from "@/entityTypes/emailReceiveTypes";
import {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";
import { decodeAddresses } from "@/service/emailReceive/EmailMessageParser";

/**
 * Register IPC handlers for inbound email receive, processing state, reply
 * identity profile, and the AI auto-reply audit UI.
 *
 * All handlers call modules — never repositories. Plain receive/sync/identity
 * handlers are NOT AI-gated. AI-gated draft generation lives in Phase 3
 * (`EMAIL_REPLY_DRAFT_CREATE`) and uses `registerAiValidatedHandler`.
 */
export function registerEmailReceiveIpcHandlers(): void {
  // ---- Manual receive sync (not AI-gated) ----
  registerValidatedHandler(
    EMAIL_RECEIVE_SYNC,
    emailReceiveSyncInputSchema,
    async (input) => {
      const syncService = new EmailReceiveSyncService();
      const result = await syncService.syncUnread(input.emailServiceId, {
        limit: input.limit,
        unreadOnly: input.unreadOnly,
        since: input.since ? new Date(input.since) : undefined,
      });
      return result;
    }
  );

  // ---- Receive connection test ----
  registerValidatedHandler(
    EMAIL_RECEIVE_CONNECTION_TEST,
    emailReceiveConnectionTestInputSchema,
    async (input) => {
      const syncService = new EmailReceiveSyncService();
      return await syncService.testConnection(
        input.emailServiceId,
        input.settings
      );
    }
  );

  // ---- Received message list (sanitized, no bodies) ----
  registerValidatedHandler(
    EMAIL_RECEIVE_MESSAGE_LIST,
    emailReceiveMessageListInputSchema,
    async (input) => {
      const module = new EmailReceivedMessageModule();
      const { records, total } = await module.listByEmailService({
        emailServiceId: input.emailServiceId,
        page: input.page ?? 0,
        size: input.size ?? 50,
        where: input.where ?? input.search,
        sortby: input.sortby,
        unreadOnly: input.unreadOnly,
        replyStatus: input.replyStatus as EmailReplyStatus | undefined,
        classification: input.classification as
          | EmailMessageClassification
          | undefined,
      });
      return {
        records: records.map(toMessageListDto),
        num: total,
      };
    }
  );

  // ---- Received message detail (sanitized body) ----
  registerValidatedHandler(
    EMAIL_RECEIVE_MESSAGE_DETAIL,
    emailReceiveMessageDetailInputSchema,
    async (input) => {
      const module = new EmailReceivedMessageModule();
      const msg = await module.read(input.id);
      if (!msg) throw new Error("emailreceive.message_not_found");
      // Mark read on open unless caller asked not to.
      if (input.includeBody !== false) {
        await module.markRead(input.id, false);
      }
      return toMessageDetailDto(msg);
    }
  );

  // ---- Mark processed / skipped / blocked / failed ----
  registerValidatedHandler(
    EMAIL_REPLY_MARK_PROCESSED,
    emailReplyMarkProcessedInputSchema,
    async (input) => {
      const messageModule = new EmailReceivedMessageModule();
      const msg = await messageModule.read(input.messageId);
      if (!msg) throw new Error("emailreceive.message_not_found");

      const statusMap: Record<string, EmailReplyStatus> = {
        skipped: "skipped",
        blocked: "blocked",
        failed: "failed",
        needs_human_review: "not_started", // keeps draft/sent state intact; flagged via audit
      };
      const status = statusMap[input.status] ?? "not_started";
      await messageModule.updateReplyStatus(
        input.messageId,
        status,
        new Date()
      );

      // Audit log (no body content).
      const auditModule = new EmailReplyAuditLogModule();
      const log = new EmailReplyAuditLogEntity();
      log.emailServiceId = msg.emailServiceId;
      log.messageId = msg.id;
      log.action = input.status === "failed" ? "send_failed" : "reply_skipped";
      log.actor = "user";
      log.reason = input.reason ?? input.status;
      await auditModule.create(log);

      return { messageId: input.messageId, status: input.status };
    }
  );

  // ---- Reply identity profile get ----
  registerValidatedHandler(
    EMAIL_REPLY_IDENTITY_GET,
    emailReplyIdentityGetInputSchema,
    async (input) => {
      const module = new EmailReplyIdentityProfileModule();
      const profile = await module.getByEmailServiceId(input.emailServiceId);
      // Fall back to the service's sender name when no profile is configured.
      if (!profile) {
        const serviceModule = new EmailServiceModule();
        const service = await serviceModule.getEmailService(
          input.emailServiceId
        );
        return {
          id: 0,
          emailServiceId: input.emailServiceId,
          ownerName: service?.name ?? "",
          ownerRole: null,
          companyName: null,
          preferredTone: "professional",
          signature: null,
          styleNotes: null,
          forbiddenPhrases: [],
          discloseAutomation: false,
        } satisfies ReplyIdentityProfileDto;
      }
      return toIdentityProfileDto(profile);
    }
  );

  // ---- Reply identity profile update ----
  registerValidatedHandler(
    EMAIL_REPLY_IDENTITY_UPDATE,
    emailReplyIdentityUpdateInputSchema,
    async (input) => {
      const module = new EmailReplyIdentityProfileModule();
      const entity = new EmailReplyIdentityProfileEntity();
      entity.emailServiceId = input.emailServiceId;
      entity.ownerName = input.ownerName;
      entity.ownerRole = input.ownerRole ?? null;
      entity.companyName = input.companyName ?? null;
      entity.preferredTone = input.preferredTone ?? null;
      entity.signature = input.signature ?? null;
      entity.styleNotes = input.styleNotes ?? null;
      entity.forbiddenPhrasesJson = JSON.stringify(
        input.forbiddenPhrases ?? []
      );
      entity.discloseAutomation = input.discloseAutomation ?? 0;
      const saved = await module.upsertForEmailService(entity);
      // FR-013: changing the identity invalidates every not-yet-sent draft for
      // the mailbox (they were written in the old voice; re-review required).
      try {
        await new EmailReplyDraftModule().invalidateUnsentDraftsForMailbox(
          input.emailServiceId,
          "Identity profile changed"
        );
      } catch (e) {
        console.error("Failed to invalidate drafts after identity change:", e);
      }
      return toIdentityProfileDto(saved);
    }
  );

  // ---- AI auto-reply audit list ----
  registerValidatedHandler(
    EMAIL_AUTO_REPLY_AUDIT_LIST,
    emailAutoReplyAuditListInputSchema,
    async (input) => {
      const module = new EmailAutoReplyAuditLogModule();
      const { records, total } = await module.list({
        emailServiceId: input.emailServiceId,
        decisionStatus: input.decisionStatus as never,
        classification: input.classification as
          | EmailMessageClassification
          | undefined,
        senderSearch: input.senderSearch,
        dateStart: input.dateStart,
        dateEnd: input.dateEnd,
        search: input.search,
        page: input.page ?? 0,
        size: input.size ?? 50,
        sortby: input.sortby,
      });
      return {
        records: records.map(toAutoReplyAuditDto),
        num: total,
      };
    }
  );

  // ---- AI auto-reply audit detail ----
  registerValidatedHandler(
    EMAIL_AUTO_REPLY_AUDIT_DETAIL,
    emailAutoReplyAuditDetailInputSchema,
    async (input) => {
      const module = new EmailAutoReplyAuditLogModule();
      const row = await module.readWithRelations(input.id);
      if (!row) throw new Error("emailreceive.audit_not_found");
      return toAutoReplyAuditDto(row);
    }
  );

  // ---- AI draft generation (AI-gated at the boundary) ----
  registerAiValidatedHandler(
    EMAIL_REPLY_DRAFT_CREATE,
    emailReplyDraftCreateInputSchema,
    async (input) => {
      // Kill switch (P0.1): block draft generation. The AI gate already ran
      // before this handler body; the kill switch is an independent emergency
      // shutoff that leaves viewing/audit/recovery available.
      if (isEmailReplyKillSwitchOn()) {
        throw new Error(
          "Reply drafting is temporarily disabled by the kill switch"
        );
      }
      const genService = new EmailReplyDraftGenerationService();
      const result = await genService.createDraft(input);
      if (!result.success) {
        // Surface the failure reason via the standard envelope.
        throw new Error(result.error);
      }
      const { success: _ignored, ...dto } = result;
      return dto;
    }
  );

  // ---- Reply draft detail ----
  registerValidatedHandler(
    EMAIL_REPLY_DRAFT_DETAIL,
    emailReplyDraftDetailInputSchema,
    async (input) => {
      const module = new EmailReplyDraftModule();
      const draft = await module.read(input.id);
      if (!draft) throw new Error("emailreceive.draft_not_found");
      return {
        id: draft.id,
        messageId: draft.messageId,
        emailServiceId: draft.emailServiceId,
        subject: draft.subject,
        bodyText: draft.bodyText,
        bodyHtml: draft.bodyHtml,
        status: draft.status,
        generationSource: draft.generationSource,
        confidence: draft.confidence,
        knowledgeSourcesJson: draft.knowledgeSourcesJson,
        warningsJson: draft.warningsJson,
        sentAt: draft.sentAt ? new Date(draft.sentAt).toISOString() : null,
        sendError: draft.sendError,
        createdAt: draft.createdAt
          ? new Date(draft.createdAt).toISOString()
          : "",
      };
    }
  );

  // ---- Reply draft body edit (user reviews/edits an AI draft) ----
  registerValidatedHandler(
    EMAIL_REPLY_DRAFT_UPDATE,
    emailReplyDraftUpdateInputSchema,
    async (input) => {
      const module = new EmailReplyDraftModule();
      const existing = await module.read(input.id);
      if (!existing) throw new Error("emailreceive.draft_not_found");

      // Reliability: route the edit through materializeRevision1 so it appends
      // an immutable revision (subject + body), invalidates any active approval
      // (FR-014), and recomputes the canonical hash. Legacy drafts without a v2
      // envelope identity fall back to the mutable updateBody path until backfill
      // materializes their revision 1.
      const canV2 =
        !!existing.senderAddress &&
        !!existing.recipientAddress &&
        existing.emailServiceId != null;
      if (canV2) {
        const { materializeRevision1 } = await import(
          "@/service/emailReply/EmailReplyRevisionMaterializer"
        );
        await materializeRevision1(module, {
          draftId: input.id,
          actor: "user",
          subject: input.subject,
          bodyText: input.bodyText,
          bodyHtml: input.bodyHtml ?? null,
          senderAddress: existing.senderAddress as string,
          recipientAddress: existing.recipientAddress as string,
          emailServiceId: existing.emailServiceId as number,
          originalMessageId: existing.messageId,
        });
      } else {
        await module.updateBody(
          input.id,
          input.bodyText,
          input.bodyHtml ?? null
        );
      }

      // Best-effort audit of the human edit.
      try {
        const audit = new EmailReplyAuditLogEntity();
        audit.emailServiceId = existing.emailServiceId ?? 0;
        audit.messageId = existing.messageId;
        audit.draftId = existing.id;
        audit.action = "draft_edited";
        audit.actor = "user";
        audit.reason = "User edited reply draft";
        await new EmailReplyAuditLogModule().create(audit);
      } catch (e) {
        log.error("Failed to write draft_edited audit:", e);
      }
      return { id: input.id };
    }
  );

  // ---- Confirmed reply send (UI Send button) ----
  // The reliable send path is authoritative (P0.1): every send requires a valid
  // approval token and goes through the idempotent delivery service. There is no
  // legacy branch and no mailbox override. The kill switch refuses new claims.
  registerValidatedHandler(
    EMAIL_REPLY_SEND,
    emailReplySendInputSchema,
    async (input) => {
      if (isEmailReplyKillSwitchOn()) {
        throw new Error(
          "Reply sending is temporarily disabled by the kill switch"
        );
      }
      if (!input.approvalToken) {
        throw new Error(
          "Approve the draft before sending (EMAIL_REPLY_DRAFT_APPROVE issues the one-time token)"
        );
      }
      const { EmailReplyDeliveryService } = await import(
        "@/service/emailReply/EmailReplyDeliveryService"
      );
      return await new EmailReplyDeliveryService().sendApprovedReply({
        draftId: input.draftId,
        approvalToken: input.approvalToken,
      });
    }
  );

  // ---- Approve the current revision of a draft (reliability v2) ----
  // Returns the one-time approval token ONCE. The renderer passes it straight
  // back to EMAIL_REPLY_SEND; it is never persisted in the clear and never
  // surfaced to the LLM transcript.
  registerValidatedHandler(
    EMAIL_REPLY_DRAFT_APPROVE,
    emailReplyDraftApproveInputSchema,
    async (input) => {
      const { EmailReplyApprovalService } = await import(
        "@/service/emailReply/EmailReplyApprovalService"
      );
      const result = await new EmailReplyApprovalService().approveDraft({
        draftId: input.draftId,
        approvedByType: "user",
      });
      return result;
    }
  );

  // ---- Send-attempt detail for a draft (audit / recovery UI) ----
  registerValidatedHandler(
    EMAIL_REPLY_SEND_ATTEMPT_DETAIL,
    emailReplySendAttemptDetailInputSchema,
    async (input) => {
      const attemptModule = new EmailReplySendAttemptModule();
      const records = await attemptModule.listByDraft(input.draftId);
      return {
        records: records.map((a) => ({
          id: a.id,
          status: a.status,
          claimedAt: a.claimedAt ? new Date(a.claimedAt).toISOString() : null,
          completedAt: a.completedAt
            ? new Date(a.completedAt).toISOString()
            : null,
          providerMessageId: a.providerMessageId,
          failureCode: a.failureCode,
          sanitizedError: a.sanitizedError,
        })),
      };
    }
  );

  // ---- Recovery + manual reconciliation (operational) ----
  registerValidatedHandler(
    EMAIL_REPLY_DELIVERY_RECONCILE,
    emailReplyDeliveryReconcileInputSchema,
    async (input) => {
      const { EmailReplySendRecoveryService } = await import(
        "@/service/emailReply/EmailReplySendRecoveryService"
      );
      const svc = new EmailReplySendRecoveryService();
      // Manual per-attempt reconcile when an attemptId + action are supplied;
      // otherwise run the bounded auto sweep of stale in-flight attempts.
      if (input.attemptId && input.action) {
        return await svc.reconcileAttempt({
          attemptId: input.attemptId,
          action: input.action,
          evidence: input.evidence,
          providerMessageId: input.providerMessageId,
        });
      }
      return await svc.recoverStaleAttempts(input.ageMs);
    }
  );

  // ---- Knowledge scope settings (FR-008, P3.1) ----
  registerValidatedHandler(
    EMAIL_REPLY_KNOWLEDGE_SCOPE_GET,
    emailReplyKnowledgeScopeGetInputSchema,
    async (input) => {
      const { EmailReplyKnowledgeScopeModule } = await import(
        "@/modules/EmailReplyKnowledgeScopeModule"
      );
      const scope =
        await new EmailReplyKnowledgeScopeModule().getByEmailServiceId(
          input.emailServiceId
        );
      // Defaults when unset: legacy behavior (search all eligible docs).
      let documentIds: number[] = [];
      let tags: string[] = [];
      if (scope) {
        try {
          documentIds = JSON.parse(scope.documentIdsJson) as number[];
        } catch {
          documentIds = [];
        }
        try {
          tags = JSON.parse(scope.tagsJson) as string[];
        } catch {
          tags = [];
        }
      }
      return {
        emailServiceId: input.emailServiceId,
        version: scope?.version ?? 0,
        documentIds,
        tags,
        allowAllDocuments: scope ? scope.allowAllDocuments === 1 : true,
        excludeInactiveDocuments: scope
          ? scope.excludeInactiveDocuments === 1
          : true,
      };
    }
  );

  // ---- Knowledge scope update: upsert + invalidate unsent drafts (FR-008) ----
  registerValidatedHandler(
    EMAIL_REPLY_KNOWLEDGE_SCOPE_UPDATE,
    emailReplyKnowledgeScopeUpdateInputSchema,
    async (input) => {
      const { EmailReplyKnowledgeScopeModule } = await import(
        "@/modules/EmailReplyKnowledgeScopeModule"
      );
      const saved = await new EmailReplyKnowledgeScopeModule().upsert({
        emailServiceId: input.emailServiceId,
        documentIds: input.documentIds,
        tags: input.tags,
        allowAllDocuments: input.allowAllDocuments,
        excludeInactiveDocuments: input.excludeInactiveDocuments,
      });
      // Changing the scope invalidates every not-yet-sent draft for the mailbox
      // (FR-008): approved drafts return to 'draft' and approvals are consumed.
      const invalidated =
        await new EmailReplyDraftModule().invalidateUnsentDraftsForMailbox(
          input.emailServiceId,
          `Knowledge scope changed (v${saved.version})`
        );
      return { version: saved.version, invalidatedDrafts: invalidated };
    }
  );
}

// ---- DTO mappers (no secrets leak) ----

function toMessageListDto(
  e: EmailReceivedMessageEntity
): ReceivedMessageListDto {
  return {
    id: e.id,
    emailServiceId: e.emailServiceId,
    fromAddress: e.fromAddress,
    fromName: e.fromName,
    subject: e.subject,
    snippet: e.snippet,
    receivedAt: iso(e.receivedAt),
    isUnread: normalizeStoredBoolean(e.isUnread),
    classification: e.classification,
    classificationConfidence: e.classificationConfidence,
    replyStatus: e.replyStatus,
    processedAt: iso(e.processedAt),
  };
}

function toMessageDetailDto(
  e: EmailReceivedMessageEntity
): ReceivedMessageDetailDto {
  return {
    ...toMessageListDto(e),
    messageId: e.messageId,
    threadKey: e.threadKey,
    replyToAddress: e.replyToAddress,
    toAddresses: decodeAddresses(e.toAddressesJson),
    ccAddresses: decodeAddresses(e.ccAddressesJson),
    bodyText: e.bodyText,
    bodyHtmlSanitized: e.bodyHtmlSanitized,
  };
}

function normalizeStoredBoolean(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function toIdentityProfileDto(
  e: EmailReplyIdentityProfileEntity
): ReplyIdentityProfileDto {
  let forbiddenPhrases: string[] = [];
  try {
    const parsed = e.forbiddenPhrasesJson
      ? JSON.parse(e.forbiddenPhrasesJson)
      : [];
    if (Array.isArray(parsed)) forbiddenPhrases = parsed.map((s) => String(s));
  } catch {
    forbiddenPhrases = [];
  }
  return {
    id: e.id,
    emailServiceId: e.emailServiceId,
    ownerName: e.ownerName,
    ownerRole: e.ownerRole,
    companyName: e.companyName,
    preferredTone: e.preferredTone,
    signature: e.signature,
    styleNotes: e.styleNotes,
    forbiddenPhrases,
    discloseAutomation: e.discloseAutomation === 1,
  };
}

function toAutoReplyAuditDto(e: {
  id: number;
  emailServiceId: number;
  messageId: number;
  draftId: number | null;
  ruleId: number | null;
  action: string;
  decisionStatus: string;
  classification: EmailMessageClassification | null;
  confidence: number | null;
  reason: string | null;
  knowledgeQuery: string | null;
  knowledgeSourcesJson: string | null;
  generatedSubject: string | null;
  generatedBodyPreview: string | null;
  sentSubject: string | null;
  sentBodyPreview: string | null;
  requiresUserApproval: number;
  approvedByUser: number;
  errorMessage: string | null;
  createdAt?: Date | null;
}): AutoReplyAuditDto {
  let knowledgeSourceCount = 0;
  try {
    const parsed = e.knowledgeSourcesJson
      ? JSON.parse(e.knowledgeSourcesJson)
      : [];
    if (Array.isArray(parsed)) knowledgeSourceCount = parsed.length;
  } catch {
    knowledgeSourceCount = 0;
  }
  return {
    id: e.id,
    emailServiceId: e.emailServiceId,
    messageId: e.messageId,
    draftId: e.draftId,
    ruleId: e.ruleId,
    action: e.action,
    decisionStatus: e.decisionStatus,
    classification: e.classification,
    confidence: e.confidence,
    reason: e.reason,
    knowledgeQuery: e.knowledgeQuery,
    knowledgeSourceCount,
    generatedSubject: e.generatedSubject,
    generatedBodyPreview: e.generatedBodyPreview,
    sentSubject: e.sentSubject,
    sentBodyPreview: e.sentBodyPreview,
    requiresUserApproval: e.requiresUserApproval === 1,
    approvedByUser: e.approvedByUser === 1,
    errorMessage: e.errorMessage,
    createdAt: iso(e.createdAt),
  };
}

function iso(d: Date | null | undefined): string {
  if (!d) return "";
  try {
    return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  } catch {
    return "";
  }
}
