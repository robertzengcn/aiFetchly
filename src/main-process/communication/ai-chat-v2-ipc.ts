import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AiChatApi } from "@/api/aiChatApi";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import { userSafeError } from "@/service/AIChatErrorMapper";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
} from "@/service/AIChatQueryEvents";
import {
  AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
  AI_CHAT_V2_MODELS,
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_HISTORY,
  AI_CHAT_V2_STREAM,
  AI_CHAT_V2_STREAM_STOP,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
  AI_CHAT_V2_PLAN_STATE,
  AI_CHAT_V2_ANSWER_QUESTION,
  AI_CHAT_V2_APPROVE_PLAN,
  AI_CHAT_V2_REJECT_PLAN,
  AI_CHAT_V2_REQUEST_PLAN_CHANGES,
  AI_CHAT_V2_PLAN_VERSIONS,
} from "@/config/channellist";
import type {
  AIChatPlanStateView,
  AIChatPlanVersionView,
  AskUserQuestionAnswer,
} from "@/entityTypes/aiChatPlanTypes";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  ChatV2StreamRequest,
  ChatV2StreamChunk,
  ChatV2MessageView,
  ChatV2HistoryResponse,
  ChatV2ConversationSummary,
  ChatV2MessageMetadata,
} from "@/entityTypes/aiChatV2Types";

/**
 * Minimal structural type for the IPC event object.
 * Mirrors the inline cast pattern used in ai-chat-ipc.ts (v1 handler).
 */
type IpcEventLike = {
  sender: { send: (channel: string, message: string) => void };
};

// -------------------------------------------------------------------------
// Singleton engine — owns all turn state that used to be module-level.
// -------------------------------------------------------------------------

let queryEngine: AIChatQueryEngine | null = null;

/** Build the production AIChatQueryLoop with real service deps. */
function createQueryLoop(): AIChatQueryLoop {
  const deps: AIChatQueryLoopDeps = {
    streamChatCompletion: (request, onChunk, options) => {
      const api = new AiChatApi();
      return api.openAIChatCompletionStream(request, onChunk, options);
    },
    executeTool: (name, args, context) => {
      return SkillExecutor.execute(name, args, context);
    },
    getSkillDefinition: (name) => SkillRegistry.getSkill(name) ?? undefined,
  };
  return new AIChatQueryLoop(deps);
}

function getQueryEngine(): AIChatQueryEngine {
  if (!queryEngine) {
    const loop = createQueryLoop();
    const tokenService = new Token();
    const agent = new AIChatCompactAgentService(tokenService, {
      completeChat: (request) => new AiChatApi().openAIChatCompletion(request),
      isEnabled: () => tokenService.getValue(USER_AI_ENABLED) === "true",
    });
    queryEngine = new AIChatQueryEngine(loop, { compactAgent: agent });
  }
  return queryEngine;
}

// -------------------------------------------------------------------------
// IPC helpers
// -------------------------------------------------------------------------

