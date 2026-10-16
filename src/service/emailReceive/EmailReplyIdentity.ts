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
 * R02: sentinel context hash marking a negative write whose owning probe
 * has not confirmed it. persistNegative stages every negative as PENDING
 * first and overwrites it with the real context hash only after the probe
 * is verified live; an expired probe stops after staging, so its row can
 * never become consumable — no compensating cleanup window exists at all.
 * A staged row whose probe crashed is equally unusable; the next healthy
 * probe overwrites it (monotonic condition) and confirms its own
 * observation. The value is not valid hex, so it can never equal a
 * recomputed context hash.
 */
export const PENDING_NEGATIVE_CONTEXT = "PROBE_PENDING";

/**
 * R02: whether a persisted negative observation is consumable by readers.
 * Unusable when the timestamp is missing, when the row still carries the
 * unconfirmed PENDING marker, or when the observation outlived its owning
 * probe's deadline end (expired owner's result — only a fresh probe may
 * establish a new negative). Observations without owner tracking (legacy
 * rows, grandfathered) keep the previous age-only semantics; callers still
 * apply their own TTL/freshness windows on top. Pure (no DB, no I/O) so the
 * detector, the claim fence, and the post-claim gate all apply the
 * identical predicate.
 */
export function isNegativeObservationUsable(input: {
  readonly replyNegativeCheckAt: Date | null | undefined;
  /**
   * N01: MANDATORY — the confirmation/context state. Optional in the past,
   * which let send readers omit it and accept staged, unconfirmed rows.
   * Missing (null/undefined) or pending context must not establish a
   * successful negative. Legacy rows always carry a real hash (every
   * historical negative write stored one), so fail-closed changes nothing
   * for them.
   */
  readonly replyNegativeContextHash: string | null | undefined;
  readonly replyNegativeOwnerExpiresAt: Date | null | undefined;
}): boolean {
  const observedAt = input.replyNegativeCheckAt;
  if (observedAt == null) return false;
  const contextHash = input.replyNegativeContextHash;
  if (contextHash == null || contextHash === PENDING_NEGATIVE_CONTEXT) {
    return false;
  }
  const ownerExpiresAt = input.replyNegativeOwnerExpiresAt;
  if (
    ownerExpiresAt != null &&
    observedAt.getTime() > ownerExpiresAt.getTime()
  ) {
    return false;
  }
  return true;
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
 * T02/FR-038: detect a provider-UID namespace conflict inside a canonical
 * cluster. A conflict exists when the cluster mixes legacy bare UIDs with
 * namespaced (`imap:<folderHash>:<uidValidity>:<uid>`) UIDs, or when two
 * namespaced rows disagree on folder hash or UIDVALIDITY. Either case means
 * the rows cannot be safely treated as the same underlying message without a
 * verified header match — surface for human reconciliation, never silently
 * merge. Shared by the policy orchestrator and the detection service.
 */
export function hasNamespaceConflict(
  rows: readonly { providerUid: string }[]
): boolean {
  const parsed = rows
    .map((r) => parseNamespacedProviderUid(r.providerUid))
    .filter((p): p is { folderHash: string; uidValidity: string; uid: string } => p !== null);
  if (parsed.length === 0) {
    // All legacy bare UIDs. Safe only as long as the cluster has a single row;
    // a multi-row all-legacy cluster is itself suspicious (duplicate bare UIDs
    // in one service is impossible under the unique index).
    return rows.length > 1;
  }
  if (parsed.length < rows.length) {
    // Mixed legacy + namespaced. Treat as a conflict until reconciled.
    return true;
  }
  // All namespaced: a conflict exists if folder hash or UIDVALIDITY disagree.
  const folderHashes = new Set(parsed.map((p) => p.folderHash));
  const uidValidities = new Set(parsed.map((p) => p.uidValidity));
  return folderHashes.size > 1 || uidValidities.size > 1;
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
