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
  /** T16/R5-02: the session-captured raw composed MIME (null when absent). */
  readonly raw?: Buffer | null;
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
      /** R5-02 (AC-22): the Sent-copy result, separate from submission. */
      readonly sentCopyStatus: EmailSentCopyStatus;
      readonly requestCorrelationId: string;
    }
  | {
      readonly status: "failed";
      readonly operationId: string | null;
      readonly code: string;
      readonly error: string;
      /** R9-02: the Sent-copy result when the SMTP round ran (AC-22). */
      readonly sentCopyStatus?: EmailSentCopyStatus;
      readonly requestCorrelationId: string;
    }
  | {
      readonly status: "outcome_unknown";
      readonly operationId: string;
      /** R6-05: the Sent-copy result when it was computed before the throw. */
      readonly sentCopyStatus?: EmailSentCopyStatus;
      readonly requestCorrelationId: string;
    }
  | {
      readonly status: "already_processed";
      /** T12: the prior operation's durable status (may be failed/unknown). */
      readonly priorOutcome: string;
      readonly operationId: string;
      /**
       * R10-02: the stored Sent-copy status of the prior attempt, so a
       * replay repeats the AC-22 warning when the copy is unverified.
       */
      readonly sentCopyStatus?: EmailSentCopyStatus;
      readonly requestCorrelationId: string;
    };

/**
 * R10-02: the stored Sent-copy status from the prior operation's item row,
 * so a replay of a send whose copy was unverified repeats the warning.
 */
