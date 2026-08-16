// NOTE: imports classic `zod` (not `zod/v4`) because registerValidatedHandler
// and the shared zodToJsonSchema machinery type against root-zod ZodType —
// same as every other file in src/schemas/ipc/.
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

/**
 * Community Plugins IPC input schemas (PRD §7.3).
 *
 * These channels are NON-AI-gated (Free users must see the catalog), so they
 * use registerValidatedHandler — never registerAiValidatedHandler.
 */

/** PLUGIN_COMMUNITY_LIST: optional filter object. */
export const pluginCommunityListInputSchema = lazySchema(() =>
  z.strictObject({
    forceRefresh: z.boolean().optional(),
    category: z.string().max(128).optional(),
    search: z.string().max(256).optional(),
  })
);

/** PLUGIN_COMMUNITY_DETAIL / PLUGIN_COMMUNITY_INSTALL: by slug. */
export const pluginCommunitySlugInputSchema = lazySchema(() =>
  z.strictObject({
    slug: z.string().min(1, "slug is required").max(200),
  })
);

/** PLUGIN_COMMUNITY_OPEN_PLANS: no args (URL is a main-process constant). */
export const pluginCommunityNoInputSchema = noInputSchema;
