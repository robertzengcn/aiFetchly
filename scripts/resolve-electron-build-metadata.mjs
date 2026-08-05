#!/usr/bin/env node
/**
 * Resolve Electron build metadata from the installed, locked `electron` package
 * (PRD FR-24, design §25.4).
 *
 * Prints GITHUB_ENV-style lines so the release workflow can consume them:
 *   ELECTRON_VERSION=<x.y.z>
 *   ELECTRON_MODULE_ABI=<number>
 *
 * The ABI is resolved deterministically from the `electron` package version via
 * the `node-abi` package — the same authoritative version→ABI table that
 * `@electron/rebuild` (used by rebuild-native-dependencies.mjs) trusts. This is
 * never hand-maintained and avoids spawning the GUI Electron binary, which is
 * unreliable in CI (Electron ignores Node's `-e` flag and the GUI process can
 * hang on a headless runner — on Linux it cannot start at all without an X
 * server, surfacing as `Could not run Electron to resolve ABI: exit null`).
 *
 * Because the hoisted top-level `node-abi` can lag behind new Electron majors
 * (a stale copy throws on the installed version), resolution prefers
 * @electron/rebuild's own nested copy first, then the top-level copy, trying
 * each until one returns a numeric ABI before falling back to the binary.
 *
 * As a fail-closed safety net, if `node-abi` is unavailable or does not yet know
 * the installed Electron version, the script falls back to executing the real
 * Electron binary with a throwaway app that prints `process.versions.modules`.
 * If neither path can produce a verified numeric ABI, the script exits nonzero
 * so CI never ships a runtime rebuilt against an unverified ABI.
 *
 * Usage:
 *   node scripts/resolve-electron-build-metadata.mjs [--github-env <file>]
 */
