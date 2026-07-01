import { PluginArchiveService } from "@/service/PluginArchiveService";
import {
  err,
  type PluginAcquireResult,
  type PluginSourceFetcher,
  type PluginSourceRequest,
} from "./pluginSourceTypes";

/**
 * Wraps the existing zip extraction pipeline so the multi-source install
 * orchestrator can treat local zips uniformly with other sources.
 *
 * Source of truth: Spec §5.1.
 */
export class LocalZipPluginFetcher implements PluginSourceFetcher {
  readonly kind = "local-zip" as const;

  async acquire(req: PluginSourceRequest): Promise<PluginAcquireResult> {
    if (!req.zipPath) {
      return {
        success: false,
        errors: [
          err(
            "install-io-failed",
            "zipPath is required for the local-zip source."
          ),
        ],
      };
    }
    const r = await PluginArchiveService.extractZip(req.zipPath);
    if (!r.success) {
      return r;
    }
    return {
      success: true,
      source: { localRoot: r.tempRoot, cleanup: r.cleanup },
    };
  }
}
