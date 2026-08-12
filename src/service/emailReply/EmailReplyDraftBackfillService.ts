import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { hashApprovalEnvelope } from "@/service/emailReply/EmailReplyRevisionHasher";
import {
  REPLY_POLICY_VERSION,
  REPLY_VALIDATOR_VERSION,
} from "@/service/emailReply/replyReliabilityVersions";
import type { EmailReplyApprovalEnvelope } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * One-shot, restartable migration that lifts legacy reply drafts (created before
 * Milestone 1) onto the immutable-revision + content-hash model (technical
 * design §22.3, PRD §19).
 *
 * Guarantees:
 *  - Idempotent: a draft with a currentRevisionId is skipped.
 *  - `sent`/`discarded` drafts stay terminal; legacy `approved` is demoted to
 *    `draft` (existing drafts default to unapproved — PRD §19).
 *  - Never synthesizes an approval record (FR-015 — approval needs a real user
 *    gesture under the new policy).
 *  - Runs in the main process; never in a worker.
 */
export class EmailReplyDraftBackfillService {
  private readonly draftModule = new EmailReplyDraftModule();
  private readonly messageModule = new EmailReceivedMessageModule();
  private readonly serviceModule = new EmailServiceModule();

  /**
   * Materialize revision 1 for every legacy draft. Returns counts so callers
   * (e.g. a startup hook or IPC) can report progress.
   */
  async backfillLegacyDrafts(): Promise<{
    processed: number;
    skipped: number;
    failed: number;
  }> {
    const legacy = await this.draftModule.listLegacyDrafts();
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const draft of legacy) {
      try {
        const message = await this.messageModule.read(draft.messageId);
        if (!message) {
          // Cannot resolve the envelope without the source message; leave the
          // draft as-is rather than guessing an identity. It stays readable.
          failed += 1;
          continue;
        }
        const emailServiceId = draft.emailServiceId ?? message.emailServiceId;
        const service = await this.serviceModule
          .getEmailService(emailServiceId)
          .catch(() => null);
        const senderAddress =
          draft.senderAddress ?? service?.from ?? message.toAddressesJson ?? "";
        const recipientAddress =
          draft.recipientAddress ??
          message.replyToAddress ??
          message.fromAddress;

        if (!senderAddress || !recipientAddress) {
          // Missing envelope identity; skip rather than persist a bad hash.
          failed += 1;
          continue;
        }

        const envelope: EmailReplyApprovalEnvelope = {
          draftId: draft.id,
          revisionId: 0, // revision 1; the hash is recomputed when a real approval is later issued
          emailServiceId,
          originalMessageId: message.id,
          senderAddress,
          recipientAddress,
          subject: draft.subject,
          bodyText: draft.bodyText,
          bodyHtml: draft.bodyHtml,
          policyVersion: REPLY_POLICY_VERSION,
          validationVersion: REPLY_VALIDATOR_VERSION,
        };
        const contentHash = hashApprovalEnvelope(envelope);

        const result = await this.draftModule.materializeRevision1ForLegacyDraft({
          draftId: draft.id,
          actor: draft.generationSource === "manual" ? "user" : "ai",
          subject: draft.subject,
          bodyText: draft.bodyText,
          bodyHtml: draft.bodyHtml,
          senderAddress,
          recipientAddress,
          contentHash,
          emailServiceId,
        });
        if (result) {
          processed += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        console.error(`Backfill failed for draft ${draft.id}:`, error);
        failed += 1;
      }
    }

    return { processed, skipped, failed };
  }
}
