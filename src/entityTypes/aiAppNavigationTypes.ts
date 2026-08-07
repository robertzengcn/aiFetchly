/**
 * Shared type definitions for the AI App Navigation Tool.
 *
 * These types are consumed by the route manifest, catalog service, matcher,
 * tool service, and renderer helper. They are pure data shapes — no runtime
 * behavior lives here.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §5
 */

/**
 * A normalized, AI-navigable route entry derived from the route manifest.
 *
 * Produced by `AIAppNavigationCatalogService.buildCatalog`. This is the
 * matcher's working set.
 */
export interface AiNavigationCatalogEntry {
  /** Stable Vue Router route name (used for `router.push({ name })`). */
  readonly routeName: string;
  /** Route path as authored (relative segment or full path). */
  readonly path: string;
  /** Full resolved path (always begins with `/`). */
  readonly fullPath: string;
  /** Existing i18n title key from `meta.title`, if any. */
  readonly titleKey?: string;
  /** Human-readable label generated from title/name/path. */
  readonly label: string;
  /** Curated natural-language phrases for this route. */
  readonly aliases: readonly string[];
  /** Human-readable route purpose. */
  readonly description?: string;
  /** Whether the route is visible in the application menu. */
  readonly visible: boolean;
  /** Whether the route path contains required params (e.g. `:id`). */
  readonly requiresParams: boolean;
  /** `true` when `meta.aiNavigable === true`. */
  readonly explicitlyIncluded: boolean;
  /** `true` when `meta.aiNavigable === false`. */
  readonly explicitlyExcluded: boolean;
  /** Origin of the entry. Reserved for future router-derived catalogs. */
  readonly source: "router";
}

/**
 * A single candidate returned when a navigation request is ambiguous.
 */
export interface AiNavigationMatchCandidate {
  readonly routeName: string;
  readonly path: string;
  readonly label: string;
  readonly confidence: number;
  readonly matchedSignals: readonly string[];
}

/**
 * Input parsed from the LLM `open_app_page` tool call.
 */
export interface OpenAppPageInput {
  readonly query: string;
  readonly preferredRouteName?: string;
}

/**
 * Successful navigation command. The renderer validates `routeName` against
 * `router.getRoutes()` before calling `router.push({ name })`.
 */
export interface OpenAppPageSuccess {
  readonly success: true;
  readonly action: "navigate";
  readonly routeName: string;
  readonly path?: string;
  readonly label: string;
  readonly confidence: number;
}

/**
 * Ambiguous-match result. The assistant should ask a clarification question
 * instead of navigating.
 */
export interface OpenAppPageClarification {
  readonly success: false;
  readonly needsClarification: true;
  readonly message: string;
  readonly candidates: readonly AiNavigationMatchCandidate[];
}

/**
 * Unsupported navigation result: not found, blocked, or requires params.
 */
export interface OpenAppPageUnsupported {
  readonly success: false;
  readonly message: string;
  readonly needsRouteParams?: boolean;
  readonly notFound?: boolean;
  readonly blocked?: boolean;
}

/**
 * Discriminated union of all tool results.
 */
export type OpenAppPageResult =
  | OpenAppPageSuccess
  | OpenAppPageClarification
  | OpenAppPageUnsupported;
