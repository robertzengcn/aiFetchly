// src/service/slashCommands/SlashCommandDispatcher.ts
// CMD-04 + CMD-08 + DX-02 — compose the parser + registry + config manager
// to resolve raw composer input into a {@link SlashCommandDispatchResponse}.
//
// Algorithm:
//   1. parseSlashCommandInput(rawInput) classifies the text.
//   2. Non-slash / bare-slash / unknown-name / disabled -> {status:false,msg}.
//   3. Built-in (type "local") -> switch on cmd.id, return show_result.
//   4. Prompt (phase 15) -> expandPrompt(body, args) -> submit_prompt.
//   5. Skill (phase 18) -> not-yet-supported.
//
// SECURITY (TRS-06): this file MUST NOT import any process-spawning
// module, MUST NOT call eval-like or dynamic-function constructors, and
// MUST NOT spawn anything. Prompt expansion remains pure string-only via
// expandPrompt. Side-effectful plugin management is delegated lazily to
// PluginSlashCommandService, which keeps install/fetch dependencies out of
// the normal slash-command dispatch path.
//
// Phase-15 boundary (TRS-06 / CMD-06): argument-token substitution NOW
// lives in the DISPATCHER for prompt-type commands (Plan 15-01, SC2).
// The substitution is text-only via expandPrompt (split-and-join); no
// dynamic code execution. The Phase-13 boundary marker is therefore
// CROSSED for the dispatcher only — the parser file SlashCommandParser.ts
// stays pure and free of the argument-token literal (region-scoped).

import type {
  CommandRegistryScope,
  SlashCommandDispatchContext,
  SlashCommandDispatchRequest,
  SlashCommandDispatchResponse,
} from "@/entityTypes/slashCommandTypes";
import { parseSlashCommandInput } from "./SlashCommandParser";
import {
  CommandRegistry,
  DEFAULT_NON_WORKSPACE_SCOPE,
} from "./CommandRegistry";
import { expandPrompt } from "./expandPrompt";
import type {
  AIFetchlyConfigManager,
  AIFetchlyConfigReloadSummary,
  AIFetchlyConfigStatus,
} from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import {
  GOAL_LOOP_MAX_ITERATIONS,
  GOAL_LOOP_MIN_ITERATIONS,
} from "@/config/aiChatGoalConfig";

export interface PluginSlashCommandExecutor {
  execute(rawArgs: string | undefined): Promise<string>;
}

export interface SkillsSlashCommandProvider {
  render(): Promise<string>;
}

/**
 * SlashCommandDispatcher — resolves raw composer text into the
 * discriminated-union dispatch response (CMD-04).
 *
 * Constructor takes the same CommandRegistry the AIFetchlyConfigManager
 * populates (so /status reflects the same commands the user sees) plus
 * the manager itself (for /status counts + /reload-config triggering).
 */
export class SlashCommandDispatcher {
  constructor(
    private readonly registry: CommandRegistry,
    private readonly manager: AIFetchlyConfigManager,
    private readonly pluginCommands?: PluginSlashCommandExecutor,
    private readonly skillsProvider?: SkillsSlashCommandProvider
  ) {}

