/**
 * Per-tool-class timeout policy for ai-chat-v2 tool calls.
 *
 * Replaces the single global CHAT_V2_TOOL_TIMEOUT_MS with a class table
 * so that browser-automation tools (search_maps_businesses, extract_contact_info)
 * get a longer ceiling than fast file tools.
 *
 * See docs/superpowers/specs/2026-06-25-ai-tool-timeout-resilience-prd.md
 */

export type ToolTimeoutClass = "fast" | "network" | "browser" | "async";

export interface ToolTimeoutPolicyConfig {
  readonly fast: number;
  readonly network: number;
  readonly browser: number;
}

export const TOOL_TIMEOUT_POLICY: ToolTimeoutPolicyConfig = {
  fast: 30_000,
  network: 90_000,
  browser: 240_000,
};

/**
 * Resolve a timeout class to its millisecond ceiling.
 * Returns null for "async" because async tools have no synchronous ceiling.
 */
export function resolveTimeoutMs(
  cls: ToolTimeoutClass,
  policy: ToolTimeoutPolicyConfig = TOOL_TIMEOUT_POLICY
): number | null {
  if (cls === "async") return null;
  return policy[cls];
}

/**
 * Fallback classifier used when a skill does not declare its timeoutClass.
 * Lets the registry migrate incrementally.
 *
 * The default for unrecognized tool names is "network" (90s), NOT "fast".
 * Rationale: every tier:"main" tool that reached production without an
 * explicit annotation has historically been an I/O tool (search engines,
 * subagents, MCP calls). Defaulting unknown tools to "fast" (30s) caused
 * silent 30s timeouts on `run_subagent` and `scrape_urls_from_search_engine`
 * before they were annotated. A 90s ceiling is safe for any plausible
 * main-tier tool and gives developers time to notice the missing annotation
 * and add an explicit one. Pure/fast tools (file_*, glob_files, grep_files,
 * read_url_content) are still matched explicitly above so they keep failing
 * fast when they hang.
 */
export function inferTimeoutClassByName(name: string): ToolTimeoutClass {
  if (
    name.startsWith("file_") ||
    name === "glob_files" ||
    name === "grep_files" ||
    name === "read_url_content"
  ) {
    return "fast";
  }
  if (name === "search_maps_businesses" || name === "extract_contact_info") {
    return "browser";
  }
  if (name === "analyze_website" || name === "search_yellow_pages") {
    return "network";
  }
  return "network";
}
