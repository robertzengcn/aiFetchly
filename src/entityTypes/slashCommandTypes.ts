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

// --- Dispatch request / response (Plan 03b) ---------------------------------

/**
 * Renderer->main request to dispatch a single composer submission.
 *
 * `rawInput` is the full composer text (e.g. "/status", "/review Acme").
 * The dispatcher parses it internally via {@link parseSlashCommandInput}
 * and resolves the name through the CommandRegistry.
 */
export interface SlashCommandDispatchRequest {
  readonly conversationId: string;
  readonly rawInput: string;
}

/**
 * Renderer-safe dispatch response. Discriminated union on `action`
 * (CMD-04 / CMD-08):
 *
 * Variants:
 *   - `submit_prompt`: the renderer submits the returned prompt via the
 *      EXISTING AI_CHAT_V2_STREAM channel (which gates USER_AI_ENABLED
 *      first — verified at ai-chat-v2-ipc.ts handleStream lines 385-393).
 *      This is TRS-05 Strategy A: no duplicate gate in the dispatcher.
 *   - `show_result`: built-in / local command result. The renderer renders
 *      the content directly (no AI call).
 *   - `{status:false, msg}`: unknown / disabled / invalid / boundary-case
 *      failure (CMD-08). The renderer surfaces the localized message.
 *
 * Phase-13 boundary: phase 13 only ships `local` built-ins, so the
 * `submit_prompt` branch is unreachable in production until phase 15
 * registers prompt commands. The variant still exists in the union so
 * the renderer can be written against the stable contract today.
 */
export type SlashCommandDispatchResponse =
  | {
      readonly status: true;
      readonly action: "submit_prompt";
      readonly prompt: string;
      readonly commandId: string;
    }
  | {
      readonly status: true;
      readonly action: "show_result";
      readonly content: string;
      readonly commandId: string;
    }
  | { readonly status: false; readonly msg: string };

/**
 * Renderer-facing list response. `commands` is already a renderer-safe
 * projection ({@link SlashCommandView} — body/metadata stripped per
 * design §5.5 / §14.2).
 *
 * Envelope mirrors the project's `CommonMessage<T>` shape so the renderer's
 * `windowInvoke` helper unwraps it consistently.
 */
export interface SlashCommandListResponse {
  readonly status: true;
  readonly commands: readonly SlashCommandView[];
  /** May be empty in phase 13 (no per-command diagnostics surfaced yet). */
  readonly diagnostics: readonly unknown[];
  readonly msg: string;
}

// --- Scoped command resolution (plugin/workspace slash commands) -------------

/**
 * Filter applied by {@link CommandRegistry} scoped accessors. A command is
 * "allowed" for a conversation when EITHER:
 *   - its `sourceId` is listed in {@link allowedExactSourceIds}, OR
 *   - it is a plugin command (`source === "plugin"`) and
 *     {@link allowPluginSources} is true.
 *
 * {@link allowedExactSourceIds} always includes {@link BUILTIN_SOURCE} and
 * {@link USER_SOURCE}; it additionally includes exactly one
 * `workspace:<workspaceId>` when the conversation has an approved workspace.
 *
 * Why plugins use a predicate instead of enumerated ids: the installed plugin
 * set is dynamic and already represented in the registry. Filtering by
 * `source === "plugin"` avoids rebuilding scopes whenever plugins are
 * installed/disabled/uninstalled (design §4.1).
 *
 * This is the canonical scope shape consumed by the registry AND produced by
 * the scope resolver — one source of truth.
 */
export interface CommandRegistryScope {
  readonly allowedExactSourceIds: ReadonlySet<string>;
  readonly allowPluginSources: boolean;
}

/**
 * Per-dispatch context handed to {@link SlashCommandDispatcher.dispatch}.
 * Carries the {@link CommandRegistryScope} so dispatch resolves names against
 * exactly the same scoped set the list API exposes (FR-2: suggestions and
 * dispatch MUST agree on the winning command).
 *
 * Optional on the dispatcher signature: when omitted, the dispatcher uses a
 * safe non-workspace default so a forgotten context can never leak a
 * workspace command. Production paths always pass a resolver-produced scope.
 */
export interface SlashCommandDispatchContext {
  readonly scope: CommandRegistryScope;
}
