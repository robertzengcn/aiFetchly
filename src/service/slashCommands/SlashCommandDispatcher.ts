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
// MUST NOT spawn anything. The dispatch path is pure logic + registry +
// manager calls + a pure string-only argument-token substitution
// (expandPrompt). Verified by a grep gate in the plan acceptance criteria
// (the forbidden literals do not appear anywhere in this file).
//
// Phase-15 boundary (TRS-06 / CMD-06): argument-token substitution NOW
// lives in the DISPATCHER for prompt-type commands (Plan 15-01, SC2).
// The substitution is text-only via expandPrompt (split-and-join); no
// dynamic code execution. The Phase-13 boundary marker is therefore
// CROSSED for the dispatcher only — the parser file SlashCommandParser.ts
// stays pure and free of the argument-token literal (region-scoped).

import type {
  SlashCommandDispatchRequest,
  SlashCommandDispatchResponse,
} from "@/entityTypes/slashCommandTypes";
import { parseSlashCommandInput } from "./SlashCommandParser";
import { CommandRegistry } from "./CommandRegistry";
import { expandPrompt } from "./expandPrompt";
import type {
  AIFetchlyConfigManager,
  AIFetchlyConfigReloadSummary,
  AIFetchlyConfigStatus,
} from "@/service/aifetchlyConfig/AIFetchlyConfigManager";

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
    private readonly manager: AIFetchlyConfigManager
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
    input: SlashCommandDispatchRequest
  ): Promise<SlashCommandDispatchResponse> {
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

    // Step 3: resolve via registry.
    const cmd = this.registry.getByName(parsed.name);
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
        return this.dispatchLocal(cmd.id, parsed.name);

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
    name: string
  ): Promise<SlashCommandDispatchResponse> {
    switch (commandId) {
      case "built-in:command:help":
        return {
          status: true,
          action: "show_result",
          commandId,
          content: this.renderHelp(),
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

      case "built-in:command:reload-config": {
        const summary = await this.manager.reload();
        return {
          status: true,
          action: "show_result",
          commandId,
          content: renderReload(summary),
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
   * Build the /help content. Lists every registered command with its
   * source label and description (renderer may render this richly later).
   */
  private renderHelp(): string {
    const views = this.registry.listViews();
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
