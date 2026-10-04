import { ZodError } from "zod";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import { EmailReplyDraftGenerationService } from "@/service/emailReply/EmailReplyDraftGenerationService";
import { decodeAddresses } from "@/service/emailReceive/EmailMessageParser";
import { isAutomatedSender } from "@/service/emailReceive/EmailMessageParser";
import { isEmailReplyKillSwitchOn } from "@/config/featureFlags";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { EmailReplyDeliveryService } from "@/service/emailReply/EmailReplyDeliveryService";
import {
  SendBindingError,
  SendPolicyRejection,
} from "@/service/emailReply/EmailReplySendBinding";
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
import type { EmailReplyPolicyCode } from "@/entityTypes/emailReplyReliabilityTypes";
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

/**
 * Policy reason codes the message-level guard and generation path emit into
 * the leading `[code]` bracket of their refusal strings (FR-028/029/033). Used
 * by {@link extractStableCode} to recover a machine-readable code from a
 * refusal error string when the typed error class is not available (e.g. the
 * generation service returns `{ success: false, error: "[already_replied] ..." }`
 * rather than throwing).
 */
const POLICY_CODES = [
  "already_replied",
  "reply_in_progress",
  "generation_in_progress",
  "reply_state_conflict",
  "reply_state_unknown",
  "needs_human_review",
  "delivery_unknown",
  "bounce",
  "unsubscribe",
  "automated_sender",
  "blocked_sender",
  "blocked_domain",
  "sensitive_topic",
  "invalid_recipient",
  "mailbox_mismatch",
  "daily_limit",
  "thread_limit",
  "classification_unknown",
  "context_ambiguous",
  "draft_not_approved",
  "approval_stale",
  "draft_terminal",
  "approval_required",
  "provider_error",
] as const;

/**
 * Recover a stable reason code from the leading `[code]` bracket of a refusal
 * error string (FR-033). Returns `null` when the string carries no recognized
 * code (e.g. a generic input error). The LLM and UI branch on `code` instead of
 * parsing English out of `error`.
 *
 * Returns the raw code string (not narrowed to {@link EmailReplyPolicyCode})
 * because the generation path also emits non-policy prefixes like
 * `provider_error`; {@link policyFailure} narrows to the policy-code vocabulary
 * for the envelope's typed `code` field.
 */
function extractStableCode(errorText: string): string | null {
  const match = /^\[([a-z_]+)\]/.exec(errorText);
  if (!match) return null;
  const candidate = match[1];
  return (POLICY_CODES as readonly string[]).includes(candidate)
    ? candidate
    : null;
}

/**
 * Suggest a machine-readable next action for the model to surface to the user,
 * given a stable refusal code (FR-033). The mapping is conservative: when in
 * doubt, route to human review rather than auto-retry. Accepts the raw code
 * string so non-policy prefixes (`provider_error`) can still map to an action.
 */
function nextActionForCode(
  code: string | null,
  existingDraftId: number | undefined
):
  | "approve_existing_draft"
  | "discard_and_retry"
  | "await_human_review"
  | "no_action" {
  if (code === "already_replied" && existingDraftId) {
    return "approve_existing_draft";
  }
  if (code === "needs_human_review" || code === "delivery_unknown" ||
      code === "reply_state_unknown" || code === "reply_state_conflict") {
    return "await_human_review";
  }
  if (code === "reply_in_progress" || code === "generation_in_progress") {
    return "no_action";
  }
  if (code === "provider_error") {
    return "discard_and_retry";
  }
  return "no_action";
}

/**
 * Build a stable failure envelope (FR-033) from a refusal error string. The
 * leading `[code]` bracket is parsed into a machine-readable `code`; the rest
 * of the message stays in `error` for the model transcript. When the caller
 * knows the existing draft id (reuse path) it passes it through. The typed
 * `code` field is set only when the prefix is a valid {@link EmailReplyPolicyCode};
 * non-policy prefixes (e.g. `provider_error`) still drive `next_action` but are
 * omitted from the typed `code` slot.
 */
