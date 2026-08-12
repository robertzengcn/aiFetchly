import type { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import type { AppendRevisionInput } from "@/model/EmailReplyDraft.model";
import { hashApprovalEnvelope } from "@/service/emailReply/EmailReplyRevisionHasher";
import {
  REPLY_POLICY_VERSION,
  REPLY_VALIDATOR_VERSION,
} from "@/service/emailReply/replyReliabilityVersions";
import type { EmailReplyApprovalEnvelope } from "@/entityTypes/emailReplyReliabilityTypes";

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
  }
): Promise<{
  revisionId: number;
  revisionNumber: number;
  contentHash: string;
}> {
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
