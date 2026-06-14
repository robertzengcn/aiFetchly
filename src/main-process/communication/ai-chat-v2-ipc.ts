import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import {
  AiChatApi,
  type OpenAIChatMessage,
  type OpenAITool,
  type OpenAIToolCall,
  type ToolExecutionResult,
  type ToolFunction,
} from "@/api/aiChatApi";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { buildOpenAITranscript } from "@/service/OpenAIChatTranscriptBuilder";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import {
  checkPlanModeToolPolicy,
  isPlanToolName,
} from "@/service/PlanModeToolPolicy";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
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
const CHAT_V2_MAX_TOOL_ROUNDS = 8;

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

function serializeToolResultContent(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      success: false,
      error: "Tool result could not be serialized",
    });
  }
}

function normalizeToolResult(
  result: ToolExecutionResult
): Record<string, unknown> {
  return {
    success: result.success,
    executionTimeMs: result.execution_time_ms,
    ...result.result,
  };
}

function isPermissionPromptResult(result: ToolExecutionResult): boolean {
  return result.result.needsPermissionPrompt === true;
}

function buildAssistantToolCallMessage(
  parsedCalls: Array<{
    index: number;
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  }>,
  assistantContent: string
): OpenAIChatMessage {
  const toolCalls: OpenAIToolCall[] = parsedCalls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    type: "function",
    function: {
      name: call.name ?? "unknown_tool",
      arguments: JSON.stringify(call.arguments ?? {}),
    },
  }));

  return {
    role: "assistant",
    content: assistantContent || null,
    tool_calls: toolCalls,
  };
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

async function handleConversations(): Promise<
  CommonMessage<ChatV2ConversationSummary[]>
> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const module = new AIChatV2Module();
    return ok(await module.getConversations());
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

  const api = new AiChatApi();
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

  try {
    await continueStreamAfterTools({
      event,
      module,
      planModule,
      api,
      req,
      conversationId,
      assistantMessageId,
      conversationMessages,
      abortController,
      openAITools: allOpenAITools,
      planState,
      isPlanMode,
      startRound: 0,
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

async function continueStreamAfterTools(state: {
  event: IpcEventLike;
  module: AIChatV2Module;
  planModule?: AIChatPlanModule;
  api: AiChatApi;
  req: ChatV2StreamRequest;
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  openAITools: OpenAITool[];
  planState?: AIChatPlanStateView | null;
  isPlanMode?: boolean;
  startRound: number;
}): Promise<void> {
  let activeAccumulator: OpenAIStreamAccumulator | null = null;
  try {
    let finalAccumulator: OpenAIStreamAccumulator | null = null;

    for (
      let round = state.startRound;
      round < CHAT_V2_MAX_TOOL_ROUNDS;
      round += 1
    ) {
      const accumulator = new OpenAIStreamAccumulator();
      activeAccumulator = accumulator;
      console.log(
        `[ai-chat-v2] round ${round} → POST /chat/completions msgs=${
          state.conversationMessages.length
        } roles=[${state.conversationMessages
          .map((m) => m.role)
          .join(",")}] tools=${state.openAITools.length}`
      );
      await state.api.openAIChatCompletionStream(
        {
          messages: state.conversationMessages,
          model: state.req.model,
          temperature: state.req.temperature,
          max_tokens: state.req.maxTokens,
          stream: true,
          tools: state.openAITools.length > 0 ? state.openAITools : undefined,
          tool_choice: state.openAITools.length > 0 ? "auto" : undefined,
        },
        (rawChunk) => {
          if (currentConversationId !== state.conversationId) return;
          const delta = accumulator.ingest(rawChunk);
          if (delta) {
            sendChunk(state.event, {
              eventType: "token",
              conversationId: state.conversationId,
              messageId: state.assistantMessageId,
              contentDelta: delta,
              model: accumulator.state.model,
            });
          }
        },
        { signal: state.abortController.signal }
      );

      finalAccumulator = accumulator;
      const parsedCalls = accumulator
        .tryParseToolCallArguments()
        .filter((call) => call.name && call.id);

      console.log(
        `[ai-chat-v2] round ${round} ← finishReason=${
          accumulator.state.finishReason
        } parsedCalls=${parsedCalls.length} willContinue=${
          accumulator.state.finishReason === "tool_calls" &&
          parsedCalls.length > 0
        }`
      );

      if (
        accumulator.state.finishReason !== "tool_calls" ||
        parsedCalls.length === 0
      ) {
        break;
      }

      if (parsedCalls.some((call) => !call.ok)) {
        throw new Error("Tool call arguments were malformed.");
      }

      state.conversationMessages.push(
        buildAssistantToolCallMessage(
          parsedCalls.filter(
            (
              call
            ): call is typeof call & {
              id: string;
              name: string;
              arguments: Record<string, unknown>;
            } => Boolean(call.id && call.name && call.arguments)
          ),
          accumulator.state.fullContent
        )
      );

      for (const call of parsedCalls) {
        if (!call.ok || !call.id || !call.name) {
          continue;
        }

        sendChunk(state.event, {
          eventType: "tool_call",
          conversationId: state.conversationId,
          messageId: state.assistantMessageId,
          toolCallId: call.id,
          toolName: call.name,
          toolArguments: call.arguments,
        });

        // Plan tools are intercepted and handled locally — never dispatched
        // to SkillExecutor. Each one either pauses the stream (AskUserQuestion)
        // or records a new plan version (SubmitPlanForApproval).
        if (state.isPlanMode && isPlanToolName(call.name)) {
          if (call.name === "AskUserQuestion") {
            const paused = await handlePlanToolAskUserQuestion({
              state,
              call,
              round,
            });
            if (paused) return;
            // If not paused (validation failed or no pending state stored),
            // fall through to push the synthetic tool result below.
            continue;
          }
          if (call.name === "SubmitPlanForApproval") {
            await handlePlanToolSubmitForApproval({
              state,
              call,
            });
            continue;
          }
        }

        // Plan-mode policy gate: block high-impact tools before the plan is
        // approved. The AI receives a structured "plan approval required"
        // result so it can explain the situation to the user.
        if (state.isPlanMode && state.planState) {
          const skillDef = SkillRegistry.getSkill(call.name);
          const policyDecision = checkPlanModeToolPolicy({
            toolName: call.name,
            skillPermissionCategory: skillDef?.permissionCategory,
            context: {
              conversationId: state.conversationId,
              planState: state.planState,
            },
          });
          if (!policyDecision.allowed) {
            const blockedContent = serializeToolResultContent({
              success: false,
              planApprovalRequired: true,
              reason: policyDecision.reason ?? "Plan approval required.",
            });
            sendChunk(state.event, {
              eventType: "plan_blocked_tool" as never,
              conversationId: state.conversationId,
              messageId: state.assistantMessageId,
              toolCallId: call.id,
              toolName: call.name,
              fullContent: blockedContent,
              planBlockedToolName: call.name,
              planBlockedReason: policyDecision.reason ?? undefined,
            } as ChatV2StreamChunk);
            state.conversationMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: blockedContent,
            });
            continue;
          }
        }

        const toolResult = await SkillExecutor.execute(
          call.name,
          call.arguments ?? {},
          {
            conversationId: state.conversationId,
            toolCallId: call.id,
            args: call.arguments,
          }
        );
        const toolPayload = normalizeToolResult(toolResult);
        const toolContent = serializeToolResultContent(toolPayload);
        console.log(
          `[ai-chat-v2] tool ${call.name} ok=${
            toolResult.success
          } needsPermission=${isPermissionPromptResult(toolResult)}`
        );

        sendChunk(state.event, {
          eventType: "tool_result",
          conversationId: state.conversationId,
          messageId: state.assistantMessageId,
          toolCallId: call.id,
          toolName: call.name,
          fullContent: toolContent,
          toolResult: toolPayload,
        });

        if (isPermissionPromptResult(toolResult)) {
          pendingPermissionState = {
            event: state.event,
            module: state.module,
            api: state.api,
            req: state.req,
            conversationId: state.conversationId,
            assistantMessageId: state.assistantMessageId,
            conversationMessages: state.conversationMessages,
            abortController: state.abortController,
            nextRound: round + 1,
            toolCallId: call.id,
            toolName: call.name,
            toolArguments: call.arguments ?? {},
          };
          console.log(
            `[ai-chat-v2] tool ${
              call.name
            } needs permission — pausing before sending result to AI (nextRound=${
              round + 1
            })`
          );
          return;
        }

        state.conversationMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: toolContent,
        });
        console.log(
          `[ai-chat-v2] tool ${call.name} result pushed → round ${round} will continue to next AI request`
        );
      }
    }

    if (currentConversationId !== state.conversationId) return;

    const fullContent = finalAccumulator?.state.fullContent ?? "";
    const finishReason = finalAccumulator?.state.finishReason ?? "stop";

    console.log(
      `[ai-chat-v2] stream complete finishReason=${finishReason} fullContentLen=${
        fullContent.length
      } preview=${JSON.stringify(fullContent.slice(0, 200))}`
    );

    if (fullContent.length > 0) {
      await state.module.saveAssistantMessage({
        conversationId: state.conversationId,
        content: fullContent,
        messageId: state.assistantMessageId,
        model: finalAccumulator?.state.model,
        metadata: {
          source: "chat-v2",
          openaiResponseId: finalAccumulator?.state.responseId,
          finishReason,
        },
      });
    }

    sendComplete(state.event, {
      eventType: "complete",
      conversationId: state.conversationId,
      messageId: state.assistantMessageId,
      fullContent,
      model: finalAccumulator?.state.model,
      finishReason,
    });
    currentAbortController = null;
    currentConversationId = null;
  } catch (err) {
    console.error(
      `[ai-chat-v2] continueStreamAfterTools failed:`,
      err instanceof Error ? err.stack || err.message : err
    );
    await handleStreamingFailure({
      event: state.event,
      module: state.module,
      conversationId: state.conversationId,
      assistantMessageId: state.assistantMessageId,
      err,
      activeAccumulator,
    });
  }
}

