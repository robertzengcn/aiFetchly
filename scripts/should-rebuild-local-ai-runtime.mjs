#!/usr/bin/env node
/**
 * Decide whether downloadable local-AI runtimes need to be rebuilt.
 *
 * Computes the current fingerprint (Electron + runtime package versions +
 * worker/packaging sources + committed version config) and compares it to
 * `runtime-fingerprint.json` on the runtime GitHub Release. Writes GitHub
 * Actions outputs when `--github-output` is set.
 *
 * Usage:
 *   node scripts/should-rebuild-local-ai-runtime.mjs \
 *     [--project-root .] [--github-output "$GITHUB_OUTPUT"] \
 *     [--write-fingerprint out/runtime-fingerprint.json] \
 *     [--published-fingerprint path] [--skip-compare]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  FINGERPRINT_ASSET_NAME,
  computeRuntimeFingerprint,
  fingerprintEquals,
  describeFingerprintDiff,
  canonicalizeFingerprint,
} from "./lib/localAiRuntime/runtimeFingerprint.mjs";

function parseArgs(argv) {
  const a = {
    projectRoot: ".",
    githubOutput: null,
    writeFingerprint: null,
    publishedFingerprint: null,
    skipCompare: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--skip-compare") {
      a.skipCompare = true;
      continue;
    }
    const value = argv[i + 1];
    switch (flag) {
      case "--project-root":
        a.projectRoot = value;
        i += 1;
        break;
      case "--github-output":
        a.githubOutput = value;
        i += 1;
        break;
      case "--write-fingerprint":
        a.writeFingerprint = value;
        i += 1;
        break;
      case "--published-fingerprint":
        a.publishedFingerprint = value;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return a;
}

function envOverride(name) {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isForceRebuild() {
  const raw = (process.env.FORCE_REBUILD ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function readPublishedFingerprintFromFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Published fingerprint is not a JSON object: ${filePath}`);
  }
  return canonicalizeFingerprint(parsed);
}

/**
 * Download `runtime-fingerprint.json` from the GitHub Release that hosts
 * the live catalog. Returns null when the release or asset does not exist.
 */
export function fetchPublishedFingerprint(releaseTag, repository, token) {
  if (!releaseTag || !repository) return null;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "aifetchly-runtime-fp-"));
  try {
    const args = [
      "release",
      "download",
      releaseTag,
      "-R",
      repository,
      "-p",
      FINGERPRINT_ASSET_NAME,
      "-D",
      tmp,
    ];
    const result = spawnSync("gh", args, {
      encoding: "utf8",
      env: token ? { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } : process.env,
    });
    if (result.status !== 0) {
      const stderr = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      if (/not found|Not Found|no assets|had no assets|could not find/i.test(stderr)) {
        return null;
      }
      throw new Error(
        `gh release download ${releaseTag} failed (exit ${String(result.status)}): ${stderr.trim()}`,
      );
    }
    const assetPath = path.join(tmp, FINGERPRINT_ASSET_NAME);
    return readPublishedFingerprintFromFile(assetPath);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function decideRebuild(current, published, forceRebuild) {
  if (forceRebuild) {
    return { rebuild: true, reason: "workflow_dispatch requested a rebuild" };
  }
  if (!published) {
    return {
      rebuild: true,
      reason: describeFingerprintDiff(current, null),
    };
  }
  if (fingerprintEquals(current, published)) {
    return { rebuild: false, reason: "fingerprint matches published runtime release" };
  }
  return { rebuild: true, reason: describeFingerprintDiff(current, published) };
}

function writeGithubOutput(filePath, values) {
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    const text = String(value);
    if (key === "reason" || /[\n\r]/.test(text)) {
      lines.push(`${key}<<EOF`, text, "EOF");
    } else {
      lines.push(`${key}=${text}`);
    }
  }
  writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function main() {
  const args = parseArgs(process.argv);
  const projectRoot = path.resolve(args.projectRoot);
  const overrides = {
    releaseTag: envOverride("OVERRIDE_RELEASE_TAG"),
    runtimeVersion: envOverride("OVERRIDE_RUNTIME_VERSION"),
    minAppVersion: envOverride("OVERRIDE_MIN_APP_VERSION"),
  };
  const current = computeRuntimeFingerprint(projectRoot, overrides);

  if (args.writeFingerprint) {
    const outPath = path.resolve(args.writeFingerprint);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(current, null, 2)}\n`);
  }

  let published = null;
  if (!args.skipCompare) {
    published = args.publishedFingerprint
      ? readPublishedFingerprintFromFile(path.resolve(args.publishedFingerprint))
      : fetchPublishedFingerprint(
          current.releaseTag,
          envOverride("GITHUB_REPOSITORY") ?? "",
          envOverride("GH_TOKEN") ?? envOverride("GITHUB_TOKEN"),
        );
  }

  const decision = args.skipCompare
    ? { rebuild: true, reason: "skip-compare writes fingerprint only" }
    : decideRebuild(current, published, isForceRebuild());

  const outputs = {
    rebuild: decision.rebuild ? "true" : "false",
    reason: decision.reason,
    release_tag: current.releaseTag,
    runtime_version: current.runtimeVersion,
    min_app_version: current.minAppVersion,
  };

  if (args.githubOutput) {
    writeGithubOutput(path.resolve(args.githubOutput), outputs);
  }

  console.log(
    `rebuild=${outputs.rebuild} tag=${outputs.release_tag} ` +
      `runtime=${outputs.runtime_version} reason=${outputs.reason}`,
  );
}

export function isDirectExecution(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  return pathToFileURL(path.resolve(argvPath)).href === metaUrl;
}

const isMain = isDirectExecution(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`should-rebuild-local-ai-runtime: ${message}`);
    process.exit(1);
  }
}