function isAIEnabled(): boolean {
  const tokenService = new Token();
  const value = tokenService.getValue(USER_AI_ENABLED);
  return value === "true";
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

function sendChunk(
  event: IpcEventLike,
  chunk: ChatV2StreamChunk,
  channel: string = AI_CHAT_V2_STREAM_CHUNK
): void {
  event.sender.send(channel, JSON.stringify(chunk));
}

function sendComplete(event: IpcEventLike, chunk: ChatV2StreamChunk): void {
  event.sender.send(AI_CHAT_V2_STREAM_COMPLETE, JSON.stringify(chunk));
}

/**
 * Adapter that converts AIChatQueryEvent to existing ChatV2StreamChunk
 * renderer events. Handles ALL event types including terminal events
 * (start, complete, cancelled, error) since the engine emits these.
 */
function createEventSink(event: IpcEventLike): AIChatQueryEventSink {
  return {
    emit: (e: AIChatQueryEvent) => {
      switch (e.type) {
        case "start":
          sendChunk(event, {
            eventType: "start",
            conversationId: e.conversationId,
            messageId: e.messageId,
          });
          break;
        case "token":
          sendChunk(event, {
            eventType: "token",
            conversationId: e.conversationId,
            messageId: e.messageId,
            contentDelta: e.contentDelta,
            model: e.model,
          });
          break;
        case "retry_connect":
          sendChunk(event, {
            eventType: "retry_connect",
            conversationId: e.conversationId,
            messageId: e.messageId,
            retryAttempt: e.retryAttempt,
            retryMaxAttempts: e.retryMaxAttempts,
            retryDelayMs: e.retryDelayMs,
          });
          break;
        case "tool_call":
          sendChunk(event, {
            eventType: "tool_call",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            toolArguments: e.toolArguments,
          });
          break;
        case "tool_result":
          sendChunk(event, {
            eventType: "tool_result",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            fullContent: e.fullContent,
            toolResult: e.toolResult,
            replacesPermissionPromptForToolId:
              e.replacesPermissionPromptForToolId,
          });
          break;
        case "plan_blocked_tool":
          sendChunk(event, {
            eventType: "plan_blocked_tool" as never,
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            fullContent: e.fullContent,
            planBlockedToolName: e.planBlockedToolName,
            planBlockedReason: e.planBlockedReason,
          } as ChatV2StreamChunk);
          break;
        case "ask_user_question":
          sendChunk(event, {
            eventType: "ask_user_question" as never,
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            question: e.question,
            planState: e.planState,
          } as ChatV2StreamChunk);
          break;
        case "plan_submitted":
          sendChunk(event, {
            eventType: "plan_submitted" as never,
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            planState: e.planState,
          } as ChatV2StreamChunk);
          break;
        case "complete":
          sendComplete(event, {
            eventType: "complete",
            conversationId: e.conversationId,
            messageId: e.messageId,
            fullContent: e.fullContent,
            model: e.model,
            finishReason: e.finishReason,
          });
          break;
        case "cancelled":
          sendComplete(event, {
            eventType: "cancelled",
            conversationId: e.conversationId,
            messageId: e.messageId,
            fullContent: e.fullContent,
          });
          break;
        case "error":
          sendComplete(event, {
            eventType: "error",
            conversationId: e.conversationId,
            messageId: e.messageId,
            errorMessage: e.errorMessage,
          });
          break;
      }
    },
  };
}

// -------------------------------------------------------------------------
// Stream handler (thin — delegates to engine)
// -------------------------------------------------------------------------

function validateStreamRequest(
  req: Partial<ChatV2StreamRequest>
): string | null {
  if (
    !req ||
    typeof req.message !== "string" ||
    req.message.trim().length === 0
  ) {
    return "Message must be a non-empty string";
  }
  if (req.conversationId !== undefined && req.conversationId === "pending") {
    return "conversationId must not be 'pending'";
  }
  if (
    req.temperature !== undefined &&
    (typeof req.temperature !== "number" ||
      req.temperature < 0 ||
      req.temperature > 2)
  ) {
    return "temperature must be a number in [0, 2]";
  }
  if (
    req.maxTokens !== undefined &&
    (typeof req.maxTokens !== "number" ||
      req.maxTokens <= 0 ||
      !Number.isInteger(req.maxTokens))
  ) {
    return "maxTokens must be a positive integer";
  }
  if (req.mode !== undefined && req.mode !== "chat" && req.mode !== "plan") {
    return "mode must be 'chat' or 'plan'";
  }
  return null;
}

async function handleStream(event: IpcEventLike, data: string): Promise<void> {
  // AI gate FIRST, before parsing request data.
  if (!isAIEnabled()) {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: "AI is not enabled",
    });
    return;
  }

  let req: ChatV2StreamRequest;
  try {
    req = JSON.parse(data ?? "{}");
  } catch {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: "Invalid request payload",
    });
    return;
  }

  const validationError = validateStreamRequest(req);
  if (validationError) {
    sendComplete(event, {
      eventType: "error",
      conversationId: req.conversationId ?? "",
      errorMessage: validationError,
    });
    return;
  }

  const engine = getQueryEngine();
  const eventSink = createEventSink(event);

  await engine.submitMessage({ request: req, eventSink });
}

function handleStop(): void {
  getQueryEngine().stopActiveTurn();
}

// -------------------------------------------------------------------------
// Resume handler: tool after permission
// -------------------------------------------------------------------------

async function handleResumeToolAfterPermission(
  data: string
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }

  const parsed = data
    ? (JSON.parse(data) as { toolId?: string; conversationId?: string })
    : {};
  if (!parsed.toolId || typeof parsed.toolId !== "string") {
    return denied("toolId is required");
  }

  const engine = getQueryEngine();
  const result = await engine.resumeToolAfterPermission({
    toolId: parsed.toolId,
    conversationId: parsed.conversationId,
  });
  return ok(result);
}

