import {
  CallbackHookDefinition,
  HookExecutionError,
  HookInput,
  HookOutput,
} from "@/entityTypes/hookTypes";
import { validateHookOutput } from "../HookOutputValidator";
import { HookSingleResult } from "../HookResultAggregator";

/**
 * Executes a trusted in-process callback hook.
 *
 * Trust model: callback hooks are registered by app code or session
 * code, so they could in principle be trusted blindly. We still
 * validate the returned output so a buggy callback cannot smuggle
 * malformed shapes into the aggregator. The callback is wrapped in
 * try/catch — a throw becomes a `HookExecutionError` rather than
 * crashing the chat stream.
 */
export async function executeCallback(
  hook: CallbackHookDefinition,
  input: HookInput,
  abortSignal?: AbortSignal
): Promise<HookSingleResult> {
  if (abortSignal?.aborted) {
    return {
      hook,
      durationMs: 0,
      error: abortedError(hook),
    };
  }

  const start = Date.now();
  let raw: unknown;
  try {
    raw = await hook.callback(input);
  } catch (err) {
    return failure(hook, errorMessage(err), start);
  }

  // Callbacks may legitimately return undefined or null to signal "no
  // opinion". Normalize to an empty object before validation.
  if (raw === undefined || raw === null) {
    raw = {};
  }

  const validation = validateHookOutput(raw);
  if (!validation.valid) {
    return failure(hook, `Invalid hook output: ${validation.error}`, start);
  }

  return {
    hook,
    output: normalizeEmpty(validation.output),
    durationMs: Date.now() - start,
  };
}

function normalizeEmpty(output: HookOutput): HookOutput {
  // Ensure aggregator always sees an object even if callback returned undefined.
  return output ?? {};
}

function failure(
  hook: CallbackHookDefinition,
  message: string,
  start: number
): HookSingleResult {
  const error: HookExecutionError = {
    hookId: hook.id,
    source: hook.source,
    message,
  };
  return { hook, error, durationMs: Date.now() - start };
}

function abortedError(hook: CallbackHookDefinition): HookExecutionError {
  return {
    hookId: hook.id,
    source: hook.source,
    message: "Hook aborted before execution",
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
