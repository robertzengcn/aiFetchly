import {
  AggregatedHookResult,
  CommandHookDefinition,
  EMPTY_AGGREGATE,
  HookEventName,
  HookExecutionError,
  HookInput,
} from "@/entityTypes/hookTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { ToolExecutionResult } from "@/api/aiChatApi";
import { HookRegistry } from "./HookRegistry";
import { aggregateResults, HookSingleResult } from "./HookResultAggregator";
import { executeCallback } from "./executors/CallbackHookExecutor";
import { buildAuditEntry, getHookAuditLogger } from "./HookAuditService";
import { HookCommandTrustService } from "./HookCommandTrustService";
import { HookExecutionClient } from "./hookExecutionClient";

/**
 * Sentinel prefix marking a skill-reference hook (D-Vocabulary). Plan 02's
 * buildHookDefinition registers a skill-ref entry as a command hook with
 * command `skill:<name>`. Phase 18 (Plan 18-02 Task 1) rewires this branch
 * from a documented no-op into an invocation of a registered skill via
 * {@link dispatchSkillRef}, falling back to {@link skillRefResult} when the
 * named skill is not registered (D-SkillRefResolve).
 */
const SKILL_REF_COMMAND_PREFIX = "skill:";

// ---------------------------------------------------------------------------
// Skill-ref resolver seam (D-SkillRefResolve, Phase 18 Plan 18-02 Task 1)
// ---------------------------------------------------------------------------

/**
 * Contract for resolving a `skill:<name>` hook reference into a real skill
 * invocation. Production wires a resolver backed by `SkillRegistry` +
 * `SkillExecutor`; tests inject a stub via {@link HookDispatcher.setSkillRefResolverForTests}.
 *
 * The seam exists so this dispatcher module NEVER statically imports the
 * DB/Electron-heavy skill runtime (`@/config/skillsRegistry` pulls in
 * SkillManagementModule, MCPToolService, ToolExecutor, …). Keeping that graph
 * out of the dispatcher's static imports preserves the utilitycode vitest
 * config boundary (the Phase 17 HookDispatcher suite runs under that config
 * and must stay loadable without a live Electron/DB environment).
 */
export interface SkillRefResolver {
  /** Whether a skill with the given name is currently registered. */
  isRegistered(skillName: string): boolean;
  /** Execute the named skill (delegates to the existing SkillWorkerClient boundary). */
  execute(
    skillName: string,
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<ToolExecutionResult>;
}

/**
 * Default resolver used when no runtime has been wired and no resolver has been
 * injected. `isRegistered` returns `false` so an unwired dispatcher preserves
 * the Phase 17 documented no-op behavior (skill-registry-not-available) — this
 * keeps the Phase 17 regression suite green and makes the dispatcher safe to
 * load in any process (worker/utility included).
 */
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

/** Test-injected resolver (wins over the lazy runtime resolver when set). */
let injectedResolver: SkillRefResolver | null = null;

/** Lazily-loaded runtime resolver (cached after the first dynamic import). */
let runtimeResolver: SkillRefResolver | null = null;

/**
 * Lazily build the production resolver by dynamically importing the skill
 * runtime. The dynamic import keeps the heavy module graph OUT of the
 * dispatcher's static imports. Wrapped in try/catch so any failure to load
 * (e.g. a non-main environment without Electron) degrades gracefully to
 * {@link NOT_WIRED_RESOLVER} rather than throwing into the hook stream.
 */
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
    // Graceful degradation: a non-main environment or a load failure leaves
    // skill-refs as the documented non-fatal no-op (skill-registry-not-available).
    runtimeResolver = NOT_WIRED_RESOLVER;
  }
  return runtimeResolver;
}

/**
 * Resolve a `skill:<name>` hook reference (D-SkillRefResolve). If the named
 * skill is registered, invoke it via the resolver and map the result to a
 * {@link HookSingleResult}. If it is NOT registered, fall back to the
 * preserved {@link skillRefResult} no-op (skill-registry-not-available).
 *
 * Never throws: a resolver rejection is caught and synthesized as a warn-mode
 * error result so the aggregator never blocks the stream. Per RESEARCH Pitfall
 * 6, hook skill-refs pass empty args `{}` (HookInput carries no tool-call args).
 */
