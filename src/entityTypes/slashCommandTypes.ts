// src/entityTypes/slashCommandTypes.ts
// Shared type definitions for the slash command subsystem.
// Pure types module — NO Electron / TypeORM / Vue / service imports.
// See docs/prd/aifetchly-local-extensibility-technical-design.md §5.5, §11.

/**
 * Where a slash command came from. Drives the lookup order in
 * {@link CommandRegistry} (CMD-01): built-in > workspace > user > plugin.
 */
export type SlashCommandSource = "built-in" | "user" | "workspace" | "plugin";

/**
 * Functional category of a slash command.
 * - "prompt": text-expansion into a chat prompt (phase 15+).
 * - "local":  main-process returns a result, no AI call (phase 13 built-ins).
 * - "skill":  invokes a registered Skill (phase 18).
 */
export type SlashCommandType = "prompt" | "local" | "skill";

/** sourceId for the always-on built-in source. */
export const BUILTIN_SOURCE = "built-in";
/** sourceId for the user-owned (~/.aifetchly) source. */
export const USER_SOURCE = "user";

/**
 * Full slash command definition, stored in the registry.
 *
 * ID format conventions (design §5.5):
 *   - built-in:  "built-in:command:<name>"
 *   - user:      "user:command:<name>"
 *   - workspace: "workspace:<workspaceId>:command:<name>"
 *   - plugin:    "plugin:<pluginName>:command:<name>"
 *
 * The {@link SlashCommandDefinition.body} field carries the raw prompt text
 * and MUST NOT be sent to the renderer — use {@link SlashCommandView} for
 * renderer-safe projections (design §5.5, §14.2 — TRS-07 / T-13-Leak).
 */
export interface SlashCommandDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Read-only alias list. The registry does not mutate caller arrays. */
  readonly aliases: readonly string[];
  readonly type: SlashCommandType;
  readonly source: SlashCommandSource;
  readonly sourceId: string;
  readonly sourceLabel: string;
  /** Optional composer hint, e.g. "<query>" or "[file]". */
  readonly argumentHint?: string;
  /** Workspace-sourced commands require explicit trust (phase 14+). */
  readonly requiresTrust: boolean;
  readonly enabled: boolean;
  /** Raw prompt body — main-process only. Never serialize to renderer. */
  readonly body?: string;
  /** Arbitrary structured metadata — main-process only. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Renderer-safe projection of a slash command. Omits the raw prompt body
 * and arbitrary metadata to prevent raw prompt leakage to the renderer
 * (design §5.5, §14.2 — TRS-07 / T-13-Leak mitigation).
 */
export interface SlashCommandView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly source: SlashCommandSource;
  readonly sourceLabel: string;
  readonly argumentHint?: string;
  readonly enabled: boolean;
  /** Optional reason a command is disabled, for surfacing in the UI. */
  readonly disabledReason?: string;
}

/**
 * Result of classifying raw composer text. Used by both the parser
 * (SlashCommandParser.ts) and the dispatcher (Plan 03).
 *
 * Semantics:
 *   - `isCommand === false`: input is not a slash command at all
 *     (empty, doesn't start with `/`, or starts with `//`).
 *   - `isCommand === true && name == null`: suggest-only (bare `/`).
 *     The dispatcher treats this as a no-op trigger for the suggestions
 *     dropdown, never as dispatchable input.
 *   - `isCommand === true && name != null`: parsed command; the dispatcher
 *     resolves it via the registry and returns not-found for unknown names
 *     (CMD-08).
 *
 * NOTE (TRS-06): The parser performs NO `$ARGUMENTS` substitution — that is
 * CMD-06 / phase 15. Phase 13 built-ins take no arguments.
 */
export interface ParsedSlashCommandInput {
  readonly isCommand: boolean;
  readonly name?: string;
  readonly args?: string;
  readonly raw: string;
}
