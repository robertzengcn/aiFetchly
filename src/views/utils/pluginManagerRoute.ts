import type { LocationQuery, LocationQueryValue } from "vue-router";

/**
 * Unified Plugin Manager route-query helpers (tech design §6.1).
 *
 * The canonical Plugin page exposes four task-oriented sections (Discover,
 * Installed, Sources, Issues) behind one `/plugins/management` route. The
 * active section is carried in `route.query.tab` so refresh, deep links, AI
 * navigation defaulting, and browser history all behave deterministically.
 *
 * These helpers parse and construct that query field against a closed tab
 * set, so an untrusted query value can never select an unknown section.
 */

export const PLUGIN_MANAGER_TABS = [
  "discover",
  "installed",
  "sources",
  "issues",
] as const;

export type PluginManagerTab = (typeof PLUGIN_MANAGER_TABS)[number];

/** Parse a `route.query.tab` value into a valid tab, defaulting to Discover. */
export function parsePluginManagerTab(
  value: LocationQueryValue | LocationQueryValue[] | undefined
): PluginManagerTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return PLUGIN_MANAGER_TABS.includes(candidate as PluginManagerTab)
    ? (candidate as PluginManagerTab)
    : "discover";
}

/** Construct a query object carrying the given tab, preserving other keys. */
export function withPluginManagerTab(
  query: LocationQuery,
  tab: PluginManagerTab
): LocationQuery {
  return { ...query, tab };
}

/** Type guard validating an arbitrary value (from v-tab @update) is a tab. */
export function isPluginManagerTab(
  value: unknown
): value is PluginManagerTab {
  return (
    typeof value === "string" &&
    PLUGIN_MANAGER_TABS.some((candidate) => candidate === value)
  );
}
