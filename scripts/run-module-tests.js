"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    shell: false,
    ...options,
  });
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function mochaCommand() {
  return path.join(
    PROJECT_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "mocha.cmd" : "mocha"
  );
}

function rebuildBetterSqliteForNode() {
  console.log("Rebuilding better-sqlite3 for Node test runtime...");
  return run(npmCommand(), [
    "rebuild",
    "better-sqlite3",
    "--build-from-source",
  ]);
}

function restoreBetterSqliteForElectron() {
  console.log("Restoring better-sqlite3 for Electron runtime...");
  return run(process.execPath, [
    path.join(PROJECT_ROOT, "scripts", "rebuild-better-sqlite.js"),
  ]);
}

function runMocha() {
  const testFiles =
    process.argv.length > 2 ? process.argv.slice(2) : ["test/modules/**/*.test.ts"];
  return run(
    mochaCommand(),
    [
      "--require",
      "tsconfig-paths/register",
      "--require",
      "tsx/cjs",
      ...testFiles,
    ],
    {
      env: {
        ...process.env,
        TS_NODE_PROJECT: "tsconfig.json",
      },
    }
  );
}

function statusCode(result) {
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status ?? 1;
}

function main() {
  const rebuildResult = rebuildBetterSqliteForNode();
  const rebuildStatus = statusCode(rebuildResult);
  if (rebuildStatus !== 0) {
    return rebuildStatus;
  }

  const mochaResult = runMocha();
  const mochaStatus = statusCode(mochaResult);

  const restoreResult = restoreBetterSqliteForElectron();
  const restoreStatus = statusCode(restoreResult);
  if (mochaStatus !== 0) {
    return mochaStatus;
  }
  return restoreStatus;
}

process.exit(main());
