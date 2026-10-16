// test/vitest/_setup/isolatedTmpDir.ts
//
// Per-worker temporary-directory isolation for the vitest suites.
//
// PROBLEM (V01 / re-audit checkbox 1): BaseDb (src/model/Basedb.ts) and
// BaseModule (src/modules/baseModule.ts) fall back to
// `path.join(os.tmpdir(), "aifetchly-test")` when constructed without a
// filepath (no USERSDBPATH in the Token store under vitest). SqliteDb is a
// process-wide singleton keyed by the resolved path, and TypeORM runs with
// `synchronize: true`. Under vitest's DEFAULT config (forks pool, isolate:
// true — each test file in its own forked process), multiple forked workers
// running `synchronize()` DDL against the SAME shared `aifetchly-test/scraper.db`
// file throw SQLITE_BUSY / "database is locked". The `busy_timeout=10000`
// pragma does not cover WAL snapshot conflicts (SQLITE_BUSY_SNAPSHOT).
//
// FIX: `os.tmpdir()` on Node 22 re-reads `process.env.TMPDIR` on EVERY call
// (verified). This setupFile runs before any test module imports (vitest
// `setupFiles` semantics), so assigning each worker process a UNIQUE TMPDIR
// makes the empty-dbpath fallback resolve to a per-worker-unique directory.
// That fixes EVERY empty-dbpath user (BaseDb, BaseModule, HookModel,
// ProxyController, ScheduleManager, AccountSessionService, ... ) with a single
// file — including EmailReplyDraftGeneration.test.ts (~5400 lines) without
// touching it.
//
// Suites that already isolate via explicit `resetInstance(<unique tmpdir>)`
// (EmailReplyGuardReservation, EmailReplyRecovery, EmailReplyRetention,
// EmailReceivedMessageUpsert, EmailReplyClusterEligibility, AIChatArchiveModel,
// EmailReplyPopulatedUpgrade, ...) compute their tmpdir through `os.tmpdir()`
// too, so they simply NEST under this worker dir — still unique (their own
// randomUUID / Date.now suffix), still self-cleaning. This file is transparent
// to them.
//
// CLEANUP: each worker removes its own dir on process exit. A hard crash can
// leak the dir; that is strictly better than the pre-existing shared
// `aifetchly-test` which was never cleaned. Best-effort rmSync (open SQLite fds
// are unlinked fine on macOS/Linux).
//
// GUARD: if mkdtempSync fails, THROW — a silent fallthrough would leave the
// fallback on the original shared dir and reintroduce SQLITE_BUSY, surfacing as
// false-green tests rather than a clear setup failure (re-audit checkbox 3:
// "failure artifacts distinguish skipped-by-setup tests from exercised
// assertions").

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

const WORKER_DIR_PREFIX = "aifetchly-vitest-";

/**
 * Marker prefix the worker-unique TMPDIR is set to. Tests assert on this to
 * prove isolation is active (re-audit checkbox 1 + 3): if the setupFile is
 * removed or broken, `getSqliteTestFallbackDir()` resolves back to the legacy
 * shared `<systemTmp>/aifetchly-test` and the regression fails red instead of
 * silently passing.
 */
export const ISOLATED_TMPDIR_PREFIX = WORKER_DIR_PREFIX;

function setupIsolatedTmpDir(): void {
  // Read the ORIGINAL system tmpdir BEFORE overriding, so the worker dir is
  // created under the real system temp root (not recursively under itself).
  const originalTmp = os.tmpdir();

  let workerDir: string;
  try {
    workerDir = fs.mkdtempSync(path.join(originalTmp, WORKER_DIR_PREFIX));
  } catch (error: unknown) {
    // Re-throw loudly. A silent fallthrough would leave the shared fallback in
    // place and reintroduce the parallel SQLITE_BUSY failure as a false green.
    throw new Error(
      `[isolatedTmpDir] failed to create per-worker temp dir under ` +
        `${originalTmp}: ${(error as Error).message}. Aborting so the suite ` +
        `does not silently fall back to the shared aifetchly-test database.`
    );
  }

  // BaseDb/BaseModule read os.tmpdir() at construction time. Overriding TMPDIR
  // here (before test modules import) makes their fallback resolve to
  // `${workerDir}/aifetchly-test` — unique per worker process.
  process.env.TMPDIR = workerDir;

  // Best-effort cleanup on worker exit. `recursive + force` so WAL/shm sidecars
  // and any nested explicit-isolation dirs are removed too. Wrapped because the
  // process may be mid-teardown; a failure here must not mask the real exit code.
  const cleanup = (): void => {
    try {
      fs.rmSync(workerDir, { recursive: true, force: true });
    } catch {
      // Non-fatal: a leaked temp dir is better than a shared one. The next
      // system temp cleanup reclaims it.
    }
  };
  process.on("exit", cleanup);
}

setupIsolatedTmpDir();

// F08: production readiness defaults to `pending` (no validation has
// succeeded in a fresh process). Isolated unit/integration fixtures never
// run the production startup path, so explicitly mark this worker's
// readiness `passed` here — suites that exercise pending/failed
// transitions (readiness, rollback, upgrade-validation) set their state
// per-test after this. The readiness module is pure (no DB/Electron),
// so a static import has no side effects.
import { setUpgradeValidationStateForTests } from "@/service/emailReply/EmailReplyReadiness";

setUpgradeValidationStateForTests("passed");
