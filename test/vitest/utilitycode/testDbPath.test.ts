import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { resolveTestDbPath } from "@/config/testDbPath";
import { getSqliteTestFallbackDir } from "@/config/SqliteDb";

/**
 * Root-cause regression guards for the DB fallback directory.
 *
 * History: the SQLITE_BUSY_SNAPSHOT CI flake (concurrent `synchronize` DDL on
 * one shared fallback file) was first fixed by suffixing the dir with
 * `VITEST_POOL_ID`. That created a SECOND directory beside
 * `getSqliteTestFallbackDir()` (`<tmpdir>/aifetchly-test`, which tests seed
 * and assert through), so the SqliteDb singleton ping-ponged between the two
 * paths — every switch destroyed the live DataSource mid-test and left
 * eagerly-bound repositories on an uninitialized connection
 * (EntityMetadataNotFoundError).
 *
 * The merged contract: worker isolation comes from the per-worker TMPDIR that
 * `test/vitest/_setup/isolatedTmpDir.ts` assigns (os.tmpdir() re-reads TMPDIR
 * per call on Node 22), and `resolveTestDbPath()` returns EXACTLY
 * `getSqliteTestFallbackDir()` so there is only ever one fallback path per
 * process. These tests pin that contract.
 */
describe("resolveTestDbPath — per-worker DB fallback", () => {
  const originalTmpdir = process.env.TMPDIR;
  beforeEach(() => {
    // Each test controls the env explicitly.
    delete process.env.VITEST_POOL_ID;
    delete process.env.VITEST_WORKER_ID;
  });
  afterEach(() => {
    delete process.env.VITEST_POOL_ID;
    delete process.env.VITEST_WORKER_ID;
    if (originalTmpdir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = originalTmpdir;
    }
  });

  it("matches getSqliteTestFallbackDir exactly (one fallback path, no singleton ping-pong)", () => {
    expect(resolveTestDbPath()).toBe(getSqliteTestFallbackDir());
  });

  it("isolates workers through the per-worker TMPDIR setup, not a pool-id suffix", () => {
    // Simulate two isolatedTmpDir workers: os.tmpdir() re-reads TMPDIR, so
    // each worker's fallback dir nests under its own unique tmp root.
    process.env.TMPDIR = path.join(os.tmpdir(), "worker-a");
    const a = resolveTestDbPath();
    process.env.TMPDIR = path.join(os.tmpdir(), "worker-b");
    const b = resolveTestDbPath();
    expect(a).not.toBe(b);
    expect(a.endsWith("aifetchly-test")).toBe(true);
    expect(b.endsWith("aifetchly-test")).toBe(true);
  });

  it("falls back to the legacy shared dir when not running under vitest (prod/dev)", () => {
    // No VITEST_POOL_ID set — production / `yarn dev` / one-off scripts.
    const dir = resolveTestDbPath();
    expect(dir).toBe(path.join(os.tmpdir(), "aifetchly-test"));
  });
});
