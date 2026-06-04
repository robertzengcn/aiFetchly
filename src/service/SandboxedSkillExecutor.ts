/**
 * SandboxedSkillExecutor — runs user-authored skills in isolated VM.
 *
 * Uses isolated-vm to create a secure sandbox with:
 * - 64MB memory limit
 * - 30 second execution timeout
 * - Explicit API grants (proxied fetch, log, args)
 * - Blocks: process, fs, require, electron, global, Buffer
 *
 * @see research.md Decision 5 (sandboxing)
 */

import ivm from "isolated-vm";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SANDBOX_CONFIG = {
  /** Maximum heap memory in MB. */
  MEMORY_LIMIT_MB: 64,
  /** Maximum wall-clock execution time in milliseconds. */
  TIMEOUT_MS: 30_000,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxedResult {
  readonly success: boolean;
  readonly result: Record<string, unknown>;
  readonly logs: readonly string[];
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Execute a user-authored skill script inside an isolated VM.
 *
 * The script receives:
 * - `args` — frozen copy of the arguments
 * - `log(msg)` — appends to the logs array
 * - `setResult(obj)` — returns a result object (must be JSON-serializable)
 *
 * @param code - The JavaScript source code to execute.
 * @param args - Arguments to pass into the sandbox.
 * @param _context - Execution context (conversation ID, tool call ID).
 * @returns Structured result from the sandboxed code.
 */
async function execute(
  code: string,
  args: Record<string, unknown>,
  _context: SkillExecutionContext
): Promise<SandboxedResult> {
  const logs: string[] = [];

  const isolate = new ivm.Isolate({
    memoryLimit: SANDBOX_CONFIG.MEMORY_LIMIT_MB,
  });
  const context = isolate.createContextSync();
  const jail = context.global;

  // Block dangerous globals by setting them to undefined
  jail.setSync("global", undefined);
  jail.setSync("process", undefined);
  jail.setSync("require", undefined);
  jail.setSync("Buffer", undefined);
  jail.setSync("electron", undefined);

  // Provide args as a JSON copy (safe — no references escape)
  const argsCopy = JSON.parse(JSON.stringify(args));
  jail.setSync("args", new ivm.ExternalCopy(argsCopy).copyInto());

  // Provide log function via Reference
  const logRef = new ivm.Reference(function (...msgArgs: unknown[]): void {
    logs.push(
      msgArgs
        .map((m) => (typeof m === "string" ? m : JSON.stringify(m)))
        .join(" ")
    );
  });
  jail.setSync("_logRef", logRef);

  // Provide setResult via Reference
  let resolveResult: (value: Record<string, unknown>) => void;
  const resultPromise = new Promise<Record<string, unknown>>((resolve) => {
    resolveResult = resolve;
  });
  const setResultRef = new ivm.Reference(function (serialized: string): void {
    resolveResult(JSON.parse(serialized) as Record<string, unknown>);
  });
  jail.setSync("_setResultRef", setResultRef);

  // Create wrapper functions that call the references
  // setResult JSON-stringifies before crossing the boundary (ivm can't transfer objects)
  context.evalSync(`
    function log() {
      _logRef.applySync(undefined, Array.from(arguments).map(String));
    }
    function setResult(val) {
      var serialized = JSON.stringify(val);
      _setResultRef.applySync(undefined, [serialized]);
    }
  `);

  // Wrap user code — call setResult with error on exception
  const wrappedCode = `
    (async () => {
      try {
        ${code}
      } catch (err) {
        setResult({ success: false, error: String(err && err.message ? err.message : err) });
      }
    })();
  `;

  try {
    const script = isolate.compileScriptSync(wrappedCode);
    const timeout = SANDBOX_CONFIG.TIMEOUT_MS;

    script.runSync(context, { timeout });

    // Wait for the result (script may be async)
    const result = await Promise.race([
      resultPromise,
      new Promise<Record<string, unknown>>((_, reject) =>
        setTimeout(
          () => reject(new Error("Sandbox execution timed out")),
          timeout
        )
      ),
    ]);

    return {
      success: (result.success as boolean) !== false,
      result,
      logs: Object.freeze([...logs]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      result: { error: message },
      logs: Object.freeze([...logs]),
    };
  } finally {
    isolate.dispose();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const SandboxedSkillExecutor = {
  execute,
} as const;
