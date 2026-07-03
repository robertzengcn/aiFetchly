import type { PluginError } from "@/entityTypes/pluginTypes";

/**
 * Translates a Claude hooks.json file into AiFetchly's internal hook
 * matcher representation.
 *
 * Claude hooks.json shape:
 *   {
 *     "<EventName>": [
 *       {
 *         matcher?: string,           // tool-name pattern, undefined = match all
 *         hooks: [
 *           { type: "command", command: "<shell>" }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Phase 3 deliberate divergence (tech design §9.2): AiFetchly does NOT
 * shell-exec plugin hook commands. The translated matcher preserves the
 * source command for traceability but the actual hook action runs in the
 * SkillWorker sandbox. Wiring of that worker dispatch is a follow-up; this
 * adapter only does the parse + translate step.
 *
 * Supported events (Phase 3 allowlist):
 *   PreToolUse, PostToolUse, SessionStart, Stop
 *
 * Other events are parsed without error and recorded in `unsupported`
 * for diagnostic surfacing.
 */

export type SupportedHookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "Stop";

const SUPPORTED_EVENTS: ReadonlySet<SupportedHookEvent> = new Set([
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "Stop",
]);

export interface AdaptedPluginHookMatcher {
  /** Event name (always one of SUPPORTED_EVENTS). */
  readonly event: SupportedHookEvent;
  /** Tool-name matcher; undefined means match all tools. */
  readonly matcher?: string;
  /** Owning plugin name. */
  readonly pluginName: string;
  /**
   * The original Claude shell command. NOT executed directly — kept for
   * diagnostics and future SkillWorker dispatch wrapping.
   */
  readonly sourceCommand: string;
}

export interface ClaudeHooksAdaptSuccess {
  readonly ok: true;
  readonly matchers: readonly AdaptedPluginHookMatcher[];
  /** Event names the plugin declared that we don't yet dispatch. */
  readonly unsupported: readonly string[];
}

export interface ClaudeHooksAdaptFailure {
  readonly ok: false;
  readonly errors: readonly PluginError[];
}

export type ClaudeHooksAdaptResult =
  | ClaudeHooksAdaptSuccess
  | ClaudeHooksAdaptFailure;

interface ClaudeHookEntry {
  readonly type?: string;
  readonly command?: string;
}

interface ClaudeHookMatcherBlock {
  readonly matcher?: string;
  readonly hooks?: readonly ClaudeHookEntry[];
}

export class ClaudeHooksAdapter {
  static adapt(
    raw: unknown,
    pluginName: string
  ): ClaudeHooksAdaptResult {
    if (!raw || typeof raw !== "object") {
      return {
        ok: false,
        errors: [
          {
            code: "manifest-schema-invalid",
            message: "Claude hooks.json must be a JSON object.",
            recoverable: false,
          },
        ],
      };
    }

    const obj = raw as Record<string, unknown>;
    const matchers: AdaptedPluginHookMatcher[] = [];
    const unsupported: string[] = [];

    for (const [eventName, blocksRaw] of Object.entries(obj)) {
      if (!Array.isArray(blocksRaw)) continue;

      if (!SUPPORTED_EVENTS.has(eventName as SupportedHookEvent)) {
        unsupported.push(eventName);
        continue;
      }

      const event = eventName as SupportedHookEvent;
      for (const blockRaw of blocksRaw as unknown[]) {
        if (!blockRaw || typeof blockRaw !== "object") continue;
        const block = blockRaw as ClaudeHookMatcherBlock;
        const hooks = block.hooks;
        if (!Array.isArray(hooks)) continue;

        for (const hook of hooks) {
          // Only type: "command" is admitted in the Claude convention.
          // Other types (if any appear) are silently skipped.
          if (hook.type !== "command") continue;
          if (typeof hook.command !== "string") continue;
          matchers.push({
            event,
            matcher: typeof block.matcher === "string" ? block.matcher : undefined,
            pluginName,
            sourceCommand: hook.command,
          });
        }
      }
    }

    return { ok: true, matchers, unsupported };
  }
}
