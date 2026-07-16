/**
 * availableAgentsBlock — D-Discovery pure assembler (Plan 16-03 Task 3).
 *
 * Formats the "Available agents" system-message block consumed by
 * {@link AIChatContextAssembler.assemble}. The block lets the model discover
 * dispatchable agents (built-in + dynamic) and copy the EXACT scoped id into
 * the run_subagent tool (ties to D-AgentIDs: bare built-in agent-* or scoped
 * dynamic user:agent:* / workspace:*:agent:*).
 *
 * Pure leaf — no filesystem, Electron-store, or ORM imports. The input
 * is the live {@link AgentDefinitionRegistryImpl.list} output (already sorted
 * by D-Precedence: built-in -> user -> workspace -> plugin), so the caller
 * renders rows in precedence order without re-sorting here.
 *
 * Design references: .planning/phases/16-dynamic-agents/16-CONTEXT.md
 * (D-Discovery); mirrors the slash-suggestions metadata shape so a row is a
 * direct copy-paste source for run_subagent.
 */

import type { AgentDefinitionView } from "@/entityTypes/agentTypes";

/**
 * Header prefix for the block. Stable so callers (tests / future telemetry)
 * can locate the injected system message via {@link String.startsWith}.
 */
export const AVAILABLE_AGENTS_BLOCK_PREFIX = "Available AiFetchly agents";

/**
 * Derive the human-readable source badge from a scoped agent id. Mirrors the
 * {@link SlashCommandDispatcher}'s private agentSourceBadgeLabel helper
 * (Plan 16-03 Task 2) — duplicated as a small, stable, pure derivation rather
 * than coupling this pure leaf to the slash-command dispatcher. Scoped-ID
 * convention comes from Plan 01:
 *   - "user:agent:<name>"                    -> "User"
 *   - "workspace:<workspaceId>:agent:<name>" -> "Workspace"
 *   - "plugin:<pluginName>:agent:<name>"     -> "Plugin"
 *   - anything else (bare "agent-*")         -> "Built-in"
 *
 * AgentDefinitionView intentionally carries no source field (Plan 01 decision
 * — parallel idToSource map keeps the DTO unchanged), so the source is derived
 * from the id prefix.
 */
export function agentSourceBadgeFromId(id: string): string {
  if (id.startsWith("user:agent:")) return "User";
  if (id.startsWith("workspace:") && id.includes(":agent:")) return "Workspace";
  if (id.startsWith("plugin:") && id.includes(":agent:")) return "Plugin";
  return "Built-in";
}

/**
 * Build the "Available agents" system-message block (D-Discovery).
 *
 * Output shape (one row per agent, precedence-ordered by the caller):
 *
 *   Available AiFetchly agents (copy the ID into run_subagent):
 *   <id> — <description> [<source>]
 *   ...
 *
 * An empty input returns an empty string — the caller decides whether to push
 * the message (it must NOT push an empty block). Never throws.
 *
 * @param agents the registry's live list (defensive copies; already sorted by
 *   D-Precedence). Treated as read-only.
 * @returns the formatted block, or "" when there are zero agents.
 */
export function buildAvailableAgentsBlock(
  agents: readonly AgentDefinitionView[]
): string {
  if (agents.length === 0) return "";
  const rows = agents.map(
    (a) => `${a.id} — ${a.description} [${agentSourceBadgeFromId(a.id)}]`
  );
  return (
    `${AVAILABLE_AGENTS_BLOCK_PREFIX} (copy the ID into run_subagent):\n` +
    rows.join("\n")
  );
}