function policyFailure(
  errorText: string,
  existingDraftId?: number
): {
  success: false;
  error: string;
  code?: EmailReplyPolicyCode;
  existing_draft_id?: number;
  next_action?:
    | "approve_existing_draft"
    | "discard_and_retry"
    | "await_human_review"
    | "no_action";
} {
  const rawCode = extractStableCode(errorText);
  const next_action = nextActionForCode(rawCode, existingDraftId);
  const envelope: {
    success: false;
    error: string;
    code?: EmailReplyPolicyCode;
    existing_draft_id?: number;
    next_action?:
      | "approve_existing_draft"
      | "discard_and_retry"
      | "await_human_review"
      | "no_action";
  } = { success: false, error: errorText };
  // Narrow to the typed policy-code vocabulary. `allowed` is the success code,
  // never surfaced on a failure envelope, so exclude it from the cast.
  if (
    rawCode &&
    rawCode !== "provider_error" &&
    rawCode !== "allowed" &&
    (POLICY_CODES as readonly string[]).includes(rawCode)
  ) {
    envelope.code = rawCode as EmailReplyPolicyCode;
  }
  if (existingDraftId) envelope.existing_draft_id = existingDraftId;
  envelope.next_action = next_action;
  return envelope;
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
      // Surface the stable code + next_action (FR-033) instead of a bare English
      // string. The generation service prefixes refusals with `[code]`; the
      // reuse path returns success, so a failure here is always a refusal.
      return policyFailure(result.error);
    }
    const { success, ...dto } = result;
    void success;
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

    // Emergency kill switch (P0.1): refuse new send claims. Viewing, audit,
    // and recovery stay available through their own IPC handlers.
    if (isEmailReplyKillSwitchOn()) {
      return {
        success: false,
        error: "Reply sending is temporarily disabled by the kill switch",
      };
    }

    // The reliable send path is authoritative (P0.1): there is no legacy SMTP
    // branch and no mailbox override. The tool's `requiresConfirmation` gate is
    // the user gesture, so confirmed execution mints a one-time
    // tool_confirmation approval inline and delivers through the atomic-claim
    // path. The LLM never sees the token.
    const draftModule = new EmailReplyDraftModule();
    await draftModule.ensureConnection();
    const draft = await draftModule.read(input.draft_id);
    if (!draft) {
      return { success: false, error: "Draft not found" };
    }
    if (draft.status !== "draft") {
      return {
        success: false,
        error: `Cannot send a draft in state '${draft.status}'; only an unapproved 'draft' may be sent (the AI tool approves on confirmed execution)`,
      };
    }
    const approval = await new EmailReplyApprovalService().approveDraft({
      draftId: draft.id,
      approvedByType: "tool_confirmation",
      approvedById: "ai_tool",
    });
    const outcome = await new EmailReplyDeliveryService().sendApprovedReply({
      draftId: draft.id,
      approvalToken: approval.token,
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
      // Stable code (FR-033): distinguish a duplicate submission from a fresh send.
      return {
        success: false,
        error: "A send was already submitted for this approved revision",
        code: "already_replied",
        next_action: "no_action",
      };
    }
    // failed or delivery_unknown: surface the stable code + next_action.
    if (outcome.status === "delivery_unknown") {
      return {
        success: false,
        error: "Delivery unknown: verify the Sent folder manually",
        code: "delivery_unknown",
        next_action: "await_human_review",
      };
    }
    return policyFailure(
      outcome.error,
      draft.id
    );
  } catch (error) {
    if (error instanceof SendPolicyRejection) {
      // Pre-send policy refusal (FR-029): already_replied / reply_in_progress /
      // reply_state_conflict / delivery_unknown / etc. Carries the stable code.
      return {
        success: false,
        error: error.message,
        code: error.code,
        next_action: nextActionForCode(error.code, undefined),
      };
    }
    if (error instanceof SendBindingError) {
      // Binding failures carry their own stable code vocabulary; map to a hint.
      return {
        success: false,
        error: error.message,
        code: bindingCodeToPolicyCode(error.code),
        next_action: "discard_and_retry",
      };
    }
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
}

/**
 * Map a {@link SendBindingError} code onto the policy code surface so the AI
 * tool envelope presents a single coherent code vocabulary (FR-033). Binding
 * failures are pre-send refusals, so they share the `draft_not_approved` family
 * when not a more specific match.
 */
function bindingCodeToPolicyCode(
  code: string
): EmailReplyPolicyCode | undefined {
  if (code === "approval_stale") return "approval_stale";
  if (code === "mailbox_mismatch") return "mailbox_mismatch";
  if (code === "service_missing" || code === "service_inactive") {
    return "invalid_recipient";
  }
  if (code === "recipient_mismatch") return "invalid_recipient";
  return "draft_not_approved";
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
