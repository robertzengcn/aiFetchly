/**
 * Electron session partition resolution (technical design §5.2, §7.5).
 *
 * Each Tool Account owns ONE persistent Electron partition. New accounts use a
 * deterministic `persist:social-account-<accountId>` name; existing valid
 * stored partitions are reused so live in-browser sessions survive the upgrade.
 *
 * accountId is always obtained from the database, never from a renderer-
 * supplied partition string.
 */

const PARTITION_PREFIX = "persist:";
/**
 * Allows alphanumerics, underscore, dash, slash, dot. The slash and dot are
 * INTENTIONALLY permitted because legacy stored partitions have the shape
 * `persist:path/<timestamp>-<rand>` and must be reused, not reset. Electron
 * treats the partition name as an opaque string (never a filesystem path), so
 * this guard is a charset sanity check that blocks colons, wildcards, control
 * chars, and whitespace — NOT a path-traversal defense.
 */
const VALID_PARTITION_NAME = /^[A-Za-z0-9_./-]+$/;

export function isValidPersistentPartition(
  value: string | null | undefined
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith(PARTITION_PREFIX)) return false;
  const name = value.slice(PARTITION_PREFIX.length);
  if (name.length === 0) return false;
  return VALID_PARTITION_NAME.test(name);
}

export function buildAccountPartition(accountId: number): string {
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error(`buildAccountPartition: invalid accountId ${accountId}`);
  }
  return `${PARTITION_PREFIX}social-account-${accountId}`;
}

/**
 * Resolve the partition to use for an account: reuse a stored valid `persist:`
 * partition (preserves existing session data), otherwise create the
 * deterministic account partition. The result is persisted together with the
 * next cookie snapshot.
 */
export function resolvePartition(
  accountId: number,
  stored: string | null | undefined
): string {
  return isValidPersistentPartition(stored)
    ? stored
    : buildAccountPartition(accountId);
}
