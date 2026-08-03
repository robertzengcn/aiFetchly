import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

/** PLUGIN_MARKETPLACE_LIST / PLUGIN_MARKETPLACE_REFRESH-via-... no-arg calls */
export const pluginMarketplaceNoInputSchema = noInputSchema;

/** PLUGIN_MARKETPLACE_GET / PLUGIN_MARKETPLACE_REFRESH / PLUGIN_MARKETPLACE_REMOVE: by name */
export const pluginMarketplaceByNameInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, "name is required").max(256).regex(/^[a-z0-9][a-z0-9_-]*$/),
  })
);

/** PLUGIN_MARKETPLACE_ADD: source + optional ref + overwrite */
export const pluginMarketplaceAddInputSchema = lazySchema(() =>
  z.strictObject({
    source: z.string().min(1, "source is required").max(4096),
    ref: z.string().max(256).optional(),
    overwrite: z.boolean().optional(),
  })
);

/** PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS: optional filter object */
export const pluginMarketplaceAvailablePluginsInputSchema = lazySchema(() =>
  z
    .object({
      search: z.string().max(256).optional(),
      marketplaceName: z.string().max(256).optional(),
      category: z.string().max(128).optional(),
      installed: z.boolean().optional(),
      hasSkills: z.boolean().optional(),
      hasMcpServers: z.boolean().optional(),
      hasHooks: z.boolean().optional(),
    })
    .strict()
);

/** PLUGIN_MARKETPLACE_GET_PLUGIN: by pluginId */
export const pluginMarketplacePluginByIdInputSchema = lazySchema(() =>
  z.strictObject({
    pluginId: z.string().min(1, "pluginId is required").max(512),
  })
);

/** PLUGIN_MARKETPLACE_INSTALL_PLUGIN: pluginId + install options */
export const pluginMarketplaceInstallInputSchema = lazySchema(() =>
  z.strictObject({
    pluginId: z.string().min(1, "pluginId is required").max(512),
    overwrite: z.boolean().optional(),
    enableAfterInstall: z.boolean().optional(),
    npmAuthToken: z.string().max(4096).optional(),
  })
);
