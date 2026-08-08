"use strict";
/**
 * Patches node_modules/node-abi/abi_registry.json to add missing Electron ABI
 * entries for versions newer than what node-abi@3.x ships.
 *
 * Why this exists:
 *   `@electron/rebuild@3.7.2` (a transitive dependency of
 *   `@electron-forge/core@7.10.2`) depends on `node-abi@^3.45.0`, whose
 *   abi_registry.json only knows about Electron up to v40.0.0-alpha.2.
 *   When the project upgrades to Electron 43.x, `nodeAbi.getAbi('43.2.0',
 *   'electron')` throws "Could not detect abi for version 43.2.0 and runtime
 *   electron", breaking `electron-forge make`.
 *
 *   Upgrading to `node-abi@4.x` is NOT an option because v4 is ESM
 *   (`"type": "module"`) while `@electron/rebuild@3.7.2` is CJS and uses
 *   `require("node-abi")`. Likewise `@electron/rebuild@4.x` is ESM and
 *   incompatible with the CJS `@electron-forge/core@7.10.2`.
 *
 *   The cleanest fix is to append the missing Electron ABI entries (sourced
 *   from node-abi@4.33.0's registry) to the installed v3 registry. This is
 *   idempotent and safe: entries are only added if absent.
 *
 * Invoked from the `postinstall` hook and the forge `prePackage` hook so the
 * patch is always present before any rebuild runs.
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * Electron ABI entries for versions 41-44, sourced from node-abi@4.33.0's
 * abi_registry.json. These are the entries missing from node-abi@3.85.0.
 *
 * The `future` flag is set to false for 41-43 (released) and true for 44
 * (alpha at the time of writing). `getAbi` only requires the target to be
 * <= getNextTarget(runtime), so having 44.0.0-alpha.1 as future=true keeps
 * the "next" boundary correct.
 */
const MISSING_ELECTRON_ENTRIES = [
  { abi: "145", future: false, lts: false, runtime: "electron", target: "41.0.0-alpha.1" },
  { abi: "146", future: false, lts: false, runtime: "electron", target: "42.0.0-alpha.1" },
  { abi: "148", future: false, lts: false, runtime: "electron", target: "43.0.0-alpha.1" },
  { abi: "149", future: true, lts: false, runtime: "electron", target: "44.0.0-alpha.1" },
];

/**
 * @returns {string|null} path to the installed node-abi abi_registry.json, or
 *   null if node-abi is not installed (e.g. production install without devDeps).
 */
function findAbiRegistryPath() {
  const candidates = [
    // Direct dependency
    path.join(PROJECT_ROOT, "node_modules", "node-abi", "abi_registry.json"),
  ];

  // Also check nested copies under @electron/rebuild
  const rebuildNodeAbi = path.join(
    PROJECT_ROOT,
    "node_modules",
    "@electron",
    "rebuild",
    "node_modules",
    "node-abi",
    "abi_registry.json"
  );
  if (fs.existsSync(rebuildNodeAbi)) {
    candidates.push(rebuildNodeAbi);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Patches a single abi_registry.json file by appending any missing Electron
 * entries. Idempotent: if the entries already exist (by target), they are not
 * duplicated.
 *
 * @param {string} registryPath - absolute path to abi_registry.json
 * @returns {boolean} true if the file was modified, false if already up to date
 */
function patchRegistry(registryPath) {
  let raw;
  try {
    raw = fs.readFileSync(registryPath, "utf-8");
  } catch {
    return false;
  }

  let registry;
  try {
    registry = JSON.parse(raw);
  } catch {
    console.warn(`patch-node-abi: could not parse ${registryPath}; skipping.`);
    return false;
  }

  if (!Array.isArray(registry)) {
    console.warn(`patch-node-abi: expected an array in ${registryPath}; skipping.`);
    return false;
  }

  const existingElectronTargets = new Set(
    registry
      .filter((entry) => entry && entry.runtime === "electron")
      .map((entry) => entry.target)
  );

  let added = 0;
  for (const entry of MISSING_ELECTRON_ENTRIES) {
    if (!existingElectronTargets.has(entry.target)) {
      registry.push(entry);
      added += 1;
    }
  }

  if (added === 0) {
    return false;
  }

  // Sort so the file stays in a stable order (node-abi ships sorted by target).
  registry.sort((a, b) => {
    if (a.runtime !== b.runtime) {
      return a.runtime < b.runtime ? -1 : 1;
    }
    // Compare semver-ish targets. Both are like "43.0.0-alpha.1".
    const parseTarget = (t) => {
      const core = t.split("-")[0];
      return core.split(".").map((n) => Number(n) || 0);
    };
    const ta = parseTarget(a.target);
    const tb = parseTarget(b.target);
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
      const diff = (ta[i] || 0) - (tb[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  try {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
    console.log(
      `patch-node-abi: added ${added} missing Electron ABI entr${added === 1 ? "y" : "ies"} to ${registryPath}`
    );
    return true;
  } catch (err) {
    console.warn(`patch-node-abi: failed to write ${registryPath}: ${err}`);
    return false;
  }
}

function run() {
  const registryPath = findAbiRegistryPath();
  if (!registryPath) {
    // node-abi not installed — nothing to patch. This is fine in production
    // installs that omit devDependencies.
    return 0;
  }

  // Patch the primary registry.
  patchRegistry(registryPath);

  // Patch any nested copies (e.g. under @electron/rebuild/node_modules).
  const rebuildNodeAbi = path.join(
    PROJECT_ROOT,
    "node_modules",
    "@electron",
    "rebuild",
    "node_modules",
    "node-abi",
    "abi_registry.json"
  );
  if (fs.existsSync(rebuildNodeAbi) && rebuildNodeAbi !== registryPath) {
    patchRegistry(rebuildNodeAbi);
  }

  return 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run, patchRegistry, findAbiRegistryPath, MISSING_ELECTRON_ENTRIES };