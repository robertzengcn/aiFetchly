import * as os from "os";
import * as path from "path";

/**
 * Resolve the temp DB directory used as a fallback when no USERSDBPATH is set
 * (test / dev environments where `Token.getValue(USERSDBPATH)` is empty).
 *
 * Shared by `BaseModule.ensureConnection()` and `BaseDb`'s constructor so the
 * two fallbacks can never drift apart.
 *
 * Concurrency: under vitest's default `forks` pool, DB-touching test files run
 * in separate worker processes. If they all fell back to the same on-disk
 * file (`os.tmpdir()/aifetchly-test/scraper.db`), concurrent
 * `DataSource.synchronize` DDL across workers hit `SQLITE_BUSY_SNAPSHOT`
 * (which `busy_timeout` cannot retry) — a ~1-in-4000 CI flake. Namespacing the
 * fallback dir by `VITEST_POOL_ID` gives each worker its own file.
 *
 * `VITEST_POOL_ID` is set by vitest only (absent in production and `yarn dev`),
 * so non-test behavior is unchanged: a single shared `aifetchly-test` dir.
 */
export function resolveTestDbPath(): string {
  const poolId = process.env.VITEST_POOL_ID;
  const dirName = poolId ? `aifetchly-test-${poolId}` : "aifetchly-test";
  return path.join(os.tmpdir(), dirName);
}
