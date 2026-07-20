/**
 * AIAppNavigationMatcher.
 *
 * Deterministic lexical matcher that scores a natural-language query against
 * the route catalog and returns a navigate / clarify / not-found decision.
 * No LLM, no side effects. Behavior is deterministic for tests.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §9
 */
import type {
  AiNavigationCatalogEntry,
  OpenAppPageResult,
  AiNavigationMatchCandidate,
} from "@/entityTypes/aiAppNavigationTypes";

export interface NavigationMatcherOptions {
  /** Confidence at or above which a clearly-leading match auto-navigates. */
  readonly autoNavigateThreshold: number;
  /** Minimum confidence for a match to be considered (else not-found). */
  readonly clarificationThreshold: number;
  /** Required gap between the top and second match to auto-navigate. */
  readonly ambiguityDelta: number;
  /** Maximum clarification candidates returned. */
  readonly maxCandidates: number;
}

const DEFAULT_OPTIONS: NavigationMatcherOptions = {
  autoNavigateThreshold: 0.8,
  clarificationThreshold: 0.55,
  ambiguityDelta: 0.15,
  maxCandidates: 5,
};

/** Stop words removed from query tokens (NOT from phrase/exact matching). */
const NAVIGATION_STOP_WORDS: ReadonlySet<string> = new Set([
  "open",
  "go",
  "to",
  "navigate",
  "show",
  "view",
  "switch",
  "page",
  "screen",
  "list",
  "the",
  "a",
  "an",
  "i",
  "want",
  "need",
  "please",
]);

/**
 * Lowercase a string and collapse non-alphanumeric runs to single spaces.
 * Used for phrase/exact-alias matching (stop words are preserved here).
 */
function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Tokenize a string into lowercase words, splitting camelCase / PascalCase
 * and separator characters. Stop words are NOT removed here; callers remove
 * them for query tokens only.
 */
function tokenize(input: string): string[] {
  const camelSplit = input.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const spaced = camelSplit.replace(/[^a-zA-Z0-9]+/g, " ");
  return spaced.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Tokenize a query and remove navigation stop words. */
function queryTokenize(input: string): string[] {
  return tokenize(input).filter((token) => !NAVIGATION_STOP_WORDS.has(token));
}

/**
 * Weighted token overlap: fraction of query tokens present in the source
 * token set, scaled by `weight`.
 */
function weightedTokenOverlap(
  sourceTokens: readonly string[],
  queryTokens: readonly string[],
  weight: number
): number {
  if (sourceTokens.length === 0 || queryTokens.length === 0) return 0;
  const source = new Set(sourceTokens);
  const query = new Set(queryTokens);
  const matches = [...query].filter((token) => source.has(token)).length;
  return Math.min(1, matches / Math.max(1, query.size)) * weight;
}

/** Escape a string for safe inclusion in a RegExp. */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Score exact alias phrase containment: returns 1.0 if any alias appears as a
 * whole-word phrase within the normalized query, else 0. Stop words are kept
 * in the query for phrase matching (so "open email service" contains "email
 * service").
 */
function exactAliasScore(
  aliases: readonly string[],
  normalizedQuery: string
): number {
  if (aliases.length === 0 || normalizedQuery.length === 0) return 0;
  for (const alias of aliases) {
    const phrase = normalizePhrase(alias);
    if (phrase.length === 0) continue;
    const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`);
    if (re.test(normalizedQuery)) return 1.0;
  }
  return 0;
}

interface ScoredEntry {
  readonly entry: AiNavigationCatalogEntry;
  readonly confidence: number;
  readonly matchedSignals: readonly string[];
}

export class AIAppNavigationMatcher {
  match(
    query: string,
    catalog: readonly AiNavigationCatalogEntry[],
    options?: Partial<NavigationMatcherOptions>
  ): OpenAppPageResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const normalizedQuery = normalizePhrase(query ?? "");
    const queryTokens = queryTokenize(query ?? "");

    const scored: ScoredEntry[] = catalog.map((entry) => {
      const signals: { name: string; value: number }[] = [];

      const aliasTokens = entry.aliases.flatMap(tokenize);
      const labelTokens = tokenize(entry.label);
      const descriptionTokens = entry.description
        ? tokenize(entry.description)
        : [];
      const routeNameTokens = tokenize(entry.routeName);
      const pathTokens = tokenize(entry.fullPath);

      const exactAlias = exactAliasScore(entry.aliases, normalizedQuery);
      if (exactAlias > 0) signals.push({ name: "exact-alias", value: exactAlias });

      const aliasTok = weightedTokenOverlap(aliasTokens, queryTokens, 0.85);
      if (aliasTok > 0) signals.push({ name: "alias-tokens", value: aliasTok });

      const labelTok = weightedTokenOverlap(labelTokens, queryTokens, 0.75);
      if (labelTok > 0) signals.push({ name: "label-tokens", value: labelTok });

      const descTok = weightedTokenOverlap(
        descriptionTokens,
        queryTokens,
        0.55
      );
      if (descTok > 0)
        signals.push({ name: "description-tokens", value: descTok });

      const routeNameTok = weightedTokenOverlap(
        routeNameTokens,
        queryTokens,
        0.45
      );
      if (routeNameTok > 0)
        signals.push({ name: "route-name-tokens", value: routeNameTok });

      const pathTok = weightedTokenOverlap(pathTokens, queryTokens, 0.35);
      if (pathTok > 0) signals.push({ name: "path-tokens", value: pathTok });

      const base = Math.max(
        exactAlias,
        aliasTok,
        labelTok,
        descTok,
        routeNameTok,
        pathTok,
        0
      );

      let boosts = 0;
      const boostSignals: string[] = [];
      if (entry.visible) {
        boosts += 0.05;
        boostSignals.push("visible-boost");
      }
      if (entry.explicitlyIncluded) {
        boosts += 0.05;
        boostSignals.push("explicit-include-boost");
      }

      const confidence = Math.min(1, base + boosts);
      return {
        entry,
        confidence,
        matchedSignals: [...signals.map((s) => s.name), ...boostSignals],
      };
    });

    const sorted = scored.sort((a, b) => b.confidence - a.confidence);
    const top = sorted[0];
    const second = sorted[1];

    if (!top || top.confidence < opts.clarificationThreshold) {
      return {
        success: false,
        notFound: true,
        message: "No matching application page was found.",
      };
    }

    if (
      top.confidence >= opts.autoNavigateThreshold &&
      (!second || top.confidence - second.confidence >= opts.ambiguityDelta)
    ) {
      return {
        success: true,
        action: "navigate",
        routeName: top.entry.routeName,
        path: top.entry.fullPath,
        label: top.entry.label,
        confidence: top.confidence,
      };
    }

    const candidates: AiNavigationMatchCandidate[] = sorted
      .slice(0, opts.maxCandidates)
      .map((s) => ({
        routeName: s.entry.routeName,
        path: s.entry.fullPath,
        label: s.entry.label,
        confidence: s.confidence,
        matchedSignals: s.matchedSignals,
      }));

    return {
      success: false,
      needsClarification: true,
      message: "Several application pages match your request.",
      candidates,
    };
  }
}
