import * as fs from "fs";
import * as path from "path";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { SkillWorkerClient } from "@/service/SkillWorkerClient";
import type {
  CallbackHookDefinition,
  HookInput,
  HookOutput,
} from "@/entityTypes/hookTypes";
import type { AdaptedPluginHookMatcher } from "@/service/pluginCompat/ClaudeHooksAdapter";
import { getPluginInstallRoot } from "@/service/pluginPaths";
import { log } from "@/modules/Logger";

/**
 * Registers Claude plugin hooks into AiFetchly's HookRegistry.
 *
 * Hook execution model (Phase 3, post-AC-7/17):
 *   - If matcher.scriptPath is set, dispatch into SkillWorker via
 *     SkillWorkerClient.executeHook(). Plugin authors ship a JS file
 *     whose default export is (input) => HookOutput.
 *   - If matcher.scriptPath is absent, the hook registers but its
 *     callback is a no-op (log + allow). This is the case for stock
 *     Claude plugins that only declare a shell `command` — we never
 *     auto-execute arbitrary shell from plugins.
 *
 * All execution happens in the SkillWorker process, never in main.
 *
 * Re-register is idempotent: existing plugin hooks with the same id are
 * replaced rather than duplicated.
 */

/** Stable id namespace; ensures re-registration replaces rather than duplicates. */
function buildHookId(pluginName: string, idx: number): string {
  return `plugin:${pluginName}:${idx}`;
}

function loadScriptContent(
  pluginName: string,
  scriptPath: string
): string | null {
  try {
    const abs = path.join(getPluginInstallRoot(pluginName), scriptPath);
    if (!fs.existsSync(abs)) {
      log.warn(
        `[plugin-hook] ${pluginName} script not found at ${scriptPath}; hook will no-op`
      );
      return null;
    }
    return fs.readFileSync(abs, "utf-8");
  } catch (e: unknown) {
    log.warn(
      `[plugin-hook] ${pluginName} failed to read script ${scriptPath}: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
    return null;
  }
}

/**
 * Build a CallbackHookDefinition from an adapted Claude matcher. When
 * scriptPath is set, the callback dispatches into SkillWorker.
 */
function buildCallbackHook(
  pluginName: string,
  matcher: AdaptedPluginHookMatcher,
  idx: number
): CallbackHookDefinition {
  const hookId = buildHookId(pluginName, idx);

  const callback = async (input: HookInput): Promise<HookOutput> => {
    if (!matcher.scriptPath) {
      // No script — Phase 3 no-op. Plugin's shell `command` is logged
      // for traceability but never executed (security policy).
      log.info(
        `[plugin-hook] ${pluginName} ${matcher.event} matched tool ` +
          `${matcher.matcher ?? "(any)"} — no script; allow ` +
          `(shell command was: ${matcher.sourceCommand})`
      );
      return {
        continue: true,
        permissionDecision: "allow",
        reason: "plugin hook has no sandboxed script; no-op",
      };
    }

    const script = loadScriptContent(pluginName, matcher.scriptPath);
    if (!script) {
      // Script declared but missing — fail-open with a warning. We do
      // NOT deny here because a missing script shouldn't break the
      // user's workflow; it should be visible in diagnostics.
      return {
        continue: true,
        permissionDecision: "allow",
        reason: `plugin hook script missing: ${matcher.scriptPath}`,
      };
    }

    try {
      // Dispatch into SkillWorker sandbox. This is what satisfies
      // AC-17 — the script runs in the worker process, not main.
      const worker = SkillWorkerClient.getInstance();
      const result = await worker.executeHook(script, input);
      return result;
    } catch (e: unknown) {
      log.error(
        `[plugin-hook] ${pluginName} script execution failed: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      // Hook execution errors are non-fatal (failureMode: "warn").
      // Fail-open to keep the user's tool call running.
      return {
        continue: true,
        permissionDecision: "allow",
        reason: `plugin hook execution error: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  };

  return {
    id: hookId,
    eventName: matcher.event,
    type: "callback",
    source: "plugin",
    enabled: true,
    trusted: false, // never trust plugin hooks implicitly
    matcher: matcher.matcher,
    failureMode: "warn", // hook errors don't block tool calls
    callback,
  };
}

export class PluginHookRegistrar {
  /**
   * Register all hooks declared by a single plugin. Idempotent per id.
   */
  static registerForPlugin(
    pluginName: string,
    matchers: readonly AdaptedPluginHookMatcher[]
  ): void {
    const registry = HookRegistry;
    matchers.forEach((matcher, idx) => {
      registry.registerBuiltinHook(buildCallbackHook(pluginName, matcher, idx));
    });
  }

  /**
   * Register hooks for all enabled plugins in a PluginLoadResult.
   */
  static registerFromLoadedPlugins(
    enabledPlugins: ReadonlyArray<{
      readonly name: string;
      readonly hooks: readonly AdaptedPluginHookMatcher[];
    }>
  ): void {
    for (const plugin of enabledPlugins) {
      if (plugin.hooks.length === 0) continue;
      PluginHookRegistrar.registerForPlugin(plugin.name, plugin.hooks);
    }
  }
}
