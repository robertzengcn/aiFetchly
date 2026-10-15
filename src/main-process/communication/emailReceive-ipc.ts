import {
  registerValidatedHandler,
  registerAiValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import { StructuredIpcError } from "@/main-process/communication/_shared/StructuredIpcError";
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
  EMAIL_REPLY_DRAFT_RESOLVE_REVIEW,
  EMAIL_REPLY_SEND_ATTEMPT_DETAIL,
  EMAIL_REPLY_DELIVERY_RECONCILE,
  EMAIL_REPLY_KNOWLEDGE_SCOPE_GET,
  EMAIL_REPLY_KNOWLEDGE_SCOPE_UPDATE,
  EMAIL_AUTO_REPLY_AUDIT_LIST,
  EMAIL_AUTO_REPLY_AUDIT_DETAIL,
  EMAIL_REPLY_CHECK_REPLIED,
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
  emailReplyDraftResolveReviewInputSchema,
  emailReplySendAttemptDetailInputSchema,
  emailReplyDeliveryReconcileInputSchema,
  emailReplyKnowledgeScopeGetInputSchema,
  emailReplyKnowledgeScopeUpdateInputSchema,
  emailAutoReplyAuditListInputSchema,
  emailAutoReplyAuditDetailInputSchema,
  emailReplyCheckRepliedInputSchema,
} from "@/schemas/ipc/emailReply";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import {
  EmailReplyDraftGenerationService,
  createModelOutputCapResolver,
} from "@/service/emailReply/EmailReplyDraftGenerationService";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplyDetectionModule } from "@/modules/EmailReplyDetectionModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { isEmailReplyKillSwitchOn } from "@/config/featureFlags";
import { EmailReplyIdentityProfileModule } from "@/modules/EmailReplyIdentityProfileModule";
import { EmailAutoReplyAuditLogModule } from "@/modules/EmailAutoReplyAuditLogModule";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyIdentityProfileEntity } from "@/entity/EmailReplyIdentityProfile.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { buildAutoReplyAuditMirrorRow } from "@/service/emailReply/EmailReplyAuditMirror";
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
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";

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

      // G03-1c: mirror the decision into the auto-reply audit table the UI
      // reads, so user/AI mark-processed outcomes are visible in the audit UI.
      const mirrorRow = buildAutoReplyAuditMirrorRow({
        emailServiceId: log.emailServiceId,
        messageId: log.messageId,
        draftId: log.draftId,
        action: log.action,
        reason: log.reason,
        metadataJson: log.metadataJson,
      });
      if (mirrorRow !== null) {
        await new EmailAutoReplyAuditLogModule().create(mirrorRow);
      }

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

  // ---- Diagnostic reply check (FR-032) ----
  // AI-gated at the boundary: `registerAiValidatedHandler` checks
  // `user_ai_enabled` first and returns the existing `{ status: false, msg,
  // data: null }` shape when disabled, before any handler work runs. The
  // handler delegates to `EmailReplyDetectionModule.checkReply` (ordinary
  // cache per §7.3, no forceRefresh) and returns the safe snake_case DTO.
  // Read-only — no mailbox mutation, no SMTP, no audit row written here.
  registerAiValidatedHandler(
    EMAIL_REPLY_CHECK_REPLIED,
    emailReplyCheckRepliedInputSchema,
    async (input) => {
      const detectionModule = new EmailReplyDetectionModule();
      const outcome = await detectionModule.checkReply({
        messageId: input.messageId,
      });
      if (!outcome.success || !outcome.result) {
        // Persistence/detection failure — surface the bounded error string the
        // service already produced. Throw so dispatchValidated's catch wraps it
        // into the safe `{ status: false, msg, data: null }` envelope (no raw
        // provider errors, no credentials).
        throw new Error(outcome.error ?? "Reply detection failed");
      }
      return outcome.result;
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
      const genService = new EmailReplyDraftGenerationService({
        resolveModelOutputCap: createModelOutputCapResolver(),
      });
      const result = await genService.createDraft(input);
      if (!result.success) {
        // B12: throw a structured error so the validated-IPC catch duck-types
        // the typed fields (code / existing_draft_id / next_action /
        // requestCorrelationId) into the failure envelope instead of losing
        // them. The message stays human-readable for legacy consumers; the
        // typed fields are pure additions the renderer / AI tool branches on.
        throw new StructuredIpcError(result.error, {
          code: result.code,
          existing_draft_id: result.existing_draft_id,
          next_action: result.next_action,
          requestCorrelationId: result.requestCorrelationId,
        });
      }
      // Strip the transport-only `success` flag before returning over IPC.
      const { success, ...dto } = result;
      void success;
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
        // R21: review metadata rides on the detail DTO as raw bounded JSON so
        // the renderer can surface the flag without a schema migration.
        // G02: the resolution stamp rides along so the UI can show
        // resolved-for-this-revision vs still-awaiting-review.
        requiresHumanReview: draft.requiresHumanReview === 1,
        reviewReasonsJson: draft.reviewReasonsJson,
        unresolvedQuestionsJson: draft.unresolvedQuestionsJson,
        humanReviewResolvedAt: draft.humanReviewResolvedAt
          ? new Date(draft.humanReviewResolvedAt).toISOString()
          : null,
        humanReviewResolvedRevisionId:
          draft.humanReviewResolvedRevisionId ?? null,
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
        console.error("Failed to write draft_edited audit:", e);
      }
      return { id: input.id };
    }
  );

  // ---- Confirmed reply send (UI Send button) ----
  // The reliable send path is authoritative (P0.1): every send requires a valid
  // approval token and goes through the idempotent delivery service. There is no
  // legacy branch and no mailbox override. The kill switch refuses new claims.
  //
  // FR-033/B12: pre-send policy/binding refusals (SendPolicyRejection /
  // SendBindingError) are thrown with a typed `code` property. The validated-IPC
  // catch duck-types that property into the failure envelope so the renderer /
  // AI tool branches on `code` instead of parsing the leading `[code]` bracket
  // out of `msg`. The envelope's `data` stays null on failure.
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
      // B12: let typed errors (SendPolicyRejection / SendBindingError) propagate
      // unchanged — dispatchValidated's catch duck-types their `code` property
      // into the failure envelope. The previous handler re-formatted the message
      // into `[code] message` AND stripped the typed code property, forcing
      // callers to parse English to recover it.
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
      // Pass the resolved user DB path so the v2 envelope's identity
      // resolution reads the real email_service row, not the BaseDb temp-dir
      // fallback (§13.2). Mirrors OutboundEmailDeliveryIpc's resolveDbpath.
      const approvalDbpath = new Token().getValue(USERSDBPATH) ?? "";
      const result = await new EmailReplyApprovalService(
        approvalDbpath
      ).approveDraft({
        draftId: input.draftId,
        approvedByType: "user",
      });
      return result;
    }
  );

  // ---- G02: resolve the model's human-review request (renderer user gesture
  // only — this channel is never registered as an AI tool, so the model
  // cannot acknowledge its own review flag). Revision-bound: the reviewed
  // revision must equal the current revision.
  registerValidatedHandler(
    EMAIL_REPLY_DRAFT_RESOLVE_REVIEW,
    emailReplyDraftResolveReviewInputSchema,
    async (input) => {
      const { EmailReplyDraftModule } = await import(
        "@/modules/EmailReplyDraftModule"
      );
      const draftModule = new EmailReplyDraftModule();
      // Resolve through the model transaction (provenance preserved, audit
      // written, stale revision refused).
      const model = (
        draftModule as unknown as {
          resolveHumanReview: (args: {
            draftId: number;
            revisionId: number;
            resolvedBy: string;
            note?: string | null;
          }) => Promise<{ resolved: boolean; reason?: string }>;
        }
      );
      return await model.resolveHumanReview({
        draftId: input.draftId,
        revisionId: input.revisionId,
        resolvedBy: "user",
        note: input.note ?? null,
      });
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

/** Exported for renderer-DTO contract tests (FR-030). */
export function toMessageListDto(
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
    // FR-030: renderer-safe observation fields (no matched-message-id or
    // context-hash in the list DTO — those are diagnostic-only).
    isAnswered: normalizeStoredBoolean(e.isAnswered),
    answeredFlagCheckedAt: iso(e.answeredFlagCheckedAt),
    replyDetectedAt: iso(e.replyDetectedAt),
  };
}

/** Exported for renderer-DTO contract tests (FR-030). */
export function toMessageDetailDto(
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
    // FR-030: full evidence set for the diagnostic detail view.
    replyDetectionSource: e.replyDetectionSource,
    replyMatchedMessageId: e.replyMatchedMessageId,
    replyNegativeCheckAt: iso(e.replyNegativeCheckAt),
    providerFolder: e.providerFolder,
    providerUidValidity: e.providerUidValidity,
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
  metadataJson?: string | null;
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
  // T10 (FR-033): extract the typed stage/code from the row's structured
  // metadataJson (proper JSON fields written by the services). This is
  // structured-data extraction, not English-text parsing (B12 allows deriving
  // from the typed store; parsing `reason`'s [code] bracket is forbidden).
  // Malformed/missing metadata → null fields, never a guessed code.
  let metadataStage: string | null = null;
  let metadataCode: string | null = null;
  if (e.metadataJson) {
    try {
      const meta = JSON.parse(e.metadataJson) as unknown;
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        const stage = (meta as Record<string, unknown>).stage;
        const code = (meta as Record<string, unknown>).code;
        if (typeof stage === "string" && stage.length > 0) {
          metadataStage = stage;
        }
        if (typeof code === "string" && code.length > 0) {
          metadataCode = code;
        }
      }
    } catch {
      // Malformed metadata — leave both fields null.
    }
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
    metadataStage,
    metadataCode,
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
