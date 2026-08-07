import { ipcMain } from "electron";
import { z } from "zod/v4";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import {
  AI_CHAT_V2_SCHEDULED_LOOP_CREATE,
  AI_CHAT_V2_SCHEDULED_LOOP_GET,
  AI_CHAT_V2_SCHEDULED_LOOP_PAUSE,
  AI_CHAT_V2_SCHEDULED_LOOP_RESUME,
  AI_CHAT_V2_SCHEDULED_LOOP_STOP,
  AI_CHAT_V2_SCHEDULED_LOOP_STOP_RUN,
} from "@/config/channellist";
import {
  AIChatScheduledLoopModule,
  ScheduledLoopError,
} from "@/modules/AIChatScheduledLoopModule";
import type { CommonMessage } from "@/entityTypes/commonType";
import type { ScheduledLoopErrorCode } from "@/entityTypes/aiChatScheduledLoopTypes";

// Reuses the CommonMessage envelope shape used by the other Chat V2 handlers.
function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}
function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

/** Stable English messages for each error code. Renderer may localize by code. */
const ERROR_MESSAGES: Readonly<Record<ScheduledLoopErrorCode, string>> = {
  INVALID_LOOP_SYNTAX: "The /loop command could not be parsed.",
  INVALID_INTERVAL: "The interval must be between 1 minute and 24 hours.",
  INVALID_LOOP_LIMIT: "The run count or lifetime limit is invalid.",
  PROMPT_REQUIRED: "A prompt is required for a scheduled loop.",
  LOOP_ALREADY_ACTIVE:
    "This conversation already has an active scheduled loop.",
  CONVERSATION_REQUIRED: "A Chat V2 conversation could not be resolved.",
  CONVERSATION_NOT_FOUND: "The bound conversation no longer exists.",
  CONVERSATION_MISMATCH:
    "Conversation identifiers disagree; the loop was paused.",
  CONVERSATION_BUSY:
    "An interactive turn is running; the scheduled run was deferred.",
  AI_DISABLED: "AI functionality is only available to subscribers.",
  WORKSPACE_UNAVAILABLE: "The required workspace is unavailable.",
  BLOCKED_BY_POLICY:
    "A tool needed unattended approval that is not available; the loop was paused.",
  RUN_TIMEOUT: "The scheduled run exceeded its time budget.",
  REPEATED_RUN_FAILURE: "The loop failed repeatedly and was stopped.",
  SCHEDULE_EXPIRED: "The scheduled loop reached its lifetime or run limit.",
  MAX_RUNS_REACHED: "The scheduled loop reached its maximum run count.",
  RUN_INTERRUPTED: "The scheduled run was interrupted.",
};

function messageForCode(code: ScheduledLoopErrorCode): string {
  return ERROR_MESSAGES[code] ?? code;
}

/** AI-enablement gate — checked before parsing request data or doing work. */
function isAiEnabled(): boolean {
  return new Token().getValue(USER_AI_ENABLED) === "true";
}

const createSchema = z.object({
  conversationId: z.string().optional(),
  rawCommand: z.string().min(1),
  prompt: z.string().min(1),
  intervalMs: z.number().int().positive(),
  maxRuns: z.number().int().positive(),
  maxLifetimeMs: z.number().int().positive(),
  model: z.string().optional(),
  allowedTools: z.array(z.string().min(1)).max(50).optional(),
  autoApproveTools: z.boolean().optional(),
  allowSkills: z.boolean().optional(),
  allowMcp: z.boolean().optional(),
  allowSubagents: z.boolean().optional(),
});

const conversationSchema = z.object({
  conversationId: z.string().min(1),
});

/** Decode a preload payload with a Zod schema. Electron serializes objects
 * before invoking IPC handlers, while tests/dev bridges may pass objects. */
function decode<T>(
  schema: z.ZodType<T>,
  data: unknown
): { ok: true; value: T } | { ok: false; message: string } {
  let payload: unknown = data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return { ok: false, message: "Invalid request payload" };
    }
  }
  const result = schema.safeParse(payload);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    message: "Invalid request payload",
  };
}

