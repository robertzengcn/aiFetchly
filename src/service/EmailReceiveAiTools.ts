import { ZodError } from "zod";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailAutoReplyAuditLogModule } from "@/modules/EmailAutoReplyAuditLogModule";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import { EmailReplyDraftGenerationService } from "@/service/emailReply/EmailReplyDraftGenerationService";
import { ReplyEmailService } from "@/modules/lib/replyEmailService";
import { decodeAddresses } from "@/service/emailReceive/EmailMessageParser";
import { isAutomatedSender } from "@/service/emailReceive/EmailMessageParser";
import { isEmailReplyApprovalV2Enabled } from "@/config/featureFlags";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { EmailReplyDeliveryService } from "@/service/emailReply/EmailReplyDeliveryService";
import {
  listEmailInboxesSchema,
  fetchUnreadEmailsSchema,
  getEmailMessageSchema,
  markEmailProcessedSchema,
  createEmailReplyDraftSchema,
  sendEmailReplySchema,
} from "@/entityTypes/emailReceiveAiTypes";
import type {
  EmailReceiveAiToolResult,
  AiEmailInboxSummary,
  AiEmailMessageSummary,
  AiEmailMessageDetail,
  AiEmailReplyDraftResult,
} from "@/entityTypes/emailReceiveAiTypes";
import type {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";

// ---- error helpers (mirror EmailMarketingAiTools) ----

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validationFailure(error: ZodError) {
  return {
    success: false as const,
    error: "Invalid email receive tool input",
    validation_errors: error.issues.map((i) => i.message),
  };
}

function failure(error: unknown) {
  return { success: false as const, error: formatError(error) };
}

// ---- list_email_inboxes ----

export async function listEmailInboxes(args: unknown): Promise<
  EmailReceiveAiToolResult<{
    records: AiEmailInboxSummary[];
    total: number;
  }>
> {
  try {
    const input = listEmailInboxesSchema.parse(args);
    const serviceModule = new EmailServiceModule();
    await serviceModule.ensureConnection();
    let services = await serviceModule.listReceiveEnabledServices();

    if (input.search) {
      const q = input.search.toLowerCase();
      services = services.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.from.toLowerCase().includes(q) ||
          (s.imapHost ?? "").toLowerCase().includes(q)
      );
    }

    const total = services.length;
    const page = services.slice(
      input.page * input.size,
      input.page * input.size + input.size
    );
    const records = page.map(toInboxSummary);
    return { success: true, records, total };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

// ---- fetch_unread_emails ----

export async function fetchUnreadEmails(args: unknown): Promise<
  EmailReceiveAiToolResult<{
    email_service_id: number;
    fetched: number;
    stored: number;
    messages: AiEmailMessageSummary[];
  }>
> {
  try {
    const input = fetchUnreadEmailsSchema.parse(args);
    const syncService = new EmailReceiveSyncService();
    const result = await syncService.syncUnread(input.email_service_id, {
      limit: input.limit,
      unreadOnly: input.unread_only,
      since: input.since ? new Date(input.since) : undefined,
    });

    // Load the freshly stored summaries (no bodies).
    const messageModule = new EmailReceivedMessageModule();
    const { records } = await messageModule.listByEmailService({
      emailServiceId: input.email_service_id,
      page: 0,
      size: result.messageIds.length || input.limit,
      unreadOnly: input.unread_only,
      sortby: { key: "receivedat", order: "desc" },
    });
    const messages = records.map(toMessageSummary);

    // Audit the AI mailbox read.
    await writeReadAudit(
      input.email_service_id,
      null,
      "AI fetched unread inbox"
    );

    return {
      success: true,
      email_service_id: input.email_service_id,
      fetched: result.fetched,
      stored: result.stored,
      messages,
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

// ---- get_email_message ----

export async function getEmailMessage(
  args: unknown
): Promise<EmailReceiveAiToolResult<{ message: AiEmailMessageDetail }>> {
  try {
    const input = getEmailMessageSchema.parse(args);
    const messageModule = new EmailReceivedMessageModule();
    await messageModule.ensureConnection();
    const msg = await messageModule.read(input.message_id);
    if (!msg) {
      return { success: false, error: "Message not found" };
    }

    // Marking read is opt-in (mark_read, default false) so a read tool does
    // not mutate mailbox state unless explicitly requested.
    if (input.mark_read) {
      await messageModule.markRead(input.message_id, false);
    }

    const detail: AiEmailMessageDetail = {
      ...toMessageSummary(msg),
      replyToAddress: msg.replyToAddress,
      toAddresses: decodeAddresses(msg.toAddressesJson),
      ccAddresses: decodeAddresses(msg.ccAddressesJson),
      snippet: msg.snippet,
      bodyText: input.include_body ? msg.bodyText : null,
      bodyHtmlSanitized: input.include_body ? msg.bodyHtmlSanitized : null,
      isAutomatedSender: isAutomatedSender({ fromAddress: msg.fromAddress }),
    };

    await writeReadAudit(msg.emailServiceId, msg.id, "AI read message body");

    return { success: true, message: detail };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

// ---- mark_email_processed ----

export async function markEmailProcessed(
  args: unknown
): Promise<EmailReceiveAiToolResult<{ message_id: number; status: string }>> {
  try {
    const input = markEmailProcessedSchema.parse(args);
    const messageModule = new EmailReceivedMessageModule();
    await messageModule.ensureConnection();
    const msg = await messageModule.read(input.message_id);
    if (!msg) {
      return { success: false, error: "Message not found" };
    }

    const statusMap: Record<string, EmailReplyStatus> = {
      skipped: "skipped",
      blocked: "blocked",
      failed: "failed",
      needs_human_review: "not_started",
    };
    const nextStatus = statusMap[input.status] ?? "not_started";
    await messageModule.updateReplyStatus(
      input.message_id,
      nextStatus,
      new Date()
    );

    const auditModule = new EmailReplyAuditLogModule();
    const log = new EmailReplyAuditLogEntity();
    log.emailServiceId = msg.emailServiceId;
    log.messageId = msg.id;
    log.action = input.status === "failed" ? "send_failed" : "reply_skipped";
    log.actor = "ai";
    log.reason = input.reason ?? input.status;
    await auditModule.create(log);

    return {
      success: true,
      message_id: input.message_id,
      status: input.status,
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

// ---- create_email_reply_draft ----

export async function createEmailReplyDraft(
  args: unknown
): Promise<EmailReceiveAiToolResult<AiEmailReplyDraftResult>> {
  try {
    const input = createEmailReplyDraftSchema.parse(args);
    const genService = new EmailReplyDraftGenerationService();
    const result = await genService.createDraft({
      messageId: input.message_id,
      tone: input.tone,
      goal: input.goal,
      extraInstructions: input.extra_instructions,
      useKnowledgeLibrary: input.use_knowledge_library,
    });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const { success: _ignored, ...dto } = result;
    return { success: true, ...dto };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

// ---- send_email_reply ----

export async function sendEmailReply(args: unknown): Promise<
  EmailReceiveAiToolResult<{
    draft_id: number;
    message_id: number;
    sent_at: string;
  }>
> {
  try {
    const input = sendEmailReplySchema.parse(args);

    // ---- Reliability v2 path (approval + idempotent delivery) ----
    // The tool's `requiresConfirmation` gate is the user gesture, so the
    // confirmed execution mints a one-time tool_confirmation approval inline and
    // delivers through the atomic-claim path. The LLM never sees the token.
    if (isEmailReplyApprovalV2Enabled()) {
      const draftModule = new EmailReplyDraftModule();
      await draftModule.ensureConnection();
      const draft = await draftModule.read(input.draft_id);
      if (!draft) {
        return { success: false, error: "Draft not found" };
      }
      let approvalToken: string;
      if (draft.status === "draft") {
        const approval = await new EmailReplyApprovalService().approveDraft({
          draftId: draft.id,
          approvedByType: "tool_confirmation",
          approvedById: "ai_tool",
        });
        approvalToken = approval.token;
      } else {
        return {
          success: false,
          error: `approval_v2: cannot send a draft in state '${draft.status}' via the AI tool`,
        };
      }
      const outcome = await new EmailReplyDeliveryService().sendApprovedReply({
        draftId: draft.id,
        approvalToken,
      });
      if (outcome.status === "sent") {
        return {
          success: true,
          draft_id: draft.id,
          message_id: draft.messageId,
          sent_at: outcome.sentAt,
        };
      }
      if (outcome.status === "already_processed") {
        return {
          success: false,
          error: "A send was already submitted for this approved revision",
        };
      }
      return {
        success: false,
        error:
          outcome.status === "delivery_unknown"
            ? "Delivery unknown: verify the Sent folder manually"
            : outcome.error,
      };
    }

    const draftModule = new EmailReplyDraftModule();
    await draftModule.ensureConnection();
    const draft = await draftModule.read(input.draft_id);
    if (!draft) {
      return { success: false, error: "Draft not found" };
    }
    if (draft.status === "sent") {
      return { success: false, error: "Draft was already sent" };
    }
    if (draft.status === "discarded") {
      return { success: false, error: "Draft was discarded" };
    }

    const messageModule = new EmailReceivedMessageModule();
    const message = await messageModule.read(draft.messageId);
    if (!message) {
      return { success: false, error: "Original received message not found" };
    }

    const emailServiceId =
      input.email_service_id ?? draft.emailServiceId ?? message.emailServiceId;
    const serviceModule = new EmailServiceModule();
    const service = await serviceModule.getEmailService(emailServiceId);
    if (!service) {
      return { success: false, error: "Outbound email service not found" };
    }
    if (service.status !== 1) {
      return { success: false, error: "Outbound email service is not active" };
    }

    const receiver = (message.replyToAddress || message.fromAddress).trim();
    if (!receiver) {
      return { success: false, error: "No reply recipient could be resolved" };
    }

    const sender = new ReplyEmailService({
      id: service.id,
      from: service.from,
      password: service.password,
      host: service.host,
      port: service.port,
      name: service.name,
      ssl: service.ssl,
    });
    const result = await sender.sendReplyEmail({
      receiver,
      subject: draft.subject,
      text: draft.bodyText,
      html: draft.bodyHtml,
      inReplyTo: message.messageId,
      references: message.referencesHeader,
    });

    if (!result.status) {
      // Failure: keep draft/message unsent, record sanitized error.
      await draftModule.updateStatus(draft.id, "failed", sanitize(result.info));
      await messageModule.updateReplyStatus(message.id, "failed", new Date());
      await writeSendAudit({
        emailServiceId,
        messageId: message.id,
        draftId: draft.id,
        ok: false,
        error: sanitize(result.info),
        subject: draft.subject,
        bodyPreview: draft.bodyText.slice(0, 400),
      });
      return {
        success: false,
        error: sanitize(result.info) || "Reply send failed",
      };
    }

    // Success.
    const sentAt = new Date();
    await draftModule.markSent(draft.id, sentAt);
    await messageModule.updateReplyStatus(message.id, "sent", sentAt);
    await writeSendAudit({
      emailServiceId,
      messageId: message.id,
      draftId: draft.id,
      ok: true,
      error: null,
      subject: draft.subject,
      bodyPreview: draft.bodyText.slice(0, 400),
    });

    return {
      success: true,
      draft_id: draft.id,
      message_id: message.id,
      sent_at: sentAt.toISOString(),
    };
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

/** Write the reply_sent / send_failed rows to both audit logs. */
async function writeSendAudit(args: {
  emailServiceId: number;
  messageId: number;
  draftId: number;
  ok: boolean;
  error: string | null;
  subject: string;
  bodyPreview: string;
}): Promise<void> {
  try {
    const replyAudit = new EmailReplyAuditLogEntity();
    replyAudit.emailServiceId = args.emailServiceId;
    replyAudit.messageId = args.messageId;
    replyAudit.draftId = args.draftId;
    replyAudit.action = args.ok ? "reply_sent" : "send_failed";
    replyAudit.actor = "user";
    replyAudit.reason = args.ok
      ? "Reply sent after user confirmation"
      : args.error;
    await new EmailReplyAuditLogModule().create(replyAudit);
  } catch (e) {
    console.error("Failed to write reply send audit:", e);
  }
  try {
    const autoAudit = new EmailAutoReplyAuditLogEntity();
    autoAudit.emailServiceId = args.emailServiceId;
    autoAudit.messageId = args.messageId;
    autoAudit.draftId = args.draftId;
    autoAudit.action = args.ok ? "auto_reply_sent" : "auto_reply_failed";
    autoAudit.decisionStatus = args.ok ? "auto_sent" : "failed";
    autoAudit.sentSubject = args.subject;
    autoAudit.sentBodyPreview = args.bodyPreview;
    autoAudit.requiresUserApproval = 1;
    autoAudit.approvedByUser = args.ok ? 1 : 0;
    autoAudit.errorMessage = args.error;
    autoAudit.reason = args.ok
      ? "Sent after explicit user confirmation (Phase 1)"
      : "Send failed after user confirmation";
    await new EmailAutoReplyAuditLogModule().create(autoAudit);
  } catch (e) {
    console.error("Failed to write auto-reply send audit:", e);
  }
}

function sanitize(value: string | undefined | null): string {
  if (!value) return "";
  return value.length > 240 ? value.slice(0, 240) + "…" : value;
}

// ---- DTO mappers ----

function toInboxSummary(s: {
  id: number;
  name: string;
  from: string;
  imapHost: string | null;
  receiveFolder: string;
  status: number;
  receiveEnabled: number;
  receiveProtocol: string;
  lastReceiveSyncAt: Date | null | undefined;
  lastReceiveSyncError: string | null | undefined;
}): AiEmailInboxSummary {
  return {
    id: s.id,
    name: s.name,
    emailAddress: s.from,
    host: s.imapHost ?? "",
    folder: s.receiveFolder,
    status: s.status,
    receiveEnabled: s.receiveEnabled === 1,
    receiveProtocol: s.receiveProtocol,
    lastSyncAt: s.lastReceiveSyncAt
      ? new Date(s.lastReceiveSyncAt).toISOString()
      : null,
    lastSyncError: s.lastReceiveSyncError ?? null,
  };
}

function toMessageSummary(e: {
  id: number;
  emailServiceId: number;
  providerUid: string;
  messageId: string | null;
  threadKey: string | null;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  receivedAt: Date;
  isUnread: number;
  classification: EmailMessageClassification | null;
  replyStatus: EmailReplyStatus;
}): AiEmailMessageSummary {
  return {
    id: e.id,
    emailServiceId: e.emailServiceId,
    providerUid: e.providerUid,
    messageId: e.messageId,
    threadKey: e.threadKey,
    fromAddress: e.fromAddress,
    fromName: e.fromName,
    subject: e.subject,
    receivedAt: e.receivedAt ? new Date(e.receivedAt).toISOString() : "",
    isUnread: e.isUnread === 1,
    classification: e.classification,
    replyStatus: e.replyStatus,
  };
}

async function writeReadAudit(
  emailServiceId: number,
  messageId: number | null,
  reason: string
): Promise<void> {
  try {
    const auditModule = new EmailReplyAuditLogModule();
    const log = new EmailReplyAuditLogEntity();
    log.emailServiceId = emailServiceId;
    log.messageId = messageId;
    log.action = "message_read_by_ai";
    log.actor = "ai";
    log.reason = reason;
    await auditModule.create(log);
  } catch (e) {
    // Audit failure must not break the tool call.
    console.error("Failed to write AI read audit log:", e);
  }
}
