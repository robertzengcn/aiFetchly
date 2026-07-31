import {
  AggregatedHookResult,
  CommandHookDefinition,
  EMPTY_AGGREGATE,
  HookEventName,
  HookExecutionError,
  HookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  PermissionRequestHookInput,
} from "@/entityTypes/hookTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { ToolExecutionResult } from "@/api/aiChatApi";
import { HookRegistry } from "./HookRegistry";
import { aggregateResults, HookSingleResult } from "./HookResultAggregator";
import { executeCallback } from "./executors/CallbackHookExecutor";
import { executeCommand } from "./executors/CommandHookExecutor";
import { buildAuditEntry, getHookAuditLogger } from "./HookAuditService";
import { Token } from "@/modules/token";
import { USER_HOOKS_ENABLED } from "@/config/usersetting";

const SKILL_REF_COMMAND_PREFIX = "skill:";

export interface SkillRefResolver {
  isRegistered(skillName: string): boolean;
  execute(
    skillName: string,
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<ToolExecutionResult>;
}

const NOT_WIRED_RESOLVER: SkillRefResolver = {
  isRegistered: () => false,
  execute: async () => ({
    tool_call_id: "",
    tool_name: "",
    success: false,
    result: { error: "skill-ref resolver not wired" },
    execution_time_ms: 0,
  }),
};

let injectedResolver: SkillRefResolver | null = null;
let runtimeResolver: SkillRefResolver | null = null;

async function ensureRuntimeResolver(): Promise<SkillRefResolver> {
  if (runtimeResolver) return runtimeResolver;
  try {
    const { SkillRegistry } = await import("@/config/skillsRegistry");
    const { SkillExecutor } = await import("@/service/SkillExecutor");
    runtimeResolver = {
      isRegistered: (name: string) => SkillRegistry.isRegistered(name),
      execute: (name, args, ctx) => SkillExecutor.execute(name, args, ctx),
    };
  } catch {
    runtimeResolver = NOT_WIRED_RESOLVER;
  }
  return runtimeResolver;
}

async function dispatchSkillRef(
  hook: CommandHookDefinition,
  input: HookInput
): Promise<HookSingleResult> {
  const skillName = hook.command.slice(SKILL_REF_COMMAND_PREFIX.length);
  const resolver = injectedResolver ?? (await ensureRuntimeResolver());

  if (!resolver.isRegistered(skillName)) {
    return skillRefResult(hook);
  }

  const start = Date.now();
  try {
    const execResult = await resolver.execute(
      skillName,
      {},
      {
        conversationId: input.conversationId ?? "",
        toolCallId: input.hookRunId,
      }
    );
    const durationMs = Date.now() - start;
    if (execResult.success) {
      return { hook, output: {}, durationMs };
    }
    return {
      hook,
      error: {
        hookId: hook.id,
        source: hook.source,
        message: `Skill ${skillName} execution failed: ${
          typeof execResult.result.error === "string"
            ? execResult.result.error
            : "unknown error"
        }`,
      },
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      hook,
      error: {
        hookId: hook.id,
        source: hook.source,
        message: `Skill ${skillName} execution threw: ${message}`,
      },
      durationMs,
    };
  }
}

/**
 * Public dispatcher API. `executeHooks` is the single entry point
 * used by the chat tool loop (StreamEventProcessor) and any future
 * callers (agent runtime, scheduled tasks). It never throws.
 *
 * MVP execution is sequential. Order matters because the aggregator
 * shallow-merges `updatedInput` in execution order.
 */

export interface ExecuteHooksInput {
  readonly eventName: HookEventName;
  readonly input: HookInput;
  readonly matchQuery?: string;
  readonly abortSignal?: AbortSignal;
}

export interface HookDispatcherApi {
  executeHooks(args: ExecuteHooksInput): Promise<AggregatedHookResult>;
}

class HookDispatcherImpl implements HookDispatcherApi {
  async executeHooks(args: ExecuteHooksInput): Promise<AggregatedHookResult> {
    // Global enable gate — Token-backed so the System Settings UI
    // can toggle the whole subsystem without touching dispatcher
    // internals. Defaults to ON when the Token value is unset.
    // Set USER_HOOKS_ENABLED to "false" to disable all hooks.
    //
    // Per-call Token construction is intentional: electron-store caches
    // its JSON state in-memory per Store instance (loaded once on
    // construction), so a cached Token field would hold a stale view
    // that never sees writes from the IPC handler's separate Token.
    // Every sibling gate (USER_AI_ENABLED: 8 call sites in src/) uses
    // the same per-call pattern for this reason.
    if (new Token().getValue(USER_HOOKS_ENABLED) === "false") {
      return EMPTY_AGGREGATE;
    }

    const { eventName, input, matchQuery, abortSignal } = args;
    if (abortSignal?.aborted) return EMPTY_AGGREGATE;

    // Extract tool input for `if` condition evaluation.
    const toolInput = extractToolInput(input);

    const hooks = HookRegistry.getMatchingHooks({
      eventName,
      matchQuery,
      toolInput,
      // The dispatcher does not own a sessionId; session hooks are
      // fetched by callers that pass a sessionId-aware registry in a
      // future iteration. For MVP, the StreamEventProcessor runs in
      // per-request scope and the registry's session filter is fed
      // by the caller via matchQuery only.
    });

    // No-hooks fast path: O(1) on the common case where no hook
    // matches. This is the critical performance requirement from the
    // PRD: <5ms overhead when hooks are absent.
    if (hooks.length === 0) {
      return EMPTY_AGGREGATE;
    }

    const audit = getHookAuditLogger();
    const results: HookSingleResult[] = [];

    for (const hook of hooks) {
      audit.log(
        buildAuditEntry({
          hookRunId: input.hookRunId,
          hookId: hook.id,
          eventName,
          source: hook.source,
          type: hook.type,
          status: "started",
          matchQuery,
        })
      );

      if (abortSignal?.aborted) {
        // Record remaining hooks as not run; stop dispatching.
        break;
      }

      let result: HookSingleResult;
      if (hook.type === "callback") {
        result = await executeCallback(hook, input, abortSignal);
      } else if (hook.command.startsWith(SKILL_REF_COMMAND_PREFIX)) {
        result = await dispatchSkillRef(hook, input);
      } else {
        const cmd = await executeCommand({ hook, input, abortSignal });
        result = cmd.result;
      }

      audit.log(
        buildAuditEntry({
          hookRunId: input.hookRunId,
          hookId: hook.id,
          eventName,
          source: hook.source,
          type: hook.type,
          status: result.error
            ? result.error.timedOut
              ? "timeout"
              : "failed"
            : "success",
          matchQuery,
          durationMs: result.durationMs,
          reason: result.error?.message,
        })
      );

      results.push(result);
    }

    return aggregateResults(results);
  }

