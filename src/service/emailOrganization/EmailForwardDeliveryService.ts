import crypto from "crypto";
import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import { EmailForwardDraftModule } from "@/modules/EmailForwardDraftModule";
import { EmailOrganizationOperationModule } from "@/modules/EmailOrganizationOperationModule";
import { EmailOrganizationAuthorizationModule } from "@/modules/EmailOrganizationAuthorizationModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { OutboundSmtpSession } from "@/modules/lib/smtpTransport";
import type { SendMailOptions } from "nodemailer";
import { EmailMessageLocationModule } from "@/modules/EmailMessageLocationModule";
import type { EmailForwardAttachmentManifestEntry } from "@/entityTypes/emailOrganizationTypes";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";
import { EmailOrganizationArtifactStore, type EmailOrganizationArtifactBackend } from "@/service/emailOrganization/EmailOrganizationArtifactStore";
import { ImapEmailMailboxAdapter } from "@/service/emailOrganization/ImapEmailMailboxAdapter";
import type { EmailMailboxAdapter } from "@/service/emailOrganization/EmailMailboxAdapter";
import {
  hashClaimToken,
  generateClaimToken,
} from "@/service/emailOrganization/EmailForwardEnvelopeHasher";
import type { EmailSentCopyStatus } from "@/entityTypes/emailOrganizationTypes";

/**
 * Forward delivery (technical design §9.3): authorization → frozen payload
 * validation → durable operation + claim → identity/config recheck → one
 * SMTP submission → per-recipient outcome persistence → Sent-copy status
 * tracked separately (Stage B: not_requested). Never resubmits: duplicates
 * resolve to the existing operation, and unknown outcomes are recorded as
 * unknown (AC-10/AC-11/AC-18/AC-22).
 */

export interface SenderParam {
  readonly id: number;
  readonly from: string;
  readonly password: string;
  readonly host: string;
  readonly port: string;
  readonly name: string;
  readonly ssl: number;
  readonly smtpUsername?: string | null;
  readonly replyTo?: string | null;
}

interface SubmissionInfo {
  readonly accepted?: ReadonlyArray<string | { address?: string }> | boolean;
  readonly rejected?: ReadonlyArray<string | { address?: string }>;
  readonly messageId?: string;
  readonly response?: string;
  /** T16: nodemailer exposes the raw composed MIME for Sent-copy append. */
  readonly raw?: Buffer;
}

export interface ForwardSender {
  sendMail(options: SendMailOptions): Promise<SubmissionInfo>;
}

export type ForwardSenderFactory = (param: SenderParam) => ForwardSender;

export interface SendForwardInput {
  readonly draftId: number;
  readonly revisionId: number;
  readonly authorizationId: number;
}

export type SendForwardOutcome =
  | {
      readonly status: "submitted";
      /** succeeded = every envelope recipient accepted; partial otherwise. */
      readonly outcome: "succeeded" | "partially_succeeded";
      readonly operationId: string;
      readonly accepted: readonly string[];
      readonly rejected: readonly string[];
      readonly unknown: readonly string[];
      readonly requestCorrelationId: string;
    }
  | {
      readonly status: "failed";
      readonly operationId: string | null;
      readonly code: string;
      readonly error: string;
      readonly requestCorrelationId: string;
    }
  | {
      readonly status: "outcome_unknown";
      readonly operationId: string;
      readonly requestCorrelationId: string;
    }
  | {
      readonly status: "already_processed";
      /** T12: the prior operation's durable status (may be failed/unknown). */
      readonly priorOutcome: string;
      readonly operationId: string;
      readonly requestCorrelationId: string;
    };

