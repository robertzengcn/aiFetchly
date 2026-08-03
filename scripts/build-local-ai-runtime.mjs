#!/usr/bin/env node
/**
 * Build one downloadable local-AI runtime archive (PRD §9.2/§15, design §23).
 *
 * Usage:
 *   node scripts/build-local-ai-runtime.mjs \
 *     --runtime <embedding-xenova|voice-sherpa> --runtime-version 1.0.0 \
 *     --platform win32 --arch x64 \
 *     --electron-version <x.y.z> --node-module-abi <n> \
 *     --output out/local-ai-runtimes \
 *     [--project-root .] [--worker-output <dir>] [--commit <sha>] \
 *     [--workflow-run-id <id>]
 *
 * Derives the production dependency closure from node_modules (NOT a recursive
 * copy), copies it into a clean staging root, writes manifest.json + a minimal
 * package.json (+ worker.js for embedding), and emits a deterministic ZIP plus
 * a metadata sidecar (sha256 + sizes). Exits nonzero on any error.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, copyFileSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  resolveClosure,
  copyClosure,
} from "./lib/localAiRuntime/runtimeClosure.mjs";
import { buildDeterministicZipBytes } from "./lib/localAiRuntime/deterministicZip.mjs";

const RUNTIME_ROOTS = {
  "embedding-xenova": ["@xenova/transformers", "onnxruntime-node", "onnxruntime-common", "sharp"],
  "voice-sherpa": ["sherpa-onnx-node"],
};

const SHERPA_PLATFORM_PACKAGE = {
  "win32-x64": "sherpa-onnx-win-x64",
  "darwin-x64": "sherpa-onnx-darwin-x64",
  "darwin-arm64": "sherpa-onnx-darwin-arm64",
};

const ARTIFACT_PREFIX = {
  "embedding-xenova": "embedding",
  "voice-sherpa": "voice",
};

function parseArgs(argv) {
  const a = {
    runtime: null, runtimeVersion: null, platform: null, arch: null,
    electronVersion: null, nodeModuleAbi: null, output: null,
    projectRoot: ".", workerOutput: null, commit: "", workflowRunId: "",
  };
  for (let i = 2; i < argv.length; i += 2) {
    switch (argv[i]) {
      case "--runtime": a.runtime = argv[i + 1]; break;
      case "--runtime-version": a.runtimeVersion = argv[i + 1]; break;
      case "--platform": a.platform = argv[i + 1]; break;
      case "--arch": a.arch = argv[i + 1]; break;
      case "--electron-version": a.electronVersion = argv[i + 1]; break;
      case "--node-module-abi": a.nodeModuleAbi = argv[i + 1]; break;
      case "--output": a.output = argv[i + 1]; break;
      case "--project-root": a.projectRoot = argv[i + 1]; break;
      case "--worker-output": a.workerOutput = argv[i + 1]; break;
      case "--commit": a.commit = argv[i + 1]; break;
      case "--workflow-run-id": a.workflowRunId = argv[i + 1]; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  const required = ["runtime", "runtimeVersion", "platform", "arch", "electronVersion", "nodeModuleAbi", "output"];
  for (const k of required) {
    if (!a[k]) throw new Error(`Missing --${k.replace(/([A-Z])/g, "-$1").toLowerCase()}`);
  }
  if (!RUNTIME_ROOTS[a.runtime]) {
    throw new Error(`Unknown runtime id: ${a.runtime}. Expected one of ${Object.keys(RUNTIME_ROOTS).join(", ")}.`);
  }
  return a;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function collectEntries(stagingRoot) {
  const entries = [];
  const stack = [stagingRoot];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries2;
    try {
      entries2 = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries2) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        const rel = path.relative(stagingRoot, full).split(path.sep).join("/");
        entries.push({ name: rel, data: readFileSync(full) });
      }
    }
  }
  return entries;
}

function locateEmbeddingWorker(args) {
  const candidates = [];
  if (args.workerOutput) candidates.push(path.join(args.workerOutput, "LocalEmbeddingWorker.js"));
  candidates.push(
    path.join(args.projectRoot, ".vite", "build", "childprocess", "LocalEmbeddingWorker.js"),
    path.join(args.projectRoot, "dist", "childprocess", "LocalEmbeddingWorker.js"),
  );
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "Embedding worker not found. Build it first with vite (vite.localEmbeddingWorker.config.mjs) or pass --worker-output <dir>.",
  );
}

/** Build one runtime archive. Exported for orchestration/testing. */
export function buildRuntimeArchive(args) {
  const roots = RUNTIME_ROOTS[args.runtime];
  const closure = resolveClosure(args.projectRoot, roots, { platform: args.platform, arch: args.arch });

  const isEmbedding = args.runtime === "embedding-xenova";
  const requiredRoots = [...roots];
  if (!isEmbedding) {
    const platformPkg = SHERPA_PLATFORM_PACKAGE[`${args.platform}-${args.arch}`];
    if (platformPkg) requiredRoots.push(platformPkg);
  }
  const missing = requiredRoots.filter((r) => !closure.has(r));
  if (missing.length > 0) {
    throw new Error(`Required runtime packages not resolvable from node_modules: ${missing.join(", ")}`);
  }

  const stagingRoot = path.join(args.output, ".staging", `${args.runtime}-${args.platform}-${args.arch}`);
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  copyClosure(closure, stagingRoot);

  const dependencies = {};
  for (const [name, entry] of closure) dependencies[name] = entry.version;

  const requiredFiles = ["package.json"];
  if (isEmbedding) {
    copyFileSync(locateEmbeddingWorker(args), path.join(stagingRoot, "worker.js"));
    requiredFiles.push("worker.js");
  } else {
    requiredFiles.push("node_modules/sherpa-onnx-node/package.json");
    const platformPkg = SHERPA_PLATFORM_PACKAGE[`${args.platform}-${args.arch}`];
    if (platformPkg) requiredFiles.push(`node_modules/${platformPkg}/package.json`);
  }
  for (const r of roots) requiredFiles.push(`node_modules/${r}/package.json`);

  writeFileSync(
    path.join(stagingRoot, "package.json"),
    JSON.stringify({
      name: `@aifetchly/runtime-${args.runtime}`,
      private: true,
      version: args.runtimeVersion,
      type: "commonjs",
    }, null, 2),
  );

  const builtAtEpoch = Number(process.env.SOURCE_DATE_EPOCH ?? 0);
  const manifest = {
    schemaVersion: 1,
    runtimeId: args.runtime,
    runtimeVersion: args.runtimeVersion,
    platform: args.platform,
    arch: args.arch,
    electronVersion: args.electronVersion,
    nodeModuleAbi: args.nodeModuleAbi,
    ...(isEmbedding ? { entryPoint: "worker.js" } : { entryModule: "sherpa-onnx-node" }),
    requiredFiles,
    dependencies,
    build: {
      commit: args.commit,
      workflowRunId: args.workflowRunId,
      builtAt: new Date(builtAtEpoch * 1000).toISOString(),
    },
  };
  writeFileSync(path.join(stagingRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

  const entries = collectEntries(stagingRoot);
  const zipBytes = buildDeterministicZipBytes(entries, { sourceDateEpoch: builtAtEpoch });
  const digest = sha256(zipBytes);

  const prefix = ARTIFACT_PREFIX[args.runtime];
  const archiveFileName = `${prefix}-runtime-${args.platform}-${args.arch}-${args.runtimeVersion}.zip`;
  mkdirSync(args.output, { recursive: true });
  const archivePath = path.join(args.output, archiveFileName);
  writeFileSync(archivePath, zipBytes);

  let expandedSize = 0;
  for (const e of entries) expandedSize += e.data.length;

  const metadata = {
    runtimeId: args.runtime,
    runtimeVersion: args.runtimeVersion,
    platform: args.platform,
    arch: args.arch,
    archiveFileName,
    archiveSizeBytes: zipBytes.length,
    installedSizeBytes: expandedSize,
    sha256: digest,
    electronVersion: args.electronVersion,
    nodeModuleAbi: args.nodeModuleAbi,
    entryPoint: manifest.entryPoint,
    entryModule: manifest.entryModule,
    requiredFiles,
    dependencies,
  };
  writeFileSync(path.join(args.output, `${archiveFileName}.metadata.json`), JSON.stringify(metadata, null, 2));

  rmSync(stagingRoot, { recursive: true, force: true });
  return { archivePath, archiveFileName, sha256: digest, archiveSizeBytes: zipBytes.length, installedSizeBytes: expandedSize };
}

function main() {
  const args = parseArgs(process.argv);
  const result = buildRuntimeArchive(args);
  console.log(`${result.archiveFileName}: ${result.archiveSizeBytes} bytes, sha256=${result.sha256.slice(0, 12)}…`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`build-local-ai-runtime: ${err.message}`);
    process.exit(1);
  }
}
