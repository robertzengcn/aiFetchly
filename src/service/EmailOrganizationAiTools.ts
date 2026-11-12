import { z } from "zod";
import { EmailForwardDraftService } from "@/service/emailOrganization/EmailForwardDraftService";
import { EmailForwardDeliveryService } from "@/service/emailOrganization/EmailForwardDeliveryService";
import { EmailMailboxActionService } from "@/service/emailOrganization/EmailMailboxActionService";
import { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import { EmailOrganizationOperationModule } from "@/modules/EmailOrganizationOperationModule";
import { EmailOrganizationSelectionService } from "@/service/emailOrganization/EmailOrganizationSelectionService";
import { EmailOrganizationSearchService } from "@/service/emailOrganization/EmailOrganizationSearchService";
import type { OrganizationSearchResult } from "@/service/emailOrganization/EmailOrganizationSearchService";
import { isRetryableOrganizationErrorCode } from "@/service/emailOrganization/EmailOrganizationErrors";
import {
  isLocationBackfillReady,
  ORGANIZATION_BACKFILL_PENDING_CODE,
  organizationBackfillPendingMessage,
} from "@/service/emailOrganization/emailOrganizationReadiness";
import { EmailOrganizationAuthorizationModule } from "@/modules/EmailOrganizationAuthorizationModule";
import { EmailForwardDraftModule } from "@/modules/EmailForwardDraftModule";
import type { ForwardDraftPreview } from "@/service/emailOrganization/EmailForwardDraftService";
import type { EmailOrganizationOperationDto } from "@/entityTypes/emailOrganizationTypes";
import type { EmailOrganizationItemStatus } from "@/entityTypes/emailOrganizationTypes";
import type { EmailSentCopyStatus } from "@/entityTypes/emailOrganizationTypes";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { log } from "@/modules/Logger";
import { ensureHostedAiEnabled } from "@/service/AiFeatureGate";
import enMessages from "@/views/lang/en";
import zhMessages from "@/views/lang/zh";
import esMessages from "@/views/lang/es";
import frMessages from "@/views/lang/fr";
import deMessages from "@/views/lang/de";
import jaMessages from "@/views/lang/ja";
import { SystemSettingController } from "@/controller/SystemSettingController";
import { parseStringArrayJson } from "@/utils/jsonArray";

/**
 * AI-facing organization tool functions (technical design §7). Tool
 * arguments can NEVER carry authorization: mutating tools freeze the
 * payload in the main process, mint a server-held request-scoped
 * authorization bound to its hash (origin `tool_confirmation`), execute,
 * and consume the authorization exactly once. Provenance anchors to the
 * persisted user turn (`sourceUserMessageId`) so a re-delivered tool call
 * resolves to the existing operation instead of repeating the action.
 *
 * These functions follow the EmailReceiveAiTools envelope convention:
 * `{ success: true, ...payload } | { success: false, error, code? }`.
 */

const positiveInt = z.number().int().positive();

const listEmailFoldersSchema = z.object({
  email_service_id: positiveInt,
});

const attachmentSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("parts"),
    part_ids: z.array(z.string().max(64)).max(EMAIL_ORGANIZATION_LIMITS.maxAttachments),
  }),
]);

const createForwardDraftSchema = z.object({
  message_id: positiveInt,
  locale: z.enum(["en", "zh", "es", "fr", "de", "ja"]).optional(),
  to: z.array(z.string().max(320)).min(1).max(EMAIL_ORGANIZATION_LIMITS.maxRecipients),
  cc: z.array(z.string().max(320)).max(EMAIL_ORGANIZATION_LIMITS.maxRecipients).optional(),
  bcc: z.array(z.string().max(320)).max(EMAIL_ORGANIZATION_LIMITS.maxRecipients).optional(),
  sender_service_id: positiveInt.optional(),
  note: z.string().max(2000).optional(),
  subject: z.string().max(998).optional(),
  attachments: attachmentSelectionSchema.optional(),
});