function newCorrelationId(): string {
  return `fwd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildForwardIdempotencyKey(
  draftId: number,
  revisionId: number,
  composedHash: string
): string {
  return `fwv1:${draftId}:${revisionId}:${composedHash}`;
}

export class EmailForwardDeliveryService extends BaseModule {
  private readonly draftModule: EmailForwardDraftModule;
  private readonly operationModule: EmailOrganizationOperationModule;
  private readonly authorizationModule: EmailOrganizationAuthorizationModule;
  private readonly serviceModule: EmailServiceModule;
  private readonly locationModule: EmailMessageLocationModule;
  private readonly artifactStore: EmailOrganizationArtifactBackend;
  private readonly adapter: EmailMailboxAdapter;
  private readonly senderFactory: ForwardSenderFactory;

  constructor(options?: {
    senderFactory?: ForwardSenderFactory;
    adapter?: EmailMailboxAdapter;
    artifactStore?: EmailOrganizationArtifactBackend;
  }) {
    super();
    this.draftModule = new EmailForwardDraftModule();
    this.operationModule = new EmailOrganizationOperationModule();
    this.authorizationModule = new EmailOrganizationAuthorizationModule();
    this.serviceModule = new EmailServiceModule();
    this.locationModule = new EmailMessageLocationModule();
    this.artifactStore =
      options?.artifactStore ?? new EmailOrganizationArtifactStore(this.dbpath || ".");
    this.adapter = options?.adapter ?? new ImapEmailMailboxAdapter();
    this.senderFactory =
      options?.senderFactory ?? createOutboundSenderFactory();
  }

  async sendApprovedForward(input: SendForwardInput): Promise<SendForwardOutcome> {
    const requestCorrelationId = newCorrelationId();
    await this.ensureConnection();

    const draft = await this.draftModule.readDraft(input.draftId);
    if (!draft) {
      return { status: "failed", operationId: null, code: "SOURCE_NOT_FOUND", error: "Draft not found.", requestCorrelationId };
    }
    const revision = await this.draftModule.readRevision(input.revisionId);
    if (!revision || revision.draftId !== draft.id) {
      return { status: "failed", operationId: null, code: "REVISION_CHANGED", error: "Revision does not belong to the draft.", requestCorrelationId };
    }
    if (draft.currentRevisionId !== revision.id) {
      return { status: "failed", operationId: null, code: "REVISION_CHANGED", error: "A newer revision exists; re-review the draft.", requestCorrelationId };
    }

    // ---- Replay check BEFORE draft-status and authorization gates (reply
    // R14 pattern): a duplicate invocation resolves to the existing
    // operation, never a fresh send attempt. ----
    const replayKey = buildForwardIdempotencyKey(draft.id, revision.id, revision.composedHash);
    const existingOperation = await this.operationModule.findByIdempotencyKey(replayKey);
    if (existingOperation) {
      // T12: the duplicate envelope projects the EXISTING durable outcome —
      // already-attempted is not accepted-by-SMTP when the prior operation
      // failed or is unresolved.
      return {
        status: "already_processed",
        priorOutcome: existingOperation.status,
        operationId: existingOperation.operationId,
        requestCorrelationId,
      };
    }

    if (draft.status === "submitted" || draft.status === "discarded") {
      return { status: "failed", operationId: null, code: "REVISION_CHANGED", error: "Draft already submitted or discarded.", requestCorrelationId };
    }

    // ---- Authorization (consumed exactly once, bound to the frozen payload) ----
    const authorization = await this.authorizationModule.read(input.authorizationId);
    if (!authorization) {
      return { status: "failed", operationId: null, code: "ACTION_NOT_AUTHORIZED", error: "Authorization not found.", requestCorrelationId };
    }
    if (
      authorization.draftId !== draft.id ||
      authorization.revisionId !== revision.id ||
      authorization.payloadHash !== revision.composedHash
    ) {
      return { status: "failed", operationId: null, code: "REVISION_CHANGED", error: "Authorization does not match the frozen payload.", requestCorrelationId };
    }
    if (!this.authorizationModule.isSpendable(authorization, new Date())) {
      return { status: "failed", operationId: null, code: "APPROVAL_EXPIRED", error: "Authorization expired or already used.", requestCorrelationId };
    }

    // ---- Durable operation (duplicate-safe) ----
    const operationResult = await this.operationModule.createOperation({
      operationId: crypto.randomUUID(),
      kind: "forward",
      emailServiceId: draft.emailServiceId,
      origin: authorization.origin,
      payloadHash: revision.composedHash,
      idempotencyKey: replayKey,
      conversationId: draft.conversationId,
      sourceUserMessageId: authorization.userTurnId,
      draftId: draft.id,
      messageIds: [draft.messageId],
      policyVersion: "fwv1",
    });
    const operation = operationResult.operation;
    if (operationResult.status === "existing") {
      return {
        status: "already_processed",
        priorOutcome: operation.status,
        operationId: operation.operationId,
        requestCorrelationId,
      };
    }

    const items = await this.operationModule.listItems(operation.operationId);
    const item = items[0];

    // Consume the authorization exactly once (design §8.1); consumedAt makes
    // it unspendable, so no separate revoke is needed (a pre-revoke would
    // break the conditional consume).
    const consumed = await this.authorizationModule.consume(input.authorizationId, new Date());
    if (!consumed) {
      // Lost the race: another caller executed first; keep the operation honest.
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId: operation.operationId,
        status: "failed",
        errorCode: "ACTION_NOT_AUTHORIZED",
        sanitizedError: "Authorization consumed by a concurrent execution.",
      });
      return { status: "failed", operationId: operation.operationId, code: "ACTION_NOT_AUTHORIZED", error: "Authorization consumed by a concurrent execution.", requestCorrelationId };
    }

    // Everything between authorization consumption and the durable claim is
    // fault-isolated: a throw here would otherwise leave a pending item, a
    // consumed authorization, and a draft permanently blocked by the replay
    // gate with no recovery path.
    let claim: Awaited<ReturnType<EmailOrganizationOperationModule["claimItem"]>>;
    try {
      await this.operationModule.recordAudit({
        operationId: operation.operationId,
        itemId: item.id,
        messageId: draft.messageId,
        emailServiceId: draft.emailServiceId,
        actor: authorization.origin === "tool_confirmation" ? "ai" : "user",
        action: "forward_prepared",
      });

      // ---- Claim BEFORE network I/O ----
      const locationSnapshot = JSON.parse(revision.sourceLocationSnapshotJson) as {
        folderPath: string;
        uidValidity: string;
        uid: string;
      };
      const currentLocation = await this.locationModule.readByMessageId(draft.messageId);
      claim = await this.operationModule.claimItem({
        operationId: operation.operationId,
        messageId: draft.messageId,
        claimTokenHash: hashClaimToken(generateClaimToken()),
        leaseExpiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.attemptLeaseMs),
        location: {
          version: currentLocation?.version ?? null,
          folderPath: currentLocation?.folderPath ?? locationSnapshot.folderPath,
          uidValidity: currentLocation?.uidValidity ?? locationSnapshot.uidValidity,
          providerUid: currentLocation?.providerUid ?? locationSnapshot.uid,
        },
        destinationFolderPath: null,
      });
    } catch (error) {
      const sanitized = error instanceof Error ? error.message.slice(0, 240) : String(error);
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId: operation.operationId,
        status: "failed",
        errorCode: "LOCAL_COMMIT_PENDING",
        sanitizedError: `Failed before claim: ${sanitized}`,
      });
      return { status: "failed", operationId: operation.operationId, code: "LOCAL_COMMIT_PENDING", error: sanitized, requestCorrelationId };
    }
    if (claim.status !== "claimed") {
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId: operation.operationId,
        status: "failed",
        errorCode: "LOCAL_COMMIT_PENDING",
        sanitizedError: `Item could not be claimed (${claim.status}).`,
      });
      return { status: "failed", operationId: operation.operationId, code: "LOCAL_COMMIT_PENDING", error: "Item could not be claimed.", requestCorrelationId };
    }

    try {
      // ---- Recheck sending identity against the frozen revision ----
      const service = await this.serviceModule.getEmailService(revision.sendingAccountId);
      if (!service || service.status !== 1) {
        return await this.failNoDispatch(claim.itemId, operation.operationId, "ACCOUNT_NOT_AVAILABLE", "Sending account is unavailable.", requestCorrelationId);
      }
      const identityUnchanged =
        service.from === revision.fromAddress &&
        (service.smtpUsername ?? null) === revision.smtpUsername &&
        (service.replyTo ?? null) === revision.replyToAddress;
      if (!identityUnchanged) {
        return await this.failNoDispatch(claim.itemId, operation.operationId, "REVISION_CHANGED", "Sending identity changed after approval.", requestCorrelationId);
      }

      // ---- Materialize content from encrypted artifacts ----
      const bodyText = await this.readArtifact(revision.bodyTextArtifactId, requestCorrelationId);
      const bodyHtml = await this.readArtifact(revision.bodyHtmlArtifactId, requestCorrelationId);
      if (bodyText === null || bodyHtml === null) {
        return await this.failNoDispatch(claim.itemId, operation.operationId, "ATTACHMENT_UNAVAILABLE", "Composed content artifacts are unavailable; re-materialize the draft.", requestCorrelationId);
      }
      const manifest = JSON.parse(revision.attachmentsJson) as EmailForwardAttachmentManifestEntry[];
      const selected = manifest.filter((entry) => entry.selected);
      const attachments: Array<{ filename: string; content: Buffer; contentType?: string; cid?: string }> = [];
      for (const entry of selected) {
        if (entry.artifactId === null) {
          return await this.failNoDispatch(claim.itemId, operation.operationId, "ATTACHMENT_UNAVAILABLE", `Attachment bytes unavailable for ${entry.displayName}.`, requestCorrelationId);
        }
        const bytes = await this.artifactStore.get(entry.artifactId).catch(() => null);
        if (bytes === null) {
          return await this.failNoDispatch(claim.itemId, operation.operationId, "ATTACHMENT_UNAVAILABLE", `Attachment bytes unreadable for ${entry.displayName}.`, requestCorrelationId);
        }
        attachments.push({
          filename: entry.displayName,
          content: bytes,
          contentType: entry.contentType ?? undefined,
          ...(entry.contentId ? { cid: entry.contentId } : {}),
        });
      }

      const toRecipients = JSON.parse(revision.toRecipientsJson) as string[];
      const ccRecipients = JSON.parse(revision.ccRecipientsJson ?? "[]") as string[];
      const bccRecipients = JSON.parse(revision.bccRecipientsJson ?? "[]") as string[];
      const envelopeRecipients = JSON.parse(revision.envelopeRecipientsJson) as string[];
      if (envelopeRecipients.length === 0) {
        return await this.failNoDispatch(claim.itemId, operation.operationId, "VALIDATION_FAILED", "At least one recipient is required.", requestCorrelationId);
      }
      if (envelopeRecipients.length > EMAIL_ORGANIZATION_LIMITS.maxRecipients) {
        return await this.failNoDispatch(claim.itemId, operation.operationId, "TOO_MANY_RECIPIENTS", "Envelope recipients exceed the limit.", requestCorrelationId);
      }

      // T03: revision/artifact expiry is enforced at the trusted delivery
      // boundary — a fresh authorization on expired retained artifacts must
      // not dispatch before the hourly purge runs.
      if (
        revision.expiresAt !== null &&
        revision.expiresAt.getTime() <= Date.now()
      ) {
        return await this.failNoDispatch(
          claim.itemId,
          operation.operationId,
          "APPROVAL_EXPIRED",
          "The revision content expired; re-materialize the draft.",
          requestCorrelationId
        );
      }

      const sender = this.senderFactory({
        id: service.id,
        from: service.from,
        password: service.password,
        host: service.host,
        port: service.port,
        name: service.name,
        ssl: service.ssl,
        smtpUsername: service.smtpUsername,
        replyTo: service.replyTo,
      });

      const mailOptions: SendMailOptions = {
        from: revision.fromName
          ? { name: revision.fromName, address: revision.fromAddress }
          : revision.fromAddress,
        to: toRecipients,
        ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
        ...(bccRecipients.length > 0 ? { bcc: bccRecipients } : {}),
        subject: revision.subject,
        text: bodyText,
        html: bodyHtml,
        messageId: revision.composedMessageId,
        // Forwarding creates a new conversation identity: deliberately no
        // In-Reply-To / References (design §9.3).
        ...(attachments.length > 0 ? { attachments } : {}),
      };

      await this.operationModule.markAttemptDispatched(claim.attemptId);

      // T03: the LAST pre-SMTP gate sits between dispatch marking and the
      // submission itself — the narrowest honest window. An edit/discard
      // committing inside the prior awaits is caught here.
      const finalAdmission = await this.draftModule.readDraft(draft.id);
      if (
        finalAdmission === null ||
        finalAdmission.status !== "ready" ||
        finalAdmission.currentRevisionId !== revision.id
      ) {
        return await this.failNoDispatch(
          claim.itemId,
          operation.operationId,
          "REVISION_CHANGED",
          "The draft was edited or discarded during dispatch preparation; the old content was not sent.",
          requestCorrelationId
        );
      }

      const info = await sender.sendMail(mailOptions);
      const { accepted, rejected, unknown } = classifyRecipients(info, envelopeRecipients);

      // T16 (AC-22): attempt the Sent-copy append only after SMTP accepted
      // at least one recipient. A failed append is a SEPARATE warning — it
      // never changes submission state and never triggers a resend.
      const sentCopyStatus: EmailSentCopyStatus = await (async () => {
        if (accepted.length === 0) return "not_requested";
        if (info.raw === undefined || info.raw.length === 0) return "not_requested";
        const loc = await this.locationModule.readByMessageId(draft.messageId).catch(() => null);
        if (loc === null) return "unknown";
        const receiveConfig = await new EmailServiceModule()
          .getEmailServiceReceiveConfig(loc.emailServiceId)
          .catch(() => null);
        if (receiveConfig === null) return "unknown";
        const appendResult = await this.adapter
          .appendSent(receiveConfig, info.raw)
          .catch(() => ({ status: "failed" as const, reasonCode: "NETWORK_BEFORE_DISPATCH", sanitizedError: "append threw" }));
        if (appendResult.status === "saved") return "saved";
        if (appendResult.status === "skipped") return "not_requested";
        log.warn(
          `[EmailForwardDeliveryService] Sent-copy append failed (${requestCorrelationId}): ${appendResult.sanitizedError}`
        );
        return "failed";
      })();

      // ---- Persist outcome + Sent copy status ----
      const outcome: "succeeded" | "partially_succeeded" | "failed" | "outcome_unknown" =
        unknown.length > 0
          ? "outcome_unknown"
          : rejected.length > 0 && accepted.length > 0
            ? "partially_succeeded"
            : rejected.length > 0
              ? "failed"
              : "succeeded";

      await this.operationModule.finalizeItem({
        itemId: claim.itemId,
        operationId: operation.operationId,
        status: outcome,
        acceptedRecipients: accepted,
        rejectedRecipients: rejected,
        unknownRecipients: unknown,
        providerMessageId: info.messageId ?? null,
        errorCode:
          outcome === "partially_succeeded"
            ? "PARTIAL_RECIPIENT_ACCEPTANCE"
            : outcome === "failed"
              ? "PROVIDER_REJECTED"
              : outcome === "outcome_unknown"
                ? "OUTCOME_UNKNOWN"
                : null,
        attemptId: claim.attemptId,
        resultJson: JSON.stringify({
          sentCopyStatus,
          response: (info.response ?? "").slice(0, 200),
        }),
      });

      if (outcome === "succeeded" || outcome === "partially_succeeded" || outcome === "outcome_unknown") {
        await this.draftModule.markSubmitted(draft.id, revision.id);
      }



      await this.operationModule.recordAudit({
        operationId: operation.operationId,
        itemId: claim.itemId,
        messageId: draft.messageId,
        emailServiceId: draft.emailServiceId,
        actor: authorization.origin === "tool_confirmation" ? "ai" : "user",
        action:
          outcome === "succeeded"
            ? "forward_submitted"
            : outcome === "failed"
              ? "forward_failed"
              : "forward_outcome_pending",
        status: outcome,
        reasonCode: accepted.length > 0 && rejected.length > 0 ? "PARTIAL_RECIPIENT_ACCEPTANCE" : null,
        detail: {
          acceptedCount: accepted.length,
          rejectedCount: rejected.length,
          unknownCount: unknown.length,
          requestCorrelationId,
        },
      });

      if (outcome === "outcome_unknown") {
        return { status: "outcome_unknown", operationId: operation.operationId, requestCorrelationId };
      }
      if (outcome === "failed") {
        // R10: an all-rejected submission is a definitive failure, never a
        // generic 'submitted' success envelope.
        return {
          status: "failed",
          operationId: operation.operationId,
          code: "PROVIDER_REJECTED",
          error: "All envelope recipients were rejected by the server.",
          requestCorrelationId,
        };
      }
      return {
        status: "submitted",
        // R10: full vs partial acceptance is explicit at the top level.
        outcome,
        operationId: operation.operationId,
        accepted,
        rejected,
        unknown,
        requestCorrelationId,
      };
    } catch (error) {
      // Post-claim unexpected failure: the submission may or may not have
      // happened. Never auto-retry — record unknown and let reconciliation
      // decide (design §10.3).
      const sanitized = error instanceof Error ? error.message.slice(0, 240) : String(error);
      await this.operationModule
        .finalizeItem({
          itemId: claim.itemId,
          operationId: operation.operationId,
          status: "outcome_unknown",
          errorCode: "OUTCOME_UNKNOWN",
          sanitizedError: `Submission interrupted: ${sanitized}`,
          attemptId: claim.attemptId,
        })
        .catch((finalizeError: unknown) => {
          log.error("[EmailForwardDeliveryService] finalize-after-error failed:", finalizeError);
        });
      return { status: "outcome_unknown", operationId: operation.operationId, requestCorrelationId };
    }
  }

  private async failNoDispatch(
    itemId: number,
    operationId: string,
    code: string,
    message: string,
    requestCorrelationId: string
  ): Promise<SendForwardOutcome> {
    await this.operationModule.finalizeItem({
      itemId,
      operationId,
      status: "failed",
      errorCode: code,
      sanitizedError: message,
    });
    await this.operationModule.recordAudit({
      operationId,
      action: "forward_failed",
      status: "failed",
      reasonCode: code,
    });
    return { status: "failed", operationId, code, error: message, requestCorrelationId };
  }

  private async readArtifact(
    artifactId: string | null,
    requestCorrelationId: string
  ): Promise<string | null> {
    if (artifactId === null) return null;
    try {
      const bytes = await this.artifactStore.get(artifactId);
      return bytes.toString("utf8");
    } catch (error) {
      log.warn(
        `[EmailForwardDeliveryService] artifact read failed (${requestCorrelationId}):`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }
}

function classifyRecipients(
  info: SubmissionInfo,
  envelopeRecipients: readonly string[]
): { accepted: string[]; rejected: string[]; unknown: string[] } {
  const extract = (entries: ReadonlyArray<string | { address?: string }> | undefined | boolean): string[] => {
    if (!entries || typeof entries === "boolean") return [];
    return entries
      .map((entry) => (typeof entry === "string" ? entry : entry.address ?? ""))
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== "");
  };
  const accepted = extract(info.accepted);
  const rejected = extract(info.rejected);
  const accounted = new Set([...accepted, ...rejected]);
  const unknown = envelopeRecipients
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => !accounted.has(entry));
  return { accepted, rejected, unknown };
}

/** Builds the real nodemailer-backed sender with TLS-mode retry. */
export function createOutboundSenderFactory(): ForwardSenderFactory {
  return (param: SenderParam) => {
    const session = new OutboundSmtpSession(
      param as unknown as ConstructorParameters<typeof OutboundSmtpSession>[0]
    );
    return {
      async sendMail(options: SendMailOptions) {
        const info = await session.sendMail(options);
        return {
          accepted: (info as { accepted?: ReadonlyArray<string | { address?: string }> }).accepted,
          rejected: (info as { rejected?: ReadonlyArray<string | { address?: string }> }).rejected,
          messageId: (info as { messageId?: string }).messageId,
          response: (info as { response?: string }).response,
          raw: (info as { message?: Buffer }).message,
        };
      },
    };
  };
}
