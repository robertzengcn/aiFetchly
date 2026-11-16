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
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  pluginMarketplaceNoInputSchema,
  pluginMarketplaceByNameInputSchema,
  pluginMarketplaceAddInputSchema,
  pluginMarketplaceAvailablePluginsInputSchema,
  pluginMarketplacePluginByIdInputSchema,
  pluginMarketplaceInstallInputSchema,
} from "@/schemas/ipc/pluginMarketplace";
import { PluginMarketplaceService } from "@/service/PluginMarketplaceService";
import { broadcastAifetchlyConfigChanged } from "@/main-process/communication/aifetchlyConfigEvents";

/**
 * Marketplace IPC handlers. Schema-validated via the shared NON-AI-gated
 * wrapper. CRLF rejection for strings that may reach spawn stays inside the
 * service (parseMarketplaceSource rejects control chars), not the schema.
 *
 * Deliberately NOT AI-gated: these channels serve plugin management (listing
 * marketplaces/sources, browsing available plugins, the Issues tab, and
 * install), which performs no AI model work. Gating them behind
 * registerAiValidatedHandler broke the Sources/Issues tables for Free users
 * with "AI feature is not enabled" (incident 2026-11-16). The precedent is
 * plugin-ipc.ts and community-plugin-ipc.ts — "plugin management is NOT an AI
 * feature". Never switch these back to registerAiValidatedHandler.
 */
export function registerPluginMarketplaceIpcHandlers(): void {
  log.info("Plugin Marketplace IPC handlers registered");

  registerValidatedHandler(
    PLUGIN_MARKETPLACE_LIST,
    pluginMarketplaceNoInputSchema,
    async () => {
      return await new PluginMarketplaceService().listMarketplaces();
    }
  );

  registerValidatedHandler(
    PLUGIN_MARKETPLACE_GET,
    pluginMarketplaceByNameInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().getMarketplace(input.name);
    }
  );

  registerValidatedHandler(
    PLUGIN_MARKETPLACE_ADD,
    pluginMarketplaceAddInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().addMarketplace(input);
    }
  );

  registerValidatedHandler(
    PLUGIN_MARKETPLACE_REFRESH,
    pluginMarketplaceByNameInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().refreshMarketplace(
        input.name
      );
    }
  );

  registerValidatedHandler(
    PLUGIN_MARKETPLACE_REMOVE,
    pluginMarketplaceByNameInputSchema,
    async (input) => {
      await new PluginMarketplaceService().removeMarketplace(input.name);
      return null;
    }
  );

  registerValidatedHandler(
    PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
    pluginMarketplaceAvailablePluginsInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().listAvailablePlugins(input);
    }
  );

  registerValidatedHandler(
    PLUGIN_MARKETPLACE_GET_PLUGIN,
    pluginMarketplacePluginByIdInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().getAvailablePlugin(
        input.pluginId
      );
    }
  );

  registerValidatedHandler(
    PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
    pluginMarketplaceInstallInputSchema,
    async (input) => {
      const installed =
        await new PluginMarketplaceService().installMarketplacePlugin(input);
      // Plugin set changed — refresh any open slash suggestions (PRD Problem 2).
      broadcastAifetchlyConfigChanged({ source: "plugin" });
      return installed;
    }
  );
}