const updateForwardDraftSchema = z.object({
  draft_id: positiveInt,
  expected_revision_id: positiveInt,
  to: z.array(z.string().max(320)).max(EMAIL_ORGANIZATION_LIMITS.maxRecipients).optional(),
  cc: z.array(z.string().max(320)).max(EMAIL_ORGANIZATION_LIMITS.maxRecipients).optional(),
  bcc: z.array(z.string().max(320)).max(EMAIL_ORGANIZATION_LIMITS.maxRecipients).optional(),
  note: z.string().max(2000).optional(),
  subject: z.string().max(998).optional(),
  attachments: attachmentSelectionSchema.optional(),
});

const sendForwardSchema = z.object({
  draft_id: positiveInt,
  revision_id: positiveInt,
});

const moveToTrashSchema = z
  .object({
    message_id: positiveInt.optional(),
    selection_id: z.string().min(8).max(64).optional(),
  })
  .refine(
    (value) => (value.message_id !== undefined) !== (value.selection_id !== undefined),
    { message: "Provide exactly one of message_id or selection_id." }
  );

const restoreEmailSchema = z
  .object({
    operation_id: z.string().min(8).max(64).optional(),
    selection_id: z.string().min(8).max(64).optional(),
    destination_folder_path: z.string().max(255).optional(),
  })
  .refine(
    (value) => (value.operation_id !== undefined) !== (value.selection_id !== undefined),
    { message: "Provide exactly one of operation_id or selection_id." }
  )
  .refine(
    (value) => value.selection_id === undefined || value.destination_folder_path === undefined,
    {
      message:
        "destination_folder_path applies to single-message restores only; a frozen selection restores to its recorded folders.",
    }
  );

const searchEmailsSchema = z
  .object({
    email_service_id: positiveInt,
    source: z.enum(["local", "server"]).default("local"),
    folder_paths: z.array(z.string().min(1).max(255)).max(20).optional(),
    from_address: z.string().max(320).optional(),
    subject: z.string().max(200).optional(),
    received_from: z.string().datetime().max(40).optional(),
    received_to: z.string().datetime().max(40).optional(),
    unread_only: z.boolean().optional(),
    has_attachments: z.boolean().optional(),
    page_size: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(512).optional(),
  })
  .refine(
    (value) =>
      value.received_from === undefined ||
      value.received_to === undefined ||
      new Date(value.received_from).getTime() < new Date(value.received_to).getTime(),
    { message: "received_from must be earlier than received_to." }
  )
  .refine((value) => value.folder_paths === undefined || value.folder_paths.length > 0, {
    message: "folder_paths must contain at least one folder when provided.",
  });

const prepareSelectionSchema = z.object({
  email_service_id: positiveInt,
  kind: z.enum(["trash", "restore"]),
  message_ids: z.array(positiveInt).min(1).max(100),
  filters_summary: z.record(z.string(), z.unknown()).optional(),
});

const getOperationSchema = z.object({
  operation_id: z.string().min(8).max(64),
});

const cancelOperationSchema = z.object({
  operation_id: z.string().min(8).max(64),
});

export type EmailOrganizationToolResult<T> =
  | ({ success: true } & T & Record<string, unknown>)
  | {
      success: false;
      error: string;
      code?: string;
      retryable?: boolean;
      /** R8-03: separate AC-22 sentence (Sent copy unverified) for chat. */
      warning?: string;
      /** R10: structured partial/failed outcome payload (inspectable). */
      result?: Record<string, unknown>;
    };

/**
 * R8-03 (AC-22): the Sent-copy status WORD comes from the same
 * `sent_copy_status.*` map the operation card renders (en source; the tool
 * layer has no renderer locale — the envelope also carries the code so any
 * UI can localize). Never a raw status token.
 */
const LOCALE_MESSAGE_TABLES: Record<string, unknown> = {
  en: enMessages,
  zh: zhMessages,
  es: esMessages,
  fr: frMessages,
  de: deMessages,
  ja: jaMessages,
};

/** R9-02: the active UI locale from the system-setting store (main side). */
async function resolveUiLocale(): Promise<string> {
  try {
    const controller = new SystemSettingController();
    await controller.ensureConnection();
    return await controller.getLanguagePreference();
  } catch {
    return "en";
  }
}

