import { log } from "@/modules/Logger";
import {
  registerValidatedHandler,
  registerAiValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import { StructuredIpcError } from "@/main-process/communication/_shared/StructuredIpcError";
import {
  EMAIL_ORG_CAPABILITIES,
  EMAIL_ORG_FOLDERS,
  EMAIL_FORWARD_DRAFT_CREATE,
  EMAIL_FORWARD_DRAFT_UPDATE,
  EMAIL_FORWARD_DRAFT_DETAIL,
  EMAIL_FORWARD_DRAFT_DISCARD,
  EMAIL_ORG_AUTHORIZE,
  EMAIL_ORG_SEND,
  EMAIL_ORG_TRASH,
  EMAIL_ORG_RESTORE,
  EMAIL_ORG_OPERATION_GET,
  EMAIL_ORG_OPERATION_CANCEL,
  EMAIL_ORG_OPERATION_RECONCILE,
} from "@/config/channellist";
import {
  emailOrgAccountInputSchema,
  emailForwardDraftCreateInputSchema,
  emailForwardDraftUpdateInputSchema,
  emailForwardDraftDetailInputSchema,
  emailOrgAuthorizeInputSchema,
  emailOrgSendInputSchema,
  emailOrgTrashInputSchema,
  emailOrgRestoreInputSchema,
  emailOrgOperationInputSchema,
} from "@/schemas/ipc/emailOrganization";
import { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import { EmailForwardDraftService } from "@/service/emailOrganization/EmailForwardDraftService";
import { EmailForwardDeliveryService } from "@/service/emailOrganization/EmailForwardDeliveryService";
import { EmailMailboxActionService } from "@/service/emailOrganization/EmailMailboxActionService";
import { EmailOrganizationOperationModule } from "@/modules/EmailOrganizationOperationModule";
import { EmailOrganizationAuthorizationModule } from "@/modules/EmailOrganizationAuthorizationModule";
import { projectOperation } from "@/service/EmailOrganizationAiTools";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";

/**
 * Email organization IPC surface (design §8.2).
 *
 * - Manual mailbox controls (capabilities, folders, trash, restore, send,
 *   status, cancel, reconcile) use ordinary validated handlers: they remain
 *   available independently of AI entitlement under the same action
 *   authorization rules.
 * - Draft create/update serve AI-function requests, so they run behind the
 *   AI enablement gate (checked before schema parsing) AND the same
 *   validation/authorization as the manual path — a renderer cannot label
 *   an AI request "manual" to bypass anything, because both paths share the
 *   services and all authorization is server-held.
 *
 * The review→send flow mirrors the reply approve/send wiring: the review
 * dialog authorizes the displayed revision (one-time, 15-minute, hash-bound
 * authorization) and the send call consumes it. No raw token round-trips.
 */

function toStructuredError(error: unknown): never {
  if (error instanceof Error && error.name === "EmailOrganizationActionError") {
    const actionError = error as Error & { code: string; retryable: boolean };
    throw new StructuredIpcError(actionError.message, {
      code: actionError.code,
      next_action: actionError.retryable ? "retry_allowed" : "no_action",
    });
  }
  throw error as Error;
}

function newUiActionId(): string {
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Module-scoped so the 5-minute capability cache actually serves its TTL
// across IPC calls instead of being re-created (and re-probed) per request.
let capabilityServiceSingleton: EmailOrganizationCapabilityService | null = null;
function getCapabilityService(): EmailOrganizationCapabilityService {
  if (capabilityServiceSingleton === null) {
    capabilityServiceSingleton = new EmailOrganizationCapabilityService();
  }
  return capabilityServiceSingleton;
}

export function registerEmailOrganizationIpcHandlers(): void {
  const capabilityService = getCapabilityService;

  // ---- Read-only account introspection (manual controls) ----
  registerValidatedHandler(
    EMAIL_ORG_CAPABILITIES,
    emailOrgAccountInputSchema,
    async (input) => {
      try {
        return await capabilityService().getCapabilities(input.emailServiceId);
      } catch (error) {
        log.error("EMAIL_ORG_CAPABILITIES failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  registerValidatedHandler(
    EMAIL_ORG_FOLDERS,
    emailOrgAccountInputSchema,
    async (input) => {
      try {
        return { folders: await capabilityService().listFolders(input.emailServiceId) };
      } catch (error) {
        log.error("EMAIL_ORG_FOLDERS failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  // ---- Draft lifecycle (create/update are AI-gated; detail/discard manual) ----
  registerAiValidatedHandler(
    EMAIL_FORWARD_DRAFT_CREATE,
    emailForwardDraftCreateInputSchema,
    async (input) => {
      try {
        const service = new EmailForwardDraftService();
        return await service.createDraft({
          messageId: input.messageId,
          to: input.to ?? [],
          cc: input.cc,
          bcc: input.bcc,
          note: input.note ?? null,
          subject: input.subject ?? null,
          attachmentSelection: input.attachments ?? { mode: "all" },
          senderServiceId: input.senderServiceId ?? null,
          provenance: "ai",
          origin: "tool_confirmation",
        });
      } catch (error) {
        log.error("EMAIL_FORWARD_DRAFT_CREATE failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  registerAiValidatedHandler(
    EMAIL_FORWARD_DRAFT_UPDATE,
    emailForwardDraftUpdateInputSchema,
    async (input) => {
      try {
        const service = new EmailForwardDraftService();
        return await service.updateDraft({
          draftId: input.draftId,
          expectedRevisionId: input.expectedRevisionId,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          note: input.note,
          subject: input.subject,
          attachmentSelection: input.attachments,
        });
      } catch (error) {
        log.error("EMAIL_FORWARD_DRAFT_UPDATE failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  registerValidatedHandler(
    EMAIL_FORWARD_DRAFT_DETAIL,
    emailForwardDraftDetailInputSchema,
    async (input) => {
      try {
        const service = new EmailForwardDraftService();
        return await service.readDraftDetail(input.draftId);
      } catch (error) {
        log.error("EMAIL_FORWARD_DRAFT_DETAIL failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  registerValidatedHandler(
    EMAIL_FORWARD_DRAFT_DISCARD,
    emailForwardDraftDetailInputSchema,
    async (input) => {
      try {
        const service = new EmailForwardDraftService();
        await service.discardDraft(input.draftId);
        return { discarded: true };
      } catch (error) {
        log.error("EMAIL_FORWARD_DRAFT_DISCARD failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  // ---- Review authorize + send (one-time hash-bound authorization) ----
  registerValidatedHandler(
    EMAIL_ORG_AUTHORIZE,
    emailOrgAuthorizeInputSchema,
    async (input) => {
      try {
        const service = new EmailForwardDraftService();
        const draft = await service.readDraftDetail(input.draftId);
        if (draft.revisionId !== input.revisionId) {
          throw new StructuredIpcError("The draft changed; re-open the review dialog.", {
            code: "REVISION_CHANGED",
          });
        }
        if (draft.expired) {
          throw new StructuredIpcError("The draft content expired; refresh the review dialog.", {
            code: "APPROVAL_EXPIRED",
          });
        }
        const authorizationModule = new EmailOrganizationAuthorizationModule();
        const issued = await authorizationModule.issue({
          draftId: draft.draftId,
          revisionId: draft.revisionId,
          payloadHash: draft.composedHash,
          origin: "ui_review",
          userTurnId: null,
          expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
        });
        return { authorizationId: issued.id, expiresInSeconds: EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs / 1000 };
      } catch (error) {
        log.error("EMAIL_ORG_AUTHORIZE failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  registerValidatedHandler(
    EMAIL_ORG_SEND,
    emailOrgSendInputSchema,
    async (input) => {
      try {
        const delivery = new EmailForwardDeliveryService();
        return await delivery.sendApprovedForward({
          draftId: input.draftId,
          revisionId: input.revisionId,
          authorizationId: input.authorizationId,
        });
      } catch (error) {
        log.error("EMAIL_ORG_SEND failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  // ---- Mailbox mutations (manual controls; AI tool path is separate) ----
  registerValidatedHandler(EMAIL_ORG_TRASH, emailOrgTrashInputSchema, async (input) => {
    try {
      const actionService = new EmailMailboxActionService();
      return await actionService.trashMessage({
        messageId: input.messageId,
        origin: "ui_action",
        actionId: input.actionId ?? newUiActionId(),
      });
    } catch (error) {
      log.error("EMAIL_ORG_TRASH failed:", error);
      throw toStructuredError(error);
    }
  });

  registerValidatedHandler(EMAIL_ORG_RESTORE, emailOrgRestoreInputSchema, async (input) => {
    try {
      const actionService = new EmailMailboxActionService();
      return await actionService.restoreFromOperation({
        priorOperationId: input.operationId,
        destinationFolderPath: input.destinationFolderPath ?? null,
        origin: "ui_action",
        actionId: newUiActionId(),
      });
    } catch (error) {
      log.error("EMAIL_ORG_RESTORE failed:", error);
      throw toStructuredError(error);
    }
  });

  // ---- Operation status / cancel / reconcile ----
  registerValidatedHandler(
    EMAIL_ORG_OPERATION_GET,
    emailOrgOperationInputSchema,
    async (input) => {
      try {
        const module = new EmailOrganizationOperationModule();
        const operation = await module.readOperation(input.operationId);
        if (!operation) return { operation: null };
        const items = await module.listItems(operation.operationId);
        return { operation: projectOperation(operation, items) };
      } catch (error) {
        log.error("EMAIL_ORG_OPERATION_GET failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  registerValidatedHandler(
    EMAIL_ORG_OPERATION_CANCEL,
    emailOrgOperationInputSchema,
    async (input) => {
      try {
        const module = new EmailOrganizationOperationModule();
        const cancelled = await module.cancelPending(input.operationId);
        const operation = await module.readOperation(input.operationId);
        const items = operation ? await module.listItems(operation.operationId) : [];
        return {
          cancelled,
          operation: operation ? projectOperation(operation, items) : null,
        };
      } catch (error) {
        log.error("EMAIL_ORG_OPERATION_CANCEL failed:", error);
        throw toStructuredError(error);
      }
    }
  );

  registerValidatedHandler(
    EMAIL_ORG_OPERATION_RECONCILE,
    emailOrgOperationInputSchema,
    async (input) => {
      try {
        const actionService = new EmailMailboxActionService();
        return await actionService.reconcileOperation(input.operationId);
      } catch (error) {
        log.error("EMAIL_ORG_OPERATION_RECONCILE failed:", error);
        throw toStructuredError(error);
      }
    }
  );
}
