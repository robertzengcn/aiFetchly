#!/usr/bin/env node
/**
 * Generate the signed-release runtime catalog (PRD FR-1, design §14.7/§25.5).
 *
 * Usage:
 *   node scripts/generate-local-ai-runtime-catalog.mjs \
 *     --input <dir-with-*.metadata.json> --release-tag v1.0.0 \
 *     --repository <owner/repo> [--url-base <url>] [--min-app-version 1.0.0] \
 *     [--runtime-version 1.0.0] --output <local-ai-runtimes.json>
 *
 * Derives immutable download URLs (GitHub Release assets by default, or
 * --url-base for update-server mirrors), validates the six required targets
 * with no duplicates / mismatched filenames / malformed sha256, and writes the
 * catalog plus its sha256 sidecar. Exits nonzero on any inconsistency.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const REQUIRED_TARGETS = [
  "embedding-xenova|win32|x64",
  "embedding-xenova|darwin|x64",
  "embedding-xenova|darwin|arm64",
  "voice-sherpa|win32|x64",
  "voice-sherpa|darwin|x64",
  "voice-sherpa|darwin|arm64",
];

function parseArgs(argv) {
  const a = { input: null, releaseTag: null, repository: null, urlBase: null, minAppVersion: "1.0.0", runtimeVersion: null, output: null };
  for (let i = 2; i < argv.length; i += 2) {
    switch (argv[i]) {
      case "--input": a.input = argv[i + 1]; break;
      case "--release-tag": a.releaseTag = argv[i + 1]; break;
      case "--repository": a.repository = argv[i + 1]; break;
      case "--url-base": a.urlBase = argv[i + 1]; break;
      case "--min-app-version": a.minAppVersion = argv[i + 1]; break;
      case "--runtime-version": a.runtimeVersion = argv[i + 1]; break;
      case "--output": a.output = argv[i + 1]; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  for (const k of ["input", "releaseTag", "output"]) {
    if (!a[k]) throw new Error(`Missing --${k}`);
  }
  if (!a.urlBase && !a.repository) {
    throw new Error("Either --repository <owner/repo> or --url-base <url> is required to derive download URLs.");
  }
  return a;
}

function sha256of(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function deriveDownloadUrl(args, archiveFileName) {
  if (args.urlBase) {
    return `${args.urlBase.replace(/\/$/, "")}/${archiveFileName}`;
  }
  return `https://github.com/${args.repository}/releases/download/${args.releaseTag}/${archiveFileName}`;
}

function main() {
  const args = parseArgs(process.argv);
  const files = readdirSync(args.input).filter((f) => f.endsWith(".metadata.json"));
  if (files.length === 0) {
    throw new Error(`No *.metadata.json files found in ${args.input}`);
  }

  const seen = new Set();
  const present = new Set();
  const runtimes = [];

  for (const f of files) {
    const meta = JSON.parse(readFileSync(path.join(args.input, f), "utf-8"));
    if (!/^([0-9a-f]{64})$/.test(meta.sha256 ?? "")) {
      throw new Error(`Malformed sha256 in ${f}`);
    }
    const targetKey = `${meta.runtimeId}|${meta.platform}|${meta.arch}`;
    if (seen.has(targetKey)) {
      throw new Error(`Duplicate runtime target in catalog: ${targetKey} (${f})`);
    }
    seen.add(targetKey);
    present.add(targetKey);

    const prefix = meta.runtimeId === "embedding-xenova" ? "embedding" : "voice";
    const expectedName = `${prefix}-runtime-${meta.platform}-${meta.arch}-${meta.runtimeVersion}.zip`;
    if (meta.archiveFileName !== expectedName) {
      throw new Error(`Archive filename mismatch in ${f}: ${meta.archiveFileName} != ${expectedName}`);
    }

    runtimes.push({
      runtimeId: meta.runtimeId,
      runtimeVersion: meta.runtimeVersion,
      platform: meta.platform,
      arch: meta.arch,
      downloadUrl: deriveDownloadUrl(args, meta.archiveFileName),
      archiveFileName: meta.archiveFileName,
      archiveSizeBytes: meta.archiveSizeBytes,
      installedSizeBytes: meta.installedSizeBytes,
      sha256: meta.sha256,
      electronVersion: meta.electronVersion,
      nodeModuleAbi: String(meta.nodeModuleAbi),
      minAppVersion: args.minAppVersion,
      ...(meta.entryPoint ? { entryPoint: meta.entryPoint } : {}),
      ...(meta.entryModule ? { entryModule: meta.entryModule } : {}),
      requiredFiles: meta.requiredFiles,
      dependencies: meta.dependencies,
    });
  }

  // Required-target coverage gate.
  const missing = REQUIRED_TARGETS.filter((t) => !present.has(t));
  if (missing.length > 0) {
    throw new Error(`Missing required runtime targets: ${missing.join(", ")}`);
  }

  const builtAtEpoch = Number(process.env.SOURCE_DATE_EPOCH ?? 0);
  const catalog = {
    schemaVersion: 1,
    catalogVersion: args.runtimeVersion ?? args.releaseTag,
    releaseTag: args.releaseTag,
    publishedAt: new Date(builtAtEpoch * 1000).toISOString(),
    runtimes,
  };
  const catalogJson = JSON.stringify(catalog, null, 2);
  writeFileSync(args.output, catalogJson + "\n");

  const digest = sha256of(Buffer.from(catalogJson));
  writeFileSync(`${args.output}.sha256`, `${digest}  ${path.basename(args.output)}\n`);
  console.log(`Catalog written: ${args.output} (${runtimes.length} runtimes, sha256=${digest.slice(0, 12)}…)`);
}

try {
  main();
} catch (err) {
  console.error(`generate-local-ai-runtime-catalog: ${err.message}`);
  process.exit(1);
}
