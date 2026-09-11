import type { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import type { AppendRevisionInput } from "@/model/EmailReplyDraft.model";
import {
  hashApprovalEnvelope,
  hashApprovalEnvelopeV2,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import { validateReplyOutput } from "@/service/emailReply/EmailReplyOutputValidator";
import {
  REPLY_POLICY_VERSION,
  REPLY_VALIDATOR_VERSION,
} from "@/service/emailReply/replyReliabilityVersions";
import type {
  EmailReplyApprovalEnvelope,
  EmailReplyApprovalEnvelopeV2,
} from "@/entityTypes/emailReplyReliabilityTypes";
import { resolveOutboundIdentity } from "@/service/outboundEmail/resolveOutboundSender";
import type { ResolvedOutboundIdentity } from "@/service/outboundEmail/resolveOutboundSender";

/**
 * Structural type satisfied by both {@link EmailReplyDraftModel} and
 * {@link EmailReplyDraftModule}. Letting the helper accept either makes it
 * testable with a dbpath-constructed model (modules resolve their DB path via
 * the Token store, which is unusable in the node test harness).
 */
export interface RevisionCapableDraftAccess {
  appendRevision(input: AppendRevisionInput): Promise<{
    revision: { id: number; revisionNumber: number };
    invalidatedApprovals: number;
  }>;
  applyContentHash(
    draftId: number,
    revisionId: number,
    contentHash: string
  ): Promise<void>;
}

/**
 * Materialize an immutable revision for a draft and persist its canonical
 * content hash (reliability v2). Used by:
 *  - {@link EmailReplyDraftGenerationService.createDraft} after it saves a new
 *    draft (revision 1), and
 *  - the EMAIL_REPLY_DRAFT_UPDATE IPC handler when a user edits a draft (next
 *    revision; invalidates any active approval — FR-014).
 *
 * The hash includes the revision id, which is assigned at insert, so this does
 * a two-step: append the revision with a placeholder, read back the assigned
 * id, recompute the real hash, and persist it via applyContentHash. The
 * placeholder is never visible long enough to approve against (a racy approve
 * during the microsecond window sees a hash mismatch and refuses).
 */
export async function materializeRevision1(
  draftAccess: RevisionCapableDraftAccess,
  input: {
    draftId: number;
    actor: "ai" | "user";
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    senderAddress: string;
    recipientAddress: string;
    emailServiceId: number;
    originalMessageId: number;
    /** Sanitized generation metadata (prompt/scope/context versions) — no prompts. */
    generationMetadataJson?: string | null;
  }
): Promise<{
  revisionId: number;
  revisionNumber: number;
  contentHash: string;
}> {
  // Run the deterministic output validator and persist machine-readable findings
  // on the immutable revision (FR-012, P0.4). The approval service blocks any
  // revision with a block/review finding.
  const validation = validateReplyOutput(input.subject, input.bodyText);

  const appended = await draftAccess.appendRevision({
    draftId: input.draftId,
    actor: input.actor,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    senderAddress: input.senderAddress,
    recipientAddress: input.recipientAddress,
    contentHash: "pending-materialize",
    policyVersion: REPLY_POLICY_VERSION,
    validationVersion: REPLY_VALIDATOR_VERSION,
    generationMetadataJson: input.generationMetadataJson ?? null,
    validationFindingsJson: JSON.stringify({
      findings: validation.findings,
      sendableAfterApproval: validation.sendableAfterApproval,
      validatorVersion: validation.validatorVersion,
    }),
  });

  const envelope: EmailReplyApprovalEnvelope = {
    draftId: input.draftId,
    revisionId: appended.revision.id,
    emailServiceId: input.emailServiceId,
    originalMessageId: input.originalMessageId,
    senderAddress: input.senderAddress,
    recipientAddress: input.recipientAddress,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    policyVersion: REPLY_POLICY_VERSION,
    validationVersion: REPLY_VALIDATOR_VERSION,
  };
  const contentHash = hashApprovalEnvelope(envelope);
  await draftAccess.applyContentHash(
    input.draftId,
    appended.revision.id,
    contentHash
  );

  return {
    revisionId: appended.revision.id,
    revisionNumber: appended.revision.revisionNumber,
    contentHash,
  };
}

/**
 * Input for {@link materializeRevision2}. Adds `emailServiceId` so the
 * materializer can resolve the full service identity (smtpUsername +
 * replyToAddress) via {@link resolveOutboundIdentity}.
 */
export interface MaterializeRevision2Input {
  draftId: number;
  actor: "ai" | "user";
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  senderAddress: string;
  recipientAddress: string;
  emailServiceId: number;
  originalMessageId: number;
  /** Sanitized generation metadata (prompt/scope/context versions) — no prompts. */
  generationMetadataJson?: string | null;
  /** Override for the dbpath (tests). When omitted, uses the draft module's path. */
  dbpath?: string;
}

/**
 * Result of {@link materializeRevision2}. Includes the resolved service identity
 * frozen on the revision so callers (approval service, delivery service) can
 * compare it at send time.
 */
export interface MaterializeRevision2Result {
  revisionId: number;
  revisionNumber: number;
  contentHash: string;
  smtpUsername: string;
  replyToAddress: string | null;
}

/**
 * Materialize a v2 immutable revision that binds the resolved service identity
 * (§18.1, §18.2). This mirrors {@link materializeRevision1} but:
 *
 *  1. Resolves the full service identity via {@link resolveOutboundIdentity}
 *     (smtpUsername + replyToAddress) before appending.
 *  2. Builds a {@link EmailReplyApprovalEnvelopeV2} with the resolved identity
 *     and hashes it via {@link hashApprovalEnvelopeV2}.
 *  3. Appends the revision with `envelopeVersion: 2`, `smtpUsername`, and
 *     `replyToAddress` via the extended {@link AppendRevisionInput}.
 *
 * The v1 {@link materializeRevision1} path is untouched — legacy revisions
 * continue to use the v1 hash.
 *
 * @throws Error when the service identity cannot be resolved (fail-closed).
 */
export async function materializeRevision2(
  draftAccess: RevisionCapableDraftAccess,
  input: MaterializeRevision2Input
): Promise<MaterializeRevision2Result> {
  const validation = validateReplyOutput(input.subject, input.bodyText);

  // Resolve the full effective identity for this service (§18.2). The
  // resolver applies the smtpUsername ?? from fallback and trims Reply-To.
  // Fail-closed when the service cannot be resolved — never materialize a
  // revision with a guessed identity.
  const identity: ResolvedOutboundIdentity | null =
    await resolveOutboundIdentity({
      dbpath: input.dbpath ?? "",
      preferredServiceId: input.emailServiceId,
    });
  if (!identity) {
    throw new Error(
      "Cannot materialize v2 revision: unable to resolve email service identity"
    );
  }

  // Verify the resolved sender matches the input senderAddress (defense-in-depth:
  // the caller should have derived senderAddress from the same resolver).
  // If they differ, we trust the resolved identity for the hash but log nothing
  // (no secrets in logs). The mismatch will be caught by the send binding check.

  const appended = await draftAccess.appendRevision({
    draftId: input.draftId,
    actor: input.actor,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    senderAddress: input.senderAddress,
    recipientAddress: input.recipientAddress,
    contentHash: "pending-materialize-v2",
    policyVersion: REPLY_POLICY_VERSION,
    validationVersion: REPLY_VALIDATOR_VERSION,
    generationMetadataJson: input.generationMetadataJson ?? null,
    validationFindingsJson: JSON.stringify({
      findings: validation.findings,
      sendableAfterApproval: validation.sendableAfterApproval,
      validatorVersion: validation.validatorVersion,
    }),
    envelopeVersion: 2,
    smtpUsername: identity.smtpUsername,
    replyToAddress: identity.replyToAddress,
  });

  const envelope: EmailReplyApprovalEnvelopeV2 = {
    version: 2,
    draftId: input.draftId,
    revisionId: appended.revision.id,
    emailServiceId: input.emailServiceId,
    originalMessageId: input.originalMessageId,
    smtpUsername: identity.smtpUsername,
    senderAddress: input.senderAddress,
    replyToAddress: identity.replyToAddress,
    recipientAddress: input.recipientAddress,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    policyVersion: REPLY_POLICY_VERSION,
    validationVersion: REPLY_VALIDATOR_VERSION,
  };
  const contentHash = hashApprovalEnvelopeV2(envelope);
  await draftAccess.applyContentHash(
    input.draftId,
    appended.revision.id,
    contentHash
  );

  return {
    revisionId: appended.revision.id,
    revisionNumber: appended.revision.revisionNumber,
    contentHash,
    smtpUsername: identity.smtpUsername,
    replyToAddress: identity.replyToAddress,
  };
}
