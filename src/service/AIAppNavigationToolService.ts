/**
 * AIAppNavigationToolService.
 *
 * Core of the `open_app_page` built-in skill. Parses tool-call args with Zod,
 * resolves the query against the route catalog, and returns a navigation
 * command, clarification candidates, or a safe failure. It never calls
 * `router.push`, never mutates data, and never echoes raw user input (so
 * prompt-injected URLs cannot leak through the result).
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §10
 */
import { openAppPageInputSchema } from "@/schemas/aiAppNavigation";
import { aiNavigationRouteManifest } from "@/config/aiNavigationRouteManifest";
import { AIAppNavigationCatalogService } from "@/service/AIAppNavigationCatalogService";
import { AIAppNavigationMatcher } from "@/service/AIAppNavigationMatcher";
import type { OpenAppPageResult } from "@/entityTypes/aiAppNavigationTypes";

/** Safe failure returned when tool args fail Zod validation. */
const INVALID_REQUEST: OpenAppPageResult = {
  success: false,
  message: "Invalid navigation request.",
};

/** Matches a bare record id token (e.g. "123" in "open campaign 123"). */
const NUMERIC_ID_PATTERN = /\b\d+\b/;

/** Matches detail/edit intent words. */
const DETAIL_WORD_PATTERN = /\b(detail|edit)\b/;

const NEEDS_PARAMS_MESSAGE =
  "This page requires a specific record. Please open the related list page and choose an item, or specify which item you mean.";

export class AIAppNavigationToolService {
  private readonly catalogService = new AIAppNavigationCatalogService();
  private readonly matcher = new AIAppNavigationMatcher();

  openAppPage(rawArgs: unknown): OpenAppPageResult {
    let query: string;
    let preferredRouteName: string | undefined;
    try {
      const input = openAppPageInputSchema.parse(rawArgs);
      query = input.query;
      preferredRouteName = input.preferredRouteName;
    } catch {
      return INVALID_REQUEST;
    }

    const catalog = this.catalogService.buildCatalog(aiNavigationRouteManifest);

    // A specific record id was referenced. The MVP does not support
    // required-param routes, so refuse to guess.
    if (NUMERIC_ID_PATTERN.test(query)) {
      return {
        success: false,
        needsRouteParams: true,
        message: NEEDS_PARAMS_MESSAGE,
      };
    }

    // Explicit selection carried over from a prior clarification round.
    if (preferredRouteName) {
      const preferred = catalog.find(
        (entry) => entry.routeName === preferredRouteName
      );
      if (preferred) {
        return {
          success: true,
          action: "navigate",
          routeName: preferred.routeName,
          path: preferred.fullPath,
          label: preferred.label,
          confidence: 0.95,
        };
      }
    }

    const result = this.matcher.match(query, catalog);

    // The matcher did not navigate and the user asked for a detail/edit page,
    // which requires a specific record. Signal that clearly instead of
    // returning a generic not-found.
    if (!result.success && DETAIL_WORD_PATTERN.test(query)) {
      return {
        success: false,
        needsRouteParams: true,
        message: NEEDS_PARAMS_MESSAGE,
      };
    }

    return result;
  }
}