async function dispatchSkillRef(
  hook: CommandHookDefinition,
  input: HookInput
): Promise<HookSingleResult> {
  const skillName = hook.command.slice(SKILL_REF_COMMAND_PREFIX.length);
  const resolver = injectedResolver ?? (await ensureRuntimeResolver());

  if (!resolver.isRegistered(skillName)) {
    // FALLBACK preserved (Phase 17): unregistered skill -> non-fatal no-op.
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
      // Success: no stream mutation (empty HookOutput). The skill already ran;
      // the audit log records the invocation. The aggregator records the hook
      // as executed and does not block.
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
    // Defensive: the resolver contract never throws by design, but a thrown
    // skill must NEVER crash the stream (HOK-02 SC4 non-fatal semantics).
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
  /** Toggles globally; future USER_HOOKS_ENABLED gate plugs in here. */
  private enabled = true;
  /**
   * HOK-02: command hooks execute via the dedicated worker round-trip (never
   * in-process in the dispatcher). Lazy singleton — forked on first command
   * dispatch. Injectable for tests via {@link setClientForTests}.
   */
  private client: HookExecutionClient = new HookExecutionClient();

  async executeHooks(args: ExecuteHooksInput): Promise<AggregatedHookResult> {
    if (!this.enabled) return EMPTY_AGGREGATE;

    const { eventName, input, matchQuery, abortSignal } = args;
    if (abortSignal?.aborted) return EMPTY_AGGREGATE;

    const hooks = HookRegistry.getMatchingHooks({
      eventName,
      matchQuery,
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
        // HOK-02 constrains only config-sourced COMMAND hooks; built-in
        // callback hooks stay trusted + in-process.
        result = await executeCallback(hook, input, abortSignal);
      } else if (hook.command.startsWith(SKILL_REF_COMMAND_PREFIX)) {
        // D-SkillRefResolve (Phase 18 Plan 18-02): resolve `skill:<name>` to a
        // registered skill and invoke it via the resolver seam; fall back to the
        // preserved skillRefResult no-op (skill-registry-not-available) when the
        // named skill is NOT registered. Never throws, never blocks the stream.
        result = await dispatchSkillRef(hook, input);
      } else if (!hook.trusted || !HookCommandTrustService.isTrusted(hook.id)) {
        // Main-side trust gate (the worker has none). A command hook runs only
        // when both the static trusted flag and the dynamic trust service agree.
        result = untrustedResult(hook);
      } else {
        // HOK-02 SC2: command hooks route through the worker round-trip. The
        // dispatcher performs NO in-process child execution. The client never
        // throws — worker failures synthesize a non-fatal warn-mode result.
        const cmdResult = await this.client.execute({
          hook,
          input,
          abortSignal,
        });
        result = cmdResult.result;
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

  /** Test-only: flip the global enable. */
  setEnabledForTests(value: boolean): void {
    this.enabled = value;
  }

  /** Test-only: inject a mock hook-execution client (HOK-02 worker round-trip). */
  setClientForTests(client: HookExecutionClient): void {
    this.client = client;
  }

  /**
   * Test/config seam (D-SkillRefResolve): inject a {@link SkillRefResolver} to
   * drive the skill-ref branch deterministically, OR pass `null` to restore the
   * default unwired state (isRegistered -> false -> skill-registry-not-available
   * fallback). Also clears the cached runtime resolver so a prior lazy load does
   * not leak across test cases. Production never calls this; the lazy runtime
   * resolver is wired on first skill-ref dispatch via {@link ensureRuntimeResolver}.
   */
  setSkillRefResolverForTests(resolver: SkillRefResolver | null): void {
    injectedResolver = resolver;
    runtimeResolver = null;
  }
}

/** Build a non-fatal result for an untrusted command hook (main-side gate). */
function untrustedResult(hook: CommandHookDefinition): HookSingleResult {
  const error: HookExecutionError = {
    hookId: hook.id,
    source: hook.source,
    message: "Command hook is not trusted",
  };
  return { hook, error, durationMs: 0 };
}

/**
 * Build a non-fatal result for a skill-reference hook whose target skill is NOT
 * registered (the preserved Phase 17 fallback). The skill-registry-not-available
 * diagnostic code is carried in the message; the aggregator treats this as a
 * warn-mode hook error (never blocks the stream).
 */
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
  setEnabledForTests(value: boolean): void;
  setClientForTests(client: HookExecutionClient): void;
  setSkillRefResolverForTests(resolver: SkillRefResolver | null): void;
} = new HookDispatcherImpl();
