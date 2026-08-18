import { normalizeEmailAddressForHash } from "@/service/emailReply/EmailReplyRevisionHasher";

/**
 * Pure mailbox + envelope binding validation for an approved send (FR-017,
 * P0.2). Throws {@link SendBindingError} on any mismatch; returns void when the
 * envelope is consistent. Extracted so the rules are unit-testable without a
 * database or SMTP.
 *
 * Invariants enforced (every violation throws BEFORE the atomic claim, so no
 * SMTP submission can occur):
 *  - the requested draftId is the draft the approval was minted for;
 *  - the approval is bound to the draft's current revision;
 *  - the draft, the original message, and the SMTP service share one mailbox;
 *  - the approved sender matches the bound mailbox `from` (after normalization);
 *  - the approved recipient matches the original message Reply-To or sender.
 */
export interface SendBindingInput {
  requestedDraftId: number;
  approval: {
    draftId: number;
    revisionId: number;
    approvedHash: string;
  };
  draft: {
    id: number;
    currentRevisionId: number | null;
    contentHash: string | null;
    emailServiceId: number | null;
  };
  revision: {
    id: number;
    senderAddress: string;
    recipientAddress: string;
    contentHash: string;
  };
  message: {
    id: number;
    emailServiceId: number;
    fromAddress: string;
    replyToAddress: string | null;
  };
  service: {
    id: number;
    from: string;
    status: number;
  };
  recomputedHash: string;
}

/** Thrown when an approved-send envelope binding check fails. */
export class SendBindingError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "SendBindingError";
  }
}

function fail(code: string, message: string): never {
  throw new SendBindingError(message, code);
}

/** Validate the full envelope binding. Throws SendBindingError on mismatch. */
export function validateSendBinding(input: SendBindingInput): void {
  const { approval, draft, revision, message, service } = input;

  if (input.requestedDraftId !== approval.draftId) {
    fail(
      "draft_token_mismatch",
      "Send rejected: approval token does not match the requested draft"
    );
  }
  if (draft.currentRevisionId !== approval.revisionId) {
    fail(
      "approval_stale",
      "Send rejected: approval is not bound to the draft's current revision"
    );
  }
  // Hash consistency across approval / draft projection / revision.
  if (approval.approvedHash !== input.recomputedHash) {
    fail(
      "hash_mismatch",
      "Send rejected: approved content no longer matches the recomputed envelope"
    );
  }
  if (revision.contentHash !== input.recomputedHash) {
    fail(
      "revision_hash_mismatch",
      "Send rejected: revision content hash differs from the recomputed envelope"
    );
  }

  // Mailbox boundary: draft / message / service must agree on one mailbox.
  const emailServiceId = draft.emailServiceId ?? message.emailServiceId;
  if (draft.emailServiceId != null) {
    if (draft.emailServiceId !== message.emailServiceId) {
      fail(
        "mailbox_mismatch",
        "Send rejected: draft mailbox differs from original message"
      );
    }
    if (draft.emailServiceId !== emailServiceId) {
      fail(
        "mailbox_mismatch",
        "Send rejected: draft mailbox differs from resolved service"
      );
    }
  }
  if (service.id !== emailServiceId) {
    fail(
      "mailbox_mismatch",
      "Send rejected: loaded service id does not match bound mailbox"
    );
  }
  if (message.emailServiceId !== emailServiceId) {
    fail(
      "mailbox_mismatch",
      "Send rejected: original message belongs to a different mailbox"
    );
  }

  if (service.status !== 1) {
    fail("service_inactive", "Send rejected: bound email service is not active");
  }

  // Envelope identity: approved sender/recipient must match trusted state.
  if (
    normalizeEmailAddressForHash(service.from) !==
    normalizeEmailAddressForHash(revision.senderAddress)
  ) {
    fail(
      "sender_mismatch",
      "Send rejected: approved sender does not match the bound mailbox address"
    );
  }
  const approvedRecipient = message.replyToAddress || message.fromAddress;
  if (
    !approvedRecipient ||
    normalizeEmailAddressForHash(revision.recipientAddress) !==
      normalizeEmailAddressForHash(approvedRecipient)
  ) {
    fail(
      "recipient_mismatch",
      "Send rejected: approved recipient does not match the original sender / Reply-To"
    );
  }
}
