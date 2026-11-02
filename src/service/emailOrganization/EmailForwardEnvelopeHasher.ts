import crypto from "crypto";
import type { EmailForwardAttachmentManifestEntry } from "@/entityTypes/emailOrganizationTypes";

/**
 * Canonical forward envelope hashing (technical design §6.1/§8.1).
 *
 * The hash freezes the exact approved payload: sending identity, recipients,
 * subject, note, body artifact hashes, attachment manifest and the generated
 * Message-ID. Approval binds to this hash; any change invalidates approval
 * (PRD FR-12 / AC-12). Pure and deterministic — same input, same hash.
 *
 * Format: length-prefixed field records joined by `|`, mirroring the reply
 * envelope hasher conventions. Null optional fields become literal markers.
 */

const NULL_MARK = "<<NULL>>";

export interface ForwardEnvelopeV1 {
  readonly sendingAccountId: number;
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly replyToAddress: string | null;
  readonly smtpUsername: string | null;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly bccRecipients: readonly string[];
  readonly subject: string;
  readonly note: string | null;
  readonly bodyTextHash: string | null;
  readonly bodyHtmlHash: string | null;
  readonly attachments: readonly EmailForwardAttachmentManifestEntry[];
  readonly composedMessageId: string;
  readonly sourceLocationSnapshotJson: string;
  readonly sourceFullSourceHash: string | null;
}

function field(label: string, value: string | null | undefined): string {
  const normalized = value == null || value === "" ? NULL_MARK : value;
  return `${label}=${normalized.length}:${normalized}`;
}

/** Normalizes an address for envelope comparison (lowercase local-insensitive). */
export function normalizeEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** Deduplicates recipients across fields while keeping first-field priority. */
export function buildEnvelopeRecipients(
  to: readonly string[],
  cc: readonly string[],
  bcc: readonly string[]
): string[] {
  const seen = new Set<string>();
  const envelope: string[] = [];
  for (const address of [...to, ...cc, ...bcc]) {
    const normalized = normalizeEmailAddress(address);
    if (normalized === "" || seen.has(normalized)) continue;
    seen.add(normalized);
    envelope.push(normalized);
  }
  return envelope;
}

export function hashForwardEnvelope(envelope: ForwardEnvelopeV1): string {
  const canonical: string[] = [
    field("version", "fwv1"),
    field("sendingAccountId", String(envelope.sendingAccountId)),
    field("fromAddress", envelope.fromAddress),
    field("fromName", envelope.fromName),
    field("replyToAddress", envelope.replyToAddress),
    field("smtpUsername", envelope.smtpUsername),
    field("to", [...envelope.toRecipients].map(normalizeEmailAddress).sort().join(",")),
    field("cc", [...envelope.ccRecipients].map(normalizeEmailAddress).sort().join(",")),
    field("bcc", [...envelope.bccRecipients].map(normalizeEmailAddress).sort().join(",")),
    field("subject", envelope.subject),
    field("note", envelope.note),
    field("bodyTextHash", envelope.bodyTextHash),
    field("bodyHtmlHash", envelope.bodyHtmlHash),
    field(
      "attachments",
      [...envelope.attachments]
        .sort((a, b) => a.partId.localeCompare(b.partId))
        .map(
          (entry) =>
            `${entry.partId}:${entry.selected ? "1" : "0"}:${entry.contentHash}:${entry.decodedSize}`
        )
        .join(","),
    ),
    field("composedMessageId", envelope.composedMessageId),
    field("sourceLocationSnapshot", envelope.sourceLocationSnapshotJson),
    field("sourceFullSourceHash", envelope.sourceFullSourceHash),
  ];
  const payload = canonical.join("|");
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Hash of raw bytes (source, attachment content, artifact bodies). */
export function hashBytes(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** Generates a fresh Message-ID for the new forward identity. */
export function generateForwardMessageId(): string {
  const uuid = crypto.randomUUID();
  return `<${uuid}@aifetchly.forward>`;
}

export function generateClaimToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashClaimToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** Fwd: prefix applied once (PRD §5.2 defaults). */
export function ensureFwdPrefix(subject: string): string {
  const trimmed = subject.trim();
  if (/^fwd\s*:/i.test(trimmed)) return trimmed;
  return `Fwd: ${trimmed}`;
}

const EMAIL_ADDRESS_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_ADDRESS_PATTERN.test(value.trim()) && value.length <= 320;
}
