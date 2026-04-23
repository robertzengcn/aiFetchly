/**
 * Type definitions for the Shell Execution Skill.
 *
 * Defines request/result interfaces and zod validation schemas
 * for secure local shell command execution through AI chat.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shell interpreter enum
// ---------------------------------------------------------------------------

/** Supported shell interpreters for command execution. */
export type ShellInterpreter = "auto" | "bash" | "powershell" | "cmd";

// ---------------------------------------------------------------------------
// Input validation schemas (zod)
// ---------------------------------------------------------------------------

/** Zod schema for shell execution requests. */
export const ShellExecutionRequestSchema = z.object({
  command: z
    .string()
    .min(1, "Command must not be empty")
    .max(10000, "Command must not exceed 10000 characters"),
  cwd: z.string().optional(),
  shell: z
    .enum(["auto", "bash", "powershell", "cmd"])
    .optional()
    .default("auto"),
  timeout_ms: z
    .number()
    .int()
    .min(1000, "Timeout must be at least 1000ms")
    .max(600000, "Timeout must not exceed 600000ms (10 minutes)")
    .optional()
    .default(60000),
});

/** Validated shell execution request type. */
export type ShellExecutionRequest = z.infer<typeof ShellExecutionRequestSchema>;

// ---------------------------------------------------------------------------
// Shell execution result
// ---------------------------------------------------------------------------

/** Structured outcome of a shell command execution. */
export interface ShellExecutionResult {
  /** Whether the command exited with code 0. */
  readonly success: boolean;
  /** Process exit code, null if timed out or failed to spawn. */
  readonly exit_code: number | null;
  /** Captured standard output, possibly truncated. */
  readonly stdout: string;
  /** Captured standard error, possibly truncated. */
  readonly stderr: string;
  /** Execution wall-clock time in milliseconds. */
  readonly duration_ms: number;
  /** Whether stdout was truncated at size cap. */
  readonly stdout_truncated: boolean;
  /** Whether stderr was truncated at size cap. */
  readonly stderr_truncated: boolean;
  /** Whether the command was killed due to timeout. */
  readonly timed_out: boolean;
  /** Error message for pre-execution failures (denylist, cwd guard). */
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Shell permission consent
// ---------------------------------------------------------------------------

/** User's consent decision for a shell execution request. */
export type ShellConsentDecision = "allow_once" | "deny";

/** Payload for the shell permission prompt sent to the UI. */
export interface ShellPermissionPromptPayload {
  readonly toolCallId: string;
  readonly skillName: "shell_execute";
  readonly permissionCategory: "shell";
  readonly details: {
    readonly command: string;
    readonly cwd: string;
    readonly shell: string;
    readonly timeout_ms: number;
  };
}

// ---------------------------------------------------------------------------
// Shell audit log entry
// ---------------------------------------------------------------------------

/** Data structure for a shell audit log record. */
export interface ShellAuditData {
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly commandRedacted: string;
  readonly cwd: string;
  readonly shell: string;
  readonly success: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
}
