/**
 * AIAppNavigationCatalogService.
 *
 * Builds a normalized, AI-navigable route catalog from the route manifest.
 * Pure computation only: no LLM, no Vue Router runtime APIs, no database.
 *
 * Inclusion / exclusion rules and label generation follow the technical
 * design §8.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §8
 */
import type { AiNavigationCatalogEntry } from "@/entityTypes/aiAppNavigationTypes";
import type { AiNavigationRouteManifestEntry } from "@/config/aiNavigationRouteManifest";

/** Auth / internal-only terms that disqualify a route from AI navigation. */
const AUTH_TERMS: ReadonlySet<string> = new Set([
  "login",
  "logout",
  "auth",
  "callback",
  "error",
]);

/**
 * Normalize a route path to a full path: ensure a leading `/` and strip any
 * trailing slash (except for the root path itself).
 */
function normalizePath(path: string): string {
  if (!path || typeof path !== "string") return "/";
  let p = path.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  return p || "/";
}

/**
 * Detect required route params (e.g. `:id`, `:id(\\d+)`). Optional params are
 * not treated as required for MVP.
 */
function hasRequiredRouteParams(path: string): boolean {
  return /(^|\/):[A-Za-z0-9_]+(\([^)]*\))?($|\/)/.test(path);
}

/**
 * Whether a route name/path mentions an auth-only or internal-only term as a
 * whole token.
 */
function isAuthRoute(routeName: string, path: string): boolean {
  const tokens = `${routeName} ${path}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => AUTH_TERMS.has(token));
}

/**
 * Convert a title key, route name, or path into a human-readable label.
 *
 * Takes the last segment after `.` (for i18n keys like `route.email_service`),
 * splits on separators and camelCase, lowercases, then title-cases each word.
 */
function toReadableLabel(input: string): string {
  const segment = input.includes(".") ? input.split(".").pop() ?? input : input;
  const spaced = segment.replace(/[-/_.]+/g, " ");
  const camelSplit = spaced.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const words = camelSplit.toLowerCase().split(/\s+/).filter(Boolean);
  return words
    .map((word) =>
      word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/** Generate a label for a manifest entry using title key → name → path priority. */
function generateLabel(entry: AiNavigationRouteManifestEntry): string {
  if (entry.titleKey) return toReadableLabel(entry.titleKey);
  if (entry.routeName) return toReadableLabel(entry.routeName);
  return toReadableLabel(normalizePath(entry.path));
}

/**
 * Whether a route is page-like enough for default (non-explicit) inclusion:
 * it has at least two path segments (a real page, not a root redirect/layout).
 */
function hasPageLikePath(fullPath: string): boolean {
  return fullPath.split("/").filter(Boolean).length >= 2;
}

export class AIAppNavigationCatalogService {
  /**
   * Build the navigable route catalog from a manifest. Entries that fail the
   * inclusion rules are dropped.
   */
  buildCatalog(
    manifest: readonly AiNavigationRouteManifestEntry[]
  ): AiNavigationCatalogEntry[] {
    const entries: AiNavigationCatalogEntry[] = [];
    for (const entry of manifest) {
      if (!this.isAiNavigableEntry(entry)) continue;
      const fullPath = normalizePath(entry.path);
      entries.push({
        routeName: entry.routeName,
        path: entry.path,
        fullPath,
        titleKey: entry.titleKey,
        label: generateLabel(entry),
        aliases: entry.aiAliases ? [...entry.aiAliases] : [],
        description: entry.aiDescription,
        visible: entry.visible ?? false,
        requiresParams: hasRequiredRouteParams(fullPath),
        explicitlyIncluded: entry.aiNavigable === true,
        explicitlyExcluded: entry.aiNavigable === false,
        source: "router",
      });
    }
    return entries;
  }

  /**
   * Whether a single manifest entry is AI-navigable. Applies the exclusion
   * rules (explicit exclude, no name, required params, auth/internal) then the
   * inclusion rules (explicit include, or default-safe param-free page).
   */
  isAiNavigableEntry(entry: AiNavigationRouteManifestEntry): boolean {
    if (!entry) return false;
    if (typeof entry.routeName !== "string" || entry.routeName.trim() === "") {
      return false;
    }
    if (entry.aiNavigable === false) return false;

    const fullPath = normalizePath(entry.path);
    if (hasRequiredRouteParams(fullPath)) return false;
    if (isAuthRoute(entry.routeName, fullPath)) return false;

    // Explicit inclusion.
    if (entry.aiNavigable === true) return true;

    // Default-safe inclusion: param-free, page-like or visible, not auth.
    return entry.visible === true || hasPageLikePath(fullPath);
  }
}
