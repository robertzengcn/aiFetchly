/**
 * Central cache invalidation hub for plugin-owned capabilities.
 * Source of truth: Design §13.2.
 *
 * The AI tool catalog (SkillRegistry.getAllToolFunctions / MCPToolService
 * .getEnabledMCPTools) reads fresh from the database on every call, so it
 * has no in-memory cache to clear. The only plugin-related cache is the
 * loader memoization, which we clear here. Downstream catalogs will pick up
 * the new state on their next read.
 */
import { PluginLoaderService } from "@/service/PluginLoaderService";

export class PluginRuntimeCache {
  /**
   * Clear plugin-related caches. Call after plugin import, uninstall,
   * enable/disable, component toggles, MCP discovery, and plugin reload.
   */
  static clear(_reason: string): void {
    try {
      PluginLoaderService.clearCache();
    } catch {
      // loader may not have run yet — safe to ignore
    }
  }
}
