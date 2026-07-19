// src/childprocess/hook-execution/workerProtocol.ts
// HOK-02 (Phase 17 / Plan 03) — WAT-06 zod schemas for the hook-execution IPC
// boundary between the main process (HookDispatcher) and the dedicated
// hook-execution worker.
//
// Two discriminated unions on the `type` field, both `strict()` so a buggy or
// compromised peer cannot smuggle an unrecognised payload past the safeParse:
//   - workerCommandSchema (main → worker): execute-hook | shutdown
//   - workerEventSchema   (worker → main): hook-result
//
// Trust model (mirrors WorkspaceWatchProtocol):
//   - main → worker is trusted (main is the authority and already gated the
//     hook through the main-side trust service BEFORE dispatching). The worker
//     safeParses defensively anyway.
//   - worker → main is UNTRUSTED. The client safeParses every event; a
//     malformed/missing hook-result is synthesized into a non-fatal failure
//     (HOK-02 SC4 — the stream NEVER crashes from a hook failure).
//
// Pure module: imports only zod. NO fs / Electron / TypeORM / DB / registry —
// worker-safe (WAT-02).

import { z } from "zod";

/** Hook run id — non-empty string, used to correlate request/response. */
const hookRunIdSchema = z.string().min(1);

/** Max command timeout (mirrors HOOK_LIMITS.maxCommandTimeoutMs). */
const MAX_TIMEOUT_MS = 60000;

/**
 * Main → worker commands. `strict()` rejects unknown extra fields so a buggy
 * main process cannot slip a stray payload past the worker.
 */
export const executeHookCommandSchema = z
  .object({
    type: z.literal("execute-hook"),
    hookRunId: hookRunIdSchema,
    command: z.string().min(1),
    cwd: z.string().min(1).optional(),
    envAllowlist: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
    stdinPayload: z.string(),
  })
  .strict();

export const shutdownCommandSchema = z
  .object({ type: z.literal("shutdown") })
  .strict();

export const workerCommandSchema = z.discriminatedUnion("type", [
  executeHookCommandSchema,
  shutdownCommandSchema,
]);

export type HookExecutionCommand = z.infer<typeof workerCommandSchema>;

/**
 * Worker → main events. `strict()` rejects unknown extra fields so a buggy or
 * compromised worker cannot smuggle an unrecognised payload past the client.
 */
export const hookResultEventSchema = z
  .object({
    type: z.literal("hook-result"),
    hookRunId: hookRunIdSchema,
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number().int().nonnegative(),
    error: z
      .object({
        message: z.string().max(2000),
        timedOut: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const workerEventSchema = z.discriminatedUnion("type", [
  hookResultEventSchema,
]);

export type HookExecutionEvent = z.infer<typeof workerEventSchema>;