import { readFileSync, writeFileSync, rmSync, appendFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export function readElectronVersion(projectRoot) {
  const pkgPath = path.join(projectRoot, "node_modules", "electron", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (!pkg.version) {
    throw new Error(`electron package at ${pkgPath} has no version.`);
  }
  return pkg.version;
}

/** The `electron` package's main export is the path to its binary. */
function resolveElectronBinary(projectRoot) {
  const projectRequire = createRequire(path.join(projectRoot, "package.json"));
  try {
    const resolved = projectRequire("electron");
    if (typeof resolved === "string" && existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // fall through to .bin
  }
  const bin = path.join(projectRoot, "node_modules", ".bin", "electron");
  if (existsSync(bin)) return bin;
  throw new Error("Could not locate the electron binary.");
}

/**
 * node-abi require-context anchor candidates, in priority order. The
 * authoritative version→ABI table is the one `@electron/rebuild` actually uses
 * (its own nested copy); older hoisted top-level releases predate new Electron
 * majors and throw on unknown versions, so {@link resolveAbiFromNodeAbiLoaders}
 * keeps trying until one returns a numeric ABI rather than stopping at the
 * first resolvable copy.
 * @param {string} projectRoot
 * @param {string | null | undefined} [selfAnchor] Anchor for the legacy
 *   script-self fallback (defaults to this module's URL). Pass `null` to skip
 *   it — used by unit tests to keep resolution isolated to `projectRoot`.
 * @returns {Array<() => unknown>}
 */
export function buildNodeAbiLoaders(projectRoot, selfAnchor = import.meta.url) {
  const loaders = [];
  const pushAnchor = (anchor) => {
    let req;
    try {
      req = createRequire(anchor);
    } catch {
      return; // anchor unusable
    }
    loaders.push(() => req("node-abi"));
  };
  // 1. @electron/rebuild's nested node-abi — the same table rebuild trusts.
  const rebuildPkg = path.join(projectRoot, "node_modules/@electron/rebuild/package.json");
  if (existsSync(rebuildPkg)) pushAnchor(rebuildPkg);
  // 2. Hoisted top-level copy.
  pushAnchor(path.join(projectRoot, "package.json"));
  // 3. This script's own resolution (legacy fallback). Skipped when `selfAnchor`
  //    is null so unit tests can isolate resolution to `projectRoot` instead of
  //    leaking to the real project's node_modules via this module's URL.
  if (selfAnchor) pushAnchor(selfAnchor);
  return loaders;
}

/**
 * Given candidate node-abi loaders, return the first numeric ABI they produce for
 * `electronVersion`, or null if none know it. A loader whose `getAbi` throws
 * (a stale node-abi that predates the Electron major) or returns a non-numeric
 * value is skipped, not fatal. Pure + exported for unit testing.
 * @param {string} electronVersion
 * @param {Array<() => unknown>} loaders
 * @returns {string | null}
 */
export function resolveAbiFromNodeAbiLoaders(electronVersion, loaders) {
  for (const load of loaders) {
    let nodeAbi = null;
    try {
      nodeAbi = load();
    } catch {
      nodeAbi = null;
    }
    if (!nodeAbi) continue;
    try {
      const abi = nodeAbi.getAbi(electronVersion, "electron");
      if (typeof abi === "string" && /^\d+$/.test(abi)) return abi;
    } catch {
      // this copy predates the Electron major; try the next loader
    }
  }
  return null;
}

/**
 * Resolve the ABI deterministically via `node-abi` (primary path). Returns the
 * numeric ABI string, or `null` if every installed node-abi copy is unavailable
 * or does not yet know this version (caller falls back to running the binary).
 * @param {string} electronVersion
 * @param {string} projectRoot
 * @param {string | null | undefined} [selfAnchor] Anchor for the legacy
 *   script-self fallback (defaults to this module's URL). Pass `null` in tests
 *   to keep resolution isolated to `projectRoot`.
 * @returns {string | null}
 */
export function resolveAbiFromNodeAbi(electronVersion, projectRoot, selfAnchor) {
  return resolveAbiFromNodeAbiLoaders(
    electronVersion,
    buildNodeAbiLoaders(projectRoot, selfAnchor),
  );
}

/**
 * Fail-closed fallback: run the installed Electron with a throwaway app that
 * prints `process.versions.modules` and exits via `app.exit()`. Uses a real app
 * entry file (not `-e`, which Electron ignores) so the process exits reliably,
 * including on Windows. Throws on any failure.
 */
function resolveAbiFromBinary(projectRoot) {
  const electronPath = resolveElectronBinary(projectRoot);
  const entryPath = path.join(os.tmpdir(), `electron-abi-probe-${process.pid}.cjs`);
  writeFileSync(
    entryPath,
    [
      "const { app } = require('electron');",
      "app.whenReady().then(() => {",
      "  process.stdout.write(String(process.versions.modules));",
      "  app.exit(0);",
      "}).catch((err) => {",
      "  process.stderr.write(String((err && err.message) || err));",
      "  app.exit(1);",
      "});",
    ].join("\n"),
  );
  let result;
  try {
    result = spawnSync(
      electronPath,
      ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", entryPath],
      { encoding: "utf-8", timeout: 120_000, windowsHide: true },
    );
  } finally {
    try {
      rmSync(entryPath, { force: true });
    } catch {
      // best-effort cleanup; ignore.
    }
  }
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit ${result.status}`;
    throw new Error(`Could not run Electron to resolve ABI: ${detail}`);
  }
  const abi = result.stdout.trim();
  if (!/^\d+$/.test(abi)) {
    throw new Error(`Electron reported a non-numeric ABI: ${JSON.stringify(abi)}`);
  }
  return abi;
}

function resolveModuleAbi(electronVersion, projectRoot) {
  const deterministic = resolveAbiFromNodeAbi(electronVersion, projectRoot);
  if (deterministic) return deterministic;
  return resolveAbiFromBinary(projectRoot);
}

function main() {
  const argv = process.argv.slice(2);
  let githubEnv = null;
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--github-env") githubEnv = argv[i + 1];
  }
  const projectRoot = process.cwd();
  const version = readElectronVersion(projectRoot);
  const abi = resolveModuleAbi(version, projectRoot);

  const lines = [`ELECTRON_VERSION=${version}`, `ELECTRON_MODULE_ABI=${abi}`];
  for (const line of lines) console.log(line);
  if (githubEnv) {
    appendFileSync(githubEnv, lines.map((l) => l + "\n").join(""));
  }
}

export function isDirectExecution(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  return pathToFileURL(path.resolve(argvPath)).href === metaUrl;
}

// Run only when executed directly, not when imported (rebuild-native-dependencies
// imports readElectronVersion).
const isMain = isDirectExecution(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`resolve-electron-build-metadata: ${err.message}`);
    process.exit(1);
  }
}
