import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  EMAIL_RECEIVE_SYNC,
  EMAIL_RECEIVE_CONNECTION_TEST,
  EMAIL_RECEIVE_MESSAGE_LIST,
  EMAIL_RECEIVE_MESSAGE_DETAIL,
  EMAIL_REPLY_MARK_PROCESSED,
  EMAIL_REPLY_IDENTITY_GET,
  EMAIL_REPLY_IDENTITY_UPDATE,
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
  emailAutoReplyAuditListInputSchema,
  emailAutoReplyAuditDetailInputSchema,
} from "@/schemas/ipc/emailReply";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
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
      return await syncService.testConnection(input.emailServiceId);
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
    isUnread: e.isUnread === 1,
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
