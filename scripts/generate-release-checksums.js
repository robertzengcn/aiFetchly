#!/usr/bin/env node
/**
 * generate-release-checksums.js
 *
 * Writes GNU coreutils `sha256sum` output for every file under a directory,
 * plus an optional Markdown checksum table for GitHub Release notes.
 *
 * Usage:
 *   node scripts/generate-release-checksums.js \
 *     --root <dir> --output <SHA256SUMS.txt> \
 *     [--notes-file <notes.md>] [--preamble <text>] [--title <text>]
 *
 * Exit codes: 0 = success, 1 = missing args / no hashable files / I/O error.
 *
 * Intentionally dependency-free so it runs on CI without extra installs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

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
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

function isChecksumSidecar(fileName) {
  return (
    fileName === "SHA256SUMS.txt" ||
    /^SHA256SUMS(?:-.*)?\.txt$/i.test(fileName) ||
    /\.sha256$/i.test(fileName)
  );
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function posixFileName(filePath) {
  return path.basename(filePath).replace(/\\/g, "/");
}

function buildChecksumEntries(root, outputPath) {
  const resolvedOutput = path.resolve(outputPath);
  const files = collectFiles(root)
    .filter((filePath) => {
      if (path.resolve(filePath) === resolvedOutput) {
        return false;
      }
      return !isChecksumSidecar(path.basename(filePath));
    })
    .sort((left, right) => {
      const leftName = posixFileName(left);
      const rightName = posixFileName(right);
      if (leftName < rightName) {
        return -1;
      }
      if (leftName > rightName) {
        return 1;
      }
      return 0;
    });

  const seen = new Map();
  const entries = [];
  for (const filePath of files) {
    const fileName = posixFileName(filePath);
    if (seen.has(fileName)) {
      throw new Error(
        `Duplicate release asset basename "${fileName}" would collide in SHA256SUMS.txt`
      );
    }
    seen.set(fileName, filePath);
    entries.push({
      fileName,
      sha256: sha256File(filePath),
      size: fs.statSync(filePath).size,
    });
  }
  return entries;
}

function formatGnuChecksums(entries) {
  return entries.map((entry) => `${entry.sha256}  ${entry.fileName}`).join("\n");
}

function formatMarkdownNotes(entries, opts) {
  const lines = [];
  if (opts.title) {
    lines.push(`# ${opts.title}`, "");
  }
  if (opts.preamble) {
    lines.push(opts.preamble, "");
  }
  lines.push("## SHA-256 checksums", "");
  lines.push("| File | SHA-256 |");
  lines.push("| --- | --- |");
  for (const entry of entries) {
    lines.push(`| \`${entry.fileName}\` | \`${entry.sha256}\` |`);
  }
  lines.push("");
  lines.push(
    "Verify a download with `sha256sum -c SHA256SUMS.txt` (Linux/macOS) or `Get-FileHash -Algorithm SHA256` (Windows)."
  );
  lines.push("");
  return lines.join("\n");
}

function writeAtomic(filePath, contents) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, contents.endsWith("\n") ? contents : `${contents}\n`);
  fs.renameSync(tmpPath, filePath);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.root;
  const output = opts.output;

  if (!root || !output) {
    console.error(
      "Usage: generate-release-checksums.js --root <dir> --output <SHA256SUMS.txt> [--notes-file <notes.md>] [--preamble <text>] [--title <text>]"
    );
    process.exit(1);
  }
  if (!fs.existsSync(root)) {
    console.error(`Checksum root does not exist: ${root}`);
    process.exit(1);
  }

  let entries;
  try {
    entries = buildChecksumEntries(root, output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  if (entries.length === 0) {
    console.error(`No hashable release assets found under ${root}`);
    process.exit(1);
  }

  writeAtomic(output, formatGnuChecksums(entries));
  console.log(`Wrote ${entries.length} SHA-256 checksum(s) to ${output}`);

  if (opts["notes-file"]) {
    writeAtomic(
      opts["notes-file"],
      formatMarkdownNotes(entries, {
        title: typeof opts.title === "string" ? opts.title : "",
        preamble: typeof opts.preamble === "string" ? opts.preamble : "",
      })
    );
    console.log(`Wrote checksum release notes to ${opts["notes-file"]}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildChecksumEntries,
  formatGnuChecksums,
  formatMarkdownNotes,
  isChecksumSidecar,
};
