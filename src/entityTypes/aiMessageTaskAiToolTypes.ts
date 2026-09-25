import { z } from "zod";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export enum AiMessageTaskToolErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  INVALID_TOOL_LIST = "INVALID_TOOL_LIST",
  EXECUTION_FAILED = "EXECUTION_FAILED",
}

// ---------------------------------------------------------------------------
// Result types (mirrors the ScheduleToolResult envelope in scheduleAiToolTypes)
// ---------------------------------------------------------------------------

export type AiMessageTaskToolSuccess<T> = {
  success: true;
  data: T;
  warning?: string;
};
export type AiMessageTaskToolFailure = {
  success: false;
  error: string;
  code: AiMessageTaskToolErrorCode;
};
export type AiMessageTaskToolResult<T> =
  | AiMessageTaskToolSuccess<T>
  | AiMessageTaskToolFailure;

// ---------------------------------------------------------------------------
// Safe payload interfaces
// ---------------------------------------------------------------------------

/** Full AI message task payload returned by create_ai_message_task. */
export interface SafeAiMessageTaskPayload {
  id: number;
  name: string;
  description: string | null;
  message: string;
  system_prompt: string | null;
  model: string | null;
  status: string;
  allowed_tools: string[];
  auto_approve_tools: boolean;
  max_tool_calls: number;
  max_runtime_ms: number;
  max_continue_calls: number;
  last_run_time: string | null;
  last_result_summary: string | null;
  last_error_message: string | null;
  workspace_path: string | null;
}

/** Compact list-row payload returned by list_ai_message_tasks. */
export interface SafeAiMessageTaskSummary {
  id: number;
  name: string;
  description: string | null;
  message_preview: string;
  model: string | null;
  status: string;
  allowed_tools: string[];
  auto_approve_tools: boolean;
  last_run_time: string | null;
  last_result_summary: string | null;
  last_error_message: string | null;
}

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

export const createAiMessageTaskSchema = z.object({
  name: z.string().trim().min(1).max(255),
  message: z.string().trim().min(1).max(10000),
  description: z.string().trim().max(1000).optional(),
  system_prompt: z.string().trim().max(4000).optional(),
  model: z.string().trim().max(100).optional(),
  allowed_tools: z.array(z.string().trim().min(1)).max(50).optional(),
  auto_approve_tools: z.boolean().default(false),
  max_tool_calls: z.coerce.number().int().min(1).max(50).default(10),
  max_runtime_ms: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(300000),
  max_continue_calls: z.coerce.number().int().min(0).max(50).default(10),
  workspace_path: z.string().trim().min(1).max(1024).optional(),
});

export const listAiMessageTasksSchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateAiMessageTaskInput = z.infer<
  typeof createAiMessageTaskSchema
>;
export type ListAiMessageTasksInput = z.infer<typeof listAiMessageTasksSchema>;
