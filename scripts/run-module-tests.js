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
    process.argv.length > 2
      ? process.argv.slice(2)
      : ["test/modules/**/*.test.ts"];
  // Loader setup:
  //  - `tsconfig-paths/register` resolves the `@/` path alias for synchronous
  //    `require()` calls.
  //  - `--import tsx` (injected via NODE_OPTIONS) registers tsx's full loader,
  //    which transpiles `.ts` for `require()` AND — crucially — resolves the
  //    `@/` alias for native ESM dynamic `import()`.
  //
  // The previous `--require tsx/cjs` only patched CommonJS, so dynamic
  // `import("@/...")` (used lazily in src/modules/lib/httpclient.ts and
  // tokenRefresh.ts to keep Electron-backed deps out of worker bundles) fell
  // through to Node's native ESM resolver, which does not honor the alias and
  // crashed with ERR_MODULE_NOT_FOUND. `--import tsx` is the unified entry and
  // also handles the `.ts` transpilation that `tsx/cjs` used to provide, so it
  // is dropped here.
  const nodeOptions = [process.env.NODE_OPTIONS, "--import tsx"]
    .filter(Boolean)
    .join(" ");
  return run(
    mochaCommand(),
    ["--require", "tsconfig-paths/register", ...testFiles],
    {
      env: {
        ...process.env,
        TS_NODE_PROJECT: "tsconfig.json",
        NODE_OPTIONS: nodeOptions,
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
