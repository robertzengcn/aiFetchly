// test/vitest/main/config/IsolatedTmpDir.v01.test.ts
//
// V01 / re-audit checkbox 1 + checkbox 3 — adversarial regression for the
// per-worker temp-dir isolation setupFile
// (test/vitest/_setup/isolatedTmpDir.ts, wired into vite.main.config.mjs).
//
// The setupFile runs before test modules import and assigns each vitest worker
// process a unique TMPDIR. BaseDb (src/model/Basedb.ts) and BaseModule
// (src/modules/baseModule.ts) fall back to `path.join(os.tmpdir(),
// "aifetchly-test")` when constructed without a filepath / without USERSDBPATH
// in the Token store. Because `os.tmpdir()` re-reads `process.env.TMPDIR` per
// call on Node 22, the fallback resolves to a per-worker-unique dir instead of
// the legacy shared `<systemTmp>/aifetchly-test` file two forked workers would
// collide on with SQLITE_BUSY.
//
// This suite asserts the isolation is ACTIVELY in effect through the PRODUCTION
// fallback path (not a test-only helper): if the setupFile is removed, broken,
// or silently skipped, these assertions fail RED instead of the suite
// false-greening on the shared DB (re-audit checkbox 3: "failure artifacts
// distinguish skipped-by-setup tests from exercised assertions").

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import os from "node:os";
import path from "node:path";
import { getSqliteTestFallbackDir, SqliteDb } from "@/config/SqliteDb";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";

/**
 * The legacy shared fallback the setupFile is responsible for MOVING OFF of.
 * Computed against the ORIGINAL system tmpdir (the one the setupFile captured
 * before overriding TMPDIR). On a correctly-isolated worker this must NOT equal
 * `getSqliteTestFallbackDir()` — proving the worker is no longer on the shared
 * path that two forked workers collide on.
 *
 * We re-read `os.tmpdir()` to capture whatever the ORIGINAL system value was
 * ONLY by temporarily restoring the env. We cannot know the original value
 * directly (the setupFile overwrote it before this module loaded), so instead
 * we assert the worker's TMPDIR is inside a worker-prefixed temp dir AND that
 * the production fallback resolves inside it. The decisive, tamper-evident
 * check is: TMPDIR starts with the worker prefix AND
 * `getSqliteTestFallbackDir()` is nested under TMPDIR.
 */

describe("V01 — per-worker temp-dir isolation (re-audit checkbox 1 + 3)", () => {
  const seededServiceIds: number[] = [];

  beforeEach(() => {
    seededServiceIds.length = 0;
  });

  afterEach(async () => {
    // Clean only the rows this suite seeded, through the production model, so
    // we never leave cross-test state. Destroying the singleton would break the
    // shared-fallback suites that intentionally reuse it; we leave the
    // connection alive (the worker dir is removed on worker exit by the
    // setupFile). Best-effort delete — a missing row is not a failure.
    const model = new EmailServiceModel("");
    for (const id of seededServiceIds) {
      try {
        await model.delete(id);
      } catch {
        // Row may already be gone; not a failure for the isolation assertion.
      }
    }
  });

  test("the setupFile assigned a worker-unique TMPDIR before test modules imported", () => {
    const tmpdir = process.env.TMPDIR;
    expect(tmpdir, "TMPDIR must be set by the isolatedTmpDir setupFile").toBeDefined();
    // The worker dir is created under <originalTmp>/aifetchly-vitest-XXXX.
    expect(tmpdir).toContain("aifetchly-vitest-");
  });

  test("the PRODUCTION empty-dbpath fallback (BaseDb) resolves into the worker-unique dir, not the legacy shared file", () => {
    // EmailServiceModel extends BaseDb; constructed with "" it exercises the
    // EXACT production fallback the re-audit names (Basedb.ts:17 ->
    // os.tmpdir()/aifetchly-test). This is the path
    // EmailReplyDraftGeneration.test.ts:53 seeds through.
    const fallbackDir = getSqliteTestFallbackDir();
    const tmpdir = process.env.TMPDIR as string;

    // Decisive, tamper-evident: the fallback's PARENT directory (everything
    // except the trailing "aifetchly-test" segment) must BE this worker's
    // unique dir. If the setupFile is removed, getSqliteTestFallbackDir()
    // resolves to <systemTmp>/aifetchly-test whose parent is the plain system
    // tmpdir — not worker-unique — and this fails RED.
    const fallbackParent = path.dirname(fallbackDir);
    expect(
      fallbackParent,
      `fallback parent ${fallbackParent} must be the worker-unique dir ` +
        `${tmpdir} (if not, the isolatedTmpDir setupFile is not active and ` +
        `the shared aifetchly-test DB will collide under parallel workers — SQLITE_BUSY)`
    ).toBe(tmpdir);

    // And the terminal segment is the familiar aifetchly-test name, so
    // isTestFallbackDir() still recognizes it and the "never switch a live user
    // connection to the test fallback" guard (SqliteDb.getInstance L740-753)
    // keeps holding — checkbox 3: never touch the real user database.
    expect(fallbackDir.endsWith("aifetchly-test")).toBe(true);
  });

  test("an empty-dbpath production model writes to the worker-unique file and round-trips a row", async () => {
    // End-to-end through the production path: construct EmailServiceModel("")
    // (BaseDb fallback), seed a row, read it back. If two workers silently
    // shared one DB, this would still pass in isolation but flake under
    // parallel load — the nested-TMPDIR assertion above is what proves
    // isolation; this test proves the production model actually functions on
    // the isolated file (not a broken/empty path).
    const model = new EmailServiceModel("");
    await model.ensureConnection();

    const id = 99001 + Math.floor(process.pid % 1000);
    seededServiceIds.push(id);

    const entity = new EmailServiceEntity();
    entity.id = id;
    entity.name = `V01 isolation probe ${id}`;
    entity.from = "v01-probe@svc.com";
    entity.smtpUsername = null;
    entity.replyTo = null;
    entity.password = "secret";
    entity.host = "smtp.v01.com";
    entity.port = "465";
    entity.ssl = 1;
    entity.status = 1;
    await model.create(entity);

    const fetched = await model.read(id);
    expect(fetched, "the seeded row must round-trip on the worker-unique DB").toBeDefined();
    expect(fetched?.from).toBe("v01-probe@svc.com");
  });

  test("the SqliteDb singleton for the fallback is recognized as a test-fallback dir (real-DB guard intact)", async () => {
    // checkbox 3: getInstance must still REFUSE to switch a live user connection
    // onto the test fallback. That guard keys on isTestFallbackDir(), which
    // compares against getSqliteTestFallbackDir(). Since the worker TMPDIR only
    // relocates the fallback (does not rename it), isTestFallbackDir still
    // matches. Prove the fallback dir this worker resolved is still treated as
    // a test fallback — i.e. the guard would fire — by constructing a fresh
    // user dir and checking getInstance prefers it over switching to fallback.
    await SqliteDb.destroyInstance();
    try {
      const userDir = path.join(os.tmpdir(), `aifetchly-v01-userdb-${process.pid}`);
      const userDb = SqliteDb.getInstance(userDir);
      await SqliteDb.ensureInitialized();

      // Now ask for the test fallback while a live NON-fallback user connection
      // exists. The guard must return the live user instance, not the fallback.
      const bounced = SqliteDb.getInstance(getSqliteTestFallbackDir());
      expect(bounced, "guard must return the live user DB, not switch to fallback").toBe(userDb);
      expect(userDb.connection.isInitialized).toBe(true);
    } finally {
      await SqliteDb.destroyInstance();
    }
  });
});
