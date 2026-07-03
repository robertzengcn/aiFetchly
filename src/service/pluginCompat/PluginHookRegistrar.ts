import { HookRegistry } from "@/service/hooks/HookRegistry";
import type {
  CallbackHookDefinition,
  HookInput,
  HookOutput,
} from "@/entityTypes/hookTypes";
import type { AdaptedPluginHookMatcher } from "@/service/pluginCompat/ClaudeHooksAdapter";
import { log } from "@/modules/Logger";

/**
 * Registers Claude plugin hooks into AiFetchly's HookRegistry.
 *
 * Phase 3 plumbing: hooks register and match correctly, but the callback
 * action is currently a no-op (log + allow). Actual hook execution —
 * wrapping the sourceCommand in a synthetic skill that runs in the
 * SkillWorker sandbox — is a follow-up that requires a new worker IPC
 * message type. See tech design §9.4.
 *
 * Re-register is idempotent: existing plugin hooks with the same id are
 * replaced rather than duplicated.
 */

/** Stable id namespace; ensures re-registration replaces rather than duplicates. */
function buildHookId(pluginName: string, idx: number): string {
  return `plugin:${pluginName}:${idx}`;
}

/**
 * Build a CallbackHookDefinition from an adapted Claude matcher. The
 * callback is the Phase 3 no-op placeholder.
 */
function buildCallbackHook(
  pluginName: string,
  matcher: AdaptedPluginHookMatcher,
  idx: number
): CallbackHookDefinition {
  const hookId = buildHookId(pluginName, idx);
  const callback = async (_input: HookInput): Promise<HookOutput> => {
    // Phase 3 placeholder: log and allow. Real dispatch (SkillWorker
    // executing a synthetic skill wrapping sourceCommand) is a follow-up.
    log.info(
      `[plugin-hook] ${pluginName} ${matcher.event} matched tool ` +
        `${matcher.matcher ?? "(any)"} — Phase 3 placeholder allow ` +
        `(would have run: ${matcher.sourceCommand})`
    );
    return {
      continue: true,
      permissionDecision: "allow",
      reason: "plugin hook Phase 3 placeholder (no action)",
    };
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
   * Callers should invoke this from the loader path after
   * PluginLoaderService has produced LoadedPlugin.hooks.
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
   * Register hooks for all enabled plugins in a PluginLoadResult. Should
   * be called whenever plugins are (re)loaded.
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
