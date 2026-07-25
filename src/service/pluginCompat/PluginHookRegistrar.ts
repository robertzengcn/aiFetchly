import * as fs from "fs";
import * as path from "path";
import { spawn } from "node:child_process";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { SkillWorkerClient } from "@/service/SkillWorkerClient";
import type {
  CallbackHookDefinition,
  HookInput,
  HookOutput,
} from "@/entityTypes/hookTypes";
import { HOOK_LIMITS } from "@/entityTypes/hookTypes";
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
 *   - If matcher.scriptPath is absent, run the Claude command in a child
 *     process using `bash -lc`, feed a Claude-shaped payload on stdin, and
 *     translate common Claude hook outputs into AiFetchly HookOutput.
 *
 * Hook code is never evaluated in the renderer or via shell:true.
 *
 * Re-register is idempotent per plugin source.
 */

/** Stable id namespace; ensures re-registration replaces rather than duplicates. */
function buildHookId(pluginName: string, idx: number): string {
  return `plugin:${pluginName}:${idx}`;
}

function pluginSourceId(pluginName: string): string {
  return `plugin:${pluginName}`;
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

function timeoutMs(matcher: AdaptedPluginHookMatcher): number {
  const raw = matcher.timeoutMs ?? HOOK_LIMITS.defaultCommandTimeoutMs;
  if (!Number.isFinite(raw) || raw <= 0) {
    return HOOK_LIMITS.defaultCommandTimeoutMs;
  }
  return Math.min(Math.floor(raw), HOOK_LIMITS.maxCommandTimeoutMs);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const suffix = "\n[plugin hook output truncated]";
  return `${value.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

function toClaudeHookPayload(input: HookInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    session_id: input.conversationId ?? input.sessionId ?? "",
    hook_event_name: input.eventName,
    conversation_id: input.conversationId,
    message_id: input.messageId,
    timestamp: input.timestamp,
    cwd: process.cwd(),
  };

  if (
    input.eventName === "PreToolUse" ||
    input.eventName === "PostToolUse" ||
    input.eventName === "PostToolUseFailure" ||
    input.eventName === "PermissionRequest" ||
    input.eventName === "PermissionDenied"
  ) {
    payload.tool_name = input.tool.name;
    payload.tool_input = input.input;
  }
  if (input.eventName === "PostToolUse") {
    payload.tool_response = input.output;
  }
  if (input.eventName === "PostToolUseFailure") {
    payload.tool_error = input.error;
  }
  if (input.eventName === "UserPromptSubmit") {
    payload.prompt = input.prompt;
  }
  if (input.eventName === "Stop") {
    payload.stop_reason = input.reason;
  }

  return payload;
}

function parseClaudeCommandOutput(stdout: string, stderr: string): HookOutput {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return stderr.trim()
      ? { reason: truncate(stderr.trim(), HOOK_LIMITS.maxReasonChars) }
      : {};
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.systemMessage === "string") {
        return {
          systemMessage: truncate(
            obj.systemMessage,
            HOOK_LIMITS.maxSystemMessageChars
          ),
        };
      }
      if (typeof obj.additionalContext === "string") {
        return {
          additionalContext: truncate(
            obj.additionalContext,
            HOOK_LIMITS.maxAdditionalContextChars
          ),
        };
      }
      if (typeof obj.message === "string") {
        return {
          systemMessage: truncate(
            obj.message,
            HOOK_LIMITS.maxSystemMessageChars
          ),
        };
      }
    }
  } catch {
    // Plain text stdout is still useful as session/tool context.
  }

  return {
    systemMessage: truncate(trimmed, HOOK_LIMITS.maxSystemMessageChars),
  };
}

async function executeClaudeCommandHook(
  pluginName: string,
  matcher: AdaptedPluginHookMatcher,
  input: HookInput
): Promise<HookOutput> {
  const pluginRoot = getPluginInstallRoot(pluginName);
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    USERNAME: process.env.USERNAME,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    CLAUDE_PROJECT_DIR: process.cwd(),
  };
  const stdinPayload = JSON.stringify(toClaudeHookPayload(input));
  const maxStdout = HOOK_LIMITS.maxCommandStdoutBytes;
  const maxStderr = HOOK_LIMITS.maxCommandStderrBytes;
  const limitMs = timeoutMs(matcher);

  return await new Promise<HookOutput>((resolve, reject) => {
    const child = spawn("bash", ["-lc", matcher.sourceCommand], {
      cwd: pluginRoot,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, limitMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= maxStdout) return;
      const slice = chunk.subarray(0, maxStdout - stdoutBytes);
      stdout += slice.toString("utf8");
      stdoutBytes += slice.length;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= maxStderr) return;
      const slice = chunk.subarray(0, maxStderr - stderrBytes);
      stderr += slice.toString("utf8");
      stderrBytes += slice.length;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Claude plugin hook timed out after ${limitMs}ms`));
        return;
      }
      if (code === 2) {
        resolve({
          continue: false,
          reason: truncate(
            stderr.trim() || stdout.trim() || "Blocked by plugin hook",
            HOOK_LIMITS.maxReasonChars
          ),
        });
        return;
      }
      if (code && code !== 0) {
        reject(
          new Error(
            `Claude plugin hook exited with code ${code}: ${truncate(
              stderr.trim() || stdout.trim(),
              HOOK_LIMITS.maxReasonChars
            )}`
          )
        );
        return;
      }
      resolve(parseClaudeCommandOutput(stdout, stderr));
    });

    child.stdin?.end(stdinPayload, "utf8");
  });
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
      log.info(
        `[plugin-hook] ${pluginName} ${matcher.event} matched ` +
          `${matcher.matcher ?? "(any)"}; running Claude command hook`
      );
      return await executeClaudeCommandHook(pluginName, matcher, input);
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
    HookRegistry.replaceSource(
      pluginSourceId(pluginName),
      matchers.map((matcher, idx) => buildCallbackHook(pluginName, matcher, idx))
    );
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
      PluginHookRegistrar.registerForPlugin(plugin.name, plugin.hooks);
    }
  }

  static unregisterPlugin(pluginName: string): void {
    HookRegistry.unregisterSource(pluginSourceId(pluginName));
  }
}
