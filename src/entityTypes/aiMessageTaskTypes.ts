// src/entityTypes/aiMessageTaskTypes.ts

/**
 * Type definitions for the AI Message Task feature.
 */

/** Status of an AI message task configuration. */
export type AiMessageTaskStatus = "active" | "inactive" | "deleted";

/** Status of an AI message task scheduled run. */
export type AiMessageTaskRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked_by_policy"
  | "timeout";

/** Structured error codes for AI message task runs. */
export type AiMessageTaskErrorCode =
  | "AI_DISABLED"
  | "TASK_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "TOOL_NOT_ALLOWED"
  | "TOOL_BLOCKED_BY_CATEGORY"
  | "TOOL_LIMIT_EXCEEDED"
  | "RUNTIME_TIMEOUT"
  | "REMOTE_AI_ERROR"
  | "TOOL_EXECUTION_FAILED"
  | "CONVERSATION_CONTINUE_FAILED";

/** Tool policy stored on each AI message task. */
export interface AiMessageTaskToolPolicy {
  readonly allowedTools: readonly string[];
  readonly autoApproveTools: boolean;
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
  readonly maxContinueCalls: number;
}

/** Default values for tool policy fields. */
export const AI_MESSAGE_TASK_DEFAULTS = {
  autoApproveTools: false,
  allowedTools: [] as readonly string[],
  maxToolCalls: 10,
  maxRuntimeMs: 300_000,
  maxContinueCalls: 10,
} as const;

/** Create-task request payload from the frontend. */
export interface CreateAiMessageTaskRequest {
  readonly name: string;
  readonly description?: string;
  readonly message: string;
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly conversationId?: string;
  readonly allowedTools?: readonly string[];
  readonly autoApproveTools?: boolean;
  readonly maxToolCalls?: number;
  readonly maxRuntimeMs?: number;
  readonly maxContinueCalls?: number;
}

/** Update-task request payload from the frontend. */
export interface UpdateAiMessageTaskRequest {
  readonly id: number;
  readonly name?: string;
  readonly description?: string;
  readonly message?: string;
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly conversationId?: string;
  readonly allowedTools?: readonly string[];
  readonly autoApproveTools?: boolean;
  readonly maxToolCalls?: number;
  readonly maxRuntimeMs?: number;
  readonly maxContinueCalls?: number;
  readonly status?: AiMessageTaskStatus;
}

/** Summary of a schedulable built-in tool for the UI catalog. */
export interface SchedulableAiToolSummary {
  readonly name: string;
  readonly description: string;
  readonly permissionCategory: string;
  readonly source: "built-in";
  readonly requiresConfirmation: boolean;
  readonly schedulable: boolean;
  readonly autoApproveAllowed: boolean;
  readonly blockedReason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
}

/** Runtime decision for a single tool call in scheduled mode. */
export interface ScheduledToolDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
}

/** Metadata for a blocked tool call stored in the run log. */
export interface BlockedToolCallRecord {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly reason: string;
  readonly timestamp: string;
  readonly args?: Record<string, unknown>;
}
