import { ZodError } from "zod";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import { decodeAddresses } from "@/service/emailReceive/EmailMessageParser";
import { isAutomatedSender } from "@/service/emailReceive/EmailMessageParser";
import {
  listEmailInboxesSchema,
  fetchUnreadEmailsSchema,
  getEmailMessageSchema,
  markEmailProcessedSchema,
} from "@/entityTypes/emailReceiveAiTypes";
import type {
  EmailReceiveAiToolResult,
  AiEmailInboxSummary,
  AiEmailMessageSummary,
  AiEmailMessageDetail,
} from "@/entityTypes/emailReceiveAiTypes";
import type { EmailMessageClassification, EmailReplyStatus } from "@/entityTypes/emailReceiveTypes";

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

export async function listEmailInboxes(
  args: unknown
): Promise<
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
    const page = services.slice(input.page * input.size, input.page * input.size + input.size);
    const records = page.map(toInboxSummary);
    return { success: true, records, total };
  } catch (error) {
    return error instanceof ZodError ? validationFailure(error) : failure(error);
  }
}

// ---- fetch_unread_emails ----

export async function fetchUnreadEmails(
  args: unknown
): Promise<
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
    await writeReadAudit(input.email_service_id, null, "AI fetched unread inbox");

    return {
      success: true,
      email_service_id: input.email_service_id,
      fetched: result.fetched,
      stored: result.stored,
      messages,
    };
  } catch (error) {
    return error instanceof ZodError ? validationFailure(error) : failure(error);
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

    if (input.include_body) {
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
    return error instanceof ZodError ? validationFailure(error) : failure(error);
  }
}

// ---- mark_email_processed ----

export async function markEmailProcessed(
  args: unknown
): Promise<
  EmailReceiveAiToolResult<{ message_id: number; status: string }>
> {
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
    await messageModule.updateReplyStatus(input.message_id, nextStatus, new Date());

    const auditModule = new EmailReplyAuditLogModule();
    const log = new EmailReplyAuditLogEntity();
    log.emailServiceId = msg.emailServiceId;
    log.messageId = msg.id;
    log.action = input.status === "failed" ? "send_failed" : "reply_skipped";
    log.actor = "ai";
    log.reason = input.reason ?? input.status;
    await auditModule.create(log);

    return { success: true, message_id: input.message_id, status: input.status };
  } catch (error) {
    return error instanceof ZodError ? validationFailure(error) : failure(error);
  }
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
    lastSyncAt: s.lastReceiveSyncAt ? new Date(s.lastReceiveSyncAt).toISOString() : null,
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
