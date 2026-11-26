/**
 * Detects SQLite unique-constraint violations across drivers/wrappers:
 * better-sqlite3 raises messages containing "UNIQUE constraint failed";
 * TypeORM-wrapped errors may carry a code instead.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) return true;
  const code = (error as { code?: string }).code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}
