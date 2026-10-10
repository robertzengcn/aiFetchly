/**
 * stagePackage — bounded copy + tree hash for skill acquisition staging.
 *
 * Worker-safe pure module: node stdlib only (fs/path/crypto). Shared by the
 * utility-process entry (SkillInstallationWorker.ts) and the main-process
 * inline fallback (SkillSourceAcquisitionService), so both paths enforce
 * IDENTICAL limits and produce identical content hashes.
 *
 * Limits (PRD §12.4 / design §9.2): file count, total bytes, traversal
 * depth. .git directories and ownership metadata are never staged; devices,
 * FIFOs, and sockets are ignored (§11.2).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface StageLimits {
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxDepth: number;
}

export interface StageResult {
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly contentHash: string;
}

export class StageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageLimitError";
  }
}

const DEFAULT_STAGE_LIMITS: StageLimits = {
  maxFiles: 5_000,
  maxTotalBytes: 250 * 1024 * 1024,
  maxDepth: 20,
};

export const SKILL_STAGE_LIMITS = DEFAULT_STAGE_LIMITS;

/** Files never staged regardless of source. */
const EXCLUDED_NAMES = new Set([".git", ".aifetchly-install.json"]);

/**
 * Copy `from` → `to` under the limits, then hash the staged tree.
 * Throws StageLimitError when a limit is exceeded (the caller decides
 * cleanup; nothing partial is trusted).
 */
export function stagePackage(
  from: string,
  to: string,
  limits: StageLimits = DEFAULT_STAGE_LIMITS
): StageResult {
  let files = 0;
  let bytes = 0;

  const walk = (src: string, dest: string, depth: number): void => {
    if (depth > limits.maxDepth) {
      throw new StageLimitError(
        `Repository traversal exceeds depth ${limits.maxDepth}.`
      );
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of entries) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      // lstat — NEVER follow repository-controlled symlinks (review S4):
      // a link whose target escapes the checkout must not materialize
      // out-of-tree content into app staging.
      const stat = fs.lstatSync(srcPath);
      if (stat.isSymbolicLink()) {
        continue; // links are documented, never staged
      }
      if (stat.isDirectory()) {
        walk(srcPath, destPath, depth + 1);
        continue;
      }
      if (!stat.isFile()) {
        continue; // devices, FIFOs, sockets ignored
      }
      files += 1;
      bytes += stat.size;
      if (files > limits.maxFiles) {
        throw new StageLimitError(
          `Acquired package exceeds the ${limits.maxFiles}-file limit.`
        );
      }
      if (bytes > limits.maxTotalBytes) {
        throw new StageLimitError(
          `Acquired package exceeds the ${Math.floor(
            limits.maxTotalBytes / 1024 / 1024
          )} MiB content limit.`
        );
      }
      fs.copyFileSync(srcPath, destPath);
    }
  };

  walk(from, to, 0);

  return {
    fileCount: files,
    totalBytes: bytes,
    contentHash: hashTree(to),
  };
}

/** Deterministic content hash over the sorted staged tree. */
export function hashTree(root: string): string {
  const hash = crypto.createHash("sha256");
  const walk = (dir: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        hash.update(entry.name + "/");
        walk(p);
      } else if (entry.isFile()) {
        hash.update(entry.name);
        hash.update(fs.readFileSync(p));
      }
    }
  };
  walk(root);
  return hash.digest("hex");
}

// (contentHash.ts's sha256Hex covers single-value hashes; hashTree is the
// one legitimate streaming-hash owner — converted files import sha256Hex.)