/** R9-02: the label from the ACTIVE locale's sent_copy_status map. */
function sentCopyStatusLabelFor(locale: string, status: EmailSentCopyStatus): string {
  const table = (LOCALE_MESSAGE_TABLES[locale.slice(0, 2).toLowerCase()] as
    | {
        emailOrganization?: {
          sent_copy_status?: Record<string, string>;
        };
      }
    | undefined)?.emailOrganization?.sent_copy_status;
  const fallback = (enMessages as {
    emailOrganization?: {
      sent_copy_status?: Record<string, string>;
    };
  }).emailOrganization?.sent_copy_status;
  return table?.[status] ?? fallback?.[status] ?? status;
}

/** R9-02: the chat warning sentence in the active locale's label. */
async function sentCopyWarningSentence(
  variant: "submitted" | "unknown" | "failed",
  status: EmailSentCopyStatus
): Promise<string> {
  const locale = await resolveUiLocale();
  const label = sentCopyStatusLabelFor(locale, status);
  if (variant === "submitted") {
    return `The forward was submitted, but the Sent copy could not be verified (${label}).`;
  }
  if (variant === "unknown") {
    return `The forward outcome is unknown, and the Sent copy could not be verified (${label}).`;
  }
  return `The forward was rejected by the server, and the Sent copy could not be verified (${label}).`;
}

/**
 * R16: AI-serving organization tools gate entitlement BEFORE parsing,
 * materialization, network or state writes (AGENTS.md AI-IPC rule; the
 * manual IPC path stays independent of AI entitlement by design).
 */
async function gateAiEntitlement(): Promise<EmailOrganizationToolResult<never> | null> {
  const enabled = await ensureHostedAiEnabled();
  if (enabled) return null;
  return { success: false, error: "AI is disabled", code: "AI_DISABLED" };
}

/**
 * R5-10: mutating tools run only after the startup location backfill
 * completed in this process (design §5.3). The gate is host-owned state —
 * it cannot be influenced by tool arguments or message content.
 */
function gateOrganizationReadiness(): EmailOrganizationToolResult<never> | null {
  if (isLocationBackfillReady()) return null;
  return {
    success: false,
    error: organizationBackfillPendingMessage(),
    code: ORGANIZATION_BACKFILL_PENDING_CODE,
  };
}

function failure(error: unknown): EmailOrganizationToolResult<never> {
  if (error instanceof Error && error.name === "EmailOrganizationActionError") {
    const actionError = error as Error & { code: string; retryable: boolean };
    return {
      success: false,
      error: actionError.message,
      code: actionError.code,
      retryable: actionError.retryable,
    };
  }
  const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
  return { success: false, error: message };
}

function actionIdFor(context: SkillExecutionContext | undefined): string | null {
  // The persisted user turn is the authoritative anchor for re-delivered
  // tool calls; the tool call id is the fallback for UI-less executions.
  return context?.sourceUserMessageId ?? context?.toolCallId ?? null;
}

/**
 * R03 (bounded): service-level second guard — scheduled executions are
 * denied here BEFORE dispatch even if a denylist regresses. The flag is
 * threaded by the host's scheduled executor, never by model arguments.
 */
function assertInteractive(context: SkillExecutionContext | undefined): EmailOrganizationToolResult<never> | null {
  if (context?.scheduledOrigin === true) {
    return {
      success: false,
      error: "Organization mutations are not allowed in scheduled executions.",
      code: "ACTION_NOT_AUTHORIZED",
    };
  }
  return null;
}

// ---- Read-only tools ----

let capabilityServiceSingleton: EmailOrganizationCapabilityService | null = null;
function getCapabilityService(): EmailOrganizationCapabilityService {
  if (capabilityServiceSingleton === null) {
    capabilityServiceSingleton = new EmailOrganizationCapabilityService();
  }
  return capabilityServiceSingleton;
}