  setSkillRefResolverForTests(resolver: SkillRefResolver | null): void {
    injectedResolver = resolver;
    runtimeResolver = null;
  }

  setClientForTests(): void {
    // Kept for older skill-ref tests. Current command hooks execute through
    // executeCommand; skill-ref hooks never use the command executor.
  }
}

function skillRefResult(hook: CommandHookDefinition): HookSingleResult {
  const error: HookExecutionError = {
    hookId: hook.id,
    source: hook.source,
    message:
      "skill-registry-not-available: hook declared a skill action but the named skill is not registered",
  };
  return { hook, error, durationMs: 0 };
}

export const HookDispatcher: HookDispatcherApi & {
  setSkillRefResolverForTests(resolver: SkillRefResolver | null): void;
  setClientForTests(client: unknown): void;
} = new HookDispatcherImpl();

/** Extract tool input args from a HookInput, if the event carries them. */
function extractToolInput(
  input: HookInput
): Record<string, unknown> | undefined {
  if (
    input.eventName === "PreToolUse" ||
    input.eventName === "PostToolUse" ||
    input.eventName === "PostToolUseFailure" ||
    input.eventName === "PermissionRequest"
  ) {
    return (input as PreToolUseHookInput | PostToolUseHookInput | PostToolUseFailureHookInput | PermissionRequestHookInput).input;
  }
  return undefined;
}
