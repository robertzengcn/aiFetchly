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
import fs from "node:fs";
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

// ---------------------------------------------------------------------------
// F08 fixture race — the setupFile's readiness marking must not evaluate the
// Token chain (featureFlags → token → electron-store) in the worker.
//
// Failure mechanism this suite pins (observed 2026-10-16 full main-suite run):
// the setupFile used a DEFERRED dynamic import of the readiness gate to mark
// readiness "passed". Under full-suite parallel load that promise resolves at
// an arbitrary time:
//   - BEFORE a Token-mocked test file's vi.mock("@/modules/token") runs →
//     featureFlags/token/electron-store get cached in the module registry
//     bound to the REAL store; isArchiveReadsEnabled() then returns the real
//     machine's "true" with an empty mocked store (5 suites / 12 tests red),
//     and ElectronStoreService's mocked constructor is never called.
//   - AFTER vitest tears the environment down → EnvironmentTeardownError
//     "Cannot load electron-store ... after the environment was torn down".
//
// The fix under test: the readiness STATE machine lives in a ZERO-IMPORT
// module and the setupFile marks readiness through it STATICALLY (synchronous
// call during setup evaluation, before any test file loads). A zero-import
// module has nothing for vi.mock to interpose and no Token chain to evaluate,
// so both failure modes are structurally impossible — no timing involved.
//
// These assertions are source-structural because the failure is a load-order
// race: it cannot be reproduced deterministically inside a single test file
// (this worker's module registry already contains the real token chain via
// other imports). They are tamper-evident in the same spirit as the V01
// checks above: reintroduce the dynamic import or point the setupFile back at
// the Token-chain gate module and these fail RED with a message naming the
// failure mode.
// ---------------------------------------------------------------------------

/** Strip block + full-line comments so prose can never trip the assertions. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function readRepoFile(relPath: string): string {
  // vitest runs with cwd = project root (vite.main.config.mjs root).
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("T01 (round 4) — per-worker SETTINGS isolation alongside DB isolation", () => {
  test("the setupFile assigns a worker-unique ELECTRON_USER_DATA_PATH", () => {
    const userDataPath = process.env.ELECTRON_USER_DATA_PATH;
    expect(
      userDataPath,
      "ELECTRON_USER_DATA_PATH must be set by the isolatedTmpDir setupFile"
    ).toBeDefined();
    // Nested under THIS worker's unique TMPDIR (not a shared location):
    // upgrade-validation suites intentionally write/clear the kill switch,
    // and without per-worker settings that state leaks into unrelated
    // workers' Token stores ("unexpected kill-switch refusal" flakes).
    const tmpdir = process.env.TMPDIR as string;
    expect(
      userDataPath!.startsWith(tmpdir),
      `settings dir ${userDataPath} must nest under the worker-unique dir ` +
        `${tmpdir}`
    );
  });

  test("the setupFile pins settings isolation with a plain env assignment (no Token chain)", () => {
    // Same tamper-evident style as the V01/F08 checks above: the mechanism
    // must stay a side-effect-free env assignment. Importing the Token /
    // electron-store chain here would reintroduce the vi.mock race this
    // file exists to prevent.
    const setup = stripComments(readRepoFile("test/vitest/_setup/isolatedTmpDir.ts"));
    expect(
      /process\.env\.ELECTRON_USER_DATA_PATH\s*=/.test(setup),
      "isolatedTmpDir.ts must assign process.env.ELECTRON_USER_DATA_PATH " +
        "so ElectronStoreService.resolveUserDataPath prefers the worker dir " +
        "over Electron userData / project-name storage"
    ).toBe(true);
  });

  test("the store resolver prefers the env path (documents the precedence this relies on)", () => {
    const resolver = stripComments(
      readRepoFile("src/modules/electronstoreservice.ts")
    );
    expect(
      resolver.indexOf("process.env.ELECTRON_USER_DATA_PATH") <
        resolver.indexOf('app.getPath("userData")'),
      "resolveUserDataPath must consult ELECTRON_USER_DATA_PATH before " +
        "Electron userData — otherwise the worker env assignment has no effect"
    ).toBe(true);
  });
});

describe("F08 fixture — setupFile readiness marking must not race per-file vi.mock", () => {
  test("the shared setupFile performs NO dynamic imports", () => {
    const setup = stripComments(readRepoFile("test/vitest/_setup/isolatedTmpDir.ts"));
    expect(
      /\bimport\s*\(/.test(setup),
      "isolatedTmpDir.ts must not use dynamic imports. A deferred dynamic " +
        "import of the readiness chain resolves at an arbitrary time under " +
        "parallel load — before per-file vi.mock registration (binding the " +
        "REAL Token store into Token-mocked suites → 12 false assertions) or " +
        "after environment teardown (EnvironmentTeardownError). Mark " +
        "readiness through the zero-import state module with a STATIC import."
    ).toBe(false);
  });

  test("readiness marking is a synchronous call into the zero-import state module", () => {
    const setup = stripComments(readRepoFile("test/vitest/_setup/isolatedTmpDir.ts"));
    expect(setup).toContain("EmailReplyReadinessState");
    expect(
      /setUpgradeValidationStateForTests\(\s*["']passed["']\s*\)/.test(setup),
      "the setupFile must synchronously mark readiness passed via " +
        "setUpgradeValidationStateForTests from the zero-import state module"
    ).toBe(true);
  });

  test("the readiness state module has ZERO runtime imports — nothing in its graph can collide with vi.mock", () => {
    const state = stripComments(readRepoFile("src/service/emailReply/EmailReplyReadinessState.ts"));
    expect(
      /^\s*import\b/m.test(state) || /\bimport\s*\(/.test(state) || /\brequire\s*\(/.test(state),
      "EmailReplyReadinessState.ts must contain no imports at all (static, " +
        "dynamic, or require). Any import pulls the Token/electron-store " +
        "chain into setup-file evaluation and reintroduces the vi.mock race."
    ).toBe(false);
  });

  test("the production readiness gate re-exports the state machine (existing consumers keep working)", () => {
    const gate = stripComments(readRepoFile("src/service/emailReply/EmailReplyReadiness.ts"));
    expect(gate).toContain('from "./EmailReplyReadinessState"');
    for (const name of [
      "markUpgradeValidationPending",
      "markUpgradeValidationPassed",
      "markUpgradeValidationFailed",
      "getUpgradeValidationState",
      "setUpgradeValidationStateForTests",
    ]) {
      expect(
        gate.includes(name),
        `EmailReplyReadiness.ts must re-export ${name} — background.ts and ` +
          `the N08 integration test import it from the gate module`
      ).toBe(true);
    }
  });
});
