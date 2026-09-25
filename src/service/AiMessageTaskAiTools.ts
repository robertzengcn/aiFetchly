import { ZodError } from "zod";

import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { validateScheduledLoopAllowedTools } from "@/service/ScheduledAiToolPolicy";
import {
  AiMessageTaskToolErrorCode,
  AiMessageTaskToolFailure,
  AiMessageTaskToolResult,
  SafeAiMessageTaskPayload,
  SafeAiMessageTaskSummary,
  createAiMessageTaskSchema,
  listAiMessageTasksSchema,
} from "@/entityTypes/aiMessageTaskAiToolTypes";

/** Truncation length for the message preview returned in list rows. */
const MESSAGE_PREVIEW_LENGTH = 300;

// ---------------------------------------------------------------------------
// Result helpers (mirrors ScheduleAiTools)
// ---------------------------------------------------------------------------

export function toolFailure(
  code: AiMessageTaskToolErrorCode,
  message: string
): AiMessageTaskToolFailure {
  return { success: false, error: message, code };
}

export function validationFailure(error: ZodError): AiMessageTaskToolFailure {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return toolFailure(
    AiMessageTaskToolErrorCode.VALIDATION_FAILED,
    `Invalid input: ${issues}`
  );
}

// ---------------------------------------------------------------------------
// Payload mappers
// ---------------------------------------------------------------------------

function parseAllowedTools(task: AiMessageTaskEntity): string[] {
  try {
    const parsed = JSON.parse(task.allowed_tools_json ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function toSafeAiMessageTaskPayload(
  task: AiMessageTaskEntity
): SafeAiMessageTaskPayload {
  return {
    id: task.id,
    name: task.name,
    description: task.description ?? null,
    message: task.message,
    system_prompt: task.system_prompt ?? null,
    model: task.model ?? null,
    status: task.status,
    allowed_tools: parseAllowedTools(task),
    auto_approve_tools: task.auto_approve_tools,
    max_tool_calls: task.max_tool_calls,
    max_runtime_ms: task.max_runtime_ms,
    max_continue_calls: task.max_continue_calls,
    last_run_time: toIso(task.last_run_time),
    last_result_summary: task.last_result_summary ?? null,
    last_error_message: task.last_error_message ?? null,
    workspace_path: task.workspace_path ?? null,
  };
}

export function toSafeAiMessageTaskSummary(
  task: AiMessageTaskEntity
): SafeAiMessageTaskSummary {
  const message = task.message ?? "";
  return {
    id: task.id,
    name: task.name,
    description: task.description ?? null,
    message_preview:
      message.length > MESSAGE_PREVIEW_LENGTH
        ? `${message.slice(0, MESSAGE_PREVIEW_LENGTH)}…`
        : message,
    model: task.model ?? null,
    status: task.status,
    allowed_tools: parseAllowedTools(task),
    auto_approve_tools: task.auto_approve_tools,
    last_run_time: toIso(task.last_run_time),
    last_result_summary: task.last_result_summary ?? null,
    last_error_message: task.last_error_message ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

export async function createAiMessageTaskForAi(
  args: unknown
): Promise<
  AiMessageTaskToolResult<{ task_id: number; task: SafeAiMessageTaskPayload }>
> {
  const parsed = createAiMessageTaskSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  const input = parsed.data;

  const allowedTools = input.allowed_tools ?? [];
  if (allowedTools.length > 0) {
    const validation = validateScheduledLoopAllowedTools(allowedTools);
    if (!validation.valid) {
      return toolFailure(
        AiMessageTaskToolErrorCode.INVALID_TOOL_LIST,
        `These tools cannot be allowlisted for unattended scheduled runs: ${validation.invalidTools.join(
          ", "
        )}. Only schedulable built-in tools (read-only, high-impact, and automation tools) may be allowlisted.`
      );
    }
  }

  const module = new AiMessageTaskModule();
  let taskId: number;
  try {
    taskId = await module.createTask({
      name: input.name,
      description: input.description,
      message: input.message,
      systemPrompt: input.system_prompt,
      model: input.model,
      allowedTools,
      autoApproveTools: input.auto_approve_tools,
      maxToolCalls: input.max_tool_calls,
      maxRuntimeMs: input.max_runtime_ms,
      maxContinueCalls: input.max_continue_calls,
      workspacePath: input.workspace_path,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return toolFailure(
      AiMessageTaskToolErrorCode.EXECUTION_FAILED,
      `Failed to create AI message task: ${message}`
    );
  }

  const created = await module.getTask(taskId);
  if (!created) {
    return toolFailure(
      AiMessageTaskToolErrorCode.TASK_NOT_FOUND,
      `Task with id ${taskId} not found after creation.`
    );
  }

  const warning =
    allowedTools.length > 0 && !input.auto_approve_tools
      ? "allowed_tools were set but auto_approve_tools is false — scheduled runs will not execute any tools unattended. Set auto_approve_tools: true if this task needs tools when running on a schedule."
      : undefined;

  const success: {
    success: true;
    data: { task_id: number; task: SafeAiMessageTaskPayload };
    warning?: string;
  } = {
    success: true,
    data: { task_id: taskId, task: toSafeAiMessageTaskPayload(created) },
  };
  if (warning) {
    success.warning = warning;
  }
  return success;
}

export async function listAiMessageTasksForAi(args: unknown): Promise<
  AiMessageTaskToolResult<{
    tasks: SafeAiMessageTaskSummary[];
    total: number;
    page: number;
    size: number;
  }>
> {
  const parsed = listAiMessageTasksSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  const { page, size } = parsed.data;

  const module = new AiMessageTaskModule();
  try {
    // Module API is 1-based; the tool schema uses 0-based pages to match
    // the other list_* AI tools.
    const result = await module.listTasks(page + 1, size);
    return {
      success: true,
      data: {
        tasks: result.items.map(toSafeAiMessageTaskSummary),
        total: result.total,
        page,
        size,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return toolFailure(
      AiMessageTaskToolErrorCode.EXECUTION_FAILED,
      `Failed to list AI message tasks: ${message}`
    );
  }
}