export async function listEmailFolders(
  args: unknown
): Promise<EmailOrganizationToolResult<{ email_service_id: number; folders: unknown[]; capabilities: unknown }>> {
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = listEmailFoldersSchema.parse(args);
    const capabilityService = getCapabilityService();
    const [folders, capabilities] = await Promise.all([
      capabilityService.listFolders(input.email_service_id),
      capabilityService.getCapabilities(input.email_service_id),
    ]);
    return {
      success: true,
      email_service_id: input.email_service_id,
      folders,
      capabilities,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function getEmailOperation(
  args: unknown
): Promise<EmailOrganizationToolResult<{ operation: EmailOrganizationOperationDto | null }>> {
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = getOperationSchema.parse(args);
    const module = new EmailOrganizationOperationModule();
    const operation = await module.readOperation(input.operation_id);
    if (!operation) {
      return { success: true, operation: null };
    }
    const items = await module.listItems(operation.operationId);
    return { success: true, operation: projectOperation(operation, items) };
  } catch (error) {
    return failure(error);
  }
}

// ---- Draft tools (never send) ----

export async function createEmailForwardDraft(
  args: unknown,
  context?: SkillExecutionContext
): Promise<EmailOrganizationToolResult<{ draft: ForwardDraftPreview }>> {
  const readinessGate = gateOrganizationReadiness();
  if (readinessGate !== null) return readinessGate;
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = createForwardDraftSchema.parse(args);
    const service = new EmailForwardDraftService();
    const draft = await service.createDraft({
      messageId: input.message_id,
      locale: input.locale ?? null,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      note: input.note ?? null,
      subject: input.subject ?? null,
      attachmentSelection: mapSelection(input.attachments),
      senderServiceId: input.sender_service_id ?? null,
      provenance: "ai",
      origin: "tool_confirmation",
      conversationId: context?.conversationId ? Number(context.conversationId) || null : null,
    });
    return { success: true, draft };
  } catch (error) {
    return failure(error);
  }
}

export async function updateEmailForwardDraft(
  args: unknown
): Promise<EmailOrganizationToolResult<{ draft: ForwardDraftPreview }>> {
  const readinessGate = gateOrganizationReadiness();
  if (readinessGate !== null) return readinessGate;
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = updateForwardDraftSchema.parse(args);
    const service = new EmailForwardDraftService();
    const draft = await service.updateDraft({
      draftId: input.draft_id,
      expectedRevisionId: input.expected_revision_id,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      note: input.note,
      subject: input.subject,
      attachmentSelection: input.attachments ? mapSelection(input.attachments) : undefined,
    });
    return { success: true, draft };
  } catch (error) {
    return failure(error);
  }
}

// ---- Mutating tools (request-scoped authorization enforced in the executor) ----

