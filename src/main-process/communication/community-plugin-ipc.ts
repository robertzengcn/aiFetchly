import { shell } from "electron";
import {
  PLUGIN_COMMUNITY_DETAIL,
  PLUGIN_COMMUNITY_INSTALL,
  PLUGIN_COMMUNITY_LIST,
  PLUGIN_COMMUNITY_OPEN_PLANS,
} from "@/config/channellist";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  pluginCommunityListInputSchema,
  pluginCommunityNoInputSchema,
  pluginCommunitySlugInputSchema,
} from "@/schemas/ipc/communityPlugin";
import { PluginMarketplaceService } from "@/service/PluginMarketplaceService";
import { MARKETING_PLANS_URL } from "@/config/pluginHubUrl";
import { broadcastAifetchlyConfigChanged } from "@/main-process/communication/aifetchlyConfigEvents";
import { log } from "@/modules/Logger";

/**
 * Community Plugins IPC handlers (Community Plugin Page PRD §7.3).
 *
 * Deliberately NON-AI-gated: Free (Community) users are the primary audience
 * of the catalog, so every handler uses registerValidatedHandler — the
 * precedent is plugin-ipc.ts ("plugin management is NOT an AI feature").
 * Never switch these to registerAiValidatedHandler.
 */
export function registerCommunityPluginIpcHandlers(): void {
  console.log("Community Plugin IPC handlers registered");

  registerValidatedHandler(
    PLUGIN_COMMUNITY_LIST,
    pluginCommunityListInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().listCommunityPlugins(input);
    }
  );

  registerValidatedHandler(
    PLUGIN_COMMUNITY_DETAIL,
    pluginCommunitySlugInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().getCommunityPluginDetail(
        input.slug
      );
    }
  );

  registerValidatedHandler(
    PLUGIN_COMMUNITY_INSTALL,
    pluginCommunitySlugInputSchema,
    async (input) => {
      const installed =
        await new PluginMarketplaceService().installCommunityPlugin(input.slug);
      // Plugin set changed — refresh any open slash suggestions (mirrors
      // plugin-marketplace-ipc.ts install handling).
      broadcastAifetchlyConfigChanged({ source: "plugin" });
      return installed;
    }
  );

  registerValidatedHandler(
    PLUGIN_COMMUNITY_OPEN_PLANS,
    pluginCommunityNoInputSchema,
    async () => {
      // Constant, never user input (PRD §7.7 / §13.3).
      try {
        await shell.openExternal(MARKETING_PLANS_URL);
        return null;
      } catch (err) {
        log.error(
          `[${PLUGIN_COMMUNITY_OPEN_PLANS}] OPEN_PLANS_FAILED: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        // Human-readable: the renderer surfaces this message verbatim.
        throw new Error("Could not open the plans page.");
      }
    }
  );
}
