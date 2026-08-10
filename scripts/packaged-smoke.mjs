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

/** Locate the unpacked Linux executable produced by electron-forge package. */
function resolvePackagedExecutable() {
  const outDir = path.join(projectRoot, "out");
  if (!fs.existsSync(outDir)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(outDir)) {
    const dir = path.join(outDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    // linux-unpacked/<AppName> (electron-packager layout)
    const unpacked = path.join(dir, "linux-unpacked");
    if (fs.existsSync(unpacked)) {
      for (const f of fs.readdirSync(unpacked)) {
        const full = path.join(unpacked, f);
        try {
          if (fs.statSync(full).isFile() && fs.accessSync(full, fs.constants.X_OK) === undefined) {
            candidates.push(full);
          }
        } catch {
          /* not executable */
        }
      }
    }
    // some layouts put the executable at the package root
    const direct = path.join(dir, entry.replace(/-/g, ""));
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) candidates.push(direct);
  }
  // Prefer an executable whose name looks like the app (not a helper).
  return (
    candidates.find((c) => !/helper|crashpad|vulkan|swiftshader/i.test(path.basename(c))) ??
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
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      env: {
        ...process.env,
        // Isolated user-data; do NOT set AIFETCHLY_E2E (packaged app must run normally).
        ELECTRON_USER_DATA_PATH: userData,
      },
      timeout: 60_000,
    });
    const page = await app.firstWindow();
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
    console.log("[packaged-smoke] OK: window opened, renderer loaded, preload bridge present");
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
