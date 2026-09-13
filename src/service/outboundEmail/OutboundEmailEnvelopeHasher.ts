import { createHash } from "node:crypto";

/**
 * Canonical SHA-256 hashing for the intent-aware outbound-email pipeline
 * (technical design §11).
 *
 * The envelope hash binds authorization to the EXACT frozen content + delivery
 * envelope the user authorized; any content change (subject, body, sender,
 * recipient, service) produces a different hash, which the gate treats as
 * `batch_hash_mismatch` / invalidation (AD-005). The worker recomputes both
 * the envelope and batch hashes before any SMTP submission; a mismatch stops
 * the entire batch (`worker_payload_hash_mismatch`).
 *
 * Canonicalization rules (§11):
 *  - addresses normalized to trimmed lowercase for hashing (whole-address,
 *    not domain-only — outbound recipients are canonicalized at materialization
 *    time, so case-folding the whole address is consistent and safe);
 *  - subject/body preserved exactly after CRLF/CR → LF normalization;
 *  - missing HTML represented as `null`, never an empty string (distinct);
 *  - fields serialized in the declared order with a schema version;
 *  - no timestamps or database IDs in the envelope hash.
 *
 * Batch hash:
 *   SHA256("outbound-batch:v1\n" + sorted envelope hashes joined by "\n")
 * sorted by (recipientAddress, draftId) so input order cannot change the hash.
 */
export interface CanonicalOutboundEnvelopeV1 {
  /** Schema version; part of the hash. */
  version: 1;
  emailServiceId: number;
  senderAddress: string;
  recipientAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}

/** Input to {@link OutboundEmailEnvelopeHasher.hashBatch}; adds draftId. */
export interface BatchEnvelopeEntry extends CanonicalOutboundEnvelopeV1 {
  draftId: number;
}

const BATCH_PREFIX = "outbound-batch:v1";

/** Normalize CRLF / CR to LF. */
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Trim + lowercase the whole address for outbound hashing (§11). */
function normalizeAddressForHash(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Build the canonical, ordered, delimiter-separated string for an envelope.
 * Length-prefixed text fields defeat delimiter-injection ambiguity so two
 * different envelope sets cannot collide by embedding the separator.
 */
export function canonicalizeOutboundEnvelope(
  envelope: CanonicalOutboundEnvelopeV1
): string {
  const subject = normalizeLineEndings(envelope.subject);
  const bodyText = normalizeLineEndings(envelope.bodyText);
  const bodyHtml =
    envelope.bodyHtml === null
      ? null
      : normalizeLineEndings(envelope.bodyHtml);
  const sender = normalizeAddressForHash(envelope.senderAddress);
  const recipient = normalizeAddressForHash(envelope.recipientAddress);

  const fields = [
    `version:${envelope.version}`,
    `emailServiceId:${envelope.emailServiceId}`,
    `sender:${len(sender)}:${sender}`,
    `recipient:${len(recipient)}:${recipient}`,
    `subject:${len(subject)}:${subject}`,
    `bodyText:${len(bodyText)}:${bodyText}`,
    `bodyHtml:${bodyHtml === null ? "<<NULL_BODY_HTML>>" : `${len(bodyHtml)}:${bodyHtml}`}`,
  ];
  return fields.join("|");
}

function len(value: string): number {
  // Count UTF-16 code units consistently; only equality matters, not the unit.
  return value.length;
}

export const OutboundEmailEnvelopeHasher = {
  /** Compute the canonical SHA-256 hex digest of one envelope. */
  hashEnvelope(envelope: CanonicalOutboundEnvelopeV1): string {
    const canonical = canonicalizeOutboundEnvelope(envelope);
    return createHash("sha256").update(canonical, "utf8").digest("hex");
  },

  /**
   * Compute the batch hash over an envelope set. Envelopes are sorted by
   * (recipientAddress, draftId) before hashing so input order is irrelevant;
   * each envelope contributes its envelope hash (no IDs/timestamps).
   */
  hashBatch(envelopes: ReadonlyArray<BatchEnvelopeEntry>): string {
    const sorted = [...envelopes].sort((a, b) => {
      const ra = normalizeAddressForHash(a.recipientAddress);
      const rb = normalizeAddressForHash(b.recipientAddress);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return a.draftId - b.draftId;
    });
    const envelopeHashes = sorted.map((e) =>
      OutboundEmailEnvelopeHasher.hashEnvelope(e)
    );
    const payload = `${BATCH_PREFIX}\n${envelopeHashes.join("\n")}`;
    return createHash("sha256").update(payload, "utf8").digest("hex");
  },
};