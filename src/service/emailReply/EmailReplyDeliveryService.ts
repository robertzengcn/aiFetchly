import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyDraftRevisionModule } from "@/modules/EmailReplyDraftRevisionModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { ReplyEmailService } from "@/modules/lib/replyEmailService";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { classifySubmissionResult } from "@/service/emailReply/EmailSubmissionClassifier";
import {
  buildSendIdempotencyKey,
  hashApprovalToken,
  hashApprovalEnvelope,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import { validateSendBinding } from "@/service/emailReply/EmailReplySendBinding";
import {
  REPLY_POLICY_VERSION,
  REPLY_VALIDATOR_VERSION,
} from "@/service/emailReply/replyReliabilityVersions";
import type {
  EmailReplyApprovalEnvelope,
  SendApprovedReplyInput,
  SendApprovedReplyOutcome,
} from "@/entityTypes/emailReplyReliabilityTypes";
import type { EmailReplyStatus } from "@/entityTypes/emailReceiveTypes";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";

/**
 * Sender interface the delivery service uses for the SMTP handoff. The default
 * factory builds a real {@link ReplyEmailService}; tests inject a fake to drive
 * the accepted / rejected / disconnect / post-SMTP-DB-failure scenarios.
 */
export interface ReplySender {
  sendReplyEmail(req: {
    receiver: string;
    subject: string;
    text: string;
    html?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
  }): Promise<EmailSendResult>;
}

export type ReplySenderFactory = (service: {
  id?: number;
  from: string;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
}) => ReplySender;

/** Minimal mailbox shape the delivery service consumes (a subset of the entity). */
export interface BoundMailbox {
  id: number;
  from: string;
  status: number;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
}

/**
 * Idempotent approved-send orchestrator (technical design §15, FR-017/018/019,
 * NFR-001). SMTP is outside DB transactions (AD-007): the system commits a
 * `sending` claim + attempt + pre-submit audit BEFORE network submission, then
 * commits the outcome AFTER submission.
 *
 * Mailbox binding is enforced here in code: the outbound service is always the
 * draft's bound mailbox. There is NO `emailServiceId` override (FR-017).
 */
export class EmailReplyDeliveryService {
  private readonly draftModule = new EmailReplyDraftModule();
  private readonly revisionModule = new EmailReplyDraftRevisionModule();
  private readonly approvalModule = new EmailReplyApprovalModule();
  private readonly attemptModule = new EmailReplySendAttemptModule();
  private readonly messageModule = new EmailReceivedMessageModule();
  private readonly serviceModule = new EmailServiceModule();
  private readonly policy = new EmailReplyPolicyOrchestrator();
  private readonly senderFactory: ReplySenderFactory;
  private readonly serviceLoader: (id: number) => Promise<BoundMailbox | null>;

  constructor(options?: {
    senderFactory?: ReplySenderFactory;
    serviceLoader?: (id: number) => Promise<BoundMailbox | null>;
  }) {
    this.senderFactory =
      options?.senderFactory ??
      ((svc) => new ReplyEmailService(svc) as unknown as ReplySender);
    this.serviceLoader =
      options?.serviceLoader ??
      ((id) =>
        this.serviceModule.getEmailService(id) as Promise<BoundMailbox | null>);
  }

  async sendApprovedReply(
    input: SendApprovedReplyInput
  ): Promise<SendApprovedReplyOutcome> {
    // 1. Resolve the opaque one-time approval token to a trusted approval.
    const tokenHash = hashApprovalToken(input.approvalToken);
    const approval = await this.approvalModule.findActiveByTokenHash(tokenHash);
    if (!approval) {
      throw new Error(
        "Send rejected: approval token is invalid, expired, or already used"
      );
    }
    const draft = await this.draftModule.readAggregate(approval.draftId);
    if (!draft) {
      throw new Error("Send rejected: draft no longer exists");
    }
    const revision = await this.revisionModule.read(approval.revisionId);
    if (!revision) {
      throw new Error("Send rejected: approved revision no longer exists");
    }
    const message = await this.messageModule.read(draft.messageId);
    if (!message) {
      throw new Error("Send rejected: original message not found");
    }

    const emailServiceId = draft.emailServiceId ?? message.emailServiceId;
    const service = await this.serviceLoader(emailServiceId);
    if (!service) {
      throw new Error("Send rejected: bound email service not found");
    }

    // Recompute the envelope hash from trusted state.
    const envelope: EmailReplyApprovalEnvelope = {
      draftId: draft.id,
      revisionId: revision.id,
      emailServiceId,
      originalMessageId: message.id,
      senderAddress: revision.senderAddress,
      recipientAddress: revision.recipientAddress,
      subject: revision.subject,
      bodyText: revision.bodyText,
      bodyHtml: revision.bodyHtml,
      policyVersion: REPLY_POLICY_VERSION,
      validationVersion: REPLY_VALIDATOR_VERSION,
    };
    const recomputedHash = hashApprovalEnvelope(envelope);

    // 2. Mailbox + envelope binding (FR-017, P0.2). Pure validation; throws
    //    SendBindingError before the atomic claim so no SMTP submission can
    //    occur on any mismatch (wrong mailbox / sender / recipient / draft).
    validateSendBinding({
      requestedDraftId: input.draftId,
      approval: {
        draftId: approval.draftId,
        revisionId: approval.revisionId,
        approvedHash: approval.approvedHash,
      },
      draft: {
        id: draft.id,
        currentRevisionId: draft.currentRevisionId,
        contentHash: draft.contentHash,
        emailServiceId: draft.emailServiceId,
      },
      revision: {
        id: revision.id,
        senderAddress: revision.senderAddress,
        recipientAddress: revision.recipientAddress,
        contentHash: revision.contentHash,
      },
      message: {
        id: message.id,
        emailServiceId: message.emailServiceId,
        fromAddress: message.fromAddress,
        replyToAddress: message.replyToAddress,
      },
      service: { id: service.id, from: service.from, status: service.status },
      recomputedHash,
    });

    // 4. Send-time policy (reloaded, never cached). FR-006.
    const decision = await this.policy.evaluate({
      stage: "pre_send",
      messageId: message.id,
      draftId: draft.id,
      revisionId: revision.id,
    });
    if (!decision.allowed) {
      throw new Error(`Send rejected by policy: ${decision.reason}`);
    }

    // 5. Idempotency: if this exact approval already claimed, return the prior
    //    attempt without contacting SMTP.
    const idempotencyKey = buildSendIdempotencyKey(
      draft.id,
      revision.id,
      recomputedHash,
      approval.id
    );
    const existing = await this.attemptModule.findByIdempotencyKey(
      idempotencyKey
    );
    if (existing) {
      return { status: "already_processed", attemptId: existing.id };
    }

    // 6. Atomic claim: draft approved -> sending, insert attempt, write pre-submit
    //    audit. SMTP is never contacted if this returns non-claimed.
    const claim = await this.draftModule.claimApprovedRevisionForSend({
      draftId: draft.id,
      revisionId: revision.id,
      approvedHash: recomputedHash,
      idempotencyKey,
      approvalId: approval.id,
      messageId: message.id,
      conversationId: draft.conversationId ?? null,
      emailServiceId,
      senderAddress: revision.senderAddress,
      recipientAddress: revision.recipientAddress,
      policyVersion: REPLY_POLICY_VERSION,
    });
    if (claim.status === "already_processed") {
      return { status: "already_processed", attemptId: claim.attempt.id };
    }
    if (claim.status === "precondition_failed") {
      throw new Error(`Send rejected: ${claim.reason}`);
    }
    const attemptId = claim.attemptId;

    // 7. Mark the attempt `submitted` at the SMTP handoff boundary (P0.6) so a
    //    crash here is recoverable to delivery_unknown rather than left claimed.
    await this.attemptModule.markSubmitted(attemptId, new Date());

    // 8. SMTP submission. classifySubmissionResult turns the raw result into a
    //    certainty; unknown outcomes become delivery_unknown (never retried).
    const sender = this.senderFactory({
      id: service.id,
      from: service.from,
      password: service.password,
      host: service.host,
      port: service.port,
      name: service.name,
      ssl: service.ssl,
    });

    let certainty: "accepted" | "definitely_rejected" | "unknown";
    let providerMessageId: string | null = null;
    let sanitizedError: string | null = null;
    try {
      const raw = await sender.sendReplyEmail({
        receiver: revision.recipientAddress,
        subject: revision.subject,
        text: revision.bodyText,
        html: revision.bodyHtml,
        inReplyTo: message.messageId,
        references: message.referencesHeader,
      });
      const classified = classifySubmissionResult(raw);
      certainty = classified.certainty;
      providerMessageId = classified.providerMessageId;
      sanitizedError = classified.sanitizedError;
    } catch (error) {
      // An unexpected throw (not a resolved failure) is ambiguous after
      // submission may have begun → delivery_unknown.
      certainty = "unknown";
      sanitizedError = error instanceof Error ? error.message : String(error);
    }

    const outcome = certaintyToOutcome(certainty);
    // Finalize attempt + draft + approval + audit + received-message status in
    // ONE transaction (P0.6). delivery_unknown leaves the message status as-is.
    const messageReplyStatus: EmailReplyStatus | undefined =
      outcome === "sent" ? "sent" : outcome === "failed" ? "failed" : undefined;
    await this.draftModule.finalizeSendOutcome({
      attemptId,
      draftId: draft.id,
      approvalId: approval.id,
      emailServiceId,
      messageId: message.id,
      outcome,
      providerMessageId,
      failureCode: certainty === "accepted" ? null : certainty,
      sanitizedError,
      messageReplyStatus,
    });

    if (outcome === "sent") {
      return {
        status: "sent",
        attemptId,
        sentAt: new Date().toISOString(),
      };
    }
    return {
      status: outcome,
      attemptId,
      error: sanitizedError ?? outcome,
    };
  }
}

function certaintyToOutcome(
  certainty: "accepted" | "definitely_rejected" | "unknown"
): "sent" | "failed" | "delivery_unknown" {
  if (certainty === "accepted") return "sent";
  if (certainty === "definitely_rejected") return "failed";
  return "delivery_unknown";
}
