import * as fs from "fs";
import * as path from "path";
import { getPluginsRoot } from "@/service/pluginPaths";
import { applyDirectoryLimits } from "./pluginSourceLimits";
import {
  err,
  type PluginAcquireResult,
  type PluginSourceFetcher,
  type PluginSourceRequest,
} from "./pluginSourceTypes";

/**
 * Acquires a plugin from a user-selected local directory.
 *
 * The user's source folder is never mutated or moved: we copy it into the
 * plugins cache via the downstream `PluginImportService.installFromLocalRoot`.
 * This fetcher only validates the source folder and returns it.
 *
 * Source of truth: Spec §5.2, §9 (security item 8).
 */
export class LocalFolderPluginFetcher implements PluginSourceFetcher {
  readonly kind = "local-folder" as const;

  async acquire(req: PluginSourceRequest): Promise<PluginAcquireResult> {
    const folderPath = req.folderPath;
    if (
      !folderPath ||
      !fs.existsSync(folderPath) ||
      !fs.statSync(folderPath).isDirectory()
    ) {
      return {
        success: false,
        errors: [
          err(
            "component-not-found",
            `Folder not found or not a directory: ${folderPath ?? "(none)"}`
          ),
        ],
      };
    }

    const resolvedRoot = path.resolve(folderPath);
    const pluginsRoot = path.resolve(getPluginsRoot());
    if (
      resolvedRoot === pluginsRoot ||
      resolvedRoot.startsWith(pluginsRoot + path.sep)
    ) {
      return {
        success: false,
        errors: [
          err(
            "path-outside-plugin",
            "Source folder must not live inside the plugins cache."
          ),
        ],
      };
    }

    const limits = applyDirectoryLimits(resolvedRoot);
    if (!limits.ok) {
      const msg =
        limits.reason === "too-many-files"
          ? `Source folder has too many files (${limits.fileCount}).`
          : `Source folder is too large (${limits.totalBytes.toString()} bytes).`;
      return {
        success: false,
        errors: [err("install-io-failed", msg)],
      };
    }

    return {
      success: true,
      source: {
        localRoot: resolvedRoot,
        // No-op: the caller's source folder is user-owned.
        cleanup: async () => {
          /* user-owned source — do not delete */
        },
      },
    };
  }
}
