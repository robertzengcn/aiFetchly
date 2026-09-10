import { normalizeEmailAddressForHash } from "@/service/emailReply/EmailReplyRevisionHasher";
import {
  normalizeEmailAddressV2,
  normalizeSmtpUsernameForHash,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";

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
    /** Envelope schema version (§18.1). Defaults to 1 (legacy) when omitted. */
    envelopeVersion?: 1 | 2;
    /** Frozen SMTP username (v2 only). Null/undefined for v1 revisions. */
    smtpUsername?: string | null;
    /** Frozen Reply-To (v2 only). Null/undefined for v1 or no-Reply-To. */
    replyToAddress?: string | null;
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
    /** Current effective SMTP username (§18.2). When null/undefined, falls back to `from`. */
    smtpUsername?: string | null;
    /** Current configured Reply-To (§18.2). Null/undefined = no Reply-To configured. */
    replyTo?: string | null;
  };
  recomputedHash: string;
}

/** Thrown when an approved-send envelope binding check fails. */
export class SendBindingError extends Error {
  constructor(message: string, public readonly code: string) {
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
    fail(
      "service_inactive",
      "Send rejected: bound email service is not active"
    );
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

  // §18.2 / §18.3 — identity binding. Version-2 revisions carry the frozen
  // service identity (smtpUsername + replyToAddress) and must match the
  // current effective service identity at send time. Version-1 revisions may
  // send ONLY when the service still satisfies the legacy compatibility gate
  // (effective SMTP username == From, configured Reply-To == null); otherwise
  // the approval is invalidated and review is required.
  const version = revision.envelopeVersion ?? 1;
  if (version === 2) {
    // §18.2 — v2 identity comparison. Uses the same v2 normalization as the
    // hash function so the comparison is byte-identical.
    const effectiveSmtp = service.smtpUsername ?? service.from;
    if (
      normalizeSmtpUsernameForHash(revision.smtpUsername ?? "") !==
      normalizeSmtpUsernameForHash(effectiveSmtp)
    ) {
      fail(
        "reply_identity_mismatch",
        "Send rejected: revision SMTP username does not match the current effective login"
      );
    }
    // Revision sender already checked above via sender_mismatch; the v2
    // comparison uses v2 normalization for consistency with the hash.
    if (
      normalizeEmailAddressV2(revision.senderAddress) !==
      normalizeEmailAddressV2(service.from)
    ) {
      fail(
        "reply_identity_mismatch",
        "Send rejected: revision sender does not match the current From address"
      );
    }
    const revisionReplyTo =
      revision.replyToAddress === null || revision.replyToAddress === undefined
        ? null
        : normalizeEmailAddressV2(revision.replyToAddress);
    const serviceReplyTo =
      service.replyTo === null || service.replyTo === undefined
        ? null
        : normalizeEmailAddressV2(service.replyTo);
    if (revisionReplyTo !== serviceReplyTo) {
      fail(
        "reply_identity_mismatch",
        "Send rejected: revision Reply-To does not match the current configured Reply-To (null must match null)"
      );
    }
  } else {
    // §18.3 — legacy v1 gate. A v1 approval may send only when the service's
    // effective SMTP username equals its From AND configured Reply-To is null.
    // Otherwise, the identity the v1 hash implicitly assumed no longer holds;
    // invalidate and require a fresh v2 revision + re-approval.
    const effectiveSmtp = service.smtpUsername ?? service.from;
    const smtpMatchesLegacy =
      normalizeSmtpUsernameForHash(effectiveSmtp) ===
      normalizeSmtpUsernameForHash(service.from);
    const replyToIsNull =
      service.replyTo === null || service.replyTo === undefined;
    if (!smtpMatchesLegacy || !replyToIsNull) {
      fail(
        "legacy_reply_identity_requires_review",
        "Send rejected: legacy v1 approval requires review because the service identity (SMTP username / Reply-To) has changed"
      );
    }
  }
}
