/**
 * Fingerprint of the inputs that change downloadable local-AI runtime ZIPs.
 *
 * CI compares this document to the last published `runtime-fingerprint.json`
 * on the runtime GitHub Release. A mismatch is the only automatic reason to
 * rebuild the four-OS matrix. See docs/ci/local-ai-runtime-release.md.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  RUNTIME_ROOTS,
  SHERPA_PLATFORM_PACKAGE,
} from "../../build-local-ai-runtime.mjs";

export const FINGERPRINT_SCHEMA_VERSION = 1;
export const FINGERPRINT_ASSET_NAME = "runtime-fingerprint.json";
export const RELEASE_CONFIG_RELATIVE_PATH = "src/config/localAiRuntimeRelease.json";

/** Files and directories whose contents are hashed into sourcesSha256. */
export const FINGERPRINT_SOURCE_PATHS = [
  "src/childprocess/embedding",
  "src/childprocess/local-ai-runtime",
  "src/schemas/worker/localEmbedding.ts",
  "src/schemas/worker/runtimeProbe.ts",
  "src/service/embedding/LocalEmbeddingModels.ts",
  RELEASE_CONFIG_RELATIVE_PATH,
  "vite.localEmbeddingWorker.config.mjs",
  "vite.workerSsrNoExternal.mjs",
  "scripts/build-local-ai-runtime.mjs",
  "scripts/verify-local-ai-runtime.mjs",
  "scripts/generate-local-ai-runtime-catalog.mjs",
  "scripts/lib/localAiRuntime",
  ".github/workflows/local-ai-runtime-release.yml",
];

export const RELEASE_CONFIG_SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Lockfile packages whose resolved version must trigger a runtime rebuild.
 * `electron` is included because NODE_MODULE_ABI follows the Electron series.
 */
export function listFingerprintPackages() {
  const names = new Set(["electron"]);
  for (const roots of Object.values(RUNTIME_ROOTS)) {
    for (const name of roots) names.add(name);
  }
  for (const name of Object.values(SHERPA_PLATFORM_PACKAGE)) {
    names.add(name);
  }
  return [...names].sort();
}

