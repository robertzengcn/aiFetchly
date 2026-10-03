"use strict";
/**
 * Patches node_modules/extract-zip/index.js (v2.0.1) to close the
 * symlink-final-path traversal (CVE-2026-19693 / GHSA-7pqw-9j4j-h8q3,
 * GitHub Dependabot alert #251 — high, open, no upstream fix released).
 *
 * Why this exists:
 *   `extract-zip@2.0.1` is the latest version on npm; the advisory has
 *   `fixed_version: null` and upstream fix PR #160 has not been released.
 *   `yarn upgrade` therefore cannot resolve this — the installed code
 *   itself must be hardened. `extract-zip` is a transitive build/dev-only
 *   dependency, pulled by `@puppeteer/browsers` (Chromium download) and
 *   `@electron/packager` (packaging); it never runs against untrusted
 *   archives at runtime. This patch is defense-in-depth.
 *
 * The flaw:
 *   The containment check validates only each entry's PARENT directory
 *   (it realpath's `path.dirname(dest)` and rejects `..`). It never
 *   resolves the entry's own final path component. A crafted archive with
 *   two same-named entries — first a symlink pointing outside the target,
 *   then a regular file — causes the file write to follow the planted
 *   symlink and land outside the destination directory (arbitrary file
 *   write).
 *
 * The fix (verbatim from upstream PR #160):
 *   Before writing a regular file, lstat the destination; if it is
 *   already a symlink, abort with "Out of bound path" so a planted
 *   symlink at the entry's final path component can never be followed.
 *
 * Idempotent: if the fix is already present, the file is left untouched.
 * Walks the whole node_modules tree so nested copies (e.g. inside
 * `puppeteer-mass-screenshots/tests`) are patched too.
 *
 * Invoked from the `postinstall` hook so the patch is always present
 * before any build/package run.
 */

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(PROJECT_ROOT, "node_modules");

// The exact vulnerable line (anchored so the patch no-ops if the upstream
// file ever changes shape, rather than silently corrupting it).
const VULNERABLE =
  "    } else {\n" +
  "      await pipeline(readStream, createWriteStream(dest, { mode: procMode }))\n" +
  "    }\n";

// The hardened replacement (upstream PR #160, verbatim): lstat the
// destination before writing; refuse to write through a planted symlink.
const PATCHED =
  "    } else {\n" +
  "      const existing = await fs.lstat(dest).catch(() => null)\n" +
  '      if (existing && existing.isSymbolicLink()) {\n' +
  '        throw new Error(`Out of bound path "${dest}" found while processing file ${entry.fileName}`)\n' +
  "      }\n" +
  "      await pipeline(readStream, createWriteStream(dest, { mode: procMode }))\n" +
  "    }\n";

/**
 * Locate every extract-zip index.js whose package version is exactly
 * "2.0.1". (v1.x is a different implementation not flagged by the
 * advisory; @electron-internal/extract-zip@1.0.5 is also unaffected.)
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
        // Candidate: <pkg-root>/extract-zip/index.js
        if (ent.name === "extract-zip") {
          const indexJs = path.join(full, "index.js");
          const pkgJson = path.join(full, "package.json");
          if (fs.existsSync(indexJs) && fs.existsSync(pkgJson)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
              if (pkg.version === "2.0.1") {
                results.push(indexJs);
              }
            } catch {
              // unreadable package.json — skip
            }
          }
        }
        walk(full); // recurse (catches nested copies)
      }
    }
  }
  walk(NODE_MODULES);
  return results;
}

function patchFile(indexJsPath) {
  let contents;
  try {
    contents = fs.readFileSync(indexJsPath, "utf8");
  } catch (err) {
    console.warn(`[patch-extract-zip] could not read ${indexJsPath}: ${err.message}`);
    return false;
  }

  if (contents.includes("existing.isSymbolicLink()")) {
    console.log(`[patch-extract-zip] already patched: ${indexJsPath}`);
    return true;
  }

  if (!contents.includes(VULNERABLE)) {
    console.warn(
      `[patch-extract-zip] vulnerable anchor not found in ${indexJsPath}; ` +
        "skipping (file shape differs from expected v2.0.1)"
    );
    return false;
  }

  const patched = contents.replace(VULNERABLE, PATCHED);

  // Self-verify: confirm the fix actually landed before writing.
  if (!patched.includes("existing.isSymbolicLink()")) {
    console.warn(`[patch-extract-zip] self-verify failed for ${indexJsPath}; skipping`);
    return false;
  }

  try {
    fs.writeFileSync(indexJsPath, patched, "utf8");
  } catch (err) {
    console.warn(`[patch-extract-zip] could not write ${indexJsPath}: ${err.message}`);
    return false;
  }

  console.log(`[patch-extract-zip] patched CVE-2026-19693 in ${indexJsPath}`);
  return true;
}

function main() {
  if (!fs.existsSync(NODE_MODULES)) {
    console.log("[patch-extract-zip] node_modules not found; skipping");
    return;
  }
  const targets = findVulnerableEntries();
  if (targets.length === 0) {
    console.log("[patch-extract-zip] no vulnerable extract-zip@2.0.1 copies found");
    return;
  }
  let ok = 0;
  for (const target of targets) {
    if (patchFile(target)) ok += 1;
  }
  console.log(`[patch-extract-zip] done: ${ok}/${targets.length} file(s) patched`);
  if (ok !== targets.length) {
    // Warn loudly but do not throw — a failed patch should not abort an
    // install/build the way an unhandled exception would. CI surfaces the
    // line above; the Dependabot alert stays open until all copies patch.
    console.warn("[patch-extract-zip] WARNING: some copies were not patched");
  }
}

main();
