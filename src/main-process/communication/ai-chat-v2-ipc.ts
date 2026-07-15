import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { noInputSchema } from "@/schemas/ipc/_shared/common";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

const unknownInputSchema = lazySchema(() => z.unknown());

/** Unwrap a handleX CommonMessage return: throw on status:false, return data on success. */
async function unwrap<T>(p: Promise<{ status: boolean; msg?: string; data?: T }>): Promise<T> {
  const res = await p;
  if (!res.status) throw new Error(res.msg || "Unknown error");
  return res.data as T;
}


import { ipcMain as ipcMain } from "electron";
import { log } from "@/modules/Logger";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED, USERSDBPATH } from "@/config/usersetting";
import { AiChatApi } from "@/api/aiChatApi";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import { AIChatModelFallbackService } from "@/service/AIChatModelFallbackService";
import {
  getSharedAutoDreamService,
  resetSharedAutoDreamService,
  getSharedWorkspaceAutoDreamService,
} from "@/service/AIAutoDreamFactory";
import { AIChatToolApprovalModule } from "@/modules/AIChatToolApprovalModule";
import { evaluateToolApproval } from "@/service/AIChatToolApprovalPolicyService";
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
  AI_CHAT_V2_COMPACT_CONVERSATION,
  AI_CHAT_V2_GET_TOOL_APPROVAL_MODE,
  AI_CHAT_V2_SET_TOOL_APPROVAL_MODE,
} from "@/config/channellist";
import type {
  AIChatPlanStateView,
  AIChatPlanVersionView,
  AskUserQuestionAnswer,
} from "@/entityTypes/aiChatPlanTypes";
import type { CommonMessage } from "@/entityTypes/commonType";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";
import type {
  ChatV2StreamRequest,
  ChatV2StreamChunk,
  ChatV2MessageView,
  ChatV2HistoryResponse,
  ChatV2ConversationSummary,
  ChatV2MessageMetadata,
  ChatV2UploadedAttachment,
  ChatV2AttachmentKind,
  ChatToolApprovalMode,
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
let compactAgent: AIChatCompactAgentService | null = null;
let queryEngineDbPath: string | null = null;
let compactAgentDbPath: string | null = null;

/** Build the production AIChatQueryLoop with real service deps. */
function createQueryLoop(): AIChatQueryLoop {
  const deps: AIChatQueryLoopDeps = {
    streamChatCompletion: (request, onChunk, options) => {
      const api = new AiChatApi();
      return api.openAIChatCompletionStream(request, onChunk, options);
    },
    executeTool: (name, args, context) => {
      // Tool approval mode check — auto-approve eligible tools without
      // showing a permission prompt, based on the conversation's mode.
      if (context.conversationId) {
        try {
          const module = new AIChatToolApprovalModule();
          const mode = module.getMode(context.conversationId);
          if (mode !== "ask_for_approval") {
            const decision = evaluateToolApproval({
              conversationId: context.conversationId,
              mode,
              toolName: name,
              isDependencyInstall: name.startsWith("install_system_dependency"),
            });
            if (decision.autoApprove) {
              context = { ...context, skipPermissionCheck: true };
              log.info(
                `[ai-chat-v2] auto-approved tool "${name}" for conversation ${context.conversationId}: ${decision.reason}`
              );
            }
          }
        } catch (err) {
          // Non-fatal: fall back to normal permission flow
          log.warn(
            "[ai-chat-v2] failed to evaluate tool approval mode, falling back to default:",
            err
          );
        }
      }
      return SkillExecutor.execute(name, args, context);
    },
    getSkillDefinition: (name) => SkillRegistry.getSkill(name) ?? undefined,
    resolveFallbackModel: async ({ originalModel, currentModel, reason }) => {
      // Lazily construct the fallback service so we don't pay the catalog
      // fetch on every loop construction — only when recovery triggers.
      const svc = new AIChatModelFallbackService();
      return svc.resolve({ originalModel, currentModel, reason });
    },
  };
  return new AIChatQueryLoop(deps);
}

function getCurrentUserDbPath(): string | null {
  const tokenService = new Token();
  return tokenService.getValue(USERSDBPATH) || null;
}

export function resetAiChatV2RuntimeForDatabaseSwitch(): void {
  if (queryEngine) {
    queryEngine.stopActiveTurn();
  }
  queryEngine = null;
  compactAgent = null;
  queryEngineDbPath = null;
  compactAgentDbPath = null;
  resetSharedAutoDreamService();
}

function getCompactAgent(): AIChatCompactAgentService {
  const dbPath = getCurrentUserDbPath();
  if (compactAgent && compactAgentDbPath !== dbPath) {
    compactAgent = null;
    compactAgentDbPath = null;
    resetSharedAutoDreamService();
  }
  if (!compactAgent) {
    const tokenService = new Token();
    compactAgent = new AIChatCompactAgentService(tokenService, {
      completeChat: (request) => new AiChatApi().openAIChatCompletion(request),
      isEnabled: () => tokenService.getValue(USER_AI_ENABLED) === "true",
    });
    compactAgentDbPath = dbPath;
  }
  return compactAgent;
}

function getQueryEngine(): AIChatQueryEngine {
  const dbPath = getCurrentUserDbPath();
  if (queryEngine && queryEngineDbPath !== dbPath) {
    resetAiChatV2RuntimeForDatabaseSwitch();
  }
  if (!queryEngine) {
    const loop = createQueryLoop();
    queryEngine = new AIChatQueryEngine(loop, {
      compactAgent: getCompactAgent(),
      autoDreamService: getSharedAutoDreamService(),
      workspaceAutoDreamService: getSharedWorkspaceAutoDreamService(),
    });
    queryEngineDbPath = dbPath;
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
  log.info(
    `[ai-chat-v2] IPC complete event=${chunk.eventType} conv=${
      chunk.conversationId || "(none)"
    } message=${chunk.messageId || "(none)"} fullContentLen=${
      chunk.fullContent?.length ?? 0
    } finish=${chunk.finishReason ?? "(none)"} error=${
      chunk.errorMessage ? "yes" : "no"
    }`
  );
  event.sender.send(AI_CHAT_V2_STREAM_COMPLETE, JSON.stringify(chunk));
}

/**
 * Adapter that converts AIChatQueryEvent to existing ChatV2StreamChunk
 * renderer events. Handles ALL event types including terminal events
 * (start, complete, cancelled, error) since the engine emits these.
 */
function createEventSink(event: IpcEventLike): AIChatQueryEventSink {
  let tokenLogCount = 0;
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
          if (tokenLogCount < 5 || tokenLogCount % 25 === 0) {
            log.info(
              `[ai-chat-v2] IPC token conv=${e.conversationId} message=${e.messageId} deltaLen=${e.contentDelta.length} tokenIndex=${tokenLogCount}`
            );
          }
          tokenLogCount += 1;
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
        case "recovery_status":
          sendChunk(event, {
            eventType: "recovery_status",
            conversationId: e.conversationId,
            messageId: e.messageId,
            recoveryLayer: e.layer,
            recoveryReason: e.reason,
            recoveryAttempt: e.attempt,
            recoveryMaxAttempts: e.maxAttempts,
            recoveryDelayMs: e.delayMs,
            recoveryElapsedMs: e.elapsedMs,
            recoveryOriginalModel: e.originalModel,
            recoveryCurrentModel: e.currentModel,
            recoveryFallbackModel: e.fallbackModel,
            recoveryMessage: e.message,
          });
          break;
        case "tool_progress":
          sendChunk(event, {
            eventType: "tool_progress",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            phase: e.phase,
            progressMessage: e.message,
            progressFraction:
              typeof e.progress === "number" ? e.progress : undefined,
            partialCount: e.partialCount ?? undefined,
            expectedCount: e.expectedCount ?? undefined,
            progressTimestamp: e.timestamp,
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
        case "plan_state":
          sendChunk(event, {
            eventType: "plan_state" as never,
            conversationId: e.conversationId,
            messageId: e.messageId,
            planState: e.planState,
            autoEntered: e.autoEntered,
          } as ChatV2StreamChunk);
          break;
        case "usage_update":
          sendChunk(event, {
            eventType: "usage_update",
            conversationId: e.conversationId,
            messageId: e.messageId,
            model: e.model,
            promptTokens: e.promptTokens,
            completionTokens: e.completionTokens,
            totalTokens: e.totalTokens,
          });
          break;
        case "complete":
          sendComplete(event, {
            eventType: "complete",
            conversationId: e.conversationId,
            messageId: e.messageId,
            fullContent: e.fullContent,
            model: e.model,
            finishReason: e.finishReason,
            promptTokens: e.promptTokens,
            completionTokens: e.completionTokens,
            totalTokens: e.totalTokens,
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
  const hasFiles =
    Array.isArray(req.uploadedFiles) && req.uploadedFiles.length > 0;
  if (
    !req ||
    typeof req.message !== "string" ||
    req.message.trim().length === 0
  ) {
    if (!hasFiles) {
      return "Message must be a non-empty string";
    }
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
  if (
    req.toolApprovalMode !== undefined &&
    req.toolApprovalMode !== "ask_for_approval" &&
    req.toolApprovalMode !== "approve_for_me" &&
    req.toolApprovalMode !== "full_access"
  ) {
    return "toolApprovalMode must be a valid approval mode";
  }
  return null;
}
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;

function classifyAttachment(
  fileName: string,
  mimeType: string
): ChatV2AttachmentKind | null {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))
    return "image";
  if (name.endsWith(".webp") || name.endsWith(".gif")) return "image";

  if (mime === "application/pdf" || name.endsWith(".pdf")) return "document";
  if (
    mime === "text/csv" ||
    mime === "application/csv" ||
    name.endsWith(".csv")
  )
    return "document";
  if (name.endsWith(".docx") || mime.includes("wordprocessingml.document"))
    return "document";
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    mime.includes("spreadsheetml.sheet")
  )
    return "document";

  return null;
}

function normalizeChatV2UploadedFiles(
  input: unknown
): ChatV2UploadedAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ChatV2UploadedAttachment[] = [];
  let totalImageBase64Bytes = 0;

  for (const item of input) {
    if (!item || typeof item !== "object") continue;

    const fileName =
      typeof (item as Record<string, unknown>).fileName === "string"
        ? ((item as Record<string, unknown>).fileName as string)
        : "";
    const mimeType =
      typeof (item as Record<string, unknown>).mimeType === "string"
        ? ((item as Record<string, unknown>).mimeType as string)
        : "";
    const sizeBytes =
      typeof (item as Record<string, unknown>).sizeBytes === "number"
        ? ((item as Record<string, unknown>).sizeBytes as number)
        : 0;
    const contentBase64 =
      typeof (item as Record<string, unknown>).contentBase64 === "string"
        ? ((item as Record<string, unknown>).contentBase64 as string)
        : "";
    const kind =
      typeof (item as Record<string, unknown>).kind === "string"
        ? ((item as Record<string, unknown>).kind as string)
        : "";

    if (!fileName || !contentBase64) continue;

    // Classify attachment to verify kind matches content
    const detectedKind = classifyAttachment(fileName, mimeType);
    if (!detectedKind) continue;
    if (kind !== "document" && kind !== "image") continue;
    if (kind !== detectedKind) continue;

    // Validate base64 length vs declared size
    if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_FILE_BYTES) continue;
    try {
      const decodedLen = Buffer.from(contentBase64, "base64").length;
      if (decodedLen !== sizeBytes) continue;
    } catch {
      continue;
    }

    // Validate total image payload size
    if (kind === "image") {
      totalImageBase64Bytes += contentBase64.length;
      if (totalImageBase64Bytes > MAX_TOTAL_IMAGE_BASE64_BYTES) continue;
    }

    out.push({
      fileName,
      mimeType,
      sizeBytes,
      contentBase64,
      kind: kind as ChatV2AttachmentKind,
    });
  }

  return out;
}

//handleStream is the main function that handles the stream request
async function handleStream(event: IpcEventLike, data: string): Promise<void> {
  // AI gate FIRST, before parsing request data.
  if (!isAIEnabled()) {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: "AI functionality is only available to subscribers.",
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

  // Normalize uploaded files
  const uploadedFiles = normalizeChatV2UploadedFiles(req.uploadedFiles);
  const processedReq = {
    ...req,
    uploadedFiles: uploadedFiles.length > 0 ? uploadedFiles : undefined,
  };

  await engine.submitMessage({ request: processedReq, eventSink });
}

function handleStop(): void {
  getQueryEngine().stopActiveTurn();
}

// -------------------------------------------------------------------------
// Resume handler: tool after permission
// -------------------------------------------------------------------------

async function handleResumeToolAfterPermission(
  data: unknown
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  if (!isAIEnabled()) {
    return denied("AI functionality is only available to subscribers.");
  }

  let parsed: { toolId?: unknown; conversationId?: unknown };
  try {
    parsed =
      typeof data === "string"
        ? ((data ? JSON.parse(data) : {}) as {
            toolId?: unknown;
            conversationId?: unknown;
          })
        : data && typeof data === "object"
        ? (data as { toolId?: unknown; conversationId?: unknown })
        : {};
  } catch {
    return denied("Invalid resume payload");
  }
  if (!parsed.toolId || typeof parsed.toolId !== "string") {
    return denied("toolId is required");
  }

  const engine = getQueryEngine();
  const result = await engine.resumeToolAfterPermission({
    toolId: parsed.toolId,
    conversationId:
      typeof parsed.conversationId === "string"
        ? parsed.conversationId
        : undefined,
  });
  return ok(result);
}

// -------------------------------------------------------------------------
// Models / Conversations / History / Clear handlers
// -------------------------------------------------------------------------

async function handleModels(): Promise<CommonMessage<unknown>> {
  if (!isAIEnabled()) {
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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
      log.error("[ai-chat-v2] clearConversationPlanState failed:", err);
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
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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
    return denied("AI functionality is only available to subscribers.");
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

async function handleCompactConversation(
  data: string
): Promise<CommonMessage<AIChatCompactSummaryView | null>> {
  if (!isAIEnabled()) {
    return denied("AI functionality is only available to subscribers.");
  }
  const parsed = data
    ? (JSON.parse(data) as { conversationId?: string; model?: string })
    : {};
  if (!parsed.conversationId) {
    return denied("conversationId is required");
  }
  if (!parsed.conversationId.startsWith("v2-")) {
    return denied("conversationId must be a v2- conversation id");
  }
  try {
    const summary = await getCompactAgent().runFullCompact({
      conversationId: parsed.conversationId,
      model: parsed.model,
    });
    return ok(summary);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

function parseSetApprovalModePayload(
  data: string
): { conversationId: string; mode: string } | null {
  try {
    const parsed = JSON.parse(data) as {
      conversationId?: string;
      mode?: string;
    };
    if (
      typeof parsed.conversationId !== "string" ||
      parsed.conversationId.length === 0
    ) {
      return null;
    }
    const validModes: ChatToolApprovalMode[] = [
      "ask_for_approval",
      "approve_for_me",
      "full_access",
    ];
    if (!validModes.includes(parsed.mode as ChatToolApprovalMode)) {
      return null;
    }
    return {
      conversationId: parsed.conversationId,
      mode: parsed.mode as ChatToolApprovalMode,
    };
  } catch {
    return null;
  }
}

async function handleGetToolApprovalMode(
  data: string
): Promise<CommonMessage<string>> {
  if (!isAIEnabled()) {
    return denied("AI functionality is only available to subscribers.");
  }
  const parsed = data ? (JSON.parse(data) as { conversationId?: string }) : {};
  if (!parsed.conversationId) {
    return denied("conversationId is required");
  }
  try {
    const module = new AIChatToolApprovalModule();
    const mode = module.getMode(parsed.conversationId);
    return ok(mode);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleSetToolApprovalMode(
  data: string
): Promise<CommonMessage<string>> {
  if (!isAIEnabled()) {
    return denied("AI functionality is only available to subscribers.");
  }
  const payload = parseSetApprovalModePayload(data);
  if (!payload) {
    return denied("conversationId and valid mode are required");
  }
  try {
    const module = new AIChatToolApprovalModule();
    module.setMode(
      payload.conversationId,
      payload.mode as ChatToolApprovalMode
    );
    // Return the mode that was just set. Do NOT call getMode() here —
    // its startup-reset downgrades full_access back to ask_for_approval
    // on the very first read, making it impossible to select "Full access".
    return ok(payload.mode);
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
  registerValidatedHandler(
    AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
    unknownInputSchema,
    async (input) =>
      unwrap(handleResumeToolAfterPermission(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_MODELS, noInputSchema, async () => unwrap(handleModels()));
  registerValidatedHandler(AI_CHAT_V2_CONVERSATIONS, unknownInputSchema, async (input) =>
    unwrap(handleConversations(JSON.stringify(input ?? {})))
  );
  registerValidatedHandler(AI_CHAT_V2_HISTORY, unknownInputSchema, async (input, event) =>
    unwrap(handleHistory(event as IpcEventLike, JSON.stringify(input ?? {})))
  );
  registerValidatedHandler(AI_CHAT_V2_CLEAR_CONVERSATION, unknownInputSchema, async (input, event) =>
    unwrap(handleClearConversation(event as IpcEventLike, JSON.stringify(input ?? {})))
  );
  registerValidatedHandler(AI_CHAT_V2_CLEAR_ALL, noInputSchema, async () => unwrap(handleClearAll()));
  registerValidatedHandler(AI_CHAT_V2_PLAN_STATE, unknownInputSchema, async (input) =>
    unwrap(handlePlanState(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_ANSWER_QUESTION, unknownInputSchema, async (input) =>
    unwrap(handleAnswerQuestion(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_APPROVE_PLAN, unknownInputSchema, async (input) =>
    unwrap(handleApprovePlan(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_REJECT_PLAN, unknownInputSchema, async (input) =>
    unwrap(handleRejectPlan(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_REQUEST_PLAN_CHANGES, unknownInputSchema, async (input) =>
    unwrap(handleRequestPlanChanges(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_PLAN_VERSIONS, unknownInputSchema, async (input) =>
    unwrap(handlePlanVersions(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_COMPACT_CONVERSATION, unknownInputSchema, async (input) =>
    unwrap(handleCompactConversation(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_GET_TOOL_APPROVAL_MODE, unknownInputSchema, async (input) =>
    unwrap(handleGetToolApprovalMode(JSON.stringify(input ?? "{}")))
  );
  registerValidatedHandler(AI_CHAT_V2_SET_TOOL_APPROVAL_MODE, unknownInputSchema, async (input) =>
    unwrap(handleSetToolApprovalMode(JSON.stringify(input ?? "{}")))
  );
  // Stream handler send message to the AI engine and receive chunks back
  ipcMain.on(AI_CHAT_V2_STREAM, async (event, data: unknown) => {
    try {
      await handleStream(event as IpcEventLike, data as string);
    } catch (err) {
      log.error("[ai-chat-v2] unhandled stream error:", err);
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
