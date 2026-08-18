// src/service/slashCommands/builtinSlashCommands.ts
// CMD-03 — register the built-in slash commands.
//
// Built-ins are always-on (requiresTrust=false, enabled=true), source
// "built-in", type "local" (no AI call — main process returns text).
// They cannot be shadowed by user/workspace/plugin commands of the same
// name thanks to the SOURCE_RANK lookup order in CommandRegistry
// (CMD-01).
//
// See docs/prd/aifetchly-local-extensibility-technical-design.md §7.2, §11.4.

import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import { CommandRegistry } from "./CommandRegistry";

/**
 * Built-in slash commands (design §7.2, §11.4).
 *
 * `local` type means the dispatcher handles them in-process and returns
 * a `show_result` discriminated-union variant — no AI call, no AI-enable
 * gate required (TRS-05 matrix).
 *
 * NOTE (TRS-06 / CMD-06): no `$ARGUMENTS` substitution is performed by
 * any phase-13 built-in. Phase 15 introduces prompt-type commands with
 * argument-token expansion — see SlashCommandDispatcher.ts for the
 * phase-15 boundary marker.
 */
const BUILT_IN_COMMANDS: readonly SlashCommandDefinition[] = Object.freeze([
  {
    id: "built-in:command:help",
    name: "help",
    description: "List available slash commands and their sources.",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    requiresTrust: false,
    enabled: true,
  },
  {
    id: "built-in:command:clear",
    name: "clear",
    description: "Clear the current conversation.",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    requiresTrust: false,
    enabled: true,
  },
  {
    id: "built-in:command:status",
    name: "status",
    description:
      "Show AiFetchly configuration status, counts, and diagnostics.",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    requiresTrust: false,
    enabled: true,
  },
  {
    id: "built-in:command:skills",
    name: "skills",
    description: "List currently available AI skills/tools in this system.",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    requiresTrust: false,
    enabled: true,
  },
  {
    id: "built-in:command:goal",
    name: "goal",
    description:
      "Create or replace the active AI Chat goal and enter Plan Mode.",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    argumentHint: "<objective>",
    requiresTrust: false,
    enabled: true,
  },
  {
    id: "built-in:command:loop",
    name: "loop",
    description:
      "Continue the active AI Chat goal for a bounded number of iterations.",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    argumentHint: "<maxIterations>",
    requiresTrust: false,
    enabled: true,
  },
  {
    id: "built-in:command:reload-config",
    name: "reload-config",
    description: "Rescan ~/.aifetchly and reload configuration.",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    requiresTrust: false,
    enabled: true,
  },
  {
    // Phase 16 / Plan 03 — /agents lists built-in + dynamic agents (AGT-03,
    // D-AgentsList). Non-AI-gated local command: the dispatcher returns a
    // computed show_result string sourced from agentRegistry.list(); no AI
    // call, no AI-gated handler registration (TRS-05 Strategy A — the grep
    // boundary test in SlashCommandDispatcher.test.ts asserts the absence of
    // the AI-gate registrar symbol in this file).
    id: "built-in:command:agents",
    name: "agents",
    description: "List available AiFetchly agents (built-in and dynamic).",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    requiresTrust: false,
    enabled: true,
  },
  {
    id: "built-in:command:plugin",
    name: "plugin",
    description:
      "Manage plugin marketplaces and install plugins from chat.",
    aliases: [],
    type: "local",
    source: "built-in",
    sourceId: "built-in",
    sourceLabel: "Built-in",
    argumentHint:
      "marketplace add <source> | install <plugin@marketplace|source>",
    requiresTrust: false,
    enabled: true,
  },
]);

/**
 * Register the built-in slash commands on the given
 * registry. Idempotent — the registry's id-based replace semantics mean
 * re-registering the same ids does not duplicate entries.
 *
 * Called once at startup from `registerSlashCommandHandlers` in the IPC
 * layer so this file owns all built-in command setup.
 */
export function registerBuiltInSlashCommands(registry: CommandRegistry): void {
  for (const cmd of BUILT_IN_COMMANDS) {
    registry.register(cmd);
  }
}
