import { BrowserWindow } from "electron";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import {
  OUTBOUND_EMAIL_BATCH_GET,
  OUTBOUND_EMAIL_DRAFT_UPDATE,
  OUTBOUND_EMAIL_BATCH_APPROVE,
  OUTBOUND_EMAIL_BATCH_SEND,
  OUTBOUND_EMAIL_BATCH_DISCARD,
  OUTBOUND_EMAIL_BATCH_STATUS,
  OUTBOUND_EMAIL_BATCH_PROGRESS,
} from "@/config/channellist";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  outboundEmailBatchGetInputSchema,
  outboundEmailDraftUpdateInputSchema,
  outboundEmailBatchApproveInputSchema,
  outboundEmailBatchSendInputSchema,
  outboundEmailBatchDiscardInputSchema,
  outboundEmailBatchStatusInputSchema,
} from "@/schemas/ipc/outboundEmail";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailPreflightService } from "@/service/outboundEmail/OutboundEmailPreflightService";
import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { BatchEnvelopeEntry } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { AuthorizedEmailWorkerEvent } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * IPC layer for the intent-aware outbound-email delivery pipeline (technical
 * design §17). Every handler validates its input with a Zod schema, then calls
 * a service/model — never a repository directly. The review/approve/send/
 * discard/status channels are plain (not AI-gated): they operate on
 * already-authorized state and must stay usable for inspection even when AI is
 * disabled.
 *
 * Raw approval tokens and SMTP credentials never cross to the renderer
 * (§17.1). The BATCH_SEND handler returns only a status + attemptId; the
 * worker payload (which carries service credentials) is built inside the
 * injected workerStarter and sent to the utility process over a MessagePort,
 * never through IPC to the renderer.
 */

export interface OutboundEmailDeliveryIpcOptions {
  readonly dbpath?: string;
  /**
   * Builds the versioned worker payload + credentials and starts the utility
   * process (§15.2). Injected so tests substitute a fake. Throwing indicates a
   * definite pre-acceptance failure (the delivery service records it as
   * worker_start_failed).
   */
  readonly workerStarter?: (
    attemptId: number,
    batch: Awaited<ReturnType<OutboundEmailDraftModel["readBatch"]>>,
    drafts: ReadonlyArray<{
      draft: Awaited<ReturnType<OutboundEmailDraftModel["readDraft"]>>;
      revision: Awaited<
        ReturnType<OutboundEmailDraftModel["readCurrentRevision"]>
      >;
    }>,
    authorization: Awaited<
      ReturnType<OutboundEmailAuthorizationService["read"]>
    >
  ) => Promise<{ started: boolean }>;
}

/** Resolve the DB path from the Token service (production) or an override. */
function resolveDbpath(override?: string): string {
  if (override) return override;
  return new Token().getValue(USERSDBPATH) ?? "";
}

/**
 * Register the six §17 invoke handlers. Call once during app startup from
 * `registerCommunicationIpcHandlers`. The progress channel is push-only — it
 * has no invoke handler; {@link broadcastOutboundEmailProgress} sends worker
 * events to the renderer.
 */
