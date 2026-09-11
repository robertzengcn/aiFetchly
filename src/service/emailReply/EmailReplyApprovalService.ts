import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyDraftRevisionModule } from "@/modules/EmailReplyDraftRevisionModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import type {
  EmailReplyApprovalEnvelope,
  EmailReplyApprovalEnvelopeV2,
  EmailReplyApprovedByType,
} from "@/entityTypes/emailReplyReliabilityTypes";
import {
  generateApprovalToken,
  hashApprovalToken,
  hashApprovalEnvelope,
  hashApprovalEnvelopeV2,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import { resolveOutboundIdentity } from "@/service/outboundEmail/resolveOutboundSender";
import { validateReplyOutput } from "@/service/emailReply/EmailReplyOutputValidator";
import {
  REPLY_POLICY_VERSION,
  REPLY_VALIDATOR_VERSION,
} from "@/service/emailReply/replyReliabilityVersions";
import { evaluateAutoReplyPolicy } from "@/service/emailReply/EmailAutoReplyPolicyService";
import { EmailAutoReplyRuleModule } from "@/modules/EmailAutoReplyRuleModule";
import { isValidReplyAddress } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";

/** Returned once to the trusted caller; the raw token is never persisted/logged. */
export interface ApprovalResult {
  readonly approvalId: number;
  readonly token: string;
  readonly revisionId: number;
  readonly contentHash: string;
}

export interface ApproveDraftInput {
  readonly draftId: number;
  readonly approvedByType: EmailReplyApprovedByType;
  readonly approvedById?: string | null;
}

/**
 * Creates an approval bound to the exact current revision of a draft (technical
 * design §14.2, FR-015). Approval is the sole precondition for the
 * `approved -> sending` transition.
 *
 * Security: the raw one-time token is returned ONCE and only its hash is
 * stored. The envelope hash is recomputed from trusted server state (never from
 * renderer input) and must match the revision's materialized content hash.
 */
export class EmailReplyApprovalService {
  private readonly dbpath: string;
  private readonly draftModule = new EmailReplyDraftModule();
  private readonly revisionModule = new EmailReplyDraftRevisionModule();
  private readonly approvalModule = new EmailReplyApprovalModule();
  private readonly messageModule = new EmailReceivedMessageModule();
  private readonly ruleModule = new EmailAutoReplyRuleModule();

  /**
   * @param dbpath Optional explicit database path (IPC handler resolves the
   *   real user DB via `Token`/`USERSDBPATH`). When omitted the service
   *   resolves the path itself, mirroring `BaseModule` — so the no-arg
   *   constructor used in tests still works and production callers that pass
   *   the resolved path avoid the `BaseDb` temp-dir fallback.
   */
  constructor(dbpath?: string) {
    this.dbpath = dbpath ?? new Token().getValue(USERSDBPATH) ?? "";
  }

  async approveDraft(input: ApproveDraftInput): Promise<ApprovalResult> {
    const draft = await this.draftModule.readAggregate(input.draftId);
    if (!draft) {
      throw new Error("Cannot approve: draft not found");
    }
    if (draft.status !== "draft") {
      throw new Error(
        `Cannot approve: draft must be in 'draft' state (current '${draft.status}')`
      );
    }
    if (!draft.currentRevisionId) {
      throw new Error("Cannot approve: draft has no current revision");
    }

    const revision = await this.revisionModule.read(draft.currentRevisionId);
    if (!revision) {
      throw new Error("Cannot approve: current revision missing");
    }

    // Re-run the deterministic output validator against the trusted revision
    // content (do not trust persisted JSON alone) and refuse approval for any
    // block/review finding (FR-012, P0.4). Block findings are never sendable;
    // review findings need a resolution path that doesn't exist yet, so they
    // also block approval in this release.
    const validation = validateReplyOutput(revision.subject, revision.bodyText);
    if (!validation.sendableAfterApproval) {
      const codes = validation.findings
        .filter((f) => f.severity !== "warning")
        .map((f) => f.code)
        .join(",");
      throw new Error(
        `Cannot approve: validation findings [${codes}] require review before sending`
      );
    }

    const message = await this.messageModule.read(draft.messageId);
    if (!message) {
      throw new Error("Cannot approve: original message not found");
    }

    const emailServiceId = draft.emailServiceId ?? message.emailServiceId;
    if (
      draft.emailServiceId != null &&
      draft.emailServiceId !== message.emailServiceId
    ) {
      throw new Error(
        "Cannot approve: draft mailbox differs from original message"
      );
    }

    if (
      !revision.recipientAddress ||
      !isValidReplyAddress(revision.recipientAddress)
    ) {
      throw new Error(
        "Cannot approve: recipient address is missing or invalid"
      );
    }

    // Refuse approval for hard-blocked inbound messages (bounce/unsubscribe/
    // automated/blocked sender). A draft may exist, but it must not be sent.
    const rule = await this.ruleModule
      .getEffectiveRule(emailServiceId)
      .catch(() => null);
    const hardBlock = evaluateAutoReplyPolicy({
      message: message as never,
      classification: message.classification as never,
      confidence: message.classificationConfidence,
      rule,
      sendCounts: { todayForService: 0, threadCount: 0 },
    });
    if (hardBlock.status === "blocked" || hardBlock.status === "skipped") {
      throw new Error(`Cannot approve: ${hardBlock.reason}`);
    }

    // Recompute the canonical hash from trusted state and require it to match
    // the revision's materialized hash. Version-aware (§18.1): v2 revisions
    // carry smtpUsername + replyToAddress bound into the hash; v1 uses the
    // legacy shape. The stored approvedHash must match the revision's version.
    const revisionVersion: 1 | 2 = revision.envelopeVersion ?? 1;
    let contentHash: string;
    if (revisionVersion === 2) {
      // Resolve the full service identity for v2 so the hash binds smtpUsername
      // and replyToAddress from trusted server state, not renderer input.
      const identity = await resolveOutboundIdentity({
        dbpath: this.dbpath,
        preferredServiceId: emailServiceId,
      });
      if (!identity) {
        throw new Error(
          "Cannot approve: unable to resolve email service identity for v2 revision"
        );
      }
      const envelopeV2: EmailReplyApprovalEnvelopeV2 = {
        version: 2,
        draftId: draft.id,
        revisionId: revision.id,
        emailServiceId,
        originalMessageId: message.id,
        smtpUsername: identity.smtpUsername,
        senderAddress: revision.senderAddress,
        replyToAddress: identity.replyToAddress,
        recipientAddress: revision.recipientAddress,
        subject: revision.subject,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
        policyVersion: REPLY_POLICY_VERSION,
        validationVersion: REPLY_VALIDATOR_VERSION,
      };
      contentHash = hashApprovalEnvelopeV2(envelopeV2);
    } else {
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
      contentHash = hashApprovalEnvelope(envelope);
    }
    if (revision.contentHash && revision.contentHash !== contentHash) {
      throw new Error(
        "Cannot approve: revision content hash is stale; regenerate the draft"
      );
    }

    const token = generateApprovalToken();
    const approvalRow = new EmailReplyApprovalEntity();
    approvalRow.draftId = draft.id;
    approvalRow.revisionId = revision.id;
    approvalRow.approvedByType = input.approvedByType;
    approvalRow.approvedById = input.approvedById ?? null;
    approvalRow.approvedHash = contentHash;
    approvalRow.approvalTokenHash = hashApprovalToken(token);
    approvalRow.approvedAt = new Date();
    approvalRow.expiresAt = null;
    approvalRow.invalidatedAt = null;
    approvalRow.invalidationReason = null;
    const saved = await this.approvalModule.create(approvalRow);

    // Atomically draft -> approved for this exact revision + hash. If a
    // concurrent edit moved the draft away, the approval is invalidated by that
    // edit's transaction and this returns false.
    const ok = await this.draftModule.markApproved(
      draft.id,
      revision.id,
      contentHash,
      REPLY_POLICY_VERSION,
      new Date()
    );
    if (!ok) {
      // The draft changed under us; invalidate the approval we just wrote.
      await this.approvalModule.invalidate(
        saved.id,
        "Draft changed before approval could be committed",
        new Date()
      );
      throw new Error(
        "Cannot approve: draft changed before approval committed"
      );
    }

    return {
      approvalId: saved.id,
      token,
      revisionId: revision.id,
      contentHash,
    };
  }
}
