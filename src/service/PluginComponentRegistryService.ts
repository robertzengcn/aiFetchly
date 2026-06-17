import {
  PluginLoaderService,
  type PluginLoadResult,
} from "@/service/PluginLoaderService";
import { PluginRuntimeCache } from "@/service/PluginRuntimeCache";

/**
 * Adapts loaded plugin data into the existing skill and MCP runtime systems.
 * Source of truth: Design §7.5.
 *
 * Boundaries (Design §7.5 last paragraph):
 *  - Does NOT execute skill code itself — that's SkillRegistry's job.
 *  - Does NOT spawn MCP processes directly — that's MCPClient's job.
 *  - Writes DB rows only through Modules when enablement must persist.
 *
 * The actual effective-enablement filtering (plugin.enabled && component.enabled)
 * lives in skillsRegistry.ts and MCPToolService.ts. This service is the
 * coordination point that triggers cache invalidation and ensures the loader
 * state is propagated.
 */
export class PluginComponentRegistryService {
  /**
   * Apply the current loader state: clear caches so downstream catalogs
   * re-read owned components with the latest plugin enablement.
   *
   * The skill/MCP catalog queries read owned rows from their own models,
   * then filter by the owning plugin's enabled state — so all this method
   * needs to do is invalidate the caches that would otherwise serve stale
   * catalogs.
   */
  static async applyLoadedPlugins(): Promise<void> {
    PluginRuntimeCache.clear("apply-loaded-plugins");
  }

  /**
   * Remove a plugin's capabilities from the runtime. Used by the IPC
   * uninstall/disable flow.
   */
  static async unregisterPluginCapabilities(pluginName: string): Promise<void> {
    PluginRuntimeCache.clear(`unregister-${pluginName}`);
  }

  /**
   * Force a fresh load (clears cache, then reloads). Used by the IPC reload
   * channel.
   */
  static async reload(): Promise<PluginLoadResult> {
    PluginLoaderService.clearCache();
    return PluginLoaderService.loadAllPlugins();
  }
}
