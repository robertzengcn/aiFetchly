/**
 * Route metadata type augmentation for Vue Router.
 *
 * Adds the AI-navigation metadata fields introduced by the AI App Navigation
 * Tool: `aiNavigable`, `aiAliases`, `aiDescription`.
 *
 * Existing meta fields (`visible`, `title`, `icon`, `keepAlive`, `noCache`,
 * `activeMenu`) are intentionally NOT re-declared here. vue-router's default
 * `RouteMeta` already extends `Record<string | number | symbol, unknown>`,
 * so those fields remain accessible as `unknown` — and parts of the codebase
 * (e.g. `translatedRoutes.ts`) assign `ComputedRef<string>` to `title`, which
 * a strict `title?: string` declaration would reject. Declaring only the new
 * fields avoids that regression while still typing the AI metadata.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §4.1
 */
import "vue-router";
import type { InnerPageRouteUiMeta } from "@/views/types/uiConvergenceTypes";

declare module "vue-router" {
  interface RouteMeta {
    /**
     * Inner-page convergence presentation contract (design §8.1).
     * Presentation-only: never authorization, database access, or safety.
     */
    ui?: InnerPageRouteUiMeta;
    /** Explicitly include (`true`) or exclude (`false`) this route from AI navigation. */
    aiNavigable?: boolean;
    /** Natural-language phrases that should match this page. */
    aiAliases?: string[];
    /** Human-readable route purpose used for matching and tool descriptions. */
    aiDescription?: string;
  }
}
