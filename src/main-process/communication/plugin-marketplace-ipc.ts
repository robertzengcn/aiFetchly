import { log } from "@/modules/Logger";
import {
  PLUGIN_MARKETPLACE_LIST,
  PLUGIN_MARKETPLACE_GET,
  PLUGIN_MARKETPLACE_ADD,
  PLUGIN_MARKETPLACE_REFRESH,
  PLUGIN_MARKETPLACE_REMOVE,
  PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
  PLUGIN_MARKETPLACE_GET_PLUGIN,
  PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
} from "@/config/channellist";
import { registerAiValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  pluginMarketplaceNoInputSchema,
  pluginMarketplaceByNameInputSchema,
  pluginMarketplaceAddInputSchema,
  pluginMarketplaceAvailablePluginsInputSchema,
  pluginMarketplacePluginByIdInputSchema,
  pluginMarketplaceInstallInputSchema,
} from "@/schemas/ipc/pluginMarketplace";
import { PluginMarketplaceService } from "@/service/PluginMarketplaceService";

/**
 * Marketplace IPC handlers. All AI-gated + schema-validated via the shared
 * wrapper. CRLF rejection for strings that may reach spawn stays inside the
 * service (parseMarketplaceSource rejects control chars), not the schema.
 */
export function registerPluginMarketplaceIpcHandlers(): void {
  log.info("Plugin Marketplace IPC handlers registered");

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_LIST, pluginMarketplaceNoInputSchema, async () => {
    return await new PluginMarketplaceService().listMarketplaces();
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_GET, pluginMarketplaceByNameInputSchema, async (input) => {
    return await new PluginMarketplaceService().getMarketplace(input.name);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_ADD, pluginMarketplaceAddInputSchema, async (input) => {
    return await new PluginMarketplaceService().addMarketplace(input);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_REFRESH, pluginMarketplaceByNameInputSchema, async (input) => {
    return await new PluginMarketplaceService().refreshMarketplace(input.name);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_REMOVE, pluginMarketplaceByNameInputSchema, async (input) => {
    await new PluginMarketplaceService().removeMarketplace(input.name);
    return null;
  });

  registerAiValidatedHandler(
    PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
    pluginMarketplaceAvailablePluginsInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().listAvailablePlugins(input);
    }
  );

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_GET_PLUGIN, pluginMarketplacePluginByIdInputSchema, async (input) => {
    return await new PluginMarketplaceService().getAvailablePlugin(input.pluginId);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_INSTALL_PLUGIN, pluginMarketplaceInstallInputSchema, async (input) => {
    return await new PluginMarketplaceService().installMarketplacePlugin(input);
  });
}
