import { createHash, randomBytes } from "node:crypto";
import type {
  EmailReplyApprovalEnvelope,
  EmailReplyApprovalEnvelopeV2,
} from "@/entityTypes/emailReplyReliabilityTypes";
import {
  normalizeEmailAddressV2,
  normalizeSmtpUsernameForHash,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";

/**
 * Canonical SHA-256 hashing for reply approval (technical design §14.1).
 *
 * Approval binds to the EXACT content + delivery envelope reviewed by the user.
 * Changing subject, body, sender, recipient, mailbox, or policy version must
 * invalidate approval (FR-015). The hash is the deterministic check that makes
 * that cheap and unforgeable.
 *
 * Canonicalization rules:
 *  - Fixed property order via explicit object construction (never
 *    `JSON.stringify` over arbitrary entity rows whose key order / extra fields
 *    are unstable).
 *  - CRLF / CR normalized to LF for text fields (subject, bodyText, bodyHtml).
 *  - Only the validated email address *domain part* is lowercased; local parts
 *    are preserved verbatim (RFC 5321 local-part case sensitivity).
 *  - UTF-8 bytes.
 *  - `null` bodyHtml hashes as the literal token `"<<NULL_BODY_HTML>>"` so a null body
 *    is distinct from an empty-string body.
 */
export const REVISION_HASH_ALGORITHM = "sha256";
const NULL_BODY_TOKEN = "<<NULL_BODY_HTML>>";

/** Normalize line endings to LF. */
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Lowercase the domain part of an email address only. Returns the input
 * unchanged when no `@` separator is present. The local part is NEVER mutated.
 */
export function normalizeEmailAddressForHash(address: string): string {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) {
    return trimmed;
  }
  return `${trimmed.slice(0, at)}${trimmed.slice(at).toLowerCase()}`;
}

/**
 * Build the canonical string representation of an approval envelope.
 *
 * The format is a deliberately-ordered, delimiter-separated record so that
 * field reordering or extra fields cannot produce a colliding hash. A leading
 * length-prefix per text field prevents delimiter-injection ambiguity.
 */
export function canonicalizeApprovalEnvelope(
  envelope: EmailReplyApprovalEnvelope
): string {
  const subject = normalizeLineEndings(envelope.subject);
  const bodyText = normalizeLineEndings(envelope.bodyText);
  const bodyHtml =
    envelope.bodyHtml === null
      ? NULL_BODY_TOKEN
      : normalizeLineEndings(envelope.bodyHtml);
  const sender = normalizeEmailAddressForHash(envelope.senderAddress);
  const recipient = normalizeEmailAddressForHash(envelope.recipientAddress);

  // Length-prefixed fields defeat any ambiguity from delimiters appearing in
  // user content: a parser can split unambiguously, and two different envelope
  // sets cannot collide by embedding the separator.
  const fields = [
    `draftId:${envelope.draftId}`,
    `revisionId:${envelope.revisionId}`,
    `emailServiceId:${envelope.emailServiceId}`,
    `originalMessageId:${envelope.originalMessageId}`,
    `sender:${len(sender)}:${sender}`,
    `recipient:${len(recipient)}:${recipient}`,
    `subject:${len(subject)}:${subject}`,
    `bodyText:${len(bodyText)}:${bodyText}`,
    `bodyHtml:${len(bodyHtml)}:${bodyHtml}`,
    `policyVersion:${envelope.policyVersion}`,
    `validationVersion:${envelope.validationVersion}`,
  ];
  return fields.join("|");
}

function len(value: string): number {
  // Count by UTF-16 code units consistently; only equality matters, not the unit.
  return value.length;
}

