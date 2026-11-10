/**
 * Vitest globalSetup: runs `tsc --noEmit` before any test executes.
 *
 * Why: Vitest uses esbuild's transpile-only mode, which strips types
 * without checking them. Type errors therefore don't fail test runs.
 * This bit us during the zod schema rollout (commit history has the
 * fix). To prevent recurrence, every vitest config that touches typed
 * source code references this file via `test.globalSetup`.
 *
 * Behavior:
 *  - tsc exits 0 -> setup resolves, tests proceed normally
 *  - tsc exits non-zero -> setup throws, vitest aborts the whole run
 *
 * The tsc JavaScript entry (node_modules/typescript/bin/tsc) is executed
 * through the running Node binary (process.execPath), so this works in
 * worktrees and CI on every platform without a global install or a shell.
 * Spawning node_modules/.bin/tsc directly fails on Windows because the
 * extensionless POSIX shim cannot be executed without a shell.
 *
 * Performance: tsc on this project takes ~45s on a warm Ubuntu CI runner
 * and has exceeded 3 minutes on macos-latest. The cap is 10 minutes so a
 * slow runner can finish, and a true hang still fails the job.
 * macos-latest's default V8 heap is ~2 GB; tsc SIGABRTs there with no
 * diagnostics (Test Suite #116, heap 2040 MB). The managed-copy job raises
 * NODE_OPTIONS for this process, and the child inherits it.
 *
 * Env opt-out:
 *   AIFETCHLY_SKIP_TSC=1 yarn testmain   # bypass typecheck (NOT recommended)
 * Useful for very tight inner loops where you know types are clean.
 */
import { execFileSync } from "child_process";
import * as path from "path";

export default function setup(): void {
  if (process.env.AIFETCHLY_SKIP_TSC === "1") {
    // eslint-disable-next-line no-console
    console.log("[typecheck] AIFETCHLY_SKIP_TSC=1 set, skipping tsc gate");
    return;
  }

  const tscEntry = path.resolve(
    __dirname,
    "../../../node_modules/typescript/bin/tsc"
  );
  const projectRoot = path.resolve(__dirname, "../../..");
  const tsconfig = path.join(projectRoot, "tsconfig.json");

  // eslint-disable-next-line no-console
  console.log(
    `[typecheck] running tsc --noEmit -p ${path.relative(
      process.cwd(),
      tsconfig
    )}`
  );

  // macos-latest has been killed at 180s while still typechecking (no
  // diagnostics). 10 minutes leaves headroom; the job timeout is 30.
  const typecheckTimeoutMs = 600_000;

  try {
    // `--incremental false` (dev) makes the gate's verdict DETERMINISTIC —
    // a stale tsbuildinfo must never flip the answer. Spawn via
    // process.execPath + tscEntry (branch fix): `node_modules/.bin/tsc` is
    // an extensionless POSIX shim that cannot spawn on win32.
    execFileSync(
      process.execPath,
      [tscEntry, "--noEmit", "--incremental", "false", "-p", tsconfig],
      {
        cwd: projectRoot,
        stdio: "pipe", // capture stdout/stderr; we'll format below
        timeout: typecheckTimeoutMs,
      }
    );
  } catch (err: unknown) {
    const e = err as {
      stdout?: Buffer;
      stderr?: Buffer;
      status?: number | null;
      signal?: NodeJS.Signals | null;
      message?: string;
    };
    const stdout = e.stdout?.toString("utf8") ?? "";
    const stderr = e.stderr?.toString("utf8") ?? "";
    const combined = (stdout + stderr).trim();
    const how = e.signal
      ? `signal ${e.signal}`
      : `exit ${e.status ?? "unknown"}`;
    const detail = e.message ? ` (${e.message})` : "";
    // Surface the tsc output regardless of which stream vitest decides to show
    // eslint-disable-next-line no-console
    console.error(
      `[typecheck] tsc --noEmit failed (${how}${detail}).\n` + combined
    );
    // Throwing aborts the whole vitest run. Tests don't execute.
    throw new Error(
      `tsc --noEmit failed (${how}). ` +
        `Fix type errors above, or bypass with AIFETCHLY_SKIP_TSC=1 (not recommended).`
    );
  }
}
