"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function betterSqlitePackagePath() {
  return path.join(PROJECT_ROOT, "node_modules", "better-sqlite3");
}

function betterSqliteNodePath() {
  return path.join(
    betterSqlitePackagePath(),
    "build",
    "Release",
    "better_sqlite3.node"
  );
}

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function spawnInherited(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

function nodeCanLoadBetterSqlite() {
  if (!fs.existsSync(betterSqliteNodePath())) {
    return false;
  }

  const probe = [
    "try {",
    `  const Database = require(${JSON.stringify(betterSqlitePackagePath())});`,
    "  const db = new Database(':memory:');",
    "  db.exec('CREATE TABLE t(x INTEGER);');",
    "  db.close();",
    "  process.exit(0);",
    "} catch (error) {",
    "  process.stderr.write(String((error && error.message) || error));",
    "  process.exit(1);",
    "}",
  ].join("\n");

  const result = spawnSync(process.execPath, ["-e", probe], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    timeout: 10000,
  });

  if (result.status === 0) {
    return true;
  }

  const detail = `${result.stderr || ""}${result.stdout || ""}`.trim();
  if (detail) {
    console.warn(`better-sqlite3 is not loadable in Node: ${detail}`);
  }
  return false;
}

function rebuildForNode() {
  const npmCommand = commandName("npm");
  const env = { ...process.env };
  delete env.npm_config_runtime;
  delete env.npm_config_target;
  delete env.npm_config_disturl;
  delete env.npm_config_arch;

  console.log(
    `Rebuilding better-sqlite3 for Node ${process.versions.node} (${process.platform}/${process.arch})...`
  );
  return spawnInherited(
    npmCommand,
    ["rebuild", "better-sqlite3", "--build-from-source"],
    { env }
  );
}

function restoreElectronBuild() {
  if (process.env.AIFETCHLY_SKIP_ELECTRON_RESTORE === "1") {
    console.log("Skipping Electron better-sqlite3 restore by request.");
    return 0;
  }

  const scriptPath = path.join(__dirname, "rebuild-better-sqlite.js");
  return spawnInherited(process.execPath, [scriptPath]);
}

function runVitest() {
  const vitestBin = path.join(
    PROJECT_ROOT,
    "node_modules",
    ".bin",
    commandName("vitest")
  );
  const vitestCommand = fs.existsSync(vitestBin)
    ? vitestBin
    : commandName("vitest");
  return spawnInherited(vitestCommand, [
    "--config",
    "vite.main.config.mjs",
    ...process.argv.slice(2),
  ]);
}

function run() {
  let setupStatus = 0;
  if (!nodeCanLoadBetterSqlite()) {
    setupStatus = rebuildForNode();
    if (setupStatus !== 0) {
      restoreElectronBuild();
      return setupStatus;
    }
  }

  const testStatus = runVitest();
  const restoreStatus = restoreElectronBuild();

  if (testStatus !== 0) {
    return testStatus;
  }
  return restoreStatus;
}

process.exit(run());
