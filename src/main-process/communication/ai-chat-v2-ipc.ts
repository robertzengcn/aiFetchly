import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import {
  AiChatApi,
  type OpenAIChatMessage,
  type OpenAITool,
  type ToolFunction,
} from "@/api/aiChatApi";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { buildOpenAITranscript } from "@/service/OpenAIChatTranscriptBuilder";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  serializeToolResultContent,
  normalizeToolResult,
  isPermissionPromptResult,
} from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
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
  AIChatPlanQuestionView,
  AIChatPlanVersionView,
  AskUserQuestionAnswer,
  AskUserQuestionPayload,
  SubmitPlanForApprovalPayload,
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

const CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES = 30;

/**
 * Minimal structural type for the IPC event object.
 * Mirrors the inline cast pattern used in ai-chat-ipc.ts (v1 handler).
 */
type IpcEventLike = {
  sender: { send: (channel: string, message: string) => void };
};

let currentAbortController: AbortController | null = null;
let currentConversationId: string | null = null;

type PendingPermissionState = {
  event: IpcEventLike;
  module: AIChatV2Module;
  api: AiChatApi;
  req: ChatV2StreamRequest;
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  nextRound: number;
  toolCallId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
};

let pendingPermissionState: PendingPermissionState | null = null;

type PendingPlanQuestionState = {
  event: IpcEventLike;
  module: AIChatV2Module;
  planModule: AIChatPlanModule;
  api: AiChatApi;
  req: ChatV2StreamRequest;
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  nextRound: number;
  toolCallId: string;
  questionId: string;
  planId: string;
};

let pendingPlanQuestionState: PendingPlanQuestionState | null = null;

function hasPendingPermissionForConversation(conversationId: string): boolean {
  const pendingState = pendingPermissionState as PendingPermissionState | null;
  return pendingState?.conversationId === conversationId;
}

function hasPendingPlanQuestionForConversation(
  conversationId: string
): boolean {
  return pendingPlanQuestionState?.conversationId === conversationId;
}

function isActivePlanState(plan?: AIChatPlanStateView | null): boolean {
  if (!plan) return false;
  return (
    plan.status !== "completed" &&
    plan.status !== "cancelled" &&
    plan.status !== "rejected"
  );
}

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

function toOpenAITools(toolFunctions: ToolFunction[]): OpenAITool[] {
  return toolFunctions
    .filter((tool) => tool.type === "function" && typeof tool.name === "string")
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
}

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

/** Adapter that converts AIChatQueryEvent to existing ChatV2StreamChunk renderer events. */
function createEventSink(
  event: IpcEventLike,
  _conversationId: string
): AIChatQueryEventSink {
  return {
    emit: (e: AIChatQueryEvent) => {
      switch (e.type) {
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
        // start, complete, cancelled, error are handled by handleLoopResult()
      }
    },
  };
}