  /**
   * Resolve `input.rawInput` into a {@link SlashCommandDispatchResponse}.
   *
   * Never throws — all branches return a response variant. Renderer-side
   * localizes the failure messages via the `slashCommands` i18n group;
   * this layer returns English literals for simplicity (Plan 05 / 04
   * handle UI localization, per design §15.3).
   */
  async dispatch(
    input: SlashCommandDispatchRequest,
    context?: SlashCommandDispatchContext
  ): Promise<SlashCommandDispatchResponse> {
    // Scoped resolution (plugin/workspace slash commands, FR-2): the context
    // carries the allowed-source set derived from the conversation's approved
    // workspace. When omitted (e.g. legacy callers / unit tests), fall back to
    // the safe non-workspace scope so a forgotten context can never leak a
    // workspace command into the wrong chat.
    const scope = context?.scope ?? DEFAULT_NON_WORKSPACE_SCOPE;
    const parsed = parseSlashCommandInput(input.rawInput);

    // Step 1: not a slash command at all.
    if (!parsed.isCommand) {
      return {
        status: false,
        msg: "Input is not a slash command. Type / to see available commands.",
      };
    }

    // Step 2: bare "/" — suggest-only, nothing to dispatch.
    if (!parsed.name) {
      return {
        status: false,
        msg: "Type a command name after / to dispatch. Use /help to list commands.",
      };
    }

    // Step 3: resolve via registry (scoped + alias-aware). A workspace command
    // hidden from this conversation's scope is unreachable here, so it cannot
    // be dispatched by manually typing its name from the wrong chat (AC-2).
    const cmd = this.registry.getByLookupNameScoped(parsed.name, scope);
    if (!cmd) {
      return {
        status: false,
        msg: `Unknown slash command: /${parsed.name}`,
      };
    }

    // Step 4: disabled commands surface a trust/disabled hint (CMD-08).
    if (!cmd.enabled) {
      return {
        status: false,
        msg: `Slash command /${parsed.name} is disabled.`,
      };
    }

    // Step 5: switch on functional type.
    switch (cmd.type) {
      case "local":
        return this.dispatchLocal(cmd.id, parsed.name, scope, parsed.args);

      case "prompt": {
        // Phase-15 (Plan 15-01, SC2 + CMD-04): prompt-type commands now
        // expand their body via expandPrompt and return a submit_prompt
        // response. The renderer submits the returned prompt through the
        // existing AI_CHAT_V2_STREAM IPC which gates USER_AI_ENABLED
        // (TRS-05 Strategy A — verified, no duplicate gate here).
        //
        // cmd.body is defensively coerced to "" when undefined: the CMD-06
        // frontmatter validator (promptCommandFrontmatter.ts) rejects empty
        // bodies, but a defensively-registered prompt command (e.g. a
        // future code path that bypasses validation) must not crash the
        // dispatch with a TypeError. parsed.args is undefined when the
        // user supplied no args; expandPrompt treats it as the empty
        // string per its (string, string) contract.
        const rendered = expandPrompt(cmd.body ?? "", parsed.args ?? "");
        return {
          status: true,
          action: "submit_prompt",
          prompt: rendered,
          commandId: cmd.id,
        };
      }

      case "skill":
        // Phase 18 — SkillRegistry integration.
        return {
          status: false,
          msg: `Skill commands are not yet supported. Command /${parsed.name} will be available in a future release.`,
        };

      // Exhaustiveness guard — if a new SlashCommandType is added without
      // a dispatcher branch, TypeScript errors here.
      default: {
        const _exhaustive: never = cmd.type;
        void _exhaustive;
        return {
          status: false,
          msg: `Unsupported command type for /${parsed.name}.`,
        };
      }
    }
  }

  /**
   * Built-in (type "local") dispatch. Switches on the stable command id
   * and returns the formatted {@link SlashCommandDispatchResponse} with
   * `action: "show_result"`.
   */
  private async dispatchLocal(
    commandId: string,
    name: string,
    scope: CommandRegistryScope,
    rawArgs: string | undefined
  ): Promise<SlashCommandDispatchResponse> {
    switch (commandId) {
      case "built-in:command:help":
        return {
          status: true,
          action: "show_result",
          commandId,
          content: this.renderHelp(scope),
        };

      case "built-in:command:clear":
        return {
          status: true,
          action: "show_result",
          commandId,
          content:
            "Clear the current conversation. The renderer invokes the existing AI_CHAT_V2_CLEAR_CONVERSATION channel; phase 13 adds no new clear logic.",
        };

      case "built-in:command:status": {
        const s = this.manager.getStatus();
        return {
          status: true,
          action: "show_result",
          commandId,
          content: renderStatus(s),
        };
      }

      case "built-in:command:skills": {
        const provider =
          this.skillsProvider ?? (await createSkillsCommandProvider());
        return {
          status: true,
          action: "show_result",
          commandId,
          content: await provider.render(),
        };
      }

      case "built-in:command:goal":
        return {
          status: true,
          action: "show_result",
          commandId,
          content:
            "Create or replace the active AI Chat goal. Usage: /goal <objective>",
        };

      case "built-in:command:loop":
        return {
          status: true,
          action: "show_result",
          commandId,
          content: `Continue the active AI Chat goal. Usage: /loop <maxIterations> where maxIterations is ${GOAL_LOOP_MIN_ITERATIONS}-${GOAL_LOOP_MAX_ITERATIONS}.`,
        };

      case "built-in:command:agents": {
        // Phase 16 / Plan 03 (D-AgentsList) — list built-in + dynamic agents
        // sourced from agentRegistry.list() (already sorted by D-Precedence:
        // built-in -> user -> workspace -> plugin). Returns a computed
        // string only — no agent file bytes cross to the renderer (TRS-07).
        // Non-AI-gated: this branch runs under the existing
        // SLASH_COMMAND_DISPATCH registerValidatedHandler path (TRS-05 A).
        const agents = this.manager.getAgentRegistry().list();
        return {
          status: true,
          action: "show_result",
          commandId,
          content: renderAgentsList(agents),
        };
      }

      case "built-in:command:reload-config": {
        const summary = await this.manager.reload();
        return {
          status: true,
          action: "show_result",
          commandId,
          content: renderReload(summary),
        };
      }

      case "built-in:command:plugin": {
        const service = this.pluginCommands ?? (await createPluginCommands());
        const content = await service.execute(rawArgs);
        return {
          status: true,
          action: "show_result",
          commandId,
          content,
        };
      }

      default:
        // A local command reached the dispatcher without a matching
        // branch. Fail closed rather than silently dropping the input.
        return {
          status: false,
          msg: `Built-in command /${name} is registered but has no handler. This is a bug — please report it.`,
        };
    }
  }