export async function sendEmailForward(
  args: unknown,
  context?: SkillExecutionContext
): Promise<EmailOrganizationToolResult<{ result: Record<string, unknown> }>> {
  const scheduledGuard = assertInteractive(context);
    if (scheduledGuard !== null) return scheduledGuard;
    const readinessGate = gateOrganizationReadiness();
  if (readinessGate !== null) return readinessGate;
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = sendForwardSchema.parse(args);
    const draftModule = new EmailForwardDraftModule();
    const revision = await draftModule.readRevision(input.revision_id);
    if (!revision || revision.draftId !== input.draft_id) {
      return { success: false, error: "Revision does not belong to the draft.", code: "REVISION_CHANGED" };
    }
    const authorizationModule = new EmailOrganizationAuthorizationModule();
    const authorization = await authorizationModule.issue({
      draftId: input.draft_id,
      revisionId: revision.id,
      payloadHash: revision.composedHash,
      origin: "tool_confirmation",
      userTurnId: context?.sourceUserMessageId ?? context?.toolCallId ?? null,
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    const delivery = new EmailForwardDeliveryService();
    const outcome = await delivery.sendApprovedForward({
      draftId: input.draft_id,
      revisionId: revision.id,
      authorizationId: authorization.id,
    });
    log.info(
      `[EmailOrganizationAiTools] send_email_forward outcome=${outcome.status} correlation=${outcome.requestCorrelationId}`
    );
    // R10: top-level success only for VERIFIED complete success; partial
    // acceptance, failure and unknowns surface through the envelope.
    if (outcome.status === "already_processed" && outcome.priorOutcome !== "succeeded") {
      return {
        success: false,
        error: `This forward was already attempted; the prior operation is ${outcome.priorOutcome}.`,
        code: "ALREADY_ATTEMPTED",
        result: { ...outcome } as unknown as Record<string, unknown>,
      };
    }
    if (outcome.status === "failed" || outcome.status === "outcome_unknown") {
      // R9-02: the all-rejected delivery return now carries sentCopyStatus
      // — the failed branch warns from it (AC-22 covers this surface too).
      if (
        outcome.status === "failed" &&
        (outcome.sentCopyStatus === "failed" || outcome.sentCopyStatus === "unknown")
      ) {
        const failedCopyWarning = await sentCopyWarningSentence(
          "failed",
          outcome.sentCopyStatus
        );
        return {
          success: false,
          error: outcome.error,
          code: outcome.code,
          warning: failedCopyWarning,
          result: { ...outcome } as unknown as Record<string, unknown>,
        };
      }
      // R8-03 (AC-22): the UNKNOWN return carries the Sent-copy warning too
      // — the status rides inside `result`, and the transcript sentence
      // uses the shared translated label instead of the raw token.
      const unknownCopyWarning =
        outcome.status === "outcome_unknown" &&
        outcome.sentCopyStatus !== undefined &&
        (outcome.sentCopyStatus === "failed" || outcome.sentCopyStatus === "unknown")
          ? await sentCopyWarningSentence("unknown", outcome.sentCopyStatus)
          : undefined;
      return {
        success: false,
        error:
          outcome.status === "failed"
            ? outcome.error
            : "Forward outcome unknown; check status before retrying.",
        code:
          outcome.status === "failed"
            ? outcome.code
            : "OUTCOME_UNKNOWN",
        ...(unknownCopyWarning !== undefined ? { warning: unknownCopyWarning } : {}),
        result: { ...outcome } as unknown as Record<string, unknown>,
      };
    }
    if (outcome.status === "submitted" && outcome.outcome === "partially_succeeded") {
      // R9-02 (AC-22): partial acceptance carries the Sent-copy sentence on
      // the surface the user is looking at — this turn's tool result.
      const partialCopyWarning =
        outcome.sentCopyStatus === "failed" || outcome.sentCopyStatus === "unknown"
          ? await sentCopyWarningSentence("submitted", outcome.sentCopyStatus)
          : undefined;
      return {
        success: false,
        error: "Partial recipient acceptance: not all recipients were accepted.",
        code: "PARTIAL_RECIPIENT_ACCEPTANCE",
        ...(partialCopyWarning !== undefined ? { warning: partialCopyWarning } : {}),
        result: { ...outcome } as unknown as Record<string, unknown>,
      };
    }
    // R7-03 (AC-22): the Sent-copy warning surfaces in the CHAT transcript
    // too — the status rides the envelope with a machine-readable code, so
    // a user who never opens the detail page still sees it.
    if (outcome.status === "submitted" && (outcome.sentCopyStatus === "failed" || outcome.sentCopyStatus === "unknown")) {
      return {
        success: true,
        warning: await sentCopyWarningSentence("submitted", outcome.sentCopyStatus),
        code: "SENT_COPY_UNVERIFIED",
        result: { ...outcome } as unknown as Record<string, unknown>,
      };
    }
    return { success: true, result: { ...outcome } };
  } catch (error) {
    return failure(error);
  }
}

export async function moveEmailToTrash(
  args: unknown,
  context?: SkillExecutionContext
): Promise<EmailOrganizationToolResult<{ result: Record<string, unknown> }>> {
  const scheduledGuard = assertInteractive(context);
    if (scheduledGuard !== null) return scheduledGuard;
    const readinessGate = gateOrganizationReadiness();
  if (readinessGate !== null) return readinessGate;
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = moveToTrashSchema.parse(args);
    const actionService = new EmailMailboxActionService();
    const result =
      input.selection_id !== undefined
        ? await actionService.trashSelection({
            selectionId: input.selection_id,
            origin: "tool_confirmation",
            actionId: actionIdFor(context),
          })
        : await actionService.trashMessage({
            messageId: input.message_id as number,
            origin: "tool_confirmation",
            actionId: actionIdFor(context),
          });
    // R10: a refused action is a failure envelope carrying the code — not a
    // success wrapper around a failed result.
    if (!result.success) {
      return {
        success: false,
        error: result.error ?? result.errorCode ?? result.status,
        code: result.errorCode ?? undefined,
        retryable: result.retryable,
        result: { ...result } as unknown as Record<string, unknown>,
      };
    }
    return { success: true, result: { ...result } };
  } catch (error) {
    return failure(error);
  }
}

