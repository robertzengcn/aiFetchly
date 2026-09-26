import { ZodError } from "zod";

import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import type { UpdateAiMessageTaskRequest } from "@/entityTypes/aiMessageTaskTypes";
import { validateScheduledLoopAllowedTools } from "@/service/ScheduledAiToolPolicy";
import {
  AI_MESSAGE_TASK_MESSAGE_MAX_CHARS,
  AiMessageTaskToolErrorCode,
  AiMessageTaskToolFailure,
  AiMessageTaskToolResult,
  SafeAiMessageTaskPayload,
  SafeAiMessageTaskSummary,
  createAiMessageTaskSchema,
  getAiMessageTaskSchema,
  listAiMessageTasksSchema,
  updateAiMessageTaskSchema,
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
      return invalidToolListFailure(validation.invalidTools);
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

export async function getAiMessageTaskForAi(
  args: unknown
): Promise<AiMessageTaskToolResult<{ task: SafeAiMessageTaskPayload }>> {
  const parsed = getAiMessageTaskSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const module = new AiMessageTaskModule();
  try {
    const task = await module.getTask(parsed.data.task_id);
    if (!task) {
      return toolFailure(
        AiMessageTaskToolErrorCode.TASK_NOT_FOUND,
        `AI message task ${parsed.data.task_id} not found.`
      );
    }
    return {
      success: true,
      data: { task: toSafeAiMessageTaskPayload(task) },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return toolFailure(
      AiMessageTaskToolErrorCode.EXECUTION_FAILED,
      `Failed to read AI message task: ${message}`
    );
  }
}

type FragmentReplaceResult =
  | { ok: true; message: string }
  | {
      ok: false;
      code: AiMessageTaskToolErrorCode;
      error: string;
    };

function replaceMessageFragment(
  original: string,
  find: string,
  replacement: string,
  replaceAll: boolean
): FragmentReplaceResult {
  const occurrences = countLiteralOccurrences(original, find);
  if (occurrences === 0) {
    return {
      ok: false,
      code: AiMessageTaskToolErrorCode.MESSAGE_FRAGMENT_NOT_FOUND,
      error:
        "The text to replace was not found in the task message. Call get_ai_message_task and copy the exact substring from the full message.",
    };
  }
  if (occurrences > 1 && !replaceAll) {
    return {
      ok: false,
      code: AiMessageTaskToolErrorCode.MESSAGE_FRAGMENT_NOT_UNIQUE,
      error: `The text to replace appears ${occurrences} times. Pass replace_all=true to replace every occurrence, or call get_ai_message_task and pass a longer unique message_find.`,
    };
  }

  const next = replaceAll
    ? original.split(find).join(replacement)
    : replaceFirstLiteral(original, find, replacement);
  const trimmed = next.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      code: AiMessageTaskToolErrorCode.VALIDATION_FAILED,
      error: "The updated message would be empty.",
    };
  }
  const limit = Math.max(
    AI_MESSAGE_TASK_MESSAGE_MAX_CHARS,
    original.trim().length
  );
  if (trimmed.length > limit) {
    return {
      ok: false,
      code: AiMessageTaskToolErrorCode.VALIDATION_FAILED,
      error: `The updated message would be ${trimmed.length} characters, which exceeds the limit of ${limit}.`,
    };
  }
  return { ok: true, message: trimmed };
}

function countLiteralOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) {
      break;
    }
    count += 1;
    from = index + needle.length;
  }
  return count;
}

function replaceFirstLiteral(
  haystack: string,
  needle: string,
  replacement: string
): string {
  const index = haystack.indexOf(needle);
  if (index < 0) {
    return haystack;
  }
  return (
    haystack.slice(0, index) +
    replacement +
    haystack.slice(index + needle.length)
  );
}

function invalidToolListFailure(
  invalidTools: readonly string[]
): AiMessageTaskToolFailure {
  return toolFailure(
    AiMessageTaskToolErrorCode.INVALID_TOOL_LIST,
    `These tools cannot be allowlisted for unattended scheduled runs: ${invalidTools.join(
      ", "
    )}. Only schedulable built-in tools (read-only, high-impact, and automation tools) may be allowlisted.`
  );
}