function handleScheduledLoopError(err: unknown): CommonMessage<unknown> {
  if (err instanceof ScheduledLoopError) {
    return denied(messageForCode(err.code));
  }
  const message = err instanceof Error ? err.message : "Scheduled loop failed.";
  return denied(message);
}

async function handleCreate(data: unknown): Promise<CommonMessage<unknown>> {
  if (!isAiEnabled()) {
    return denied(messageForCode("AI_DISABLED"));
  }
  const decoded = decode(createSchema, data);
  if (!decoded.ok) return denied(decoded.message);
  const module = new AIChatScheduledLoopModule();
  try {
    const response = await module.create(decoded.value);
    return ok(response);
  } catch (err) {
    return handleScheduledLoopError(err);
  }
}

async function handleGet(data: unknown): Promise<CommonMessage<unknown>> {
  if (!isAiEnabled()) {
    return denied(messageForCode("AI_DISABLED"));
  }
  const decoded = decode(conversationSchema, data);
  if (!decoded.ok) return denied(decoded.message);
  const module = new AIChatScheduledLoopModule();
  try {
    const view = await module.getStatus(decoded.value.conversationId);
    return ok(view);
  } catch (err) {
    return handleScheduledLoopError(err);
  }
}

async function handleControl(
  data: unknown,
  op: "pause" | "resume" | "stop"
): Promise<CommonMessage<unknown>> {
  if (!isAiEnabled()) {
    return denied(messageForCode("AI_DISABLED"));
  }
  const decoded = decode(conversationSchema, data);
  if (!decoded.ok) return denied(decoded.message);
  const module = new AIChatScheduledLoopModule();
  try {
    const view =
      op === "pause"
        ? await module.pause(decoded.value.conversationId)
        : op === "resume"
        ? await module.resume(decoded.value.conversationId)
        : await module.stop(decoded.value.conversationId);
    return ok(view);
  } catch (err) {
    return handleScheduledLoopError(err);
  }
}

async function handleStopRun(data: unknown): Promise<CommonMessage<unknown>> {
  if (!isAiEnabled()) {
    return denied(messageForCode("AI_DISABLED"));
  }
  const decoded = decode(conversationSchema, data);
  if (!decoded.ok) return denied(decoded.message);
  const module = new AIChatScheduledLoopModule();
  try {
    const result = await module.stopCurrentRun(decoded.value.conversationId);
    return ok(result);
  } catch (err) {
    return handleScheduledLoopError(err);
  }
}

/**
 * Register /loop scheduled-loop IPC handlers.
 *
 * EVERY handler checks USER_AI_ENABLED before parsing request data, constructing
 * modules, or mutating schedules (FR-17, technical-design §12.2). Handlers
 * contain no direct database access — they delegate to AIChatScheduledLoopModule.
 */
export function registerAiChatScheduledLoopIpcHandlers(): void {
  ipcMain.handle(AI_CHAT_V2_SCHEDULED_LOOP_CREATE, async (_e, data: unknown) =>
    handleCreate(data)
  );
  ipcMain.handle(AI_CHAT_V2_SCHEDULED_LOOP_GET, async (_e, data: unknown) =>
    handleGet(data)
  );
  ipcMain.handle(AI_CHAT_V2_SCHEDULED_LOOP_PAUSE, async (_e, data: unknown) =>
    handleControl(data, "pause")
  );
  ipcMain.handle(AI_CHAT_V2_SCHEDULED_LOOP_RESUME, async (_e, data: unknown) =>
    handleControl(data, "resume")
  );
  ipcMain.handle(AI_CHAT_V2_SCHEDULED_LOOP_STOP, async (_e, data: unknown) =>
    handleControl(data, "stop")
  );
  ipcMain.handle(
    AI_CHAT_V2_SCHEDULED_LOOP_STOP_RUN,
    async (_e, data: unknown) => handleStopRun(data)
  );
}
