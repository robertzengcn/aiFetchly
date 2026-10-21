/**
 * Shared helpers for comparing against SQLite columns whose storage format is
 * NOT ISO-8601.
 *
 * TypeORM `@CreateDateColumn` / `@UpdateDateColumn` against the better-sqlite3
 * driver store values via SQLite's `CURRENT_TIMESTAMP`, which is the text
 * `"YYYY-MM-DD HH:MM:SS"` (space separator, no offset marker, no
 * milliseconds). Comparing such a column against `Date.prototype.toISOString()`
 * (`"YYYY-MM-DDTHH:MM:SS.sssZ"`, 'T' separator) is a TEXT comparison in SQLite:
 * `' '` (0x20) < `'T' (0x54)`, so every row created on the same UTC day as the
 * bound sorts *before* it and is excluded from a `>= :startedAt` window — the
 * execution-local freshness window appears empty and record-count / fresh-
 * observation evidence criteria can never be satisfied (fail-closed →
 * unknown). See `ContactInfo.model.ts` (extraction_date) for the regression
 * this module exists to prevent.
 *
 * Bind the space-format text produced here instead of `toISOString()`.
 */

/**
 * Format a Date as SQLite `CURRENT_TIMESTAMP` text: `"YYYY-MM-DD HH:MM:SS"` in
 * UTC, with a space separator and no milliseconds/offset. Lexically comparable
 * against `@CreateDateColumn` values stored by the better-sqlite3 driver.
 *
 * Note: `@CreateDateColumn` stores whole seconds (no fractional). For a `>=`
 * bound, producing whole seconds (matching the storage granularity) is the
 * least surprising choice; callers that need sub-second precision should not
 * compare against a whole-second column.
 */
export function toSqliteCurrentTimestampText(date: Date): string {
  const pad = (n: number, width = 2): string =>
    String(n).padStart(width, "0");
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-` +
    `${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:` +
    `${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}