// -------------------------------------------------------------------------
// Models / Conversations / History / Clear handlers
// -------------------------------------------------------------------------

async function handleModels(): Promise<CommonMessage<unknown>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const api = new AiChatApi();
    const models = await api.listOpenAIModels();
    return ok(models);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleConversations(
  data?: string
): Promise<CommonMessage<ChatV2ConversationSummary[]>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const req = data ? JSON.parse(data) : {};
    const searchQuery =
      typeof req.searchQuery === "string" ? req.searchQuery : undefined;
    const module = new AIChatV2Module();
    return ok(await module.getConversations(searchQuery));
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleHistory(
  _e: IpcEventLike,
  data: string
): Promise<CommonMessage<ChatV2HistoryResponse | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const req = JSON.parse(data ?? "{}");
    if (typeof req.conversationId !== "string") {
      return denied("conversationId must be a string");
    }
    const conversationId: string = req.conversationId;
    if (!conversationId) {
      return denied("conversationId is required");
    }
    const module = new AIChatV2Module();
    const rows = await module.getConversationMessages(conversationId);
    const views: ChatV2MessageView[] = rows.map((r) => ({
      id: r.messageId,
      conversationId: r.conversationId,
      role: (r.role as ChatV2MessageView["role"]) ?? "user",
      content: r.content,
      timestamp: r.timestamp.toISOString(),
      messageType: r.messageType,
      model: r.model,
      tokensUsed: r.tokensUsed,
      metadata: parseMetadata(r.metadata),
    }));
    return ok({
      conversationId,
      messages: views,
      totalMessages: views.length,
    });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleClearConversation(
  _e: IpcEventLike,
  data: string
): Promise<CommonMessage<{ deleted: number } | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const req = JSON.parse(data ?? "{}");
    if (typeof req.conversationId !== "string") {
      return denied("conversationId must be a string");
    }
    const conversationId: string = req.conversationId;
    if (!conversationId) {
      return denied("conversationId is required");
    }
    const module = new AIChatV2Module();
    const deleted = await module.clearConversation(conversationId);
    // Cascade: clear any durable plan state for this conversation.
    try {
      const planModule = new AIChatPlanModule();
      await planModule.clearConversationPlanState(conversationId);
    } catch (err) {
      console.error("[ai-chat-v2] clearConversationPlanState failed:", err);
    }
    return ok({ deleted });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleClearAll(): Promise<
  CommonMessage<{ deleted: number } | null>
> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const module = new AIChatV2Module();
    const deleted = await module.clearAllV2History();
    return ok({ deleted });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

// -------------------------------------------------------------------------
// Plan Mode IPC handlers
// -------------------------------------------------------------------------

async function handlePlanState(
  data: string
): Promise<CommonMessage<AIChatPlanStateView | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const req = data ? JSON.parse(data) : {};
    if (typeof req.conversationId !== "string") {
      return denied("conversationId must be a string");
    }
    const planModule = new AIChatPlanModule();
    const planState = await planModule.getPlanState(req.conversationId);
    return ok(planState);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleAnswerQuestion(
  data: string
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  const parsed = data
    ? (JSON.parse(data) as {
        questionId?: string;
        answers?: AskUserQuestionAnswer[];
        conversationId?: string;
      })
    : {};
  if (!parsed.questionId || typeof parsed.questionId !== "string") {
    return denied("questionId is required");
  }
  if (!parsed.conversationId || typeof parsed.conversationId !== "string") {
    return denied("conversationId is required");
  }
  if (!Array.isArray(parsed.answers)) {
    return denied("answers must be an array");
  }

  const engine = getQueryEngine();
  const result = await engine.answerPlanQuestion({
    questionId: parsed.questionId,
    conversationId: parsed.conversationId,
    answers: parsed.answers,
  });
  return ok(result);
}

