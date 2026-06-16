import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import {
  PLUGIN_PACKAGE_LIMITS,
  type PluginError,
} from "@/entityTypes/pluginTypes";

/**
 * Safely extracts plugin zip packages to a temp directory.
 * Source of truth: Design §7.2, §15.1.
 *
 * Security requirements enforced:
 *  - Reject absolute paths, ".." traversal, symlinks, device files.
 *  - Enforce max zip bytes, max extracted bytes, max file count.
 *  - Never extract over an existing install path (caller's job, but we
 *    always extract to a fresh temp dir).
 */

export interface ExtractedPluginArchive {
  readonly tempRoot: string;
  readonly cleanup: () => Promise<void>;
}

export interface PluginArchiveSuccess {
  readonly success: true;
  readonly tempRoot: string;
  readonly cleanup: () => Promise<void>;
}

export interface PluginArchiveFailure {
  readonly success: false;
  readonly errors: readonly PluginError[];
}

export type PluginArchiveResult = PluginArchiveSuccess | PluginArchiveFailure;

function effectiveLimits() {
  return {
    maxZipBytes: PLUGIN_PACKAGE_LIMITS.maxZipBytes,
    maxExtractedBytes: PLUGIN_PACKAGE_LIMITS.maxExtractedBytes,
    maxFiles:
      process.env.PLUGIN_TEST_MAX_FILES !== undefined
        ? parseInt(process.env.PLUGIN_TEST_MAX_FILES, 10)
        : PLUGIN_PACKAGE_LIMITS.maxFiles,
    maxZipBytesOverride:
      process.env.PLUGIN_TEST_MAX_BYTES !== undefined
        ? parseInt(process.env.PLUGIN_TEST_MAX_BYTES, 10)
        : null,
  };
}

const DEVICE_FILE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * Exported for direct unit testing. Returns true when a zip entry name
 * would escape or compromise the extraction target (absolute path,
 * traversal, Windows device file).
 */
export function isUnsafeEntryName(name: string): boolean {
  if (!name) return true;
  if (path.isAbsolute(name)) return true;
  const normalized = path.normalize(name).replace(/\\/g, "/");
  if (
    normalized.startsWith("..") ||
    normalized.includes("/../") ||
    normalized === ".."
  ) {
    return true;
  }
  if (DEVICE_FILE_RE.test(path.basename(normalized))) return true;
  return false;
}

export class PluginArchiveService {
  /**
   * Extract a zip to a fresh temp directory. Returns a discriminated union;
   * never throws for expected validation failures.
   */
  static async extractZip(zipPath: string): Promise<PluginArchiveResult> {
    const limits = effectiveLimits();

    if (!fs.existsSync(zipPath)) {
      return failure([
        {
          code: "install-io-failed",
          path: zipPath,
          message: `Zip file not found: ${zipPath}`,
          recoverable: false,
        },
      ]);
    }

    const stat = fs.statSync(zipPath);
    const zipByteLimit = limits.maxZipBytesOverride ?? limits.maxZipBytes;
    if (stat.size > zipByteLimit) {
      return failure([
        {
          code: "install-io-failed",
          path: zipPath,
          message: `Zip file size (${stat.size} bytes) exceeds limit (${zipByteLimit} bytes).`,
          recoverable: false,
        },
      ]);
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(zipPath);
    } catch (e: unknown) {
      return failure([
        {
          code: "install-io-failed",
          path: zipPath,
          message:
            e instanceof Error
              ? `Invalid or corrupted zip: ${e.message}`
              : "Invalid or corrupted zip",
          recoverable: false,
        },
      ]);
    }

    const entries = zip.getEntries();
    if (entries.length > limits.maxFiles) {
      return failure([
        {
          code: "install-io-failed",
          message: `Zip contains too many entries (${entries.length}, max ${limits.maxFiles}).`,
          recoverable: false,
        },
      ]);
    }

    let totalUncompressed = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      // Symlink detection: adm-zip exposes unix permissions via header.attr
      // (high 16 bits of the external attributes hold the mode).
      const attr = (entry as unknown as { header?: { attr?: number } }).header;
      const mode = attr?.attr ? (attr.attr >> 16) & 0xfff : 0;
      const isSymlink = (mode & 0o170000) === 0o120000;
      if (isSymlink) {
        return failure([
          {
            code: "path-outside-plugin",
            path: entry.entryName,
            message: `Symlink entries are not allowed ("${entry.entryName}").`,
            recoverable: false,
          },
        ]);
      }
      totalUncompressed += entry.header.size;
      if (totalUncompressed > limits.maxExtractedBytes) {
        return failure([
          {
            code: "install-io-failed",
            message: `Zip uncompressed size exceeds limit (${limits.maxExtractedBytes} bytes).`,
            recoverable: false,
          },
        ]);
      }
      if (isUnsafeEntryName(entry.entryName)) {
        return failure([
          {
            code: "path-outside-plugin",
            path: entry.entryName,
            message: `Unsafe zip entry name: "${entry.entryName}".`,
            recoverable: false,
          },
        ]);
      }
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-extract-"));
    try {
      zip.extractAllTo(tempRoot, true);
    } catch (e: unknown) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return failure([
        {
          code: "install-io-failed",
          message:
            e instanceof Error
              ? `Failed to extract zip: ${e.message}`
              : "Failed to extract zip",
          recoverable: false,
        },
      ]);
    }

    const cleanup = async (): Promise<void> => {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // idempotent — ignore
      }
    };

    return { success: true, tempRoot, cleanup };
  }
}

function failure(errors: PluginError[]): PluginArchiveFailure {
  return { success: false, errors };
}