export function registerOutboundEmailDeliveryIpcHandlers(
  options: OutboundEmailDeliveryIpcOptions = {}
): void {
  const dbpath = resolveDbpath(options.dbpath);

  // OUTBOUND_EMAIL_BATCH_GET — load batch + drafts + current revision +
  // findings summary so the review UI can render (§17, §18).
  registerValidatedHandler(
    OUTBOUND_EMAIL_BATCH_GET,
    outboundEmailBatchGetInputSchema,
    async (input) => {
      const draftModel = new OutboundEmailDraftModel(dbpath);
      const batch = await draftModel.readBatch(input.batchId);
      if (!batch) {
        throw new Error("batch_not_found");
      }
      const drafts = await draftModel.listDraftsByBatch(input.batchId);
      const views = await Promise.all(
        drafts.map(async (draft) => {
          const revision = await draftModel.readCurrentRevision(draft.id);
          return {
            id: draft.id,
            recipientAddress: draft.recipientAddress,
            recipientDisplayName: draft.recipientDisplayName,
            status: draft.status,
            revisionNumber: draft.revisionNumber,
            subject: revision?.subject ?? "",
            bodyText: revision?.bodyText ?? "",
            bodyHtml: revision?.bodyHtml ?? null,
            emailServiceId: revision?.emailServiceId ?? null,
            senderAddress: revision?.senderAddress ?? null,
          };
        })
      );
      return {
        batch: {
          id: batch.id,
          status: batch.status,
          batchHash: batch.batchHash,
          conversationId: batch.conversationId,
          recipientCount: batch.recipientCount,
        },
        drafts: views,
      };
    }
  );

  // OUTBOUND_EMAIL_DRAFT_UPDATE — create a new user revision for one draft
  // (§18). Editing creates a new revision and invalidates any prior approval.
  registerValidatedHandler(
    OUTBOUND_EMAIL_DRAFT_UPDATE,
    outboundEmailDraftUpdateInputSchema,
    async (input) => {
      const draftModel = new OutboundEmailDraftModel(dbpath);
      const draft = await draftModel.readDraft(input.draftId);
      if (!draft) {
        throw new Error("draft_not_found");
      }
      const envelope: BatchEnvelopeEntry = {
        version: 1,
        draftId: draft.id,
        emailServiceId: input.emailServiceId,
        senderAddress: input.senderAddress,
        recipientAddress: draft.recipientAddress,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
      };
      const contentHash = OutboundEmailEnvelopeHasher.hashEnvelope(envelope);
      const revision = await draftModel.appendRevision({
        draftId: draft.id,
        actor: "user",
        emailServiceId: input.emailServiceId,
        senderAddress: input.senderAddress,
        recipientAddress: draft.recipientAddress,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        contentHash,
      });

      // Recompute the batch hash over every current revision and persist it.
      const allDrafts = await draftModel.listDraftsByBatch(draft.batchId);
      const envelopes: BatchEnvelopeEntry[] = [];
      for (const d of allDrafts) {
        const rev = await draftModel.readCurrentRevision(d.id);
        if (!rev) continue;
        envelopes.push({
          version: 1,
          draftId: d.id,
          emailServiceId: rev.emailServiceId,
          senderAddress: rev.senderAddress,
          recipientAddress: rev.recipientAddress,
          subject: rev.subject,
          bodyText: rev.bodyText,
          bodyHtml: rev.bodyHtml,
        });
      }
      const batchHash = OutboundEmailEnvelopeHasher.hashBatch(envelopes);
      await draftModel.updateBatchHash(draft.batchId, batchHash);

      // §13.3 — any envelope change invalidates the active authorization and
      // returns the batch to draft_ready.
      const authz = new OutboundEmailAuthorizationService(dbpath);
      await authz.invalidateOnRevisionChange(draft.batchId, "draft_edited");

      return {
        revisionId: revision.id,
        batchHash,
        batchStatus: "draft_ready",
      };
    }
  );

  // OUTBOUND_EMAIL_BATCH_APPROVE — rerun preflight and create a review approval
  // (§17, §13.2). The caller supplies the batchHash it reviewed so a
  // changed-since-review race is caught by the authorization service.
  registerValidatedHandler(
    OUTBOUND_EMAIL_BATCH_APPROVE,
    outboundEmailBatchApproveInputSchema,
    async (input) => {
      const draftModel = new OutboundEmailDraftModel(dbpath);
      const batch = await draftModel.readBatch(input.batchId);
      if (!batch) {
        throw new Error("batch_not_found");
      }
      // Defense-in-depth: the caller's reviewed hash must match the persisted
      // batch hash before we authorize.
      if (batch.batchHash !== input.batchHash) {
        throw new Error("batch_hash_mismatch");
      }

      // Rerun preflight over every current revision (§12).
      const drafts = await draftModel.listDraftsByBatch(input.batchId);
      const entries = await Promise.all(
        drafts.map(async (draft) => {
          const revision = await draftModel.readCurrentRevision(draft.id);
          const envelope: BatchEnvelopeEntry | null = revision
            ? {
                version: 1,
                draftId: draft.id,
                emailServiceId: revision.emailServiceId,
                senderAddress: revision.senderAddress,
                recipientAddress: revision.recipientAddress,
                subject: revision.subject,
                bodyText: revision.bodyText,
                bodyHtml: revision.bodyHtml,
              }
            : null;
          return {
            view: { draft, revision },
            envelope,
            storedHash: revision?.contentHash ?? null,
          };
        })
      );
      const preflight = new OutboundEmailPreflightService().run(entries);
      if (!preflight.passed) {
        // Map the first blocking finding to a stable error code (§20).
        const blocking = preflight.findings.find((f) => f.severity === "block");
        throw new Error(
          `preflight_failed: ${blocking?.code ?? "blocking_findings"}`
        );
      }

      const authz = new OutboundEmailAuthorizationService(dbpath);
      const approval = await authz.createReviewApproval({
        batchId: input.batchId,
        batchHash: input.batchHash,
        sourceUserMessageId: batch.sourceUserMessageId,
      });
      if (!approval.success) {
        throw new Error(approval.code ?? "approval_failed");
      }
      // The raw token is returned ONCE (§13.2); only the hash is persisted.
      return {
        authorizationId: approval.authorizationId,
        token: approval.token,
        batchHash: approval.batchHash,
      };
    }
  );

  // OUTBOUND_EMAIL_BATCH_SEND — claim + start authorized delivery (§15). The
  // claim transaction is idempotent; a duplicate returns already_processed.
  registerValidatedHandler(
    OUTBOUND_EMAIL_BATCH_SEND,
    outboundEmailBatchSendInputSchema,
    async (input) => {
      const delivery = new OutboundEmailDeliveryService({
        dbpath,
        workerStarter: options.workerStarter,
      });
      const result = await delivery.claim({
        batchId: input.batchId,
        authorizationId: input.authorizationId,
        batchHash: input.batchHash,
      });
      return {
        status: result.status,
        attemptId: result.attemptId,
      };
    }
  );

  // OUTBOUND_EMAIL_BATCH_DISCARD — discard an unsent batch (§17).
  registerValidatedHandler(
    OUTBOUND_EMAIL_BATCH_DISCARD,
    outboundEmailBatchDiscardInputSchema,
    async (input) => {
      const draftModel = new OutboundEmailDraftModel(dbpath);
      const authz = new OutboundEmailAuthorizationService(dbpath);
      await authz.invalidateOnRevisionChange(input.batchId, "batch_discarded");
      await draftModel.updateBatchStatus(input.batchId, "discarded");
      return { discarded: true };
    }
  );

  // OUTBOUND_EMAIL_BATCH_STATUS — refresh attempt + outcomes for a batch (§17).
  registerValidatedHandler(
    OUTBOUND_EMAIL_BATCH_STATUS,
    outboundEmailBatchStatusInputSchema,
    async (input) => {
      const draftModel = new OutboundEmailDraftModel(dbpath);
      const deliveryModel = new OutboundEmailDeliveryModel(dbpath);
      const batch = await draftModel.readBatch(input.batchId);
      if (!batch) {
        throw new Error("batch_not_found");
      }
      const attempt = batch.sendAttemptId
        ? await deliveryModel.readAttempt(batch.sendAttemptId)
        : null;
      const outcomes = await deliveryModel.listOutcomesByBatch(input.batchId);
      return {
        batchStatus: batch.status,
        attempt: attempt ? { id: attempt.id, status: attempt.status } : null,
        outcomes: outcomes.map((o) => ({
          id: o.id,
          draftId: o.draftId,
          recipientAddress: o.recipientAddress,
          status: o.status,
          errorCode: o.errorCode ?? null,
          providerMessageId: o.providerMessageId ?? null,
        })),
      };
    }
  );
}

/**
 * Broadcast a typed worker event to every live browser window on the
 * OUTBOUND_EMAIL_BATCH_PROGRESS channel (§6.4, §17). Called by the worker-IPC
 * bridge when a `sendAuthorizedEmails` utility process posts an
 * `OutboundEmailDeliveryEvent`. Safe to call when no windows exist.
 */
export function broadcastOutboundEmailProgress(
  event: AuthorizedEmailWorkerEvent
): void {
  const windows = BrowserWindow.getAllWindows() as Array<{
    isDestroyed: () => boolean;
    webContents: {
      send: (channel: string, payload: unknown) => void;
    };
  }>;
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(OUTBOUND_EMAIL_BATCH_PROGRESS, event);
    }
  }
}
