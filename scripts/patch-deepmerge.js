"use strict";
/**
 * Patches node_modules/deepmerge (v4.3.1) mergeObject() to close the
 * prototype-poisoning flaw (GitHub Dependabot alert #320 — moderate, open,
 * no upstream fix released: vulnerable range >= 4.2.0 <= 4.3.1 and 4.3.1 is
 * the latest version on npm).
 *
 * Why this exists:
 *   `deepmerge` is a runtime dependency pulled by puppeteer-extra and
 *   @rollup/plugin-node-resolve, whose options/defaults are merged from
 *   caller-controlled objects. Upstream has not released a patched
 *   version, so `yarn upgrade` cannot resolve this — the installed code
 *   itself must be hardened.
 *
 * The flaw:
 *   mergeObject() guards only the SOURCE-side key loop with
 *   propertyIsUnsafe(target, key) — and that guard checks the key against
 *   the TARGET, not against `destination`. The TARGET-side loop
 *   (getKeys(target).forEach) has no guard at all. When the target is an
 *   object carrying an own enumerable `__proto__` data property (trivially
 *   produced by JSON.parse('{"__proto__": {...}}'), which does not invoke
 *   the accessor), `destination[key] = value` invokes the
 *   Object.prototype.__proto__ setter and rewrites the prototype of the
 *   returned object (prototype poisoning of the merge result).
 *
 * The fix:
 *   Skip the three prototype-hazard keys (`__proto__`, `constructor`,
 *   `prototype`) at the top of BOTH key loops. Behavior is unchanged for
 *   every benign object — no legitimate config merges those keys — and
 *   the returned object can no longer have its prototype rewritten by
 *   merge input.
 *
 * Idempotent: files already carrying the exact guard in BOTH loops are
 * left untouched. Walks the whole node_modules tree so nested copies are
 * patched too. Anchored on `forEach(function(key) {`, which occurs exactly
 * twice per build (both mergeObject key loops) — files whose shape differs
 * are skipped with a WARNING (install still succeeds so a future upstream
 * shape change cannot brick installs; the WARNING is the CI signal).
 * Writes are atomic (write-file-atomic) and the patched text is
 * syntax-verified before it lands, so a partial or corrupting write is
 * impossible. When any file is newly written, node_modules/.vite is
 * removed so Vite's optimizeDeps prebundle can never keep serving a
 * stale unpatched deepmerge copy to the renderer in dev.
 *
 * Invoked from the `postinstall` hook so the patch is always present
 * before any build/package run.
 */

const fs = require("node:fs");
const path = require("node:path");
const writeFileAtomic = require("write-file-atomic");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(PROJECT_ROOT, "node_modules");
const VITE_DEPS_DIR = path.join(NODE_MODULES, ".vite");

const GUARD =
  "if (key === '__proto__' || key === 'constructor' || key === 'prototype') { return }";
const LOOP_ANCHOR = "forEach(function(key) {";

/**
 * Locate every deepmerge package directory (v4.x — the advisory range
 * starts at 4.2.0; 1.x used by webpack-chain is a different codebase and
 * not flagged) and return the three build outputs to harden.
 */
function findVulnerableEntries(nodeModulesDir = NODE_MODULES) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === ".cache") continue; // skip yarn cache
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // Candidate: <pkg-root>/deepmerge/{index.js,dist/cjs.js,dist/umd.js}
        if (ent.name === "deepmerge") {
          const pkgJson = path.join(full, "package.json");
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
            if (typeof pkg.version === "string" && pkg.version.startsWith("4.")) {
              const candidates = [
                path.join(full, "index.js"),
                path.join(full, "dist", "cjs.js"),
                path.join(full, "dist", "umd.js"),
              ];
              for (const candidate of candidates) {
                if (fs.existsSync(candidate)) results.push(candidate);
              }
            }
          } catch {
            // unreadable package.json — skip
          }
        }
        walk(full); // recurse (catches nested copies)
      }
    }
  }
  walk(nodeModulesDir);
  return results;
}

function patchFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.warn(`[patch-deepmerge] could not read ${filePath}: ${err.message}`);
    return "failed";
  }

  const guardCount = contents.split(GUARD).length - 1;
  if (guardCount === 2) {
    return "already";
  }
  if (guardCount === 1) {
    // Half-patched (e.g. a torn write from an older non-atomic version):
    // re-patching would inject a second guard into one loop. Surface it.
    console.warn(
      `[patch-deepmerge] ${filePath} carries 1/2 guards (unexpected state); ` +
        "NOT patching — reinstall node_modules to repair"
    );
    return "failed";
  }

  const occurrences = contents.split(LOOP_ANCHOR).length - 1;
  if (occurrences !== 2) {
    console.warn(
      `[patch-deepmerge] expected exactly 2 mergeObject key loops in ${filePath}, ` +
        `found ${occurrences}; skipping (file shape differs from expected v4.3.1)`
    );
    return "skipped";
  }

  const patched = contents.replaceAll(LOOP_ANCHOR, `${LOOP_ANCHOR} ${GUARD}`);

  // Self-verify before writing: both loops must carry the guard AND the
  // result must still parse as JavaScript, so a guard landing inside a
  // string literal can never be persisted.
  if (patched.split(GUARD).length - 1 !== 2) {
    console.warn(`[patch-deepmerge] self-verify failed for ${filePath}; skipping`);
    return "skipped";
  }
  try {
    new Function(patched);
  } catch (err) {
    console.warn(
      `[patch-deepmerge] patched text does not parse for ${filePath}: ${err.message}; skipping`
    );
    return "skipped";
  }

  try {
    writeFileAtomic.sync(filePath, patched, "utf8");
  } catch (err) {
    console.warn(`[patch-deepmerge] could not write ${filePath}: ${err.message}`);
    return "failed";
  }

  console.log(`[patch-deepmerge] patched prototype poisoning in ${filePath}`);
  return "patched";
}

function main({ nodeModulesDir = NODE_MODULES, viteDepsDir = VITE_DEPS_DIR } = {}) {
  if (!fs.existsSync(nodeModulesDir)) {
    console.log("[patch-deepmerge] node_modules not found; skipping");
    return;
  }
  const targets = findVulnerableEntries(nodeModulesDir);
  if (targets.length === 0) {
    console.log("[patch-deepmerge] no deepmerge@4.x installs found; nothing to do");
    return;
  }
  let wroteAny = false;
  const results = { patched: 0, already: 0, skipped: 0, failed: 0 };
  for (const target of targets) {
    const outcome = patchFile(target);
    results[outcome] += 1;
    if (outcome === "patched") wroteAny = true;
  }
  console.log(
    `[patch-deepmerge] done: ${results.patched} newly patched, ` +
      `${results.already} already patched, ${results.skipped} skipped, ` +
      `${results.failed} failed of ${targets.length} file(s)`
  );
  // Vite's optimizeDeps prebundle hashes only lockfile+config, not file
  // content, so a newly patched deepmerge must invalidate the cache or the
  // renderer keeps loading a stale unpatched prebundle in dev.
  if (wroteAny && fs.existsSync(viteDepsDir)) {
    try {
      fs.rmSync(viteDepsDir, { recursive: true, force: true });
      console.log("[patch-deepmerge] cleared node_modules/.vite (stale prebundle)");
    } catch (err) {
      console.warn(`[patch-deepmerge] could not clear node_modules/.vite: ${err.message}`);
    }
  }
  if (results.skipped > 0 || results.failed > 0) {
    console.warn(
      `[patch-deepmerge] WARNING: ${results.skipped + results.failed} deepmerge ` +
        "file(s) could NOT be verified as prototype-poisoning-patched. " +
        "The hardening is INCOMPLETE for this install."
    );
  }
}

module.exports = { findVulnerableEntries, patchFile, main };

if (require.main === module) {
  main();
}
