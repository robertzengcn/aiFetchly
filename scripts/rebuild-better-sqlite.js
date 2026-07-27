"use strict";
/**
 * Rebuilds better-sqlite3 for the installed Electron version, and verifies the
 * result actually loads under Electron.
 *
 * Why this exists:
 *   `yarn install` / `yarn add` re-runs better-sqlite3's install script
 *   (`prebuild-install`), which fetches a prebuilt binary compiled for the
 *   SYSTEM Node.js. Electron uses a different NODE_MODULE_VERSION, so the app
 *   crashes with `ERR_DLOPEN_FAILED` until better-sqlite3 is recompiled against
 *   Electron's headers. Invoked from the `postinstall` hook so a fresh install
 *   is always ready for `yarn dev`.
 *
 * Why it verifies by loading under Electron (not by `require()`-ing in Node):
 *   better-sqlite3 builds can be loadable in both Node and Electron, so a
 *   successful Node `require()` does NOT prove the binary is Electron-compatible.
 *   The only reliable check is loading it in Electron itself.
 *
 * `--print-target` prints the targeted Electron version (consumed by
 * test/vitest/utilitycode/nativeModuleVersion.test.ts).
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * The installed Electron version, or null when electron is absent
 * (e.g. `install --production` in CI/Docker). There is nothing to rebuild for
 * Electron in that case — better-sqlite3 stays built for system Node.
 */
function getElectronTargetVersion() {
  try {
    return require(path.join(
      PROJECT_ROOT,
      "node_modules",
      "electron",
      "package.json"
    )).version;
  } catch {
    return null;
  }
}

function betterSqliteNodePath() {
  return path.join(
    PROJECT_ROOT,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
}

function electronCliPath() {
  const name = process.platform === "win32" ? "electron.cmd" : "electron";
  return path.join(PROJECT_ROOT, "node_modules", ".bin", name);
}

/**
 * Probe whether the current better-sqlite3 binary loads in Electron.
 *   "ok"      — Electron spawned AND better-sqlite3 loaded successfully.
 *   "fail"    — Electron spawned but better-sqlite3 threw on load (definitive
 *               ABI mismatch — the binary is NOT Electron-compatible).
 *   "unknown" — Electron could not be spawned/queried here (no display, binary
 *               missing, timeout, etc.). Caller should trust the rebuild.
 */
function probeElectronLoad() {
  const electronBin = electronCliPath();
  if (!fs.existsSync(electronBin)) return "unknown";
  if (!fs.existsSync(betterSqliteNodePath())) return "fail";

  // Require by absolute path so module resolution does not depend on where the
  // probe file lives (it runs from os.tmpdir(), which has no node_modules).
  const bsqlRequirePath = path.join(
    PROJECT_ROOT,
    "node_modules",
    "better-sqlite3"
  );
  // Electron's CLI does not reliably accept `-e`, so write the probe to a temp
  // file and point Electron at it.
  const probeSrc = [
    "const { app } = require('electron');",
    "app.whenReady().then(() => {",
    "  try {",
    `    const D = require(${JSON.stringify(bsqlRequirePath)});`,
    "    const db = new D(':memory:');",
    "    db.exec('CREATE TABLE t(x INTEGER);');",
    "    process.stdout.write('BSQL_OK');",
    "  } catch (e) {",
    "    process.stdout.write('BSQL_FAIL:' + String((e && e.message) || e).slice(0, 200));",
    "  }",
    "  try { app.quit(); } catch (_) {}",
    "});",
    "setTimeout(() => { try { app.quit(); } catch (_) {} process.exit(3); }, 30000).unref();",
  ].join("\n");
  const probeFile = path.join(os.tmpdir(), "aifetchly-bsql-probe.js");
  try {
    fs.writeFileSync(probeFile, probeSrc);
  } catch (writeError) {
    return "unknown";
  }

  let result;
  try {
    result = spawnSync(
      electronBin,
      ["--no-sandbox", "--headless", "--disable-gpu", probeFile],
      { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 45000 }
    );
  } catch (spawnError) {
    return "unknown";
  } finally {
    try {
      fs.unlinkSync(probeFile);
    } catch (cleanupError) {
      /* best-effort */
    }
  }

  if (/BSQL_OK/.test(result.stdout || "")) return "ok";
  if (/BSQL_FAIL/.test(result.stdout || "")) {
    console.warn(
      `better-sqlite3 failed to load under Electron: ${
        (result.stdout || "").match(/BSQL_FAIL:.*/)?.[0] || "(no detail)"
      }`
    );
    return "fail";
  }
  // Electron spawned but produced neither marker — treat as unverifiable.
  return "unknown";
}

/**
 * Recompile better-sqlite3 from source against Electron's headers. Uses CLI
 * flags (not npm_config_* env vars): they propagate reliably through
 * better-sqlite3's build, where the env-var form silently left a Node build.
 */
function rebuildForElectron(electronVersion) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = [
    "rebuild",
    "better-sqlite3",
    "--build-from-source",
    "--runtime=electron",
    `--target=${electronVersion}`,
    "--disturl=https://electronjs.org/headers",
    `--arch=${process.arch}`,
  ];
  console.log(
    `Rebuilding better-sqlite3 for Electron ${electronVersion} (${process.platform}/${process.arch})...`
  );
  const result = spawnSync(npmCommand, args, {
    cwd: PROJECT_ROOT,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error);
    return false;
  }
  return result.status === 0;
}

function run() {
  const electronVersion = getElectronTargetVersion();
  if (!electronVersion) {
    console.log(
      "Skipping better-sqlite3 Electron rebuild: electron package not installed."
    );
    return 0;
  }

  // Fast path: if better-sqlite3 already loads under Electron, skip the (slow)
  // from-source recompile. Makes repeated `yarn rebuild-better-sqlite` calls
  // cheap while still self-healing after an install flips it to Node.
  const before = probeElectronLoad();
  if (before === "ok") {
    console.log(
      `better-sqlite3 already loads in Electron ${electronVersion} — nothing to do.`
    );
    return 0;
  }

  if (!rebuildForElectron(electronVersion)) {
    console.error("better-sqlite3 rebuild for Electron failed.");
    return 1;
  }

  // Never silently leave a Node-built binary — that is exactly the churn this
  // script prevents. Fail loudly on a definitive mismatch.
  const after = probeElectronLoad();
  if (after === "fail") {
    console.error(
      "better-sqlite3 was rebuilt but still fails to load under Electron. Refusing to leave the app in a broken state."
    );
    return 1;
  }
  if (after === "unknown") {
    console.warn(
      "Could not verify the rebuilt binary under Electron in this environment (continuing — rebuild reported success)."
    );
  } else {
    console.log(
      `better-sqlite3 rebuilt and verified to load in Electron ${electronVersion}.`
    );
  }
  return 0;
}

if (process.argv.includes("--print-target")) {
  console.log(getElectronTargetVersion() || "");
  process.exit(0);
}

if (require.main === module) {
  process.exit(run());
}

module.exports = {
  getElectronTargetVersion,
  probeElectronLoad,
};
