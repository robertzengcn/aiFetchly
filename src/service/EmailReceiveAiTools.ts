import { ZodError } from "zod";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import { EmailReplyDraftGenerationService } from "@/service/emailReply/EmailReplyDraftGenerationService";
import { EmailReplyDetectionModule } from "@/modules/EmailReplyDetectionModule";
import { ensureHostedAiEnabled } from "@/service/AiFeatureGate";
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
  nextActionForCode,
  type EmailReplyNextAction,
} from "@/service/emailReply/EmailReplyNextAction";
import {
  listEmailInboxesSchema,
  fetchUnreadEmailsSchema,
  getEmailMessageSchema,
  markEmailProcessedSchema,
  createEmailReplyDraftSchema,
  sendEmailReplySchema,
  checkEmailRepliedSchema,
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
 * Default AI feature gate for the diagnostic reply-check tool (FR-032).
 * Lazy-reconciles once when currently disabled (PRD FR-6.1), then re-reads the
 * flag. GET failures keep the cache, so a Community user is never falsely
 * unlocked. Mirrors {@link KnowledgeLibraryAiTools.defaultIsAiEnabled}.
 */
async function defaultIsAiEnabled(): Promise<boolean> {
  try {
    return await ensureHostedAiEnabled();
  } catch {
    return false;
  }
}

/**
 * Build a stable failure envelope (FR-033, B12) from a typed refusal result.
 *
 * B12: the generation service's failure side is now a typed union carrying
 * `code` / `existing_draft_id` / `next_action` / `requestCorrelationId`
 * additively alongside the legacy `error` string. This composer consumes
 * those typed fields directly -- it does NOT parse the leading `[code]`
 * bracket out of `error` to recover a machine-readable reason. The previous
 * implementation (`extractStableCode` + `POLICY_CODES`) regex-parsed English
 * error text, which is exactly what B12 forbids.
 *
 * The typed `code` field is set only when the result carries a genuine
 * {@link EmailReplyPolicyCode}; non-policy failures (provider_error, AI-disabled,
 * message-not-found, audit-persistence) leave `code` undefined and the
 * envelope's `error` still carries the human-readable text. `next_action` is
 * derived from the typed code via {@link nextActionForCode} (typed-code→action
 * derivation, not English parsing); when the result already carries a
 * `next_action` (e.g. transport failures where the service knows the action
 * without a policy code), that value is preserved.
 */
function policyFailure(result: {
  success: false;
  error: string;
  code?: EmailReplyPolicyCode;
  existing_draft_id?: number;
  next_action?: EmailReplyNextAction;
  requestCorrelationId?: string;
}): {
  success: false;
  error: string;
  code?: EmailReplyPolicyCode;
  existing_draft_id?: number;
  next_action?: EmailReplyNextAction;
  requestCorrelationId?: string;
} {
  const envelope: {
    success: false;
    error: string;
    code?: EmailReplyPolicyCode;
    existing_draft_id?: number;
    next_action?: EmailReplyNextAction;
    requestCorrelationId?: string;
  } = { success: false, error: result.error };
  // The generation service already narrowed `code` to EmailReplyPolicyCode;
  // pass it through verbatim. Absent on provider_error / AI-disabled /
  // message-not-found / audit-persistence failures.
  if (result.code) envelope.code = result.code;
  if (result.existing_draft_id) {
    envelope.existing_draft_id = result.existing_draft_id;
  }
  // Prefer the service-derived next_action when present (transport / empty-
  // output failures derive it directly without a policy code); otherwise
  // derive from the typed code.
  envelope.next_action =
    result.next_action ?? nextActionForCode(result.code, result.existing_draft_id);
  // R19: propagate the service's request correlation id so tool/IPC consumers
  // can correlate the refusal with lifecycle audits.
  if (result.requestCorrelationId) {
    envelope.requestCorrelationId = result.requestCorrelationId;
  }
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
      // B12: surface the typed code + next_action + existing_draft_id directly
      // from the widened failure union. The generation service already narrowed
      // `code` to EmailReplyPolicyCode; policyFailure passes it through without
      // parsing English. The reuse path returns success, so a failure here is
      // always a refusal or a transport/validation/audit-persistence failure.
      return policyFailure(result);
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
    // R13: a `failed` draft (definite SMTP rejection) reaches the fenced
    // reopen inside `approveDraft`; the reopen refuses when retry is unsafe
    // (cluster positive / unknown / sent / in-flight sibling). Other
    // non-`draft` states stay refused at this gate.
    if (draft.status !== "draft" && draft.status !== "failed") {
      return {
        success: false,
        error: `Cannot send a draft in state '${draft.status}'; only an unapproved 'draft' (or a definitely-failed draft the approval service reopens) may be sent`,
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
      // R-5: derive next_action canonically via nextActionForCode — an
      // already_replied here has no reusable draft id surfaced (the outcome
      // carries only the attempt, not a fresh draft), so it routes to
      // await_human_review, consistent with the SendPolicyRejection path.
      return {
        success: false,
        error: "A send was already submitted for this approved revision",
        code: "already_replied",
        next_action: nextActionForCode("already_replied", undefined),
      };
    }
    // failed: the delivery service surfaces a sanitized transport error string
    // but no typed policy code (a failed SMTP submission is a provider-level
    // failure, not a policy refusal). B12: build the typed envelope from the
    // outcome's own fields -- no English parsing. next_action routes to retry
    // since a transport failure is typically transient.
    if (outcome.status === "failed") {
      return {
        success: false,
        error: outcome.error,
        next_action: "discard_and_retry",
        existing_draft_id: draft.id,
      };
    }
    // delivery_unknown: ambiguous outcome after possible provider acceptance.
    // Stable policy code so the model surfaces human review, never auto-retry.
    // This is the final outcome status (sent / already_processed / failed are
    // handled above); the fallthrough return satisfies exhaustiveness.
    return {
      success: false,
      error: "Delivery unknown: verify the Sent folder manually",
      code: "delivery_unknown",
      next_action: "await_human_review",
      existing_draft_id: draft.id,
    };
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

// ---- check_email_replied ----

/**
 * FR-032: diagnostic reply-check tool. Runs the shared §7.1 detection
 * algorithm (ordinary cache, no forceRefresh) and returns the three-state
 * typed result as a snake_case DTO. Read-only — does not mutate the mailbox
 * and needs no confirmation; local cache/read audit may update.
 *
 * AI-enable is checked at the tool boundary BEFORE input parsing or Module
 * creation (FR-6.1). Disabled → `{ success: false, error: "AI feature is not
 * enabled" }` with no detection work performed.
 *
 * Never leaks credentials, raw provider errors, bodies, or internal exception
 * details — the DTO carries only low-cardinality codes, booleans, timestamps,
 * and the matched message id (FR-039).
 */
export async function checkEmailReplied(args: unknown): Promise<
  EmailReceiveAiToolResult<{
    message_id: number;
    state: "replied" | "not_replied" | "unknown";
    replied: boolean | null;
    source: string;
    reason_code: string;
    matched_message_id: string | null;
    checked_at: string | null;
    from_cache: boolean;
    coverage: string;
  }>
> {
  // AI-enable check at the boundary (FR-6.1): before parsing request data or
  // constructing any Module. A disabled-AI caller gets no detection work.
  if (!(await defaultIsAiEnabled())) {
    return { success: false, error: "AI feature is not enabled" };
  }
  let messageId: number;
  try {
    const input = checkEmailRepliedSchema.parse(args);
    messageId = input.message_id;
  } catch (error) {
    return error instanceof ZodError
      ? validationFailure(error)
      : failure(error);
  }
  // Verify the seed message exists BEFORE detection (the detector needs the
  // row to resolve the account + identity). Missing → typed failure, no
  // detection probe.
  const messageModule = new EmailReceivedMessageModule();
  await messageModule.ensureConnection();
  const msg = await messageModule.read(messageId);
  if (!msg) {
    return { success: false, error: "Message not found" };
  }
  try {
    const detectionModule = new EmailReplyDetectionModule();
    const outcome = await detectionModule.checkReply({ messageId });
    if (!outcome.success || !outcome.result) {
      // Persistence/detection failure — sanitize via the bounded error string
      // the service already produced (no raw provider errors, no credentials).
      return { success: false, error: outcome.error ?? "Reply detection failed" };
    }
    // Carry the safe DTO fields through the tool envelope. The detection
    // service already mapped the result to snake_case; pass it through verbatim
    // (no English parsing, no code recovery).
    const dto = outcome.result;
    return {
      success: true,
      message_id: dto.message_id,
      state: dto.state,
      replied: dto.replied,
      source: dto.source,
      reason_code: dto.reason_code,
      matched_message_id: dto.matched_message_id,
      checked_at: dto.checked_at,
      from_cache: dto.from_cache,
      coverage: dto.coverage,
    };
  } catch (error) {
    return failure(error);
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
