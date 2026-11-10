import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";
import { ctaFor } from "@/views/utils/communityPluginCta";

/**
 * Pure Community catalog filtering & facet helpers (tech design §7).
 *
 * These functions own NO component state and touch NO IPC. They normalize
 * the cached Community catalog into search documents, build stable tag
 * facets, and apply search + single-tag + availability filters with logical
 * AND. Input arrays are never mutated; input order is preserved.
 *
 * Availability never becomes a second entitlement implementation: it reuses
 * the Hub-driven `ctaFor()` decision, so "Available" exactly tracks the
 * actionable Install outcome and never re-derives tier.
 */

export const COMMUNITY_AVAILABILITY_FILTERS = [
  "all",
  "available",
  "installed",
] as const;

export type CommunityAvailabilityFilter =
  (typeof COMMUNITY_AVAILABILITY_FILTERS)[number];

export interface CommunityCatalogFilters {
  /** Free-text search across all searchable catalog fields. */
  readonly search: string;
  /** Normalized facet key of the single selected tag, or null for "All". */
  readonly selectedTagKey: string | null;
  /** All / Available / Installed availability restriction. */
  readonly availability: CommunityAvailabilityFilter;
}

export interface CommunityTagFacet {
  /** Normalized (trimmed, lowercased) facet identity. */
  readonly key: string;
  /** First non-empty catalog spelling encountered. */
  readonly label: string;
  /** Number of catalog entries carrying this facet value. */
  readonly count: number;
}

interface NormalizedFacetValue {
  readonly key: string;
  readonly label: string;
}

/**
 * Deterministic normalizer for filter identity keys.
 *
 * Do NOT use locale-dependent case mapping for identity keys — a stable
 * ASCII lowercase keeps facet identity predictable across platforms. Display
 * labels preserve the first catalog spelling.
 */
export function normalizeCommunityFilterValue(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Build the lowercase search document for an entry across every field a user
 * would reasonably search by (display name, name, description, owner,
 * category, tags). Uses string interpolation data only — no HTML is produced.
 */
export function communityPluginSearchDocument(
  entry: PluginCommunityEntry
): string {
  return [
    entry.displayName,
    entry.name,
    entry.description,
    entry.owner ?? "",
    entry.category ?? "",
    ...(entry.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * The per-entry normalized facet values (category + tags). A category and a
 * tag sharing the same term count at most once per plugin so one plugin
 * cannot inflate a facet's frequency.
 */
export function communityEntryFacetValues(
  entry: PluginCommunityEntry
): NormalizedFacetValue[] {
  const labels = [
    ...(entry.category ? [entry.category] : []),
    ...(entry.tags ?? []),
  ];
  const byKey = new Map<string, string>();

  for (const rawLabel of labels) {
    const label = rawLabel.trim();
    const key = normalizeCommunityFilterValue(label);
    if (key && !byKey.has(key)) byKey.set(key, label);
  }

  return [...byKey.entries()].map(([key, label]) => ({ key, label }));
}

/**
 * Build tag facets from the full catalog: count each normalized value at most
 * once per plugin, then sort by frequency descending with alphabetical
 * tie-break for deterministic rendering (tech design §7.4 / §11.2).
 */
export function buildCommunityTagFacets(
  entries: readonly PluginCommunityEntry[]
): CommunityTagFacet[] {
  const facets = new Map<string, { label: string; count: number }>();

  for (const entry of entries) {
    for (const value of communityEntryFacetValues(entry)) {
      const current = facets.get(value.key);
      facets.set(value.key, {
        label: current?.label ?? value.label,
        count: (current?.count ?? 0) + 1,
      });
    }
  }

  return [...facets.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });
}

/**
 * Availability semantics reuse `ctaFor()` so Available exactly tracks the
 * actionable Install outcome (excludes upgrade, sign-in, preview, forbidden,
 * and unavailable cards). Installed tracks the Hub cross-referenced flag.
 */
export function matchesCommunityAvailability(
  entry: PluginCommunityEntry,
  availability: CommunityAvailabilityFilter
): boolean {
  if (availability === "all") return true;
  if (availability === "installed") return entry.installed;
  return ctaFor(entry) === "install";
}

/**
 * Combined filtering with logical AND across search, selected tag, and
 * availability. Preserves input order and does not mutate entries.
 */
export function filterCommunityPlugins(
  entries: readonly PluginCommunityEntry[],
  filters: CommunityCatalogFilters
): PluginCommunityEntry[] {
  const search = normalizeCommunityFilterValue(filters.search);

  return entries.filter((entry) => {
    const matchesSearch =
      !search || communityPluginSearchDocument(entry).includes(search);
    const facetKeys = new Set(
      communityEntryFacetValues(entry).map((value) => value.key)
    );
    const matchesTag =
      !filters.selectedTagKey || facetKeys.has(filters.selectedTagKey);
    const matchesAvailability = matchesCommunityAvailability(
      entry,
      filters.availability
    );

    return matchesSearch && matchesTag && matchesAvailability;
  });
}

/**
 * The concise primary facet set shown above the grid. If the currently
 * selected facet falls outside the primary set, include it as the final
 * visible facet so the selected tag never disappears (tech design §7.7 /
 * §11.4). Counts come from the full catalog, not current search results.
 */
export function visibleCommunityTagFacets(
  facets: readonly CommunityTagFacet[],
  selectedKey: string | null,
  limit = 10
): CommunityTagFacet[] {
  const primary = facets.slice(0, limit);
  if (!selectedKey || primary.some((facet) => facet.key === selectedKey)) {
    return primary;
  }
  const selected = facets.find((facet) => facet.key === selectedKey);
  if (!selected) return primary;
  return [...primary.slice(0, Math.max(0, limit - 1)), selected];
}