export async function restoreEmail(
  args: unknown,
  context?: SkillExecutionContext
): Promise<EmailOrganizationToolResult<{ result: Record<string, unknown> }>> {
  const scheduledGuard = assertInteractive(context);
    if (scheduledGuard !== null) return scheduledGuard;
    const readinessGate = gateOrganizationReadiness();
  if (readinessGate !== null) return readinessGate;
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = restoreEmailSchema.parse(args);
    const actionService = new EmailMailboxActionService();
    const result =
      input.selection_id !== undefined
        ? await actionService.restoreSelection({
            selectionId: input.selection_id,
            origin: "tool_confirmation",
            actionId: actionIdFor(context),
          })
        : await actionService.restoreFromOperation({
            priorOperationId: input.operation_id as string,
            destinationFolderPath: input.destination_folder_path ?? null,
            origin: "tool_confirmation",
            actionId: actionIdFor(context),
          });
    if (!result.success) {
      return {
        success: false,
        error: result.error ?? result.errorCode ?? result.status,
        code: result.errorCode ?? undefined,
        retryable: result.retryable,
        result: { ...result } as unknown as Record<string, unknown>,
      };
    }
    return { success: true, result: { ...result } };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelEmailOperation(
  args: unknown
): Promise<EmailOrganizationToolResult<{ result: Record<string, unknown> }>> {
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = cancelOperationSchema.parse(args);
    const module = new EmailOrganizationOperationModule();
    const cancelled = await module.cancelPending(input.operation_id);
    const operation = await module.readOperation(input.operation_id);
    const items = operation ? await module.listItems(operation.operationId) : [];
    return {
      success: true,
      result: {
        cancelled,
        operation: operation ? projectOperation(operation, items) : null,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

// ---- Stage C: search + frozen selections ----

export async function searchEmails(
  args: unknown
): Promise<EmailOrganizationToolResult<{ search: OrganizationSearchResult }>> {
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = searchEmailsSchema.parse(args);
    const service = new EmailOrganizationSearchService();
    const search = await service.search({
      emailServiceId: input.email_service_id,
      source: input.source,
      folderPaths: input.folder_paths,
      fromAddress: input.from_address,
      subject: input.subject,
      receivedFrom: input.received_from,
      receivedTo: input.received_to,
      unreadOnly: input.unread_only,
      hasAttachments: input.has_attachments,
      pageSize: input.page_size,
      cursor: input.cursor,
    });
    return { success: true, search };
  } catch (error) {
    return failure(error);
  }
}

export async function prepareEmailSelection(
  args: unknown,
  context?: SkillExecutionContext
): Promise<EmailOrganizationToolResult<{ selection: Record<string, unknown> }>> {
  const readinessGate = gateOrganizationReadiness();
  if (readinessGate !== null) return readinessGate;
  const gate = await gateAiEntitlement();
    if (gate !== null) return gate;
    try {
    const input = prepareSelectionSchema.parse(args);
    const service = new EmailOrganizationSelectionService();
    const selection = await service.prepareSelection({
      emailServiceId: input.email_service_id,
      kind: input.kind,
      messageIds: input.message_ids,
      filtersSummary: input.filters_summary,
      ownerContext: context?.sourceUserMessageId ?? context?.toolCallId ?? null,
    });
    return { success: true, selection: { ...selection } };
  } catch (error) {
    return failure(error);
  }
}

// ---- helpers ----

function mapSelection(
  selection: z.infer<typeof attachmentSelectionSchema> | undefined
): { mode: "all" } | { mode: "none" } | { mode: "parts"; partIds: readonly string[] } {
  if (!selection) return { mode: "all" };
  if (selection.mode === "parts") {
    return { mode: "parts", partIds: selection.part_ids };
  }
  return { mode: selection.mode };
}

/**
 * R5-02: reads the durable Sent-copy status from an item's result evidence.
 * Absent evidence → null (the caller renders nothing rather than guessing).
 */
export function sentCopyStatusFromResultJson(
  resultJson: string | null
): EmailSentCopyStatus | null {
  if (resultJson === null) return null;
  try {
    const parsed = JSON.parse(resultJson) as { sentCopyStatus?: unknown };
    if (
      parsed.sentCopyStatus === "not_requested" ||
      parsed.sentCopyStatus === "pending" ||
      parsed.sentCopyStatus === "saved" ||
      parsed.sentCopyStatus === "failed" ||
      parsed.sentCopyStatus === "unknown"
    ) {
      return parsed.sentCopyStatus;
    }
    return null;
  } catch {
    return null;
  }
}

/** Public operation projection (safe per-item detail, no bodies/credentials). */
export function projectOperation(
  operation: {
    operationId: string;
    kind: string;
    status: string;
    emailServiceId: number;
    completedCount: number;
    failedCount: number;
    unknownCount: number;
    pendingCount: number;
    cancelledCount: number;
    errorCode: string | null;
    requestedAt: Date;
    completedAt: Date | null;
    cancelRequestedAt: Date | null;
  },
  items: Array<{
    id: number;
    messageId: number;
    status: EmailOrganizationItemStatus;
    beforeFolderPath: string | null;
    destinationFolderPath: string | null;
    errorCode: string | null;
    sanitizedError: string | null;
    acceptedRecipientsJson: string | null;
    rejectedRecipientsJson: string | null;
    unknownRecipientsJson: string | null;
    resultJson?: string | null;
  }>
): EmailOrganizationOperationDto {

  return {
    operationId: operation.operationId,
    kind: operation.kind as EmailOrganizationOperationDto["kind"],
    status: operation.status as EmailOrganizationOperationDto["status"],
    emailServiceId: operation.emailServiceId,
    itemCounts: {
      completed: operation.completedCount,
      failed: operation.failedCount,
      unresolved: operation.unknownCount,
      pending: operation.pendingCount,
      cancelled: operation.cancelledCount,
    },
    items: items.map((item) => ({
      itemId: item.id,
      messageId: item.messageId,
      status: item.status,
      beforeFolderPath: item.beforeFolderPath,
      destinationFolderPath: item.destinationFolderPath,
      errorCode: item.errorCode,
      sanitizedError: item.sanitizedError,
      recipientOutcomes: [
        ...parseStringArrayJson(item.acceptedRecipientsJson).map((address) => ({ address, outcome: "accepted" as const })),
        ...parseStringArrayJson(item.rejectedRecipientsJson).map((address) => ({ address, outcome: "rejected" as const })),
        ...parseStringArrayJson(item.unknownRecipientsJson).map((address) => ({ address, outcome: "unknown" as const })),
      ],
      // R5-02: the Sent-copy status is projected so the card and the tool
      // can warn separately from the submission outcome (AC-22).
      ...(operation.kind === "forward"
        ? { sentCopyStatus: sentCopyStatusFromResultJson(item.resultJson ?? null) }
        : {}),
    })),
    createdAt: operation.requestedAt.toISOString(),
    completedAt: operation.completedAt ? operation.completedAt.toISOString() : null,
    cancelRequestedAt: operation.cancelRequestedAt ? operation.cancelRequestedAt.toISOString() : null,
    errorCode: operation.errorCode,
    retryable: isRetryableOrganizationErrorCode(operation.errorCode),
  };
}