type ContinueStreamState = Parameters<typeof continueStreamAfterTools>[0];

type ParsedToolCall = {
  index: number;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  ok: boolean;
};

/**
 * Handle the AskUserQuestion plan tool: persist the question, emit a
 * structured chunk to the renderer, and pause the stream by storing a
 * pendingPlanQuestionState. Returns true when the stream was paused.
 */
async function handlePlanToolAskUserQuestion(args: {
  state: ContinueStreamState;
  call: ParsedToolCall;
  round: number;
}): Promise<boolean> {
  const { state, call } = args;
  if (!state.planModule || !state.planState) {
    return false;
  }
  if (!call.id || !call.name) return false;

  const payload = (call.arguments ?? {}) as unknown as AskUserQuestionPayload;
  if (!payload || !Array.isArray(payload.questions)) {
    return false;
  }

  let questionView: AIChatPlanQuestionView;
  try {
    questionView = await state.planModule.saveQuestion({
      conversationId: state.conversationId,
      planId: state.planState.planId,
      payload,
    });
  } catch (err) {
    console.error("[ai-chat-v2] saveQuestion failed:", err);
    const errContent = serializeToolResultContent({
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "AskUserQuestion payload was rejected.",
    });
    state.conversationMessages.push({
      role: "tool",
      tool_call_id: call.id,
      content: errContent,
    });
    return false;
  }

  sendChunk(state.event, {
    eventType: "ask_user_question" as never,
    conversationId: state.conversationId,
    messageId: state.assistantMessageId,
    toolCallId: call.id,
    toolName: call.name,
    question: questionView,
    planState: state.planState,
  } as ChatV2StreamChunk);

  // Synthetic tool result so the transcript has a well-formed tool/assistant
  // pair; the real answer is filled in later when the user responds.
  const ackContent = serializeToolResultContent({
    success: true,
    status: "awaiting_answer",
    questionId: questionView.questionId,
  });
  state.conversationMessages.push({
    role: "tool",
    tool_call_id: call.id,
    content: ackContent,
  });

  pendingPlanQuestionState = {
    event: state.event,
    module: state.module,
    planModule: state.planModule,
    api: state.api,
    req: state.req,
    conversationId: state.conversationId,
    assistantMessageId: state.assistantMessageId,
    conversationMessages: state.conversationMessages,
    abortController: state.abortController,
    nextRound: args.round + 1,
    toolCallId: call.id,
    questionId: questionView.questionId,
    planId: state.planState.planId,
  };
  console.log(
    `[ai-chat-v2] AskUserQuestion paused (questionId=${
      questionView.questionId
    }, nextRound=${args.round + 1})`
  );
  return true;
}

/**
 * Handle the SubmitPlanForApproval plan tool: record a new plan version,
 * transition status to awaiting_approval, and emit a plan_submitted chunk.
 */
async function handlePlanToolSubmitForApproval(args: {
  state: ContinueStreamState;
  call: ParsedToolCall;
}): Promise<void> {
  const { state, call } = args;
  if (!state.planModule || !state.planState || !call.id) return;

  const payload = (call.arguments ??
    {}) as unknown as SubmitPlanForApprovalPayload;
  let updatedPlan: AIChatPlanStateView;
  try {
    updatedPlan = await state.planModule.submitPlanForApproval({
      conversationId: state.conversationId,
      planId: state.planState.planId,
      payload,
    });
  } catch (err) {
    console.error("[ai-chat-v2] submitPlanForApproval failed:", err);
    const errContent = serializeToolResultContent({
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "SubmitPlanForApproval payload was rejected.",
    });
    state.conversationMessages.push({
      role: "tool",
      tool_call_id: call.id,
      content: errContent,
    });
    return;
  }

  sendChunk(state.event, {
    eventType: "plan_submitted" as never,
    conversationId: state.conversationId,
    messageId: state.assistantMessageId,
    toolCallId: call.id,
    toolName: call.name,
    planState: updatedPlan,
  } as ChatV2StreamChunk);

  const ackContent = serializeToolResultContent({
    success: true,
    status: "awaiting_approval",
    planId: updatedPlan.planId,
    version: updatedPlan.currentVersion,
  });
  state.conversationMessages.push({
    role: "tool",
    tool_call_id: call.id,
    content: ackContent,
  });
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

    void continueStreamAfterTools({
      event: pending.event,
      module: pending.module,
      api: pending.api,
      req: pending.req,
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      conversationMessages: pending.conversationMessages,
      abortController: pending.abortController,
      openAITools: toOpenAITools(await SkillRegistry.getAllToolFunctions()),
      startRound: pending.nextRound,
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

    void continueStreamAfterTools({
      event: pending.event,
      module: pending.module,
      planModule: pending.planModule,
      api: pending.api,
      req: pending.req,
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      conversationMessages: pending.conversationMessages,
      abortController: pending.abortController,
      openAITools: allOpenAITools,
      planState,
      isPlanMode: true,
      startRound: pending.nextRound,
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
  ipcMain.handle(AI_CHAT_V2_CONVERSATIONS, async () => handleConversations());
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
