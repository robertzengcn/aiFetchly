import {
  AggregatedHookResult,
  CommandHookDefinition,
  EMPTY_AGGREGATE,
  HookEventName,
  HookExecutionError,
  HookInput,
} from "@/entityTypes/hookTypes";
import { HookRegistry } from "./HookRegistry";
import { aggregateResults, HookSingleResult } from "./HookResultAggregator";
import { executeCallback } from "./executors/CallbackHookExecutor";
import { buildAuditEntry, getHookAuditLogger } from "./HookAuditService";
import { HookCommandTrustService } from "./HookCommandTrustService";
import { HookExecutionClient } from "./hookExecutionClient";

/**
 * Sentinel prefix marking a skill-reference hook (D-Vocabulary). Plan 02's
 * buildHookDefinition registers a skill-ref entry as a command hook with
 * command `skill:<name>`; the dispatcher detects the prefix and treats it as
 * a documented no-op (skill registry not yet wired — Phase 18).
 */
const SKILL_REF_COMMAND_PREFIX = "skill:";

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
        // D-Vocabulary skill-ref no-op (HOK-02 SC4): the hook declared a skill
        // action but the skill registry is not yet wired (Phase 18). Emit a
        // non-fatal skill-registry-not-available diagnostic and perform NO
        // execution — never throws, never blocks the stream.
        result = skillRefResult(hook);
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
 * Build a non-fatal result for a skill-reference hook (D-Vocabulary no-op).
 * The skill-registry-not-available diagnostic code is carried in the message;
 * the aggregator treats this as a warn-mode hook error (never blocks).
 */
function skillRefResult(hook: CommandHookDefinition): HookSingleResult {
  const error: HookExecutionError = {
    hookId: hook.id,
    source: hook.source,
    message:
      "skill-registry-not-available: hook declared a skill action but the skill registry is not yet wired",
  };
  return { hook, error, durationMs: 0 };
}

export const HookDispatcher: HookDispatcherApi & {
  setEnabledForTests(value: boolean): void;
  setClientForTests(client: HookExecutionClient): void;
} = new HookDispatcherImpl();
