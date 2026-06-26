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
  if (
    name === "search_maps_businesses" ||
    name === "extract_contact_info"
  ) {
    return "browser";
  }
  if (
    name === "analyze_website" ||
    name === "search_yellow_pages"
  ) {
    return "network";
  }
  return "fast";
}
