/**
 * Zod schemas for the AI App Navigation Tool.
 *
 * Uses the `zod/v4` subpath entry per the project zod-schema-validation
 * standard (new code imports from `zod/v4`; v3 and v4 coexist). This schema
 * is only used to `parse()` tool-call arguments inside the built-in skill's
 * `execute()` — it is not converted to a JSON schema for the LLM (the
 * LLM-facing `parameters` is a hand-authored JSON Schema object on the
 * `SkillDefinition`).
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §6
 * @see docs/prd/zod-schema-validation-tech-design.md §2
 */
import { z } from "zod/v4";

/**
 * Input schema for the `open_app_page` tool.
 *
 * `query` is the user's natural-language navigation request.
 * `preferredRouteName` is an optional route name chosen from a previous
 * clarification round.
 */
export const openAppPageInputSchema = z.object({
  query: z.string().trim().min(1).max(300),
  preferredRouteName: z.string().trim().min(1).max(120).optional(),
});

export type OpenAppPageInput = z.infer<typeof openAppPageInputSchema>;
