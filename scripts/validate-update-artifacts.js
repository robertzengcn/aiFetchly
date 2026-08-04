#!/usr/bin/env node
/**
 * validate-update-artifacts.js
 *
 * Validates that a built release output directory contains the artifacts
 * required for GitHub Releases based auto-updates, and fails closed when any
 * required artifact is missing. Run once per platform/arch after `electron-forge make`.
 *
 * Usage:
 *   node scripts/validate-update-artifacts.js \
 *     --platform <win32|darwin> --arch <x64|arm64> --root <out/make> \
 *     [--strict-signing]
 *
 * Windows (win32) required artifacts:
 *   - RELEASES            (non-empty)
 *   - *-full.nupkg        (>= 1)
 *   - *.exe               (>= 1, installer)
 *   *-delta.nupkg is optional (warned when absent).
 *
 * macOS (darwin) required artifacts:
 *   - *.zip               (>= 1, signed/notarized app ZIP — auto-update needs ZIP, not only DMG)
 *   - each ZIP must contain an .app bundle
 *   - *.dmg recommended (warned when absent)
 *   - with --strict-signing (macOS host only): codesign + spctl notarization checks.
 *
 * Exit codes: 0 = pass, 1 = one or more required artifacts missing/invalid.
 *
 * Intentionally dependency-free (fs/path + child_process only) so it runs on
 * any CI runner without resolving node_modules first.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(token);
    }
  }
  return out;
}

/** Recursively collect every file path under `root`. */
function collectFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(root);
  return files;
}

/** True if `zip` lists an entry ending in `.app/` (an app bundle). */
function zipContainsApp(zipPath) {
  // Prefer `unzip -l` (macOS/Linux). Fall back to a buffer scan for ".app/".
  try {
    const listing = execFileSync("unzip", ["-l", zipPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /\.app\//.test(listing);
  } catch {
    // unzip unavailable — scan the raw zip bytes for the ".app/" marker.
    // NOTE: this loads the whole ZIP into memory (macOS app zips can be
    // 100-300 MB). Only used when `unzip` is absent; CI runners always have it.
    try {
      const buf = fs.readFileSync(zipPath);
      return Buffer.isBuffer(buf) && buf.includes(Buffer.from(".app/"));
    } catch {
      return false;
    }
  }
}

function validateWindows(root, files) {
  const errors = [];
  const warnings = [];

  const releases = files.filter((f) => path.basename(f) === "RELEASES");
  const fullNupkgs = files.filter((f) => /-full\.nupkg$/i.test(f));
  const deltaNupkgs = files.filter((f) => /-delta\.nupkg$/i.test(f));
  const exes = files.filter((f) => /\.exe$/i.test(f) && !/uninstall/i.test(f));

  if (releases.length === 0) {
    errors.push("missing required RELEASES file");
  } else {
    for (const r of releases) {
      const stat = fs.statSync(r);
      if (stat.size === 0)
        errors.push(`RELEASES is empty: ${path.relative(root, r)}`);
    }
    if (releases.length > 1) {
      warnings.push(
        `multiple RELEASES files found (${releases.length}); expected one`
      );
    }
  }
  if (fullNupkgs.length === 0) errors.push("missing required *-full.nupkg");
  if (exes.length === 0) errors.push("missing required *.exe installer");
  if (deltaNupkgs.length === 0) {
    warnings.push(
      "no *-delta.nupkg found (optional; recommended for faster updates)"
    );
  }

  return {
    errors,
    warnings,
    summary: {
      RELEASES: releases.length,
      "full.nupkg": fullNupkgs.length,
      "delta.nupkg": deltaNupkgs.length,
      exe: exes.length,
    },
  };
}

function validateMacos(root, files, opts) {
  const errors = [];
  const warnings = [];

  const zips = files.filter((f) => /\.zip$/i.test(f));
  const dmgs = files.filter((f) => /\.dmg$/i.test(f));

  if (zips.length === 0) {
    errors.push(
      "missing required signed *.zip (macOS auto-update requires a ZIP, not only a DMG)"
    );
  }
  if (dmgs.length === 0) {
    warnings.push("no *.dmg found (optional; recommended for manual download)");
  }

  for (const zip of zips) {
    if (!zipContainsApp(zip)) {
      errors.push(
        `ZIP does not contain an .app bundle: ${path.relative(root, zip)}`
      );
    }
  }

  if (opts["strict-signing"]) {
    if (process.platform !== "darwin") {
      warnings.push(
        "--strict-signing requested but host is not macOS; skipping codesign/spctl checks"
      );
    } else {
      for (const zip of zips) {
        verifyMacosSignature(root, zip, errors, warnings);
      }
    }
  }

  return {
    errors,
    warnings,
    summary: { zip: zips.length, dmg: dmgs.length },
  };
}

/** Extract `zip` to a temp dir and run codesign + spctl on the .app bundle. */
function verifyMacosSignature(root, zip, errors, warnings) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-verify-"));
  try {
    execFileSync("unzip", ["-o", "-q", zip, "-d", tmp], { stdio: "ignore" });
    const appBundle = findAppBundle(tmp);
    if (!appBundle) {
      warnings.push(
        `could not locate .app bundle inside ${path.relative(
          root,
          zip
        )}; skipping codesign`
      );
      return;
    }
    try {
      execFileSync("codesign", ["--verify", "--deep", "--strict", appBundle], {
        stdio: "pipe",
      });
    } catch (err) {
      errors.push(
        `codesign verification failed for ${path.relative(root, zip)}: ${
          err.message
        }`
      );
      return;
    }
    try {
      execFileSync("spctl", ["-a", "-vv", "-t", "open", appBundle], {
        stdio: "pipe",
      });
    } catch (err) {
      errors.push(
        `notarization check (spctl) failed for ${path.relative(root, zip)}: ${
          err.message
        }`
      );
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

function findAppBundle(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      return path.join(dir, entry.name);
    }
  }
  // .app may be nested one level (common with maker-zip output).
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = findAppBundle(path.join(dir, entry.name));
      if (nested) return nested;
    }
  }
  return null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const platform = opts.platform;
  const arch = opts.arch || "x64";
  const root = opts.root;

  if (!platform || !root) {
    console.error(
      "Usage: validate-update-artifacts.js --platform <win32|darwin> --arch <x64|arm64> --root <dir> [--strict-signing]"
    );
    process.exit(1);
  }
  if (!fs.existsSync(root)) {
    console.error(`Validation root does not exist: ${root}`);
    process.exit(1);
  }

  const files = collectFiles(root);
  console.log(
    `Validating ${platform}/${arch} artifacts under ${root} (${files.length} files)`
  );

  const result =
    platform === "win32"
      ? validateWindows(root, files)
      : platform === "darwin"
      ? validateMacos(root, files, opts)
      : {
          errors: [`unsupported platform: ${platform}`],
          warnings: [],
          summary: {},
        };

  console.log("Artifact summary:", JSON.stringify(result.summary, null, 2));
  for (const w of result.warnings) console.warn(`WARN: ${w}`);
  for (const e of result.errors) console.error(`FAIL: ${e}`);

  if (result.errors.length > 0) {
    console.error(
      `\n${result.errors.length} required-artifact error(s) for ${platform}/${arch}.`
    );
    process.exit(1);
  }
  console.log(`\nOK: ${platform}/${arch} release artifacts validated.`);
  process.exit(0);
}

main();
