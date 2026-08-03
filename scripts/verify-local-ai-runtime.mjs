#!/usr/bin/env node
/**
 * Verify a downloadable local-AI runtime archive (PRD §20.4, design §24).
 *
 * Usage:
 *   node scripts/verify-local-ai-runtime.mjs \
 *     --archive <file.zip> --platform win32 --arch x64 \
 *     --electron-version <x.y.z> --node-module-abi <n>
 *
 * Checks: filename contract, ZIP entry safety, internal manifest schema,
 * required files present, exact target identity, every manifest dependency has
 * a node_modules package in the archive, no foreign-target native package, no
 * absolute build paths in manifest, and reports compressed/expanded sizes.
 * Exits nonzero on any violation. (On-target native load is a separate CI
 * Electron smoke step.)
 */
import { open } from "yauzl";
import { basename } from "node:path";
import {
  matchesTarget,
  looksPlatformSpecific,
} from "./lib/localAiRuntime/runtimeClosure.mjs";

const ARTIFACT_PREFIX = { "embedding-xenova": "embedding", "voice-sherpa": "voice" };

function parseArgs(argv) {
  const a = { archive: null, platform: null, arch: null, electronVersion: null, nodeModuleAbi: null };
  for (let i = 2; i < argv.length; i += 2) {
    switch (argv[i]) {
      case "--archive": a.archive = argv[i + 1]; break;
      case "--platform": a.platform = argv[i + 1]; break;
      case "--arch": a.arch = argv[i + 1]; break;
      case "--electron-version": a.electronVersion = argv[i + 1]; break;
      case "--node-module-abi": a.nodeModuleAbi = argv[i + 1]; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  for (const k of ["archive", "platform", "arch", "electronVersion", "nodeModuleAbi"]) {
    if (!a[k]) throw new Error(`Missing required argument for ${k}`);
  }
  return a;
}

function isSafeEntryName(name) {
  if (!name || name.includes("\0")) return false;
  if (name.startsWith("/") || name.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(name) || name.startsWith("\\\\")) return false;
  if (name.includes("\\")) return false;
  for (const seg of name.split("/")) {
    if (seg === "" || seg === "." || seg === "..") return false;
  }
  return true;
}

function readEntry(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error("no stream"));
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

function openZip(archive) {
  return new Promise((resolve, reject) => {
    open(archive, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error("open failed"));
      resolve(zipfile);
    });
  });
}

async function collectArchive(archive) {
  const zipfile = await openZip(archive);
  const entries = []; // { name, uncompressedSize }
  const files = new Map(); // name -> Buffer (for small text/json files we read)
  let manifestBuf = null;
  await new Promise((resolve, reject) => {
    zipfile.on("entry", async (entry) => {
      try {
        if (!isSafeEntryName(entry.fileName)) {
          throw new Error(`Unsafe archive entry: ${entry.fileName}`);
        }
        entries.push({ name: entry.fileName, uncompressedSize: entry.uncompressedSize });
        if (entry.fileName === "manifest.json") {
          manifestBuf = await readEntry(zipfile, entry);
        }
        zipfile.readEntry();
      } catch (e) {
        reject(e);
      }
    });
    zipfile.on("end", resolve);
    zipfile.on("error", reject);
    zipfile.readEntry();
  });
  return { entries, manifestBuf };
}

function isForeignPackage(name, platform, arch) {
  // A platform-specific package (carries a win/darwin/linux segment) that does
  // not match the current target is foreign.
  return looksPlatformSpecific(name) && !matchesTarget(name, platform, arch);
}

async function main() {
  const args = parseArgs(process.argv);
  const violations = [];
  const fileName = basename(args.archive);
  const prefixByRuntime = Object.fromEntries(Object.entries(ARTIFACT_PREFIX).map(([k, v]) => [v, k]));

  // 1. Filename contract: <prefix>-runtime-<platform>-<arch>-<version>.zip
  const m = fileName.match(/^(embedding|voice)-runtime-(win32|darwin)-(x64|arm64)-\d+\.\d+\.\d+\.zip$/);
  if (!m) violations.push(`Filename does not match the runtime contract: ${fileName}`);

  const { entries, manifestBuf } = await collectArchive(args.archive);
  const entryNames = new Set(entries.map((e) => e.name));

  if (!manifestBuf) {
    violations.push("manifest.json missing from archive");
  }
  let manifest = null;
  if (manifestBuf) {
    try {
      manifest = JSON.parse(manifestBuf.toString("utf-8"));
    } catch {
      violations.push("manifest.json is not valid JSON");
    }
  }

  // 3. Manifest schema (required fields + identity).
  if (manifest) {
    const expectedRuntime = prefixByRuntime[m?.[1]];
    if (expectedRuntime && manifest.runtimeId !== expectedRuntime) {
      violations.push(`manifest runtimeId (${manifest.runtimeId}) != filename (${expectedRuntime})`);
    }
    if (manifest.platform !== args.platform || manifest.arch !== args.arch) {
      violations.push(`manifest target (${manifest.platform}/${manifest.arch}) != verification target (${args.platform}/${args.arch})`);
    }
    if (manifest.electronVersion !== args.electronVersion) {
      violations.push(`manifest electronVersion (${manifest.electronVersion}) != ${args.electronVersion}`);
    }
    if (String(manifest.nodeModuleAbi) !== String(args.nodeModuleAbi)) {
      violations.push(`manifest nodeModuleAbi (${manifest.nodeModuleAbi}) != ${args.nodeModuleAbi}`);
    }
    // 4. Required files present.
    for (const rf of manifest.requiredFiles ?? []) {
      if (!entryNames.has(rf)) violations.push(`Required file missing: ${rf}`);
    }
    // 6. Every declared dependency has a node_modules package in the archive.
    for (const depName of Object.keys(manifest.dependencies ?? {})) {
      if (!entryNames.has(`node_modules/${depName}/package.json`)) {
        violations.push(`Declared dependency not in archive: ${depName}`);
      }
    }
    // 8. No absolute build paths in the manifest text.
    if (/\/home\/|\/Users\/|C:\\\\Users\\\\/.test(manifestBuf.toString("utf-8"))) {
      violations.push("Absolute build path found in manifest.json");
    }
  }

  // 7. No foreign-target native package in the archive.
  for (const name of entryNames) {
    const nm = name.match(/^node_modules\/([^/]+(?:\/[^/]+)?)\/package\.json$/);
    if (nm) {
      const pkg = nm[1];
      if (isForeignPackage(pkg, args.platform, args.arch)) {
        violations.push(`Foreign-target package in archive: ${pkg}`);
      }
    }
  }

  const expanded = entries.reduce((s, e) => s + e.uncompressedSize, 0);
  const report = [
    `Runtime verification for ${fileName}: ${violations.length === 0 ? "PASS" : "FAIL"}`,
    `  entries: ${entries.length}, expanded: ${expanded} bytes`,
    ...violations.map((v) => `  [violation] ${v}`),
  ].join("\n");
  console.log(report);
  if (violations.length > 0) process.exit(1);
}

try {
  await main();
} catch (err) {
  console.error(`verify-local-ai-runtime: ${err.message}`);
  process.exit(1);
}
