import { HOOK_LIMITS } from "@/entityTypes/hookTypes";

/**
 * Glob-lite matcher for hook tool events.
 *
 * Supported syntax:
 * - `undefined` or `*`     → match all
 * - exact                  → `shell_execute`
 * - suffix wildcard        → `mcp_*`
 * - prefix wildcard        → `*_search`
 * - contains wildcard      → `scrape_*_urls`
 *
 * No regex support in MVP. Regex matchers create a DoS surface and
 * complicate UI validation. See PRD §Matcher Semantics.
 */

const MAX_MATCHER_CHARS = HOOK_LIMITS.maxMatcherChars;

/** Escape regex metacharacters except `*`. */
function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a glob-lite matcher into an anchored regex source. */
function matcherToRegexSource(matcher: string): string {
  return "^" + escapeRegex(matcher).replace(/\*/g, ".*") + "$";
}

/**
 * Returns true when `query` matches `matcher`.
 *
 * Oversized matchers (over HOOK_LIMITS.maxMatcherChars) never match —
 * they are treated as malformed and ignored rather than dropped silently
 * at registration time. The registry still admits them so that future
 * trust UI can flag them.
 */
export function matchesHookMatcher(
  matcher: string | undefined,
  query: string
): boolean {
  if (matcher === undefined || matcher === "*") {
    return true;
  }
  if (matcher.length === 0 || matcher.length > MAX_MATCHER_CHARS) {
    return false;
  }
  const source = matcherToRegexSource(matcher);
  const re = new RegExp(source);
  return re.test(query);
}
