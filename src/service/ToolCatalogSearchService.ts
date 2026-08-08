/**
 * ToolCatalogSearchService — implements the `tool_catalog_search` discovery
 * tool (FR-3, design §13).
 *
 * Given a query and/or explicit selects, ranks deferred catalog entries using
 * weighted signals (exact name, name parts, MCP/plugin/server parts, required
 * +terms, description words, recent discovery) and returns compact matches plus
 * the exact tool names to load on the next round.
 *
 * Security: never returns blocked tools; restricts to allowedToolNames when an
 * agent allowlist is present. Disabled tools are already absent from the
 * catalog. No secrets/schema details are included in matches.
 */

import { TOOL_CATALOG_DEFAULTS } from "@/config/toolCatalogConfig";
import type {
  ToolCatalog,
  ToolCatalogRuntimeContext,
  ToolCatalogSearchArgs,
  ToolCatalogSearchMatch,
  ToolCatalogSearchResult,
  ToolCatalogState,
} from "@/entityTypes/toolCatalogTypes";

export interface ToolCatalogSearchInput {
  readonly args: ToolCatalogSearchArgs;
  readonly catalog: ToolCatalog;
  readonly state: ToolCatalogState;
  readonly context: ToolCatalogRuntimeContext;
}

interface ScoredMatch extends ToolCatalogSearchMatch {
  readonly partsCount: number;
}

export class ToolCatalogSearchService {
  search(input: ToolCatalogSearchInput): ToolCatalogSearchResult {
    const { args, catalog, state, context } = input;
    const query = (args.query ?? "").trim();
    const maxResults = this.resolveMaxResults(args.max_results);
    const selects = args.select ?? [];

    const candidates = catalog.entries.filter(
      (e) =>
        !context.blockedToolNames?.has(e.name) &&
        (!context.allowedToolNames || context.allowedToolNames.has(e.name))
    );
    const candidateByName = new Map(candidates.map((c) => [c.name, c]));

    const selectedToolNames: string[] = [];
    const missingToolNames: string[] = [];

    // 1. Resolve exact selects first.
    for (const raw of selects) {
      const name = typeof raw === "string" ? raw : String(raw);
      if (!name) continue;
      if (candidateByName.has(name)) {
        if (!selectedToolNames.includes(name)) selectedToolNames.push(name);
      } else if (!missingToolNames.includes(name)) {
        missingToolNames.push(name);
      }
    }

    // 2. Rank query matches.
    let matches: ToolCatalogSearchMatch[] = [];
    if (query) {
      const { required, optional } = tokenizeQuery(query);
      const allTerms = [...required, ...optional];
      const scored: ScoredMatch[] = [];

      for (const entry of candidates) {
        const parts = tokenizeName(entry.name);
        const descWords = tokenizeText(
          entry.shortDescription || entry.description
        );

        // Required-term gate.
        if (
          required.length > 0 &&
          !required.every(
            (req) =>
              parts.includes(req) ||
              descWords.includes(req) ||
              partialNameMatch(parts, req)
          )
        ) {
          continue;
        }

        let score = 0;
        // Exact full-name match.
        if (query.toLowerCase() === entry.name.toLowerCase()) score += 100;

        for (const term of allTerms) {
          if (parts.includes(term)) score += 20;
          else if (partialNameMatch(parts, term)) score += 8;
          if (descWords.includes(term)) score += 5;
        }
        for (const req of required) {
          if (
            parts.includes(req) ||
            descWords.includes(req) ||
            partialNameMatch(parts, req)
          ) {
            score += 16;
          }
        }
        if (state.discoveredToolNames.has(entry.name)) score += 3;

        if (score > 0) {
          scored.push({
            name: entry.name,
            source: entry.source,
            description: entry.shortDescription,
            category: entry.category,
            score,
            alreadyExposed: isAlreadyExposed(entry, state),
            partsCount: parts.length,
          });
        }
      }

      // Sort: score desc, then fewer name parts (more concise match), then name.
      scored.sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : a.partsCount !== b.partsCount
          ? a.partsCount - b.partsCount
          : a.name.localeCompare(b.name)
      );

      const capped = scored.slice(0, maxResults);
      matches = capped.map(({ partsCount: _partsCount, ...rest }) => rest);
      for (const m of matches) {
        if (!selectedToolNames.includes(m.name)) selectedToolNames.push(m.name);
      }
    }

    return {
      success: true,
      query,
      matches,
      selectedToolNames,
      missingToolNames,
      message: buildMessage({ matches, selectedToolNames, selects, query }),
    };
  }

  private resolveMaxResults(raw: number | undefined): number {
    const max = TOOL_CATALOG_DEFAULTS.searchMaxResults;
    const def = TOOL_CATALOG_DEFAULTS.searchDefaultMaxResults;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return def;
    const n = Math.floor(raw);
    if (n < 1) return 1;
    if (n > max) return max;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Tokenizers + helpers
// ---------------------------------------------------------------------------

function tokenizeName(name: string): string[] {
  const withSpaces = name
    .replace(/__/g, " ")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return withSpaces
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0 && !/^\d+$/.test(t));
}

function tokenizeText(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2);
}

function tokenizeQuery(query: string): {
  required: string[];
  optional: string[];
} {
  const required: string[] = [];
  const optional: string[] = [];
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    const isRequired = raw.startsWith("+");
    const term = isRequired ? raw.slice(1) : raw;
    if (!term || seen.has(term)) continue;
    seen.add(term);
    if (isRequired) required.push(term);
    else optional.push(term);
  }
  return { required, optional };
}

function partialNameMatch(parts: string[], term: string): boolean {
  if (term.length < 3) return false;
  return parts.some((p) => p.includes(term));
}

function isAlreadyExposed(
  entry: { readonly name: string; readonly loadPolicy: string },
  state: ToolCatalogState
): boolean {
  return (
    state.discoveredToolNames.has(entry.name) || entry.loadPolicy !== "deferred"
  );
}

function buildMessage(input: {
  readonly matches: readonly ToolCatalogSearchMatch[];
  readonly selectedToolNames: readonly string[];
  readonly selects: readonly string[];
  readonly query: string;
}): string {
  const { matches, selectedToolNames, selects, query } = input;
  if (matches.length > 0) {
    return `Found ${matches.length} match(es). ${selectedToolNames.length} tool(s) will be loaded on the next round.`;
  }
  if (selectedToolNames.length > 0) {
    return `Selected ${selectedToolNames.length} tool(s) by name.`;
  }
  if (selects.length > 0) {
    return `None of the requested tools were found in the deferred catalog.`;
  }
  return query
    ? `No tools matched the query "${query}".`
    : `Provide a query or select tool names.`;
}
