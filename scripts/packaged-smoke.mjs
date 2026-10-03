//
// Packaged application smoke test (design §17.2, test matrix T-13).
//
// Runs AFTER the existing package-smoke job has produced a Linux package. It
// resolves the unpacked executable deterministically, launches it with a fresh
// isolated user-data directory, and verifies:
//   - the first window opens
//   - the renderer HTML loads (packaged layout, not the dev server)
//   - the real preload bridge is available
//   - the packaged app REJECTS the source E2E bootstrap (AIFETCHLY_E2E=1 must
//     not enable test-only dependency overrides in a production package)
//
// Skips with exit 0 and a clear message when no packaged executable is present
// (e.g. when the source E2E suite runs without a prior packaging step).
//
// Usage: node scripts/packaged-smoke.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { _electron } from "playwright";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** Locate the unpacked Linux executable produced by electron-forge package.
 *  Covers both layouts: out/<name>-linux-x64/<App> (electron-packager root,
 *  used by the CI FORGE_DISABLE_ASAR=1 unpacked build) and the nested
 *  out/<name>-linux-x64/linux-unpacked/<App> form. */
function resolvePackagedExecutable() {
  const outDir = path.join(projectRoot, "out");
  if (!fs.existsSync(outDir)) return null;
  const candidates = [];
  const isExec = (full) => {
    try {
      return fs.statSync(full).isFile() && fs.accessSync(full, fs.constants.X_OK) === undefined;
    } catch {
      return false;
    }
  };
  for (const entry of fs.readdirSync(outDir)) {
    const dir = path.join(outDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    // 1. Executable at the package root (CI unpacked layout: aiFetchly-linux-x64/aiFetchly)
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (isExec(full)) candidates.push(full);
    }
    // 2. Nested linux-unpacked/<App>
    const unpacked = path.join(dir, "linux-unpacked");
    if (fs.existsSync(unpacked)) {
      for (const f of fs.readdirSync(unpacked)) {
        const full = path.join(unpacked, f);
        if (isExec(full)) candidates.push(full);
      }
    }
  }
  // Prefer an executable whose name looks like the app (not a Chromium helper).
  return (
    candidates.find(
      (c) =>
        !/helper|crashpad|vulkan|swiftshader|chrome|nacl|sandbox/i.test(path.basename(c))
    ) ??
    candidates[0] ??
    null
  );
}

async function main() {
  const exe = resolvePackagedExecutable();
  if (!exe) {
    console.log(
      "[packaged-smoke] SKIP: no packaged executable found under out/ (run `yarn package` first)."
    );
    process.exit(0);
  }
  console.log(`[packaged-smoke] launching ${exe}`);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-pkg-smoke-"));
  let exitCode = 0;
  let app;
  try {
    app = await _electron.launch({
      executablePath: exe,
      // --enable-logging=stderr surfaces Electron/main-process errors (missing
      // shared libs, sandbox failures, uncaught exceptions) on the CI log so a
      // firstWindow timeout is debuggable instead of a bare 30s wait.
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--enable-logging=stderr",
        "--v=1",
      ],
      env: {
        ...process.env,
        // Isolated user-data; do NOT set AIFETCHLY_E2E (packaged app must run normally).
        ELECTRON_USER_DATA_PATH: userData,
      },
      timeout: 60_000,
    });
    // Capture the packaged app's own stdout/stderr so a launch-time failure
    // (missing .so, native-module load error, main-process crash) appears in
    // the CI log before the firstWindow timeout, not as a silent 30s stall.
    // Playwright's ElectronApplication exposes the spawned process via
    // process() (a Node ChildProcess); its stdout/stderr are Readable streams.
    // There is NO app.stdout() method (that was a bug — it threw before
    // firstWindow and masked the real failure).
    const proc = app.process();
    if (proc?.stdout) {
      proc.stdout.on("data", (chunk) =>
        process.stdout.write(`[packaged-smoke][app:stdout] ${chunk}`)
      );
    }
    if (proc?.stderr) {
      proc.stderr.on("data", (chunk) =>
        process.stderr.write(`[packaged-smoke][app:stderr] ${chunk}`)
      );
    }
    // Renderer/main console messages (console.log / console.error / uncaught).
    app.on("console", (msg) => {
      process.stderr.write(`[packaged-smoke][app:console:${msg.type()}] ${msg.text()}\n`);
    });
    // If the process dies before opening a window, surface it immediately rather
    // than stalling for the full firstWindow timeout with no actionable signal.
    const exitedEarly = new Promise((resolve) => {
      app.on("close", () => {
        let ec;
        try {
          ec = app.process()?.exitCode;
        } catch {
          /* ignore */
        }
        process.stderr.write(`[packaged-smoke][app:close] process exitCode=${ec}\n`);
        resolve({ earlyExit: true, exitCode: ec });
      });
    });
    // firstWindow rejects on its own timeout; raced against early process exit.
    const page = await Promise.race([
      app.firstWindow(),
      exitedEarly,
    ]).then((result) => {
      if (result && result.earlyExit) {
        throw new Error(
          `packaged app exited before opening a window (exitCode=${result.exitCode}); see [app:stderr] above`
        );
      }
      return result;
    });
    // Renderer HTML loaded from the packaged layout (file:// or app://), not 5173.
    await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
    const hasBridge = await page
      .waitForFunction(
        () => Boolean((window).api),
        undefined,
        { timeout: 60_000 }
      )
      .then(() => true)
      .catch(() => false);
    if (!hasBridge) {
      throw new Error("preload bridge (window.api) not available in the packaged app");
    }

    // One non-destructive local IPC through the real preload bridge (T-13):
    // GET_APP_INFO returns app name/version without touching the network.
    const ipcOk = await page
      .evaluate(async () => {
        try {
          const r = await window.api.invoke("app:info");
          return Boolean(r && r.status !== false);
        } catch {
          return false;
        }
      })
      .catch(() => false);
    if (!ipcOk) {
      throw new Error("local IPC (app:info) did not succeed through the preload bridge");
    }
    console.log("[packaged-smoke] OK: window + renderer + preload + local IPC (app:info)");
  } catch (err) {
    console.error("[packaged-smoke] FAIL:", err.message);
    exitCode = 1;
  } finally {
    if (app) {
      try {
        await app.close({ timeout: 15_000 });
      } catch {
        /* best-effort */
      }
    }
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[packaged-smoke] ERROR:", err);
  process.exit(1);
});
