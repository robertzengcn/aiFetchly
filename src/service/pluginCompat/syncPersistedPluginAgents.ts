import { log } from "@/modules/Logger";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { PluginAgentImportService } from "@/service/PluginAgentImportService";
import type { LoadedPlugin } from "@/service/PluginLoaderService";
import type { PluginError } from "@/entityTypes/pluginTypes";
import {
  isPluginHealth,
  pluginHealthForLoadErrors,
} from "@/service/pluginCompat/pluginLoadHealth";

/**
 * Re-read installed plugin agents and refresh their persisted allowlists.
 *
 * Import stores the agent rows and the diagnostic list. When the Claude tool
 * map grows, already-installed plugins keep the old "tool was ignored"
 * errors until something rewrites those rows. Startup promotion does that
 * rewrite so Write/Edit/Bash become usable without a manual reinstall.
 */
export async function syncPersistedPluginAgents(
  plugins: readonly LoadedPlugin[]
): Promise<void> {
  const targets = plugins.filter(
    (plugin) => plugin.enabled && typeof plugin.installPath === "string"
  );
  if (targets.length === 0) return;

  const agentModule = new AgentDefinitionModule();
  const pluginModule = new PluginManagementModule();
  for (const plugin of targets) {
    const installPath = plugin.installPath;
    if (!installPath) continue;
    try {
      const parsed = PluginAgentImportService.parsePluginAgents({
        pluginRoot: installPath,
        manifest: plugin.manifest,
      });
      if (!parsed.ok) continue;

      const existing = await agentModule.findAgentsByPluginName(plugin.name);
      const disabled = new Set(
        existing
          .filter((agent) => agent.status === "disabled")
          .map((agent) => agent.id)
      );
      await agentModule.upsertPluginAgents(
        plugin.name,
        parsed.agents,
        disabled
      );

      const row = await pluginModule.getPluginByName(plugin.name);
      if (!row) continue;
      const stored = parseStoredErrors(row.lastLoadErrorsJson);
      const kept = stored.filter(
        (error) =>
          !(
            error.code === "agent-unsupported-field" &&
            error.componentType === "agent"
          )
      );
      const next = [...kept, ...parsed.warnings];
      const currentHealth = isPluginHealth(row.health) ? row.health : undefined;
      await pluginModule.updatePluginState({
        name: plugin.name,
        health: pluginHealthForLoadErrors(next, currentHealth),
        lastLoadErrorsJson: JSON.stringify(next),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(
        `[plugin-agent-sync] skipped ${plugin.name}: ${message}`
      );
    }
  }
}

function parseStoredErrors(json: string | null | undefined): PluginError[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PluginError =>
        !!item &&
        typeof item === "object" &&
        typeof (item as PluginError).code === "string" &&
        typeof (item as PluginError).message === "string"
    );
  } catch {
    return [];
  }
}
