import type {
  PluginError,
  PluginSourceKind,
  PluginSourceProvenance,
} from "@/entityTypes/pluginTypes";
import {
  PluginImportService,
  type PluginImportResult,
} from "@/service/PluginImportService";
import { PluginSourceRegistry } from "@/service/pluginSources/PluginSourceRegistry";
import { LocalFolderPluginFetcher } from "@/service/pluginSources/LocalFolderPluginFetcher";
import { LocalZipPluginFetcher } from "@/service/pluginSources/LocalZipPluginFetcher";
import { GitPluginFetcher } from "@/service/pluginSources/GitPluginFetcher";
import { PluginHttpDownloadService } from "@/service/pluginSources/PluginHttpDownloadService";
import { GitHubArchiveClient } from "@/service/pluginSources/GitHubArchiveClient";
import { GitHubPluginFetcher } from "@/service/pluginSources/GitHubPluginFetcher";
import { NpmPluginFetcher } from "@/service/pluginSources/NpmPluginFetcher";
import { UrlPluginFetcher } from "@/service/pluginSources/UrlPluginFetcher";
import { redactMessage } from "@/service/pluginSources/pluginSourceRedact";
import type { PluginSourceRequest } from "@/service/pluginSources/pluginSourceTypes";

/**
 * Orchestrates multi-source plugin installation: resolve a fetcher by kind,
 * acquire a local directory, then delegate to the existing
 * `PluginImportService.installFromLocalRoot` pipeline. Cleanup is always
 * invoked.
 *
 * Source of truth: Spec §4.2, §7.2.
 */

export type InstallFromLocalRootFn = (
  localRoot: string,
  opts: { overwrite?: boolean; provenance?: PluginSourceProvenance }
) => Promise<PluginImportResult>;

export class PluginInstallService {
  constructor(
    private readonly registry: PluginSourceRegistry = PluginInstallService.defaultRegistry(),
    private readonly installFromLocalRoot: InstallFromLocalRootFn = (
      root,
      opts
    ) => PluginImportService.installFromLocalRoot(root, opts)
  ) {}

  static defaultRegistry(): PluginSourceRegistry {
    // Shared dependency composition (design §10.6): ONE transport + ONE
    // archive client + ONE zip fetcher, so limits, redirects, cancellation,
    // and cleanup behave identically across GitHub and URL sources.
    const http = new PluginHttpDownloadService();
    const zip = new LocalZipPluginFetcher();
    const archiveClient = new GitHubArchiveClient({ http, appVersion: "1.0.0" });
    const reg = new PluginSourceRegistry();
    reg.register(zip);
    reg.register(new LocalFolderPluginFetcher());
    reg.register(new GitPluginFetcher());
    reg.register(new GitHubPluginFetcher({ archiveClient, zip, git: new GitPluginFetcher() }));
    reg.register(new NpmPluginFetcher());
    reg.register(new UrlPluginFetcher());
    return reg;
  }

  async installFromSource(
    req: PluginSourceRequest
  ): Promise<PluginImportResult> {
    let fetcher;
    try {
      fetcher = this.registry.get(req.kind as PluginSourceKind);
    } catch (e: unknown) {
      return {
        success: false,
        errors: [
          {
            code: "unknown",
            message: e instanceof Error ? e.message : "Unknown source kind.",
            recoverable: false,
          },
        ],
      };
    }

    const acquired = await fetcher.acquire(req);
    if (!acquired.success) {
      return {
        success: false,
        errors: redactErrors(acquired.errors),
      };
    }

    const { localRoot, cleanup } = acquired.source;
    try {
      // Trusted provenance merge (design §10.3): FETCHER-generated keys
      // (canonical URI, resolved SHA, acquisition kind) win over renderer
      // request values, so a caller can never spoof resolvedCommitSha or
      // acquisition. sourceKind/source stay request-controlled (validated
      // upstream).
      const acquiredProvenance = acquired.source.provenance;
      const provenance: PluginSourceProvenance = {
        sourceKind: req.kind,
        sourceUri:
          acquiredProvenance?.sourceUri ??
          req.uri ??
          req.zipPath ??
          req.folderPath ??
          req.npmPackage,
        sourceRef: acquiredProvenance?.sourceRef ?? req.ref ?? req.npmVersion,
        source: req.source,
        sourceMeta: {
          ...(req.npmRegistry ? { registry: req.npmRegistry } : {}),
          ...(req.sourceMeta ?? {}),
          ...(acquiredProvenance?.sourceMeta ?? {}),
        },
      };
      const r = await this.installFromLocalRoot(localRoot, {
        overwrite: req.overwrite,
        provenance,
      });
      if (!r.success) {
        return { success: false, errors: redactErrors(r.errors) };
      }
      return r;
    } catch (e: unknown) {
      return {
        success: false,
        errors: [
          {
            code: "install-io-failed",
            message: redactMessage(
              e instanceof Error ? e.message : "Install failed."
            ),
            recoverable: false,
          },
        ],
      };
    } finally {
      try {
        await cleanup();
      } catch {
        /* best-effort — fetcher logs internally */
      }
    }
  }
}

function redactErrors(errors: readonly PluginError[]): readonly PluginError[] {
  return errors.map((e) => ({ ...e, message: redactMessage(e.message) }));
}
