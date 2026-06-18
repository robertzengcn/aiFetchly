import * as fs from "fs";
import * as path from "path";
import { PLUGIN_PACKAGE_LIMITS } from "@/entityTypes/pluginTypes";

/**
 * Filesystem size/file-count limits applied to every fetched plugin source
 * before validation, regardless of how the source was acquired.
 * Source of truth: Spec §9 (security requirements, item 5).
 */

export interface DirectoryLimits {
  readonly maxFiles: number;
  readonly maxExtractedBytes: bigint;
}

export type DirectoryLimitsResult =
  | { ok: true; fileCount: number; totalBytes: bigint }
  | {
      ok: false;
      reason: "too-many-files" | "too-large";
      fileCount: number;
      totalBytes: bigint;
    };

export function applyDirectoryLimits(
  root: string,
  limits: DirectoryLimits = {
    maxFiles: PLUGIN_PACKAGE_LIMITS.maxFiles,
    maxExtractedBytes: BigInt(PLUGIN_PACKAGE_LIMITS.maxExtractedBytes),
  }
): DirectoryLimitsResult {
  let fileCount = 0;
  let totalBytes = 0n;

  const walk = (dir: string): DirectoryLimitsResult | null => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const r = walk(full);
        if (r) return r;
      } else if (entry.isFile()) {
        fileCount++;
        if (fileCount > limits.maxFiles) {
          return {
            ok: false,
            reason: "too-many-files",
            fileCount,
            totalBytes,
          };
        }
        const stat = fs.statSync(full);
        totalBytes += BigInt(stat.size);
        if (totalBytes > limits.maxExtractedBytes) {
          return { ok: false, reason: "too-large", fileCount, totalBytes };
        }
      }
    }
    return null;
  };

  const failure = walk(root);
  return failure ?? { ok: true, fileCount, totalBytes };
}
