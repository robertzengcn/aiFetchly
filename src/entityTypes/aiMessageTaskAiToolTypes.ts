import { z } from "zod";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export enum AiMessageTaskToolErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  INVALID_TOOL_LIST = "INVALID_TOOL_LIST",
  EXECUTION_FAILED = "EXECUTION_FAILED",
  /** message_find was not an exact substring of the stored message. */
  MESSAGE_FRAGMENT_NOT_FOUND = "MESSAGE_FRAGMENT_NOT_FOUND",
  /** message_find matched more than once and replace_all was not set. */
  MESSAGE_FRAGMENT_NOT_UNIQUE = "MESSAGE_FRAGMENT_NOT_UNIQUE",
}

/** Max characters for a newly written AI message task prompt. */
export const AI_MESSAGE_TASK_MESSAGE_MAX_CHARS = 10_000;

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
  message: z.string().trim().min(1).max(AI_MESSAGE_TASK_MESSAGE_MAX_CHARS),
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

export const getAiMessageTaskSchema = z.object({
  task_id: z.coerce.number().int().positive(),
});

export const updateAiMessageTaskSchema = z
  .object({
    task_id: z.coerce.number().int().positive(),
    name: z.string().trim().min(1).max(255).optional(),
    message: z
      .string()
      .trim()
      .min(1)
      .max(AI_MESSAGE_TASK_MESSAGE_MAX_CHARS)
      .optional(),
    /** Exact substring of the current message. Do not trim — matching is literal. */
    message_find: z
      .string()
      .min(1)
      .max(AI_MESSAGE_TASK_MESSAGE_MAX_CHARS)
      .optional(),
    message_replace: z
      .string()
      .max(AI_MESSAGE_TASK_MESSAGE_MAX_CHARS)
      .optional(),
    replace_all: z.boolean().default(false),
    description: z.string().trim().max(1000).optional(),
    system_prompt: z.string().trim().max(4000).optional(),
    model: z.string().trim().max(100).optional(),
    allowed_tools: z.array(z.string().trim().min(1)).max(50).optional(),
    auto_approve_tools: z.boolean().optional(),
    max_tool_calls: z.coerce.number().int().min(1).max(50).optional(),
    max_runtime_ms: z.coerce.number().int().min(1000).max(3600000).optional(),
    max_continue_calls: z.coerce.number().int().min(0).max(50).optional(),
    workspace_path: z.string().trim().min(1).max(1024).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .superRefine((value, ctx) => {
    const hasFind = value.message_find !== undefined;
    const hasReplace = value.message_replace !== undefined;
    if (hasFind !== hasReplace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "message_find and message_replace must be provided together",
        path: [hasFind ? "message_replace" : "message_find"],
      });
    }
    if (value.message !== undefined && (hasFind || hasReplace)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Pass either message or message_find/message_replace, not both",
        path: ["message"],
      });
    }
    const hasUpdate =
      value.name !== undefined ||
      value.message !== undefined ||
      hasFind ||
      value.description !== undefined ||
      value.system_prompt !== undefined ||
      value.model !== undefined ||
      value.allowed_tools !== undefined ||
      value.auto_approve_tools !== undefined ||
      value.max_tool_calls !== undefined ||
      value.max_runtime_ms !== undefined ||
      value.max_continue_calls !== undefined ||
      value.workspace_path !== undefined ||
      value.status !== undefined;
    if (!hasUpdate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field to update is required",
        path: ["task_id"],
      });
    }
  });

export type CreateAiMessageTaskInput = z.infer<
  typeof createAiMessageTaskSchema
>;
export type ListAiMessageTasksInput = z.infer<typeof listAiMessageTasksSchema>;
export type GetAiMessageTaskInput = z.infer<typeof getAiMessageTaskSchema>;
export type UpdateAiMessageTaskInput = z.infer<
  typeof updateAiMessageTaskSchema
>;