export async function updateAiMessageTaskForAi(
  args: unknown
): Promise<AiMessageTaskToolResult<{ task: SafeAiMessageTaskPayload }>> {
  const parsed = updateAiMessageTaskSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  const input = parsed.data;

  if (input.allowed_tools && input.allowed_tools.length > 0) {
    const validation = validateScheduledLoopAllowedTools(input.allowed_tools);
    if (!validation.valid) {
      return invalidToolListFailure(validation.invalidTools);
    }
  }

  const module = new AiMessageTaskModule();
  let existing: AiMessageTaskEntity | null;
  try {
    existing = await module.getTask(input.task_id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return toolFailure(
      AiMessageTaskToolErrorCode.EXECUTION_FAILED,
      `Failed to read AI message task: ${message}`
    );
  }
  if (!existing) {
    return toolFailure(
      AiMessageTaskToolErrorCode.TASK_NOT_FOUND,
      `AI message task ${input.task_id} not found.`
    );
  }

  let nextMessage: string | undefined;
  if (input.message_find !== undefined && input.message_replace !== undefined) {
    const replaced = replaceMessageFragment(
      existing.message ?? "",
      input.message_find,
      input.message_replace,
      input.replace_all
    );
    if (!replaced.ok) {
      return toolFailure(replaced.code, replaced.error);
    }
    nextMessage = replaced.message;
  } else if (input.message !== undefined) {
    nextMessage = input.message;
  }

  const request: UpdateAiMessageTaskRequest = {
    id: input.task_id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(nextMessage !== undefined ? { message: nextMessage } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.system_prompt !== undefined
      ? { systemPrompt: input.system_prompt }
      : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.allowed_tools !== undefined
      ? { allowedTools: input.allowed_tools }
      : {}),
    ...(input.auto_approve_tools !== undefined
      ? { autoApproveTools: input.auto_approve_tools }
      : {}),
    ...(input.max_tool_calls !== undefined
      ? { maxToolCalls: input.max_tool_calls }
      : {}),
    ...(input.max_runtime_ms !== undefined
      ? { maxRuntimeMs: input.max_runtime_ms }
      : {}),
    ...(input.max_continue_calls !== undefined
      ? { maxContinueCalls: input.max_continue_calls }
      : {}),
    ...(input.workspace_path !== undefined
      ? { workspacePath: input.workspace_path }
      : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };

  try {
    await module.updateTask(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    if (message.toLowerCase().includes("not found")) {
      return toolFailure(AiMessageTaskToolErrorCode.TASK_NOT_FOUND, message);
    }
    return toolFailure(
      AiMessageTaskToolErrorCode.EXECUTION_FAILED,
      `Failed to update AI message task: ${message}`
    );
  }

  let updated: AiMessageTaskEntity | null;
  try {
    updated = await module.getTask(input.task_id);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return toolFailure(
      AiMessageTaskToolErrorCode.EXECUTION_FAILED,
      `Failed to read AI message task after update: ${message}`
    );
  }
  if (!updated) {
    return toolFailure(
      AiMessageTaskToolErrorCode.TASK_NOT_FOUND,
      `AI message task ${input.task_id} not found after update.`
    );
  }

  const effectiveTools = input.allowed_tools ?? parseAllowedTools(existing);
  const effectiveAutoApprove =
    input.auto_approve_tools ?? existing.auto_approve_tools;
  const touchedToolPolicy =
    input.allowed_tools !== undefined || input.auto_approve_tools !== undefined;
  const warning =
    touchedToolPolicy && effectiveTools.length > 0 && !effectiveAutoApprove
      ? "allowed_tools are set but auto_approve_tools is false — scheduled runs will not execute those tools unattended. Set auto_approve_tools: true if this task needs them when running on a schedule."
      : undefined;

  const success: AiMessageTaskToolResult<{ task: SafeAiMessageTaskPayload }> = {
    success: true,
    data: { task: toSafeAiMessageTaskPayload(updated) },
  };
  if (warning && success.success) {
    success.warning = warning;
  }
  return success;
}