async function handleApprovePlan(
  data: string
): Promise<CommonMessage<AIChatPlanStateView | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  const parsed = data
    ? (JSON.parse(data) as {
        planId?: string;
        conversationId?: string;
        version?: number;
      })
    : {};
  if (!parsed.planId) {
    return denied("planId is required");
  }
  if (!parsed.conversationId) {
    return denied("conversationId is required");
  }
  if (typeof parsed.version !== "number") {
    return denied("version is required");
  }
  try {
    const planModule = new AIChatPlanModule();
    const planState = await planModule.approvePlan({
      conversationId: parsed.conversationId,
      planId: parsed.planId,
      version: parsed.version,
    });
    return ok(planState);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleRejectPlan(
  data: string
): Promise<CommonMessage<AIChatPlanStateView | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  const parsed = data
    ? (JSON.parse(data) as {
        planId?: string;
        conversationId?: string;
        version?: number;
        feedback?: string;
      })
    : {};
  if (!parsed.planId) {
    return denied("planId is required");
  }
  if (!parsed.conversationId) {
    return denied("conversationId is required");
  }
  if (typeof parsed.version !== "number") {
    return denied("version is required");
  }
  try {
    const planModule = new AIChatPlanModule();
    const planState = await planModule.rejectPlan({
      conversationId: parsed.conversationId,
      planId: parsed.planId,
      version: parsed.version,
      feedback: parsed.feedback,
    });
    return ok(planState);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleRequestPlanChanges(
  data: string
): Promise<CommonMessage<AIChatPlanStateView | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  const parsed = data
    ? (JSON.parse(data) as {
        planId?: string;
        conversationId?: string;
        version?: number;
        feedback?: string;
      })
    : {};
  if (!parsed.planId) {
    return denied("planId is required");
  }
  if (!parsed.conversationId) {
    return denied("conversationId is required");
  }
  if (typeof parsed.version !== "number") {
    return denied("version is required");
  }
  if (!parsed.feedback || parsed.feedback.trim().length === 0) {
    return denied("feedback is required");
  }
  try {
    const planModule = new AIChatPlanModule();
    const planState = await planModule.requestPlanChanges({
      conversationId: parsed.conversationId,
      planId: parsed.planId,
      version: parsed.version,
      feedback: parsed.feedback,
    });
    return ok(planState);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handlePlanVersions(
  data: string
): Promise<CommonMessage<AIChatPlanVersionView[] | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  const parsed = data ? (JSON.parse(data) as { planId?: string }) : {};
  if (!parsed.planId) {
    return denied("planId is required");
  }
  try {
    const planModule = new AIChatPlanModule();
    const versions = await planModule.listVersions(parsed.planId);
    return ok(versions);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

function parseMetadata(raw?: string | null): ChatV2MessageMetadata | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.source === "chat-v2") {
      return parsed as ChatV2MessageMetadata;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function registerAiChatV2IpcHandlers(): void {
  ipcMain.handle(
    AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
    async (_e, data: unknown) =>
      handleResumeToolAfterPermission((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_MODELS, async () => handleModels());
  ipcMain.handle(AI_CHAT_V2_CONVERSATIONS, async (_e, data: unknown) =>
    handleConversations(data as string)
  );
  ipcMain.handle(AI_CHAT_V2_HISTORY, async (_e, data: unknown) =>
    handleHistory(_e as IpcEventLike, data as string)
  );
  ipcMain.handle(AI_CHAT_V2_CLEAR_CONVERSATION, async (_e, data: unknown) =>
    handleClearConversation(_e as IpcEventLike, data as string)
  );
  ipcMain.handle(AI_CHAT_V2_CLEAR_ALL, async () => handleClearAll());
  ipcMain.handle(AI_CHAT_V2_PLAN_STATE, async (_e, data: unknown) =>
    handlePlanState((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_ANSWER_QUESTION, async (_e, data: unknown) =>
    handleAnswerQuestion((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_APPROVE_PLAN, async (_e, data: unknown) =>
    handleApprovePlan((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_REJECT_PLAN, async (_e, data: unknown) =>
    handleRejectPlan((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_REQUEST_PLAN_CHANGES, async (_e, data: unknown) =>
    handleRequestPlanChanges((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_PLAN_VERSIONS, async (_e, data: unknown) =>
    handlePlanVersions((data as string) ?? "")
  );
  ipcMain.on(AI_CHAT_V2_STREAM, async (event, data: unknown) => {
    try {
      await handleStream(event as IpcEventLike, data as string);
    } catch (err) {
      console.error("[ai-chat-v2] unhandled stream error:", err);
      const evt = event as IpcEventLike;
      sendComplete(evt, {
        eventType: "error",
        conversationId: "",
        errorMessage: userSafeError(err),
      });
    }
  });
  ipcMain.on(AI_CHAT_V2_STREAM_STOP, () => handleStop());
}
