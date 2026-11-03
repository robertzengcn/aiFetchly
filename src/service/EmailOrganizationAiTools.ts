import { z } from "zod";
import { EmailForwardDraftService } from "@/service/emailOrganization/EmailForwardDraftService";
import { EmailForwardDeliveryService } from "@/service/emailOrganization/EmailForwardDeliveryService";
import { EmailMailboxActionService } from "@/service/emailOrganization/EmailMailboxActionService";
import { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import { EmailOrganizationOperationModule } from "@/modules/EmailOrganizationOperationModule";
import { isRetryableOrganizationErrorCode } from "@/service/emailOrganization/EmailOrganizationErrors";
import { EmailOrganizationAuthorizationModule } from "@/modules/EmailOrganizationAuthorizationModule";
import { EmailForwardDraftModule } from "@/modules/EmailForwardDraftModule";
import type { ForwardDraftPreview } from "@/service/emailOrganization/EmailForwardDraftService";
import type { EmailOrganizationOperationDto } from "@/entityTypes/emailOrganizationTypes";
import type { EmailOrganizationItemStatus } from "@/entityTypes/emailOrganizationTypes";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { log } from "@/modules/Logger";
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

const moveToTrashSchema = z.object({
  message_id: positiveInt,
});

const restoreEmailSchema = z.object({
  operation_id: z.string().min(8).max(64),
  destination_folder_path: z.string().max(255).optional(),
});

const getOperationSchema = z.object({
  operation_id: z.string().min(8).max(64),
});

const cancelOperationSchema = z.object({
  operation_id: z.string().min(8).max(64),
});

export type EmailOrganizationToolResult<T> =
  | ({ success: true } & T & Record<string, unknown>)
  | { success: false; error: string; code?: string; retryable?: boolean };

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
  try {
    const input = createForwardDraftSchema.parse(args);
    const service = new EmailForwardDraftService();
    const draft = await service.createDraft({
      messageId: input.message_id,
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
    return { success: true, result: { ...outcome } };
  } catch (error) {
    return failure(error);
  }
}

export async function moveEmailToTrash(
  args: unknown,
  context?: SkillExecutionContext
): Promise<EmailOrganizationToolResult<{ result: Record<string, unknown> }>> {
  try {
    const input = moveToTrashSchema.parse(args);
    const actionService = new EmailMailboxActionService();
    const result = await actionService.trashMessage({
      messageId: input.message_id,
      origin: "tool_confirmation",
      actionId: actionIdFor(context),
    });
    return { success: true, result: { ...result } };
  } catch (error) {
    return failure(error);
  }
}

export async function restoreEmail(
  args: unknown,
  context?: SkillExecutionContext
): Promise<EmailOrganizationToolResult<{ result: Record<string, unknown> }>> {
  try {
    const input = restoreEmailSchema.parse(args);
    const actionService = new EmailMailboxActionService();
    const result = await actionService.restoreFromOperation({
      priorOperationId: input.operation_id,
      destinationFolderPath: input.destination_folder_path ?? null,
      origin: "tool_confirmation",
      actionId: actionIdFor(context),
    });
    return { success: true, result: { ...result } };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelEmailOperation(
  args: unknown
): Promise<EmailOrganizationToolResult<{ result: Record<string, unknown> }>> {
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
    })),
    createdAt: operation.requestedAt.toISOString(),
    completedAt: operation.completedAt ? operation.completedAt.toISOString() : null,
    cancelRequestedAt: operation.cancelRequestedAt ? operation.cancelRequestedAt.toISOString() : null,
    errorCode: operation.errorCode,
    retryable: isRetryableOrganizationErrorCode(operation.errorCode),
  };
}
