// src/service/pluginCompat/PluginCommandDiagnosticsStore.ts
// In-memory, per-plugin cache of slash-command/agent promotion diagnostics.
//
// Plugin commands and agents are NOT persisted to the database — their source
// of truth at runtime is the live CommandRegistry / AgentDefinitionRegistry.
// Promotion diagnostics (invalid command files, unsupported Claude declarations,
// path-traversal rejections, oversized files, …) therefore have no natural DB
// home. This store bridges the gap: PluginComponentRegistryService writes the
// latest diagnostics here on every promotion pass, and PluginDiagnosticsService
// reads them when building a diagnostics bundle for the UI / export surface.
//
// Promotion rewrites each plugin's entry on every apply (including an empty
// array for disabled / missing-install-path plugins), so stale diagnostics
// can never survive a reconcile. clearAll() is exposed for tests.

import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";

const store = new Map<string, AIFetchlyConfigDiagnostic[]>();

function clone(diags: readonly AIFetchlyConfigDiagnostic[]): AIFetchlyConfigDiagnostic[] {
  return diags.map((d) => ({ ...d }));
}

/**
 * Per-plugin promotion diagnostics cache. Process-wide singleton backed by a
 * module-level Map — no class state to wire up.
 */
export const PluginCommandDiagnosticsStore = {
  /**
   * Record the latest diagnostics for a plugin. Existing entries are replaced
   * (passing an empty array clears the plugin's diagnostics — used when a
   * plugin is disabled / uninstalled / missing its install path so stale
   * warnings never linger).
   *
   * Stores defensive copies; callers cannot mutate the cached entries.
   */
  set(pluginName: string, diagnostics: readonly AIFetchlyConfigDiagnostic[]): void {
    store.set(pluginName, clone(diagnostics));
  },

  /**
   * Read the cached diagnostics for a plugin. Returns a fresh defensive copy,
   * or an empty array when the plugin has no recorded diagnostics.
   */
  get(pluginName: string): readonly AIFetchlyConfigDiagnostic[] {
    const diags = store.get(pluginName);
    return diags ? clone(diags) : [];
  },

  /** Drop a single plugin's diagnostics (used on uninstall). */
  clear(pluginName: string): void {
    store.delete(pluginName);
  },

  /** Drop ALL plugins' diagnostics. Test-only; production relies on per-plugin rewrites. */
  clearAll(): void {
    store.clear();
  },
};
