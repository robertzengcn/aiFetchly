/**
 * Renderer-side handler for `open_app_page` tool results.
 *
 * Only the renderer owns Vue Router, so actual navigation (`router.push`)
 * happens here — never in the main process. Streamed tool results are treated
 * as untrusted: the route is re-validated against `router.getRoutes()` and the
 * same safety rules (no explicit exclusion, no required params, no auth routes)
 * before navigating.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §12
 */
import type { Router } from "vue-router";

type RouterRoute = ReturnType<Router["getRoutes"]>[number];

interface NavigationToolResult {
  readonly success?: unknown;
  readonly action?: unknown;
  readonly routeName?: unknown;
}

/** Auth / internal-only terms that disqualify a route from AI navigation. */
const AUTH_TERMS: ReadonlySet<string> = new Set([
  "login",
  "logout",
  "auth",
  "callback",
  "error",
]);

function hasRequiredRouteParams(path: string): boolean {
  return /(^|\/):[A-Za-z0-9_]+(\([^)]*\))?($|\/)/.test(path);
}

function isAuthRoute(name: string, path: string): boolean {
  const tokens = `${name} ${path}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => AUTH_TERMS.has(token));
}

/** Whether a streamed tool result is a navigation command. */
export function isNavigationResult(
  value: unknown
): value is { success: true; action: "navigate"; routeName: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as NavigationToolResult;
  return (
    record.success === true &&
    record.action === "navigate" &&
    typeof record.routeName === "string" &&
    record.routeName.length > 0
  );
}

/** Whether a router route passes the renderer-side AI-navigation safety rules. */
function isRendererAiNavigableRoute(route: RouterRoute): boolean {
  const name = typeof route.name === "string" ? route.name : "";
  const path = route.path ?? "";
  if (route.meta?.aiNavigable === false) return false;
  if (hasRequiredRouteParams(path)) return false;
  if (isAuthRoute(name, path)) return false;
  return true;
}

/**
 * Handle a streamed tool result. Navigates when the result is a valid
 * navigation command for an allowed route.
 *
 * @returns `true` if the result was a navigation command (whether or not it
 *   actually navigated); `false` if it was some other kind of result.
 */
export async function handleAiNavigationToolResult(
  router: Router,
  toolResult: unknown
): Promise<boolean> {
  if (!isNavigationResult(toolResult)) return false;

  const routeName = toolResult.routeName;
  const route = router.getRoutes().find((entry) => entry.name === routeName);

  if (!route) {
    // Route is not registered in this build (e.g. present on another branch).
    // Treat as handled but do not navigate.
    return true;
  }

  if (!isRendererAiNavigableRoute(route)) {
    return true;
  }

  try {
    await router.push({ name: routeName });
  } catch {
    // A navigation guard threw. Treat as handled without surfacing an error
    // (avoids an unhandled rejection from the fire-and-forget caller).
  }
  return true;
}