/** Compute the canonical SHA-256 hex digest of an approval envelope. */
export function hashApprovalEnvelope(
  envelope: EmailReplyApprovalEnvelope
): string {
  const canonical = canonicalizeApprovalEnvelope(envelope);
  return createHash(REVISION_HASH_ALGORITHM)
    .update(canonical, "utf8")
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Version-2 reply approval envelope (§18.1).
//
// The v2 canonicalizer adds a leading `version:2` field and includes the
// resolved service identity (`smtpUsername` + `replyToAddress`) BEFORE the
// recipient, so any change to the SMTP login or Reply-To invalidates the
// approval hash. The v1 canonicalizer and all pinned v1 fixtures remain
// byte-identical — the v2 path is entirely separate.
//
// Normalization reuses the outbound v2 functions
// (`normalizeEmailAddressV2`, `normalizeSmtpUsernameForHash`) from the
// outbound hasher so reply and outbound sides are byte-for-byte consistent
// (§7.3): email = trim + lowercase domain only (preserve local part); SMTP
// username = trim only (never lowercase).
// ---------------------------------------------------------------------------

const NULL_REPLY_TO_TOKEN = "<<NULL_REPLY_TO>>";

/**
 * Build the canonical string representation of a v2 approval envelope.
 *
 * Format: leading `version:2`, then draftId, revisionId, emailServiceId,
 * originalMessageId, smtpUsername (trim-normalized), sender (v2 email
 * normalized), replyTo (v2 email normalized or `<<NULL_REPLY_TO>>`),
 * recipient (v2 normalized), subject, bodyText, bodyHtml, policyVersion,
 * validationVersion. Length-prefixed text fields prevent delimiter-injection
 * ambiguity, mirroring the v1 canonicalizer.
 */
export function canonicalizeApprovalEnvelopeV2(
  envelope: EmailReplyApprovalEnvelopeV2
): string {
  const subject = normalizeLineEndings(envelope.subject);
  const bodyText = normalizeLineEndings(envelope.bodyText);
  const bodyHtml =
    envelope.bodyHtml === null
      ? NULL_BODY_TOKEN
      : normalizeLineEndings(envelope.bodyHtml);
  const smtpUsername = normalizeSmtpUsernameForHash(envelope.smtpUsername);
  const sender = normalizeEmailAddressV2(envelope.senderAddress);
  const replyTo =
    envelope.replyToAddress === null
      ? null
      : normalizeEmailAddressV2(envelope.replyToAddress);
  const recipient = normalizeEmailAddressV2(envelope.recipientAddress);

  const fields = [
    `version:${envelope.version}`,
    `draftId:${envelope.draftId}`,
    `revisionId:${envelope.revisionId}`,
    `emailServiceId:${envelope.emailServiceId}`,
    `originalMessageId:${envelope.originalMessageId}`,
    `smtpUsername:${len(smtpUsername)}:${smtpUsername}`,
    `sender:${len(sender)}:${sender}`,
    `replyTo:${
      replyTo === null ? NULL_REPLY_TO_TOKEN : `${len(replyTo)}:${replyTo}`
    }`,
    `recipient:${len(recipient)}:${recipient}`,
    `subject:${len(subject)}:${subject}`,
    `bodyText:${len(bodyText)}:${bodyText}`,
    `bodyHtml:${len(bodyHtml)}:${bodyHtml}`,
    `policyVersion:${envelope.policyVersion}`,
    `validationVersion:${envelope.validationVersion}`,
  ];
  return fields.join("|");
}

/** Compute the canonical SHA-256 hex digest of a v2 approval envelope. */
export function hashApprovalEnvelopeV2(
  envelope: EmailReplyApprovalEnvelopeV2
): string {
  const canonical = canonicalizeApprovalEnvelopeV2(envelope);
  return createHash(REVISION_HASH_ALGORITHM)
    .update(canonical, "utf8")
    .digest("hex");
}

/** Prefix for idempotency keys derived from an approved revision (§15.3). */
export const SEND_IDEMPOTENCY_KEY_PREFIX = "erv1";

/**
 * Deterministic idempotency key for an approved send. Derived from the
 * revision + approved hash + the one-time approval id so:
 *   - two CONCURRENT send requests for the SAME approval collide on the unique
 *     index → at most one SMTP submission (FR-018); and
 *   - a RETRY after a definite failure (a fresh approval on the same revision)
 *     gets a distinct key, so the unique index does not block legitimate retries
 *     (FR-016).
 */
export function buildSendIdempotencyKey(
  draftId: number,
  revisionId: number,
  approvedHash: string,
  approvalId: number
): string {
  const digest = createHash(REVISION_HASH_ALGORITHM)
    .update(`${draftId}:${revisionId}:${approvedHash}:${approvalId}`, "utf8")
    .digest("hex");
  return `${SEND_IDEMPOTENCY_KEY_PREFIX}:${draftId}:${revisionId}:${approvalId}:${digest}`;
}

/**
 * Generate a fresh opaque one-time approval token (64 hex bytes / 128 chars).
 * Only the SHA-256 hash is persisted; the raw value is returned once to the
 * trusted caller and never logged.
 */
export function generateApprovalToken(): string {
  return randomBytes(64).toString("hex");
}

/** Hash an opaque approval token for at-rest storage / lookup. */
export function hashApprovalToken(token: string): string {
  return createHash(REVISION_HASH_ALGORITHM)
    .update(token, "utf8")
    .digest("hex");
}