/** Handle the result from AIChatQueryLoop.run() — persist messages and emit terminal events. */
async function handleLoopResult(args: {
  result: AIChatQueryLoopResult;
  event: IpcEventLike;
  module: AIChatV2Module;
  conversationId: string;
  assistantMessageId: string;
}): Promise<void> {
  const { result, event, module, conversationId, assistantMessageId } = args;

  switch (result.type) {
    case "completed": {
      if (result.fullContent.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: result.fullContent,
          messageId: assistantMessageId,
          model: result.model,
          metadata: {
            source: "chat-v2",
            openaiResponseId: result.responseId,
            finishReason: result.finishReason,
          },
        });
      }
      sendComplete(event, {
        eventType: "complete",
        conversationId,
        messageId: assistantMessageId,
        fullContent: result.fullContent,
        model: result.model,
        finishReason: result.finishReason,
      });
      currentAbortController = null;
      currentConversationId = null;
      break;
    }
    case "cancelled": {
      if (result.partialContent.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: result.partialContent,
          messageId: assistantMessageId,
          model: result.model,
          metadata: {
            source: "chat-v2",
            openaiResponseId: result.responseId,
            finishReason: "cancelled",
            cancelled: true,
          } as ChatV2MessageMetadata,
        });
      }
      sendComplete(event, {
        eventType: "cancelled",
        conversationId,
        messageId:
          result.partialContent.length > 0 ? assistantMessageId : undefined,
        fullContent: result.partialContent,
      });
      currentAbortController = null;
      currentConversationId = null;
      break;
    }
    case "failed": {
      if (result.partialContent.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: result.partialContent,
          messageId: assistantMessageId,
          model: result.model,
          metadata: {
            source: "chat-v2",
            openaiResponseId: result.responseId,
            finishReason: "error",
            error: userSafeError(result.error),
          },
        });
      }
      sendComplete(event, {
        eventType: "error",
        conversationId,
        messageId:
          result.partialContent.length > 0 ? assistantMessageId : undefined,
        errorMessage: userSafeError(result.error),
      });
      currentAbortController = null;
      currentConversationId = null;
      pendingPermissionState = null;
      break;
    }
    case "paused_for_permission": {
      pendingPermissionState = {
        event,
        module,
        api: new AiChatApi(),
        req: result.pending.request,
        conversationId: result.pending.conversationId,
        assistantMessageId: result.pending.assistantMessageId,
        conversationMessages: result.pending.conversationMessages,
        abortController: result.pending.abortController,
        nextRound: result.pending.nextRound,
        toolCallId: result.pending.toolCallId,
        toolName: result.pending.toolName,
        toolArguments: result.pending.toolArguments,
      };
      console.log(
        `[ai-chat-v2] tool ${result.pending.toolName} needs permission — paused (nextRound=${result.pending.nextRound})`
      );
      break;
    }
    case "paused_for_plan_question": {
      pendingPlanQuestionState = {
        event,
        module,
        planModule: new AIChatPlanModule(),
        api: new AiChatApi(),
        req: result.pending.request,
        conversationId: result.pending.conversationId,
        assistantMessageId: result.pending.assistantMessageId,
        conversationMessages: result.pending.conversationMessages,
        abortController: result.pending.abortController,
        nextRound: result.pending.nextRound,
        toolCallId: result.pending.toolCallId,
        questionId: result.pending.questionId,
        planId: result.pending.planId,
      };
      console.log(
        `[ai-chat-v2] AskUserQuestion paused (questionId=${result.pending.questionId}, nextRound=${result.pending.nextRound})`
      );
      break;
    }
  }
}

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

  const module = new AIChatV2Module();
  const planModule = new AIChatPlanModule();
  let planState: AIChatPlanStateView | null = null;
  if (req.conversationId && req.conversationId.startsWith("v2-")) {
    try {
      planState = await planModule.getPlanState(req.conversationId);
    } catch {
      // ignore lookup failures before conversation resolution
    }
  }
  const isPlanMode = req.mode === "plan" || isActivePlanState(planState);
  let conversationId: string;
  let transcript: ReturnType<typeof buildOpenAITranscript>;
  let assistantMessageId: string;

  // Database operations and transcript building happen before the streaming
  // try/catch. Wrap them so a failure sends a proper error response instead
  // of silently hanging the renderer.
  try {
    conversationId = module.createConversationIfNeeded(req.conversationId);
    currentConversationId = conversationId;

    // Resolve plan state now that we have the final conversation id.
    if (isPlanMode) {
      if (!planState) {
        planState = await planModule.ensurePlanForConversation({
          conversationId,
          title: req.message.slice(0, 80) || "New plan",
          objective: req.message.slice(0, 500),
        });
      } else if (planState.conversationId !== conversationId) {
        planState = await planModule.getPlanState(conversationId);
      }
    }

    // Save user message before remote call; capture its messageId so we can
    // exclude ONLY this row from the transcript (it is re-appended via
    // currentUserMessage). Filtering by content would silently drop earlier
    // turns that happen to share the same text (e.g. "ok", "thanks").
    const savedUser = await module.saveUserMessage({
      conversationId,
      content: req.message,
    });

    // Load history and build transcript.
    const history = await module.getConversationMessages(conversationId);
    const basePrompt = req.systemPrompt ?? module.getDefaultSystemPrompt();
    transcript = buildOpenAITranscript({
      history: history.filter((r) => r.messageId !== savedUser.messageId),
      currentUserMessage: req.message,
      systemPrompt: isPlanMode
        ? buildPlanModeSystemPrompt({
            baseSystemPrompt: basePrompt,
            planState,
          })
        : basePrompt,
      filterSource: "chat-v2",
      maxMessages: CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES,
    });

    assistantMessageId = `assistant-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  } catch (err) {
    console.error("[ai-chat-v2] pre-stream error:", err);
    currentConversationId = null;
    sendComplete(event, {
      eventType: "error",
      conversationId: req.conversationId ?? "",
      errorMessage: userSafeError(err),
    });
    return;
  }

  const toolFunctions = await SkillRegistry.getAllToolFunctions();
  const openAITools = toOpenAITools(toolFunctions);
  const allOpenAITools = isPlanMode
    ? [...openAITools, ...PlanModeToolRegistry.toOpenAITools()]
    : openAITools;
  const conversationMessages: OpenAIChatMessage[] = [...transcript.messages];

  const abortController = new AbortController();
  // Abort any prior stream before overwriting the reference (defense-in-depth;
  // the renderer guards against concurrent sends, but the main process should
  // not leak a dangling fetch if it ever happens).
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = abortController;
  pendingPermissionState = null;

  // Start chunk.
  sendChunk(event, {
    eventType: "start",
    conversationId,
    messageId: assistantMessageId,
  });

  const loop = createQueryLoop();
  const eventSink = createEventSink(event, conversationId);
  const planContext =
    isPlanMode && planState
      ? {
          planModule: {
            saveQuestion: (input: {
              conversationId: string;
              planId?: string;
              payload: AskUserQuestionPayload;
            }) => planModule.saveQuestion(input),
            submitPlanForApproval: (input: {
              conversationId: string;
              planId?: string;
              payload: SubmitPlanForApprovalPayload;
            }) => planModule.submitPlanForApproval(input),
            getPlanStateByPlanId: (planId: string) =>
              planModule.getPlanStateByPlanId(planId),
            answerQuestion: (input: {
              conversationId: string;
              questionId: string;
              answers: AskUserQuestionAnswer[];
            }) => planModule.answerQuestion(input),
          },
          planState,
        }
      : undefined;

  const loopInput: AIChatQueryLoopInput = {
    conversationId,
    assistantMessageId,
    messages: conversationMessages,
    request: req,
    openAITools: allOpenAITools,
    abortController,
    eventSink,
    planContext,
    startRound: 0,
  };

  try {
    const result = await loop.run(loopInput);
    await handleLoopResult({
      result,
      event,
      module,
      conversationId,
      assistantMessageId,
    });
  } catch (err) {
    await handleStreamingFailure({
      event,
      module,
      conversationId,
      assistantMessageId,
      err,
    });
  } finally {
    const waitingForPermission =
      hasPendingPermissionForConversation(conversationId);
    const waitingForPlanQuestion =
      hasPendingPlanQuestionForConversation(conversationId);
    if (
      currentConversationId === conversationId &&
      !waitingForPermission &&
      !waitingForPlanQuestion
    ) {
      currentAbortController = null;
      currentConversationId = null;
    }
  }
}

function handleStop(): void {
  if (pendingPermissionState) {
    const pending = pendingPermissionState;
    pendingPermissionState = null;
    currentAbortController = null;
    currentConversationId = null;
    sendComplete(pending.event, {
      eventType: "cancelled",
      conversationId: pending.conversationId,
      messageId: pending.assistantMessageId,
      fullContent: "",
    });
  }
  if (pendingPlanQuestionState) {
    const pending = pendingPlanQuestionState;
    pendingPlanQuestionState = null;
    sendComplete(pending.event, {
      eventType: "cancelled",
      conversationId: pending.conversationId,
      messageId: pending.assistantMessageId,
      fullContent: "",
    });
  }
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

async function handleStreamingFailure(args: {
  event: IpcEventLike;
  module: AIChatV2Module;
  conversationId: string;
  assistantMessageId: string;
  err: unknown;
  activeAccumulator?: OpenAIStreamAccumulator | null;
}): Promise<void> {
  const partial = args.activeAccumulator?.state.fullContent ?? "";
  if (currentConversationId !== args.conversationId) return;

  const aborted = args.err instanceof Error && args.err.name === "AbortError";
  if (aborted) {
    if (partial.length > 0) {
      await args.module.saveAssistantMessage({
        conversationId: args.conversationId,
        content: partial,
        messageId: args.assistantMessageId,
        model: args.activeAccumulator?.state.model,
        metadata: {
          source: "chat-v2",
          openaiResponseId: args.activeAccumulator?.state.responseId,
          finishReason: "cancelled",
          cancelled: true,
        } as ChatV2MessageMetadata,
      });
    }
    sendComplete(args.event, {
      eventType: "cancelled",
      conversationId: args.conversationId,
      messageId: partial.length > 0 ? args.assistantMessageId : undefined,
      fullContent: partial,
    });
  } else {
    if (partial.length > 0) {
      await args.module.saveAssistantMessage({
        conversationId: args.conversationId,
        content: partial,
        messageId: args.assistantMessageId,
        model: args.activeAccumulator?.state.model,
        metadata: {
          source: "chat-v2",
          finishReason: "error",
          error: userSafeError(args.err),
        },
      });
    }
    sendComplete(args.event, {
      eventType: "error",
      conversationId: args.conversationId,
      messageId: partial.length > 0 ? args.assistantMessageId : undefined,
      errorMessage: userSafeError(args.err),
    });
  }
  currentAbortController = null;
  currentConversationId = null;
  pendingPermissionState = null;
}

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

  const pending = pendingPermissionState;
  console.log(
    `[ai-chat-v2] resume requested toolId=${parsed.toolId} conv=${
      parsed.conversationId
    } hasPending=${!!pending} pendingToolCallId=${pending?.toolCallId}`
  );
  if (!pending || pending.toolCallId !== parsed.toolId) {
    return ok({
      ok: false,
      error: "No active permission-gated tool call to continue.",
    });
  }

  if (
    parsed.conversationId &&
    parsed.conversationId !== pending.conversationId
  ) {
    return ok({
      ok: false,
      error: "Conversation mismatch for pending tool call.",
    });
  }

  pendingPermissionState = null;
  currentAbortController = pending.abortController;
  currentConversationId = pending.conversationId;

  try {
    const toolResult = await SkillExecutor.execute(
      pending.toolName,
      pending.toolArguments,
      {
        conversationId: pending.conversationId,
        toolCallId: pending.toolCallId,
        args: pending.toolArguments,
        skipPermissionCheck: true,
      }
    );
    const toolPayload = normalizeToolResult(toolResult);
    const toolContent = serializeToolResultContent(toolPayload);

    sendChunk(pending.event, {
      eventType: "tool_result",
      conversationId: pending.conversationId,
      messageId: pending.assistantMessageId,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      fullContent: toolContent,
      toolResult: toolPayload,
      replacesPermissionPromptForToolId: pending.toolCallId,
    });

    if (isPermissionPromptResult(toolResult)) {
      pendingPermissionState = pending;
      return ok({
        ok: false,
        error: "Permission is still required for this tool.",
      });
    }

    pending.conversationMessages.push({
      role: "tool",
      tool_call_id: pending.toolCallId,
      content: toolContent,
    });

    console.log(
      `[ai-chat-v2] resume re-exec ${pending.toolName} ok=${
        toolResult.success
      } needsPermission=${isPermissionPromptResult(
        toolResult
      )} → resuming stream at round ${pending.nextRound} msgs=${
        pending.conversationMessages.length
      }`
    );

    const resumeLoop = createQueryLoop();
    const resumeEventSink = createEventSink(
      pending.event,
      pending.conversationId
    );
    const resumeLoopInput: AIChatQueryLoopInput = {
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      messages: pending.conversationMessages,
      request: pending.req,
      openAITools: toOpenAITools(await SkillRegistry.getAllToolFunctions()),
      abortController: pending.abortController,
      eventSink: resumeEventSink,
      startRound: pending.nextRound,
    };

    void resumeLoop
      .run(resumeLoopInput)
      .then((result) =>
        handleLoopResult({
          result,
          event: pending.event,
          module: pending.module,
          conversationId: pending.conversationId,
          assistantMessageId: pending.assistantMessageId,
        })
      )
      .catch((err) => {
        console.error("[ai-chat-v2] resume loop failed:", err);
      });

    return ok({ ok: true });
  } catch (err) {
    pendingPermissionState = null;
    currentAbortController = null;
    currentConversationId = null;
    return ok({ ok: false, error: userSafeError(err) });
  }
}

// ---------------------------------------------------------------------------
// Plan Mode IPC handlers
// ---------------------------------------------------------------------------

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

  const planModule = new AIChatPlanModule();
  let answered;
  try {
    answered = await planModule.answerQuestion({
      conversationId: parsed.conversationId,
      questionId: parsed.questionId,
      answers: parsed.answers,
    });
  } catch (err) {
    return denied(userSafeError(err));
  }

  // If a stream is paused waiting for this answer, resume it.
  const pending = pendingPlanQuestionState;
  if (
    pending &&
    pending.questionId === parsed.questionId &&
    (!parsed.conversationId || pending.conversationId === parsed.conversationId)
  ) {
    pendingPlanQuestionState = null;
    const answerContent = serializeToolResultContent({
      success: true,
      status: "answered",
      questionId: answered.questionId,
      answers: parsed.answers,
    });
    // Replace the synthetic "awaiting_answer" tool result with the real
    // answer so the model sees the user's decisions.
    const toolMsgIndex = pending.conversationMessages.findIndex(
      (m) => m.role === "tool" && m.tool_call_id === pending.toolCallId
    );
    if (toolMsgIndex >= 0) {
      pending.conversationMessages[toolMsgIndex] = {
        role: "tool",
        tool_call_id: pending.toolCallId,
        content: answerContent,
      };
    } else {
      pending.conversationMessages.push({
        role: "tool",
        tool_call_id: pending.toolCallId,
        content: answerContent,
      });
    }

    currentAbortController = pending.abortController;
    currentConversationId = pending.conversationId;

    const planState = await planModule.getPlanStateByPlanId(pending.planId);
    const allOpenAITools = [
      ...toOpenAITools(await SkillRegistry.getAllToolFunctions()),
      ...PlanModeToolRegistry.toOpenAITools(),
    ];

    const answerLoop = createQueryLoop();
    const answerEventSink = createEventSink(
      pending.event,
      pending.conversationId
    );
    const answerLoopPlanContext = planState
      ? {
          planModule: {
            saveQuestion: (input: {
              conversationId: string;
              planId?: string;
              payload: AskUserQuestionPayload;
            }) => pending.planModule.saveQuestion(input),
            submitPlanForApproval: (input: {
              conversationId: string;
              planId?: string;
              payload: SubmitPlanForApprovalPayload;
            }) => pending.planModule.submitPlanForApproval(input),
            getPlanStateByPlanId: (planId: string) =>
              pending.planModule.getPlanStateByPlanId(planId),
            answerQuestion: (input: {
              conversationId: string;
              questionId: string;
              answers: AskUserQuestionAnswer[];
            }) => pending.planModule.answerQuestion(input),
          },
          planState,
        }
      : undefined;
    const answerLoopInput: AIChatQueryLoopInput = {
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      messages: pending.conversationMessages,
      request: pending.req,
      openAITools: allOpenAITools,
      abortController: pending.abortController,
      eventSink: answerEventSink,
      planContext: answerLoopPlanContext,
      startRound: pending.nextRound,
    };

    void answerLoop
      .run(answerLoopInput)
      .then((result) =>
        handleLoopResult({
          result,
          event: pending.event,
          module: pending.module,
          conversationId: pending.conversationId,
          assistantMessageId: pending.assistantMessageId,
        })
      )
      .catch((err) => {
        console.error("[ai-chat-v2] answer-question loop failed:", err);
      });
  }

  return ok({ ok: true });
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

function userSafeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return "Generation stopped.";
    }
    const msg = err.message || "Unknown error";
    if (/401|403/.test(msg)) {
      return "Please sign in again.";
    }
    if (/404/.test(msg)) {
      return "Selected model is not available.";
    }
    if (/503/.test(msg)) {
      return "No chat model is configured on the AI server.";
    }
    if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(msg)) {
      return "Could not connect to the AI server.";
    }
    // Avoid surfacing raw server response bodies (may contain internal details,
    // stack traces, or echoed request data). Log the full error for debugging.
    console.error("[ai-chat-v2] unmapped error:", msg);
    return "An unexpected error occurred. Please try again.";
  }
  return "Unknown error";
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
