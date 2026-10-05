import { createHash } from "node:crypto";
import { normalizeMessageId } from "@/service/emailReceive/EmailThreadResolver";

/**
 * Canonical inbound reply identity (technical design §4.1, FR-029/FR-038).
 *
 * The duplicate guard must key on the *message identity*, not on subject,
 * sender alone, the whole conversation, or a globally shared RFC ID. The
 * canonical reply key is scoped to the configured email service so the same
 * RFC Message-ID arriving in two different inboxes is NOT merged into one
 * replyable entity.
 *
 *   - Valid canonical inbound RFC ID:  `replyKey = "rfc:" + sha256(normalizedId)`
 *   - Missing/malformed RFC ID:        `replyKey = "row:" + storedRowId`
 *
 * The `row:` fallback protects a single stored row locally but mailbox
 * detection still returns `unknown` unless positive local evidence settles it.
 * Conflicting rows with the same RFC ID but different underlying identity
 * produce `reply_state_conflict`, never an automatic merge.
 *
 * These helpers are PURE (no DB, no I/O). The module layer
 * ({@link EmailReceivedMessageModel.findCanonicalEquivalents}) uses them to
 * locate equivalent rows; the guard inspects the cluster.
 */

/** Max length of the raw `provider_uid` column (entity-defined). */
const PROVIDER_UID_MAX_LENGTH = 255;

/** Prefix for the namespaced provider-uid form (§5.1). */
const NAMESPACED_PROVIDER_UID_PREFIX = "imap:";

/** Prefix length of `imap:<folderHash>:<uidValidity>:<uid>`. */
const NAMESPACED_PROVIDER_UID_MIN_SEGMENTS = 4;

/**
 * Compute the canonical reply key for a stored message row.
 *
 * @param normalizedMessageId the row's already-normalized RFC Message-ID
 *   (preferred). When absent, the caller should pass the {@link normalizeMessageId}
 *   of the raw stored `messageId` so legacy rows join the right cluster.
 * @param rowId the stored row id, used as the local-only fallback key when no
 *   valid RFC ID exists.
 */
export function canonicalReplyKey(input: {
  normalizedMessageId: string | null;
  rowId: number;
}): string {
  const id = input.normalizedMessageId;
  if (id && id.length > 0) {
    return `rfc:${sha256Hex(id)}`;
  }
  return `row:${input.rowId}`;
}

/**
 * Normalize a stored raw `messageId` header value to its canonical token, or
 * `null` when missing/malformed. Convenience wrapper over
 * {@link normalizeMessageId} so the guard can normalize legacy rows on the fly
 * without importing the thread-resolver directly.
 */
export function normalizeStoredMessageId(
  raw: string | null | undefined
): string | null {
  return normalizeMessageId(raw);
}

/**
 * Two stored normalized message ids are equivalent when their canonical tokens
 * are byte-equal. Identifiers are case-preserving (per §7.1 of the thread
 * resolver), so equality is exact string equality — no locale-sensitive
 * casing. `null`/empty values are never equivalent to anything (including
 * another `null`): a missing id cannot match another missing id.
 */
export function normalizedIdsMatch(
  a: string | null,
  b: string | null
): boolean {
  if (!a || !b) return false;
  return a === b;
}

/**
 * Build a namespaced IMAP provider UID encoding protocol, folder hash,
 * UIDVALIDITY, and UID (§5.1). IMAP UIDs are only valid within a (folder,
 * UIDVALIDITY) namespace; a bare UID reused after a folder rename or
 * UIDVALIDITY bump would attribute the wrong message's flags to the old row.
 *
 * The encoded form is `imap:<folderHash>:<uidValidity>:<uid>` and fits within
 * the 255-character column limit. `folderHash` is a short sha256 prefix of the
 * mailbox path; `uidValidity` is stored losslessly as a string so the full
 * 32-bit value (and any leading zeros) survives.
 */
export function buildNamespacedProviderUid(input: {
  folder: string;
  uidValidity: string | number;
  uid: string | number;
}): string {
  const folderHash = sha256Hex(input.folder).slice(0, 16);
  const uidValidity = String(input.uidValidity);
  const uid = String(input.uid);
  return `${NAMESPACED_PROVIDER_UID_PREFIX}${folderHash}:${uidValidity}:${uid}`;
}

/**
 * Detect whether a stored `providerUid` is the namespaced IMAP form (post-FR-030
 * sync) or a legacy bare UID (POP3 UIDL, or a pre-namespace IMAP UID).
 *
 * Legacy bare UIDs may NOT be adopted as the same message after a folder/
 * UIDVALIDITY change; the guard must surface a `reply_state_conflict` until the
 * row is reconciled by a verified header match (FR-038).
 */
export function isNamespacedProviderUid(
  providerUid: string | null | undefined
): boolean {
  if (!providerUid) return false;
  if (!providerUid.startsWith(NAMESPACED_PROVIDER_UID_PREFIX)) return false;
  const segments = providerUid.split(":");
  return segments.length >= NAMESPACED_PROVIDER_UID_MIN_SEGMENTS;
}

/**
 * Parse a namespaced provider UID back into its provenance parts. Returns
 * `null` for legacy bare UIDs or malformed values; never throws.
 */
export function parseNamespacedProviderUid(
  providerUid: string | null | undefined
): { folderHash: string; uidValidity: string; uid: string } | null {
  if (!isNamespacedProviderUid(providerUid)) return null;
  const segments = (providerUid as string).split(":");
  // `imap` / folderHash / uidValidity / uid
  if (segments.length < NAMESPACED_PROVIDER_UID_MIN_SEGMENTS) return null;
  const folderHash = segments[1];
  const uidValidity = segments[2];
  const uid = segments.slice(3).join(":");
  if (!folderHash || !uidValidity || !uid) return null;
  return { folderHash, uidValidity, uid };
}

/**
 * Whether a stored provider-uid value fits the column length limit. Exposed so
 * sync can refuse to write a truncated identifier (a truncated namespaced UID
 * would silently collide with another row).
 */
export function providerUidFitsColumn(
  providerUid: string
): boolean {
  return providerUid.length > 0 && providerUid.length <= PROVIDER_UID_MAX_LENGTH;
}

/** SHA-256 hex digest of a UTF-8 string. */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
