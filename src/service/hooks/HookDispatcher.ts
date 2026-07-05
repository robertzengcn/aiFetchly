import {
  AggregatedHookResult,
  EMPTY_AGGREGATE,
  HookEventName,
  HookInput,
} from "@/entityTypes/hookTypes";
import { HookRegistry } from "./HookRegistry";
import { aggregateResults, HookSingleResult } from "./HookResultAggregator";
import { executeCallback } from "./executors/CallbackHookExecutor";
import { executeCommand } from "./executors/CommandHookExecutor";
import { buildAuditEntry, getHookAuditLogger } from "./HookAuditService";
import { Token } from "@/modules/token";
import { USER_HOOKS_ENABLED } from "@/config/usersetting";

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
    // internals. Defaults to OFF when the Token value is unset,
    // matching the PRD's "disabled by default" intent.
    //
    // Per-call Token construction is intentional: electron-store caches
    // its JSON state in-memory per Store instance (loaded once on
    // construction), so a cached Token field would hold a stale view
    // that never sees writes from the IPC handler's separate Token.
    // Every sibling gate (USER_AI_ENABLED: 8 call sites in src/) uses
    // the same per-call pattern for this reason.
    if (new Token().getValue(USER_HOOKS_ENABLED) !== "true") {
      return EMPTY_AGGREGATE;
    }

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
        result = await executeCallback(hook, input, abortSignal);
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
}

export const HookDispatcher: HookDispatcherApi = new HookDispatcherImpl();
