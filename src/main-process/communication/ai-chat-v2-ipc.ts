import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AiChatApi } from "@/api/aiChatApi";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { buildOpenAITranscript } from "@/service/OpenAIChatTranscriptBuilder";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import {
  AI_CHAT_V2_MODELS,
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_HISTORY,
  AI_CHAT_V2_STREAM,
  AI_CHAT_V2_STREAM_STOP,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
} from "@/config/channellist";
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
let currentAssistantMessageId: string | null = null;

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
  let conversationId: string;
  let transcript: ReturnType<typeof buildOpenAITranscript>;
  let assistantMessageId: string;

  // Database operations and transcript building happen before the streaming
  // try/catch. Wrap them so a failure sends a proper error response instead
  // of silently hanging the renderer.
  try {
    conversationId = module.createConversationIfNeeded(req.conversationId);
    currentConversationId = conversationId;

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
    transcript = buildOpenAITranscript({
      history: history.filter((r) => r.messageId !== savedUser.messageId),
      currentUserMessage: req.message,
      systemPrompt: req.systemPrompt ?? module.getDefaultSystemPrompt(),
      filterSource: "chat-v2",
      maxMessages: CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES,
    });

    assistantMessageId = `assistant-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    currentAssistantMessageId = assistantMessageId;
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
  const accumulator = new OpenAIStreamAccumulator();

  const abortController = new AbortController();
  // Abort any prior stream before overwriting the reference (defense-in-depth;
  // the renderer guards against concurrent sends, but the main process should
  // not leak a dangling fetch if it ever happens).
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = abortController;

  // Start chunk.
  sendChunk(event, {
    eventType: "start",
    conversationId,
    messageId: assistantMessageId,
  });

  try {
    await api.openAIChatCompletionStream(
      {
        messages: transcript.messages,
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
      },
      (rawChunk) => {
        if (currentConversationId !== conversationId) return;
        const delta = accumulator.ingest(rawChunk);
        if (delta) {
          sendChunk(event, {
            eventType: "token",
            conversationId,
            messageId: assistantMessageId,
            contentDelta: delta,
            model: accumulator.state.model,
          });
        }
      },
      { signal: abortController.signal }
    );

    // Late-chunk protection.
    if (currentConversationId !== conversationId) return;

    const fullContent = accumulator.state.fullContent;
    const finishReason = accumulator.state.finishReason ?? "stop";

    if (fullContent.length > 0) {
      await module.saveAssistantMessage({
        conversationId,
        content: fullContent,
        messageId: assistantMessageId,
        model: accumulator.state.model,
        metadata: {
          source: "chat-v2",
          openaiResponseId: accumulator.state.responseId,
          finishReason,
        },
      });
    }

    sendComplete(event, {
      eventType: "complete",
      conversationId,
      messageId: assistantMessageId,
      fullContent,
      model: accumulator.state.model,
      finishReason,
    });
  } catch (err) {
    const partial = accumulator.state.fullContent;
    if (currentConversationId !== conversationId) return;

    const aborted = err instanceof Error && err.name === "AbortError";
    if (aborted) {
      if (partial.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: partial,
          messageId: assistantMessageId,
          model: accumulator.state.model,
          metadata: {
            source: "chat-v2",
            openaiResponseId: accumulator.state.responseId,
            finishReason: "cancelled",
            cancelled: true,
          } as ChatV2MessageMetadata,
        });
      }
      sendComplete(event, {
        eventType: "cancelled",
        conversationId,
        messageId: partial.length > 0 ? assistantMessageId : undefined,
        fullContent: partial,
      });
    } else {
      if (partial.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: partial,
          messageId: assistantMessageId,
          model: accumulator.state.model,
          metadata: {
            source: "chat-v2",
            finishReason: "error",
            error: userSafeError(err),
          },
        });
      }
      sendComplete(event, {
        eventType: "error",
        conversationId,
        messageId: partial.length > 0 ? assistantMessageId : undefined,
        errorMessage: userSafeError(err),
      });
    }
  } finally {
    if (currentConversationId === conversationId) {
      currentAbortController = null;
      currentConversationId = null;
      currentAssistantMessageId = null;
    }
  }
}

function handleStop(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
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
  ipcMain.handle(AI_CHAT_V2_MODELS, async () => handleModels());
  ipcMain.handle(AI_CHAT_V2_CONVERSATIONS, async () => handleConversations());
  ipcMain.handle(AI_CHAT_V2_HISTORY, async (_e, data: unknown) =>
    handleHistory(_e as IpcEventLike, data as string)
  );
  ipcMain.handle(AI_CHAT_V2_CLEAR_CONVERSATION, async (_e, data: unknown) =>
    handleClearConversation(_e as IpcEventLike, data as string)
  );
  ipcMain.handle(AI_CHAT_V2_CLEAR_ALL, async () => handleClearAll());
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
