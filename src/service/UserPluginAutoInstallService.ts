import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import {
  PluginImportService,
  type PluginImportResult,
} from "@/service/PluginImportService";
import {
  PluginManifestService,
  resolvePluginRoot,
} from "@/service/PluginManifestService";
import { AIFETCHLY_CONFIG_DIR_NAME } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import type {
  PluginError,
  PluginSourceProvenance,
} from "@/entityTypes/pluginTypes";

export interface UserPluginSyncSummary {
  readonly scanned: number;
  readonly installed: number;
  readonly skipped: number;
  readonly errors: readonly PluginError[];
}

interface InstalledPluginLookup {
  getPluginByName(name: string): Promise<{ readonly name: string } | null>;
}

type InstallFromLocalRootFn = (
  localRoot: string,
  opts: { overwrite?: boolean; provenance?: PluginSourceProvenance }
) => Promise<PluginImportResult>;

let inFlightSync: Promise<UserPluginSyncSummary> | null = null;

/**
 * Synchronizes manifest-bearing folders dropped into ~/.aifetchly/plugins into
 * the normal installed-plugin store. Options-only folders are ignored.
 */
export class UserPluginAutoInstallService {
  constructor(
    private readonly pluginLookup: InstalledPluginLookup = new PluginManagementModule(),
    private readonly installFromLocalRoot: InstallFromLocalRootFn = (
      localRoot,
      opts
    ) => PluginImportService.installFromLocalRoot(localRoot, opts)
  ) {}

  static getDefaultUserPluginsRoot(): string {
    return path.join(os.homedir(), AIFETCHLY_CONFIG_DIR_NAME, "plugins");
  }

  static async syncDefaultUserPlugins(): Promise<UserPluginSyncSummary> {
    if (inFlightSync) {
      return inFlightSync;
    }
    inFlightSync = new UserPluginAutoInstallService()
      .syncFromUserPluginsRoot()
      .finally(() => {
        inFlightSync = null;
      });
    return inFlightSync;
  }

  async syncFromUserPluginsRoot(
    pluginsRoot = UserPluginAutoInstallService.getDefaultUserPluginsRoot()
  ): Promise<UserPluginSyncSummary> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(pluginsRoot, {
        withFileTypes: true,
      });
    } catch (e: unknown) {
      if (isNoEntryError(e)) {
        return { scanned: 0, installed: 0, skipped: 0, errors: [] };
      }
      return {
        scanned: 0,
        installed: 0,
        skipped: 0,
        errors: [
          {
            code: "install-io-failed",
            path: pluginsRoot,
            message:
              e instanceof Error
                ? `Failed to read user plugin directory: ${e.message}`
                : "Failed to read user plugin directory",
            recoverable: true,
          },
        ],
      };
    }

    let scanned = 0;
    let installed = 0;
    let skipped = 0;
    const errors: PluginError[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      scanned += 1;
      const candidateRoot = path.join(pluginsRoot, entry.name);
      const pluginRoot = resolvePluginRoot(candidateRoot);
      const manifestResult = await PluginManifestService.loadFromDirectory(
        pluginRoot
      );

      if (!manifestResult.success) {
        if (manifestResult.errors.every((e) => e.code === "manifest-not-found")) {
          skipped += 1;
          continue;
        }
        errors.push(...manifestResult.errors);
        continue;
      }

      const existing = await this.pluginLookup.getPluginByName(
        manifestResult.manifest.name
      );
      if (existing) {
        skipped += 1;
        continue;
      }

      const result = await this.installFromLocalRoot(pluginRoot, {
        overwrite: false,
        provenance: {
          source: "local",
          sourceKind: "local-folder",
          sourceUri: candidateRoot,
          sourceMeta: {
            autoInstalledFrom: "user-plugins",
          },
        },
      });

      if (result.success) {
        installed += 1;
      } else {
        errors.push(...result.errors);
      }
    }

    return { scanned, installed, skipped, errors };
  }
}

function isNoEntryError(e: unknown): boolean {
  return (
    e instanceof Error &&
    "code" in e &&
    (e as NodeJS.ErrnoException).code === "ENOENT"
  );
}
