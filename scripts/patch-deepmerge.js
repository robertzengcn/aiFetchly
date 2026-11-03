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
 * Idempotent: files already containing the guard are left untouched.
 * Walks the whole node_modules tree so nested copies are patched too.
 * Anchored on `forEach(function(key) {`, which occurs exactly twice per
 * build (both mergeObject key loops) — files whose shape differs are
 * skipped with a warning, never corrupted.
 *
 * Invoked from the `postinstall` hook so the patch is always present
 * before any build/package run.
 */

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(PROJECT_ROOT, "node_modules");

const GUARD =
  "if (key === '__proto__' || key === 'constructor' || key === 'prototype') { return }";
const LOOP_ANCHOR = "forEach(function(key) {";
const IDEMPOTENCE_MARKER = "=== '__proto__'";

/**
 * Locate every deepmerge package directory (v4.x — the advisory range
 * starts at 4.2.0; 1.x used by webpack-chain is a different codebase and
 * not flagged) and return the three build outputs to harden.
 */
function findVulnerableEntries() {
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
  walk(NODE_MODULES);
  return results;
}

function patchFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.warn(`[patch-deepmerge] could not read ${filePath}: ${err.message}`);
    return false;
  }

  if (contents.includes(IDEMPOTENCE_MARKER)) {
    console.log(`[patch-deepmerge] already patched: ${filePath}`);
    return true;
  }

  const occurrences = contents.split(LOOP_ANCHOR).length - 1;
  if (occurrences !== 2) {
    console.warn(
      `[patch-deepmerge] expected exactly 2 mergeObject key loops in ${filePath}, ` +
        `found ${occurrences}; skipping (file shape differs from expected v4.3.1)`
    );
    return false;
  }

  const patched = contents.replaceAll(LOOP_ANCHOR, `${LOOP_ANCHOR} ${GUARD}`);

  // Self-verify: both loops must now carry the guard before writing.
  if (patched.split(IDEMPOTENCE_MARKER).length - 1 !== 2) {
    console.warn(`[patch-deepmerge] self-verify failed for ${filePath}; skipping`);
    return false;
  }

  try {
    fs.writeFileSync(filePath, patched, "utf8");
  } catch (err) {
    console.warn(`[patch-deepmerge] could not write ${filePath}: ${err.message}`);
    return false;
  }

  console.log(`[patch-deepmerge] patched prototype poisoning in ${filePath}`);
  return true;
}

function main() {
  if (!fs.existsSync(NODE_MODULES)) {
    console.log("[patch-deepmerge] node_modules not found; skipping");
    return;
  }
  const targets = findVulnerableEntries();
  if (targets.length === 0) {
    console.log("[patch-deepmerge] no deepmerge@4.x installs found; nothing to do");
    return;
  }
  let patchedCount = 0;
  for (const target of targets) {
    if (patchFile(target)) patchedCount += 1;
  }
  console.log(
    `[patch-deepmerge] done: ${patchedCount}/${targets.length} file(s) patched`
  );
}

main();
