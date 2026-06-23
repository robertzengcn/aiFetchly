import {
  AggregatedHookResult,
  HookDefinition,
  HookExecutionError,
  HookFailureMode,
  HookOutput,
  HookPermissionDecision,
} from "@/entityTypes/hookTypes";

/**
 * Per-hook result handed to the aggregator. Exactly one of `output`
 * and `error` is set; `output` may be `{}` for hooks that returned
 * nothing but did not error.
 */
export interface HookSingleResult {
  readonly hook: HookDefinition;
  readonly output?: HookOutput;
  readonly error?: HookExecutionError;
  readonly durationMs: number;
}

const PERMISSION_RANK: Record<HookPermissionDecision, number> = {
  allow: 1,
  ask: 2,
  deny: 3,
}

function defaultFailureMode(hook: HookDefinition): HookFailureMode {
  // Built-in policy callbacks opt into block explicitly; default to warn.
  return hook.failureMode ?? "warn";
}

/**
 * Deterministically merge per-hook results into one aggregate.
 *
 * Rules (see docs/superpowers/specs/2026-06-23-hooks-system-technical-design.md
 * §HookResultAggregator):
 *  1. continue:false ⇒ blocked.
 *  2. First block reason wins (execution order = priority order).
 *  3. permissionDecision deny > ask > allow; allow is advisory.
 *  4. updatedInput (PreToolUse only) shallow-merges in execution order.
 *  5. updatedToolOutput (PostToolUse only) shallow-merges in order.
 *  6. additionalContext and systemMessage append in execution order.
 *  7. A hook whose failureMode is "block" converts an execution error
 *     into a blocked aggregate.
 */
export function aggregateResults(
  results: readonly HookSingleResult[]
): AggregatedHookResult {
  let blocked = false;
  let blockReason: string | undefined;
  let permissionDecision: HookPermissionDecision | undefined;
  let updatedInput: Record<string, unknown> | undefined;
  let updatedToolOutput: Record<string, unknown> | undefined;

  const additionalContexts: string[] = [];
  const systemMessages: string[] = [];
  const hookErrors: HookExecutionError[] = [];
  const executedHookIds: string[] = [];

  for (const r of results) {
    executedHookIds.push(r.hook.id);

    // Hook execution error.
    if (r.error) {
      hookErrors.push(r.error);
      if (defaultFailureMode(r.hook) === "block" && !blocked) {
        blocked = true;
        blockReason = `Hook policy failed: ${r.error.message}`;
      }
      continue;
    }

    const out = r.output ?? {};

    // continue:false ⇒ block. First reason wins.
    if (out.continue === false && !blocked) {
      blocked = true;
      blockReason = out.reason ?? "Tool blocked by hook policy";
    }

    // Permission: stricter wins.
    if (out.permissionDecision) {
      const cand = out.permissionDecision;
      if (!permissionDecision || PERMISSION_RANK[cand] > PERMISSION_RANK[permissionDecision]) {
        permissionDecision = cand;
      }
    }

    // Shallow-merge input updates in execution order.
    if (out.updatedInput) {
      updatedInput = updatedInput
        ? { ...updatedInput, ...out.updatedInput }
        : { ...out.updatedInput };
    }

    // Shallow-merge output updates in execution order.
    if (out.updatedToolOutput) {
      updatedToolOutput = updatedToolOutput
        ? { ...updatedToolOutput, ...out.updatedToolOutput }
        : { ...out.updatedToolOutput };
    }

    if (out.additionalContext) {
      additionalContexts.push(out.additionalContext);
    }
    if (out.systemMessage) {
      systemMessages.push(out.systemMessage);
    }
  }

  const aggregate: AggregatedHookResult = {
    blocked,
    additionalContexts,
    systemMessages,
    hookErrors,
    executedHookIds,
  };
  if (blockReason !== undefined) aggregate.blockReason = blockReason;
  if (permissionDecision !== undefined) aggregate.permissionDecision = permissionDecision;
  if (updatedInput !== undefined) aggregate.updatedInput = updatedInput;
  if (updatedToolOutput !== undefined) aggregate.updatedToolOutput = updatedToolOutput;
  return aggregate;
}
