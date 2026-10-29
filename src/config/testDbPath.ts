import * as os from "os";
import * as path from "path";

/**
 * Resolve the temp DB directory used as a fallback when no USERSDBPATH is set
 * (test / dev environments where `Token.getValue(USERSDBPATH)` is empty).
 *
 * Shared by `BaseModule.ensureConnection()` and `BaseDb`'s constructor so the
 * two fallbacks can never drift apart. MUST stay identical to
 * `getSqliteTestFallbackDir()` in SqliteDb.ts — tests seed and assert through
 * that helper, and any drift makes the SqliteDb singleton ping-pong between
 * two paths, each switch destroying the live DataSource mid-test.
 *
 * Concurrency: under vitest, `test/vitest/_setup/isolatedTmpDir.ts` assigns
 * each worker process a UNIQUE TMPDIR before any test module imports, so
 * `os.tmpdir()` below is already per-worker — the plain `aifetchly-test` name
 * cannot collide across workers (this supersedes the earlier
 * `aifetchly-test-${VITEST_POOL_ID}` suffix, which produced a SECOND directory
 * beside the fallback-helper one and triggered exactly those path switches).
 * Non-test behavior is unchanged: a single shared `aifetchly-test` dir.
 */
export function resolveTestDbPath(): string {
  return path.join(os.tmpdir(), "aifetchly-test");
}
