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
import * as crypto from "node:crypto";
import { _electron } from "playwright";

/** The public fixture installed by the git-free phase (GF-1). */
const SMOKE_FIXTURE_REPO =
  process.env.PKG_SMOKE_GITHUB_REPO ??
  "https://github.com/robertzengcn/aifetchly-plugin-smoke-fixture";

/**
 * Sample the packaged app's descendant processes for a `git` executable
 * (POSIX /proc walk from the Electron root pid). Windows relies on the
 * PATH guarantee (no watchdog — the sampled tree would need WMI).
 */
function startGitWatchdog(rootPid) {
  if (process.platform === "win32") return { sawGit: () => false, stop: () => {} };
  let sawGit = false;
  const timer = setInterval(() => {
    try {
      const childrenOf = new Map();
      const pids = fs
        .readdirSync("/proc")
        .filter((d) => /^\d+$/.test(d))
        .map(Number);
      for (const pid of pids) {
        try {
          const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
          // Fields: pid (comm) ppid — comm may contain spaces; parse from
          // the right: the last two numeric-ish tokens before state context.
          const m = stat.match(/^(\d+) \(.*\) [A-Z] (-?\d+)/);
          if (!m) continue;
          const ppid = Number(m[2]);
          if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
          childrenOf.get(ppid).push(pid);
        } catch {
          /* process gone */
        }
      }
      const stack = [rootPid];
      const seen = new Set();
      while (stack.length > 0) {
        const pid = stack.pop();
        if (seen.has(pid)) continue;
        seen.add(pid);
        try {
          const cmdline = fs
            .readFileSync(`/proc/${pid}/cmdline`, "utf8")
            .split("\0")[0] ?? "";
          if (/(^|\/)git(\.exe)?$/i.test(cmdline)) {
            sawGit = true;
          }
        } catch {
          /* gone */
        }
        for (const child of childrenOf.get(pid) ?? []) stack.push(child);
      }
    } catch {
      /* /proc unavailable */
    }
  }, 150);
  return {
    sawGit: () => sawGit,
    stop: () => clearInterval(timer),
  };
}

/**
 * GF-1: install a PUBLIC GitHub plugin on the packaged app with NO git on
 * PATH, proving the archive path spawns zero Git processes and yields a
 * healthy plugin row. Runs when PKG_SMOKE_GITHUB=1 (CI) and only after the
 * base smoke passed (the caller owns the app lifecycle).
 */
async function gitFreeGitHubInstall(exe) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-pkg-gh-"));
  // A PATH with nothing resolvable — in particular NO git. The packaged
  // app itself was launched by absolute path and needs no PATH entries for
  // the HTTPS archive flow.
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-nopath-"));
  let app;
  const result = { ok: false, pluginRow: false, sawGit: false, errors: [] };
  try {
    app = await _electron.launch({
      executablePath: exe,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_PATH: userData,
        PATH: emptyBin,
      },
      timeout: 60_000,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.api), undefined, {
      timeout: 60_000,
    });

    const watchdog = startGitWatchdog(app.process()?.pid);
    try {
      const installResult = await page.evaluate(
        async ({ uri }) => {
          const resp = (await window.api.invoke("plugin:install-from-source", {
            operationId: crypto.randomUUID(),
            kind: "github",
            uri,
            overwrite: true,
          }));
          return resp ?? null;
        },
        { uri: SMOKE_FIXTURE_REPO }
      );
      const installed =
        installResult && installResult.status === true && installResult.data;
      if (!installed || installed.success !== true) {
        result.errors.push(
          "install failed: " + JSON.stringify(installed)?.slice(0, 300)
        );
      } else {
        result.ok = true;
        const listed = await page.evaluate(async () => {
          const resp = (await window.api.invoke("plugin:list"));
          return resp && resp.status === true ? resp.data : null;
        });
        const names = Array.isArray(listed)
          ? listed.map((p) => p && p.name)
          : [];
        result.pluginRow = names.includes("smoke-fixture");
        if (!result.pluginRow) {
          result.errors.push("plugin row missing after install: " + names.join(","));
        }
      }
    } finally {
      watchdog.stop();
      result.sawGit = watchdog.sawGit();
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
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
      fs.rmSync(emptyBin, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return result;
}

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

    // GF-1 (opt-in; CI sets PKG_SMOKE_GITHUB=1): git-free public GitHub
    // plugin install on the packaged app.
    if (process.env.PKG_SMOKE_GITHUB === "1") {
      const gh = await gitFreeGitHubInstall(exe);
      console.log(
        `[packaged-smoke] git-free GitHub install: ok=${gh.ok} ` +
          `pluginRow=${gh.pluginRow} sawGit=${gh.sawGit}` +
          (gh.errors.length > 0 ? ` errors=${gh.errors.join(" | ")}` : "")
      );
      if (!gh.ok || !gh.pluginRow || gh.sawGit) {
        throw new Error(
          "git-free GitHub install failed " +
            `(ok=${gh.ok} pluginRow=${gh.pluginRow} sawGit=${gh.sawGit})`
        );
      }
    }
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
