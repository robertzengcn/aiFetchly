import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { resolveTestDbPath } from "@/config/testDbPath";

/**
 * Root-cause regression guard for the SQLITE_BUSY_SNAPSHOT CI flake.
 *
 * The flake: under vitest's default `forks` pool, DB-touching test files that
 * don't stand up their own isolated DB all opened the SAME on-disk file
 * (`os.tmpdir()/aifetchly-test/scraper.db`) via the BaseModule/Basedb fallback.
 * Concurrent `DataSource.synchronize` DDL across workers on that one file hit
 * `SQLITE_BUSY_SNAPSHOT`, which `busy_timeout` cannot retry. ~1-in-4000 under
 * load; a fresh CI `/tmp` raised the rate enough to fail the run.
 *
 * The fix: namespace the fallback dir per vitest worker (`VITEST_POOL_ID`) so
 * each fork gets its own file. These tests pin that contract.
 */
describe("resolveTestDbPath — per-worker DB fallback", () => {
  beforeEach(() => {
    // Each test controls the env explicitly.
    delete process.env.VITEST_POOL_ID;
    delete process.env.VITEST_WORKER_ID;
  });
  afterEach(() => {
    delete process.env.VITEST_POOL_ID;
    delete process.env.VITEST_WORKER_ID;
  });

  it("namespaces the dir by VITEST_POOL_ID so concurrent workers don't share a file", () => {
    process.env.VITEST_POOL_ID = "7";
    const dir = resolveTestDbPath();
    expect(dir).toBe(path.join(os.tmpdir(), "aifetchly-test-7"));
  });

  it("two different pool ids yield two different dirs", () => {
    process.env.VITEST_POOL_ID = "3";
    const a = resolveTestDbPath();
    process.env.VITEST_POOL_ID = "4";
    const b = resolveTestDbPath();
    expect(a).not.toBe(b);
  });

  it("falls back to the legacy shared dir when not running under vitest (prod/dev)", () => {
    // No VITEST_POOL_ID set — production / `yarn dev` / one-off scripts.
    const dir = resolveTestDbPath();
    expect(dir).toBe(path.join(os.tmpdir(), "aifetchly-test"));
  });
});