  /**
   * Build the /help content. Lists every command allowed under `scope` (so
   * workspace commands only appear inside their owning conversation) with its
   * source label and description (renderer may render this richly later).
   */
  private renderHelp(scope: CommandRegistryScope): string {
    const views = this.registry.listScopedViews(scope);
    if (views.length === 0) {
      return "Available commands: (none registered).";
    }
    const lines = views.map(
      (v) =>
        `/${v.name} — ${v.description} [${v.sourceLabel}]${
          v.enabled ? "" : " (disabled)"
        }`
    );
    return "Available commands:\n" + lines.join("\n");
  }
}

async function createPluginCommands(): Promise<PluginSlashCommandExecutor> {
  const { PluginSlashCommandService } = await import(
    "./PluginSlashCommandService"
  );
  return new PluginSlashCommandService();
}

async function createSkillsCommandProvider(): Promise<SkillsSlashCommandProvider> {
  const [
    { SkillRegistry },
    { formatSkillsAsChatMarkdown },
    { formatToolCatalogBreakdown },
  ] = await Promise.all([
    import("@/config/skillsRegistry"),
    import("@/api/aiChatApi"),
    import("@/service/ToolCatalogDiagnostics"),
  ]);
  return {
    async render(): Promise<string> {
      const allTools = await SkillRegistry.getAllToolFunctions();
      const listing = formatSkillsAsChatMarkdown(allTools);
      const breakdown = formatToolCatalogBreakdown(allTools);
      return `${listing}\n\n${breakdown}`;
    },
  };
}

/**
 * Render the /status content (DX-02). Includes command/diagnostic counts,
 * last reload timestamp, and the phase-14 watcher placeholder.
 *
 * The internal watcherState enum is hyphenated (`"not-started"`); convert
 * to a human-readable form with a space for display.
 */
function renderStatus(s: AIFetchlyConfigStatus): string {
  const lastReload =
    s.lastReloadAt > 0 ? new Date(s.lastReloadAt).toISOString() : "never";
  const watcher = s.watcherState.replace("-", " ");
  return [
    "AiFetchly configuration status:",
    `Commands: ${s.commandCount}`,
    `Agents: ${s.agentCount} (phase 16)`,
    `Hooks: ${s.hookCount} (phase 17)`,
    `Skills: ${s.skillCount} (phase 18)`,
    `Diagnostics: ${s.diagnosticCount}`,
    `Last reload: ${lastReload}`,
    `Watcher: ${watcher} (phase 14)`,
  ].join("\n");
}

/**
 * Render the /reload-config content (DX-02 + success criterion 3).
 */
function renderReload(r: AIFetchlyConfigReloadSummary): string {
  return [
    "Reloaded AiFetchly config:",
    `Commands: ${r.commandCount}`,
    `Diagnostics: ${r.diagnosticCount}`,
    `Instructions changed: ${r.instructionsChanged ? "yes" : "no"}`,
  ].join("\n");
}

/**
 * Phase 16 / Plan 03 — derive the rendered badge from the registry metadata.
 * Plugin agents imported from Claude plugins use IDs such as
 * "<plugin>:<agent>" for persisted compatibility, so source inference must not
 * depend only on the old scoped-ID convention.
 */
function agentSourceBadgeLabel(agent: AgentDefinitionView): string {
  // Badge labels mirror the Phase 13 slashCommands i18n source-label keys
  // (sourceBuiltin/sourceUser/sourceWorkspace/sourcePlugin). The dispatcher
  // returns English literals for simplicity (design §15.3; same convention
  // as renderHelp/renderStatus) — no new badge strings are introduced.
  switch (agent.source) {
    case "user":
      return "User";
    case "workspace":
      return "Workspace";
    case "plugin":
      return "Plugin";
    case "built-in":
      return "Built-in";
    default:
      return "Built-in";
  }
}

/**
 * Render the /agents content (D-AgentsList). The input MUST be already sorted
 * by D-Precedence (built-in -> user -> workspace -> plugin), which
 * {@link AgentDefinitionRegistryImpl.list} guarantees. Each row formats as
 * "<id> — <name>: <description> [<source badge>]" so the model can copy the
 * exact id into run_subagent (ties to D-AgentIDs). An empty list yields a
 * stable no-agents message and NEVER throws.
 */
function renderAgentsList(agents: readonly AgentDefinitionView[]): string {
  if (agents.length === 0) {
    return "No agents registered. Add ~/.aifetchly/agents/<name>.md to define one.";
  }
  const lines = agents.map(
    (a) =>
      `${a.id} — ${a.name}: ${a.description} [${agentSourceBadgeLabel(a)}]`
  );
  return "Available agents:\n" + lines.join("\n");
}