function sentCopyStatusFromItem(
  items: ReadonlyArray<{ resultJson: string | null }>
): EmailSentCopyStatus | undefined {
  for (const item of items) {
    if (item.resultJson === null) continue;
    try {
      const parsed = JSON.parse(item.resultJson) as { sentCopyStatus?: unknown };
      if (
        parsed.sentCopyStatus === "failed" ||
        parsed.sentCopyStatus === "unknown"
      ) {
        return parsed.sentCopyStatus;
      }
    } catch {
      // malformed evidence: keep scanning
    }
  }
  return undefined;
}

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
      // failed or is unresolved. R10-02: a replay repeats the Sent-copy
      // warning when the prior attempt stored an unverified copy.
      const replayItems = await this.operationModule
        .listItems(existingOperation.operationId)
        .catch(() => []);
      return {
        status: "already_processed",
        priorOutcome: existingOperation.status,
        operationId: existingOperation.operationId,
        sentCopyStatus: sentCopyStatusFromItem(replayItems),
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
      // R10-02: same replay warning as the idempotency-key short-circuit.
      const replayItems = await this.operationModule
        .listItems(operation.operationId)
        .catch(() => []);
      return {
        status: "already_processed",
        priorOutcome: operation.status,
        operationId: operation.operationId,
        sentCopyStatus: sentCopyStatusFromItem(replayItems),
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

    // R5-01: tracks whether the dispatch fence was WON — the catch block
    // may only transition the draft when we actually hold the fence (a
    // pre-fence throw leaves the draft in `ready`, untouched).
    let fenceHeld = false;
    // R6-04: tracks whether sendMail was ENTERED — the catch splits on it
    // (pre-dispatch local failure vs possible on-wire outcome).
    let sendMailEntered = false;
    // R6-05: the Sent-copy status computed in the try survives into the
    // unknown return and the catch's finalize (hoisted, "unknown" default).
    let sentCopyComputed = false;
    let sentCopyStatus: EmailSentCopyStatus = "unknown";
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
        // R4-17: the approved Reply-To identity is applied to the emitted MIME.
        ...(revision.replyToAddress ? { replyTo: revision.replyToAddress } : {}),
        to: toRecipients,
        ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
        ...(bccRecipients.length > 0 ? { bcc: bccRecipients } : {}),
        subject: revision.subject,
        // R4-07: base64 text encoding makes the composed-size estimator's
        // base64+folding bound a TRUE upper bound (quoted-printable expands
        // mixed Unicode up to 4x and bypassed the limit).
        textEncoding: "base64",
        text: bodyText,
        html: bodyHtml,
        messageId: revision.composedMessageId,
        // Forwarding creates a new conversation identity: deliberately no
        // In-Reply-To / References (design §9.3).
        ...(attachments.length > 0 ? { attachments } : {}),
      };

      // R4-01: revision-bound dispatch fence — the atomic ready→dispatching
      // CAS fences edit/discard for the whole SMTP window. Losing the CAS
      // means an edit/discard won; the old content never leaves.
      const dispatchFenced = await this.draftModule.markDispatching(
        draft.id,
        revision.id
      );
      if (!dispatchFenced) {
        return await this.failNoDispatch(
          claim.itemId,
          operation.operationId,
          "REVISION_CHANGED",
          "The draft was edited or discarded during dispatch preparation; the old content was not sent.",
          requestCorrelationId
        );
      }
      fenceHeld = true;

      // R5-01: the attempt is `dispatched` only after the fence wins and only
      // immediately before the socket write — a fence loss must not leave a
      // dispatched attempt claiming the old content was on the wire.
      await this.operationModule.markAttemptDispatched(claim.attemptId);

      // R6-04: the socket-attempt boundary. A throw BEFORE this point is a
      // local failure (attempt-row update, transport construction, bad
      // options) — provably pre-dispatch, retryable. A throw after it may
      // have reached the wire — stays unknown, never replayed.
      sendMailEntered = true;
      const info = await sender.sendMail(mailOptions);
      const { accepted, rejected, unknown } = classifyRecipients(info, envelopeRecipients);

      // T16 (AC-22): attempt the Sent-copy append only after SMTP accepted
      // at least one recipient. A failed append is a SEPARATE warning — it
      // never changes submission state and never triggers a resend.
      // R5-02: the append targets the SENDING account's mailbox (where the
      // provider's Sent folder lives), not the source message's account.
      // R6-05: the value is tracked in a hoisted binding so the
      // outcome_unknown return and the catch's durable row keep carrying
      // it — the user's warning must not vanish on the unknown path.
      sentCopyComputed = true;
      sentCopyStatus = await (async () => {
        if (accepted.length === 0) return "not_requested";
        if (info.raw == null || info.raw.length === 0) {
          // R5-02: the submission was requested with a copy expectation and
          // the bytes are missing — that is unknown, never "not_requested".
          return "unknown";
        }
        if (resolveSentCopyStrategy(service.host) === "provider_managed") {
          // Design §9.4: never append blindly — a provider that provably
          // stores its own Sent mail is skipped by the tested catalog only.
          return "not_requested";
        }
        const receiveConfig = await this.serviceModule
          .getEmailServiceReceiveConfig(revision.sendingAccountId)
          .catch(() => null);
        if (receiveConfig === null) return "unknown";
        const appendResult = await this.adapter
          .appendSent(receiveConfig, info.raw)
          .catch(() => ({ status: "failed" as const, reasonCode: "NETWORK_BEFORE_DISPATCH", sanitizedError: "append threw" }));
        if (appendResult.status === "saved") return "saved";
        if (appendResult.status === "skipped") {
          // No discoverable Sent folder: whether the provider stored its own
          // copy is unknowable from here — honest unknown, not a non-request.
          return "unknown";
        }
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

      // R5-01: pair every fence win with a terminal draft transition — the
      // draft must end submitted or failed-and-released, never stranded in
      // `dispatching`. Unknown outcomes mark submitted too: SMTP may have
      // happened, and re-sending is barred by the operation idempotency key.
      if (outcome === "succeeded" || outcome === "partially_succeeded" || outcome === "outcome_unknown") {
        const submitted = await this.draftModule.markSubmitted(draft.id, revision.id);
        if (!submitted) {
          // A durable error on an already-sent message: force the terminal
          // state out of `dispatching` and record it for support evidence.
          log.error(
            `[EmailForwardDeliveryService] markSubmitted lost for draft ${draft.id} after SMTP (${outcome}); forcing submitted`,
            requestCorrelationId
          );
          await this.draftModule.forceTerminalFromDispatching(draft.id, "submitted");
          await this.operationModule.recordAudit({
            operationId: operation.operationId,
            itemId: claim.itemId,
            messageId: draft.messageId,
            emailServiceId: draft.emailServiceId,
            action: "forward_draft_submit_state_failed",
            status: outcome,
            reasonCode: "LOCAL_COMMIT_PENDING",
            detail: { requestCorrelationId },
          }).catch(() => undefined);
        }
      } else if (outcome === "failed") {
        // R5-01: all envelope recipients rejected — SMTP provably delivered
        // nothing, so the fence releases into the editable `failed` state.
        const released = await this.draftModule.markSendFailed(draft.id, revision.id);
        if (!released) {
          log.error(
            `[EmailForwardDeliveryService] markSendFailed lost for draft ${draft.id}; forcing failed`,
            requestCorrelationId
          );
          await this.draftModule.forceTerminalFromDispatching(draft.id, "failed");
        }
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
        // R6-05: the unknown envelope carries the Sent-copy status so the
        // detail page and the tool envelope can warn (AC-22) even though
        // the submission itself is unresolved.
        return {
          status: "outcome_unknown",
          operationId: operation.operationId,
          sentCopyStatus,
          requestCorrelationId,
        };
      }
      if (outcome === "failed") {
        // R10: an all-rejected submission is a definitive failure, never a
        // generic 'submitted' success envelope. R9-02: the Sent-copy status
        // the item row stored rides the return so the tool can warn (AC-22).
        return {
          status: "failed",
          operationId: operation.operationId,
          code: "PROVIDER_REJECTED",
          error: "All envelope recipients were rejected by the server.",
          sentCopyStatus,
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
        sentCopyStatus,
        requestCorrelationId,
      };
    } catch (error) {
      const sanitized = error instanceof Error ? error.message.slice(0, 240) : String(error);

      // R6-04: the pre-dispatch split. A throw BEFORE sendMail was entered
      // is provably local (attempt-row update, transport build, bad
      // options) — a retryable failure, never a claimed success: the item
      // finalizes failed with a pre-dispatch code and the fence releases
      // into the editable `failed` state. Only a throw after sendMail has
      // been entered keeps the honest unknown + submitted pair.
      if (fenceHeld && !sendMailEntered) {
        await this.operationModule
          .finalizeItem({
            itemId: claim.itemId,
            operationId: operation.operationId,
            status: "failed",
            errorCode: "NETWORK_BEFORE_DISPATCH",
            sanitizedError: `Pre-dispatch local failure (SMTP never started): ${sanitized}`,
            attemptId: claim.attemptId,
          })
          .catch((finalizeError: unknown) => {
            log.error("[EmailForwardDeliveryService] pre-dispatch finalize failed:", finalizeError);
          });
        const released = await this.draftModule
          .markSendFailed(draft.id, revision.id)
          .catch(() => false);
        if (!released) {
          await this.draftModule
            .forceTerminalFromDispatching(draft.id, "failed")
            .catch(() => undefined);
        }
        await this.operationModule
          .recordAudit({
            operationId: operation.operationId,
            itemId: claim.itemId,
            messageId: draft.messageId,
            emailServiceId: draft.emailServiceId,
            action: "forward_failed",
            status: "failed",
            reasonCode: "NETWORK_BEFORE_DISPATCH",
            detail: { requestCorrelationId, preDispatch: true },
          })
          .catch(() => undefined);
        return {
          status: "failed",
          operationId: operation.operationId,
          code: "NETWORK_BEFORE_DISPATCH",
          error: `Forward could not start (SMTP never ran): ${sanitized}`,
          requestCorrelationId,
        };
      }

      // Post-claim unexpected failure past the socket boundary: the
      // submission may or may not have happened. Never auto-retry — record
      // unknown and let reconciliation decide (design §10.3).
      await this.operationModule
        .finalizeItem({
          itemId: claim.itemId,
          operationId: operation.operationId,
          status: "outcome_unknown",
          errorCode: "OUTCOME_UNKNOWN",
          sanitizedError: `Submission interrupted: ${sanitized}`,
          attemptId: claim.attemptId,
          // R6-05: a throw after a successful Sent append must not drop the
          // status from the durable row.
          ...(sentCopyComputed ? { resultJson: JSON.stringify({ sentCopyStatus }) } : {}),
        })
        .catch((finalizeError: unknown) => {
          log.error("[EmailForwardDeliveryService] finalize-after-error failed:", finalizeError);
        });
      // R5-01: the fence is still held after a throw past the dispatch point
      // — SMTP may have happened, so the draft lands in `submitted` (never a
      // re-sendable state) instead of being stranded in `dispatching`.
      if (fenceHeld) {
        const submittedAfterError = await this.draftModule
          .markSubmitted(draft.id, revision.id)
          .catch(() => false);
        if (!submittedAfterError) {
          await this.draftModule
            .forceTerminalFromDispatching(draft.id, "submitted")
            .catch(() => undefined);
        }
      }
      return {
        status: "outcome_unknown",
        operationId: operation.operationId,
        ...(sentCopyComputed ? { sentCopyStatus } : {}),
        requestCorrelationId,
      };
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

/**
 * R5-02 (design §9.4): per-provider Sent-copy strategy. The default is to
 * append the submitted bytes to the sending account's special-use Sent
 * folder; a provider is added to PROVIDER_MANAGED_SENT_HOSTS only with
 * operator-tested evidence that it stores its own Sent mail (an untested
 * guess would silently lose the user's copy).
 */
export type SentCopyStrategy = "append" | "provider_managed";

const PROVIDER_MANAGED_SENT_HOSTS: ReadonlySet<string> = new Set([]);

export function resolveSentCopyStrategy(smtpHost: string | null | undefined): SentCopyStrategy {
  const host = (smtpHost ?? "").trim().toLowerCase();
  if (host !== "" && PROVIDER_MANAGED_SENT_HOSTS.has(host)) {
    return "provider_managed";
  }
  return "append";
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
          // R5-02: nodemailer's SMTP result does NOT populate `info.message`;
          // the session's stream plugin captured the exact submitted bytes.
          raw: session.capturedRawMessage(),
        };
      },
    };
  };
}