export function loadReleaseConfig(projectRoot, overrides = {}) {
  const configPath = path.join(projectRoot, RELEASE_CONFIG_RELATIVE_PATH);
  if (!existsSync(configPath)) {
    throw new Error(`Missing runtime release config: ${configPath}`);
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Runtime release config must be a JSON object: ${configPath}`);
  }
  const record = parsed;
  const releaseTag = nonEmptyString(
    overrides.releaseTag ?? record.releaseTag,
    "releaseTag",
  );
  const runtimeVersion = dottedTriple(
    overrides.runtimeVersion ?? record.runtimeVersion,
    "runtimeVersion",
  );
  const minAppVersion = dottedTriple(
    overrides.minAppVersion ?? record.minAppVersion,
    "minAppVersion",
  );
  return { releaseTag, runtimeVersion, minAppVersion };
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Runtime release config ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function dottedTriple(value, field) {
  const text = nonEmptyString(value, field);
  if (!RELEASE_CONFIG_SEMVER.test(text)) {
    throw new Error(`Runtime release config ${field} must be a dotted-triple version.`);
  }
  return text;
}

/**
 * Resolve the installed version of `packageName` from a Yarn v1 lockfile.
 * Matches `name@...` keys (quoted or unquoted, including comma-joined stanzas)
 * and reads the following `version "x.y.z"` field.
 */
export function resolveYarnLockVersion(lockText, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRe = new RegExp(
    `(?:^|,\\s*)"?${escaped}@(?:[^:\\n]*?)"?\\s*(?:,|:)`,
    "m",
  );
  const match = keyRe.exec(lockText);
  if (!match) return null;
  const rest = lockText.slice(match.index);
  const versionMatch = rest.match(/\n  version "([^"]+)"/);
  return versionMatch ? versionMatch[1] : null;
}

export function collectSourceFiles(projectRoot, sourcePaths = FINGERPRINT_SOURCE_PATHS) {
  const files = [];
  for (const relative of sourcePaths) {
    const absolute = path.join(projectRoot, relative);
    if (!existsSync(absolute)) {
      throw new Error(`Fingerprint source path is missing: ${relative}`);
    }
    walkFiles(absolute, projectRoot, files);
  }
  files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  return files;
}

function walkFiles(absolute, projectRoot, files) {
  const stats = statSync(absolute);
  if (stats.isFile()) {
    if (path.basename(absolute) === ".DS_Store") return;
    files.push({
      relative: path.relative(projectRoot, absolute).split(path.sep).join("/"),
      absolute,
    });
    return;
  }
  if (!stats.isDirectory()) return;
  const entries = readdirSync(absolute, { withFileTypes: true });
  for (const entry of entries) {
    walkFiles(path.join(absolute, entry.name), projectRoot, files);
  }
}

export function hashSourceFiles(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relative);
    hash.update("\0");
    hash.update(readFileSync(file.absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function computeRuntimeFingerprint(projectRoot, overrides = {}) {
  const config = loadReleaseConfig(projectRoot, overrides);
  const lockPath = path.join(projectRoot, "yarn.lock");
  if (!existsSync(lockPath)) {
    throw new Error(`Missing yarn.lock at ${lockPath}`);
  }
  const lockText = readFileSync(lockPath, "utf8");
  const packages = {};
  for (const name of listFingerprintPackages()) {
    const version = resolveYarnLockVersion(lockText, packageNameOrThrow(name));
    if (!version) {
      throw new Error(
        `Fingerprint package ${name} is not present in yarn.lock. ` +
          "A lockfile that omits a runtime native package cannot produce a trustworthy rebuild signal.",
      );
    }
    packages[name] = version;
  }
  const sourcesSha256 = hashSourceFiles(collectSourceFiles(projectRoot));
  return canonicalizeFingerprint({
    schemaVersion: FINGERPRINT_SCHEMA_VERSION,
    electron: packages.electron,
    packages,
    sourcesSha256,
    runtimeVersion: config.runtimeVersion,
    minAppVersion: config.minAppVersion,
    releaseTag: config.releaseTag,
  });
}

function packageNameOrThrow(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Fingerprint package names must be non-empty strings.");
  }
  return name;
}

export function canonicalizeFingerprint(value) {
  return JSON.parse(JSON.stringify(sortKeysDeep(value)));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

export function fingerprintEquals(a, b) {
  return JSON.stringify(canonicalizeFingerprint(a)) === JSON.stringify(canonicalizeFingerprint(b));
}

export function describeFingerprintDiff(current, published) {
  if (!published) {
    return "no published runtime-fingerprint.json on the runtime release tag";
  }
  const reasons = [];
  if (current.electron !== published.electron) {
    reasons.push(`electron ${published.electron} -> ${current.electron}`);
  }
  const currentPackages = current.packages ?? {};
  const publishedPackages = published.packages ?? {};
  const names = new Set([
    ...Object.keys(currentPackages),
    ...Object.keys(publishedPackages),
  ]);
  for (const name of [...names].sort()) {
    if (name === "electron") continue;
    const before = publishedPackages[name];
    const after = currentPackages[name];
    if (before !== after) {
      reasons.push(`${name} ${before ?? "missing"} -> ${after ?? "missing"}`);
    }
  }
  if (current.sourcesSha256 !== published.sourcesSha256) {
    reasons.push("worker/packaging source hash changed");
  }
  if (current.runtimeVersion !== published.runtimeVersion) {
    reasons.push(`runtimeVersion ${published.runtimeVersion} -> ${current.runtimeVersion}`);
  }
  if (current.minAppVersion !== published.minAppVersion) {
    reasons.push(`minAppVersion ${published.minAppVersion} -> ${current.minAppVersion}`);
  }
  if (current.releaseTag !== published.releaseTag) {
    reasons.push(`releaseTag ${published.releaseTag} -> ${current.releaseTag}`);
  }
  if (reasons.length === 0) {
    return "fingerprint mismatch (unlisted field)";
  }
  return reasons.join("; ");
}
