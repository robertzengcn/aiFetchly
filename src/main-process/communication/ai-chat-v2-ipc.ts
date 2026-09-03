import { ipcMain } from "electron";
import {
  AIChatTurnQueueService,
  AIChatTurnQueueError,
  createSteeringPromoter,
} from "@/service/AIChatTurnQueueService";
import { AIChatPendingMessageModule } from "@/modules/AIChatPendingMessageModule";
import { AIChatV2EventBroadcaster } from "@/service/AIChatV2EventBroadcaster";
import { AIChatConversationTurnCoordinator } from "@/service/AIChatConversationTurnCoordinator";
import {
  AI_CHAT_MESSAGE_QUEUE_ENABLED,
  AI_CHAT_MESSAGE_STEERING_ENABLED,
} from "@/config/usersetting";
import {
  aiChatPendingCreateInputSchema,
  aiChatPendingListInputSchema,
  aiChatPendingSteerInputSchema,
  aiChatPendingCancelInputSchema,
  aiChatPendingResumeInputSchema,
} from "@/schemas/ipc/aiChatPendingMessage";
import {
  AI_CHAT_V2_PENDING_CREATE,
  AI_CHAT_V2_PENDING_LIST,
  AI_CHAT_V2_PENDING_STEER,
  AI_CHAT_V2_PENDING_CANCEL,
  AI_CHAT_V2_PENDING_RESUME,
} from "@/config/channellist";
import type { ZodType } from "zod/v4";
import type {
  AIChatPendingCreateResult,
  AIChatPendingMessageView,
} from "@/entityTypes/aiChatV2Types";
import { Token } from "@/modules/token";
import { log } from "@/modules/Logger";
import { AIProviderResolver } from "@/service/aiProvider/AIProviderResolver";
import type { OpenAIChatCompletionRequest } from "@/api/aiChatApi";
import { USERSDBPATH } from "@/config/usersetting";
import { AiChatApi } from "@/api/aiChatApi";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopDeps } from "@/service/AIChatQueryLoop";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import { getSharedLightweightCompletionService } from "@/service/AIChatLightweightCompletionFactory";
import { AIChatModelCatalogService } from "@/service/AIChatModelCatalogService";
import { AIChatConversationUpdateBroadcaster } from "@/service/AIChatConversationUpdateBroadcaster";
import { AIChatModelFallbackService } from "@/service/AIChatModelFallbackService";
import {
  getSharedAutoDreamService,
  resetSharedAutoDreamService,
  getSharedWorkspaceAutoDreamService,
  resetSharedWorkspaceAutoDreamService,
} from "@/service/AIAutoDreamFactory";
import { AIChatToolApprovalModule } from "@/modules/AIChatToolApprovalModule";
import { evaluateToolApproval } from "@/service/AIChatToolApprovalPolicyService";
import { redirectToLoginOnAuthExpired } from "@/service/AIChatAuthExpiredHandler";
import { userSafeError } from "@/service/AIChatErrorMapper";
import type { AIChatQueryEventSink } from "@/service/AIChatQueryEvents";
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
  AI_CHAT_V2_READ_PASTE_CACHE,
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
import { aiChatV2PastedContentsSchema } from "@/schemas/aiChatV2PastedText";
import { PasteStoreService } from "@/service/pastedText/PasteStoreService";
import { createChatV2StreamSink } from "@/service/aiChatV2StreamSink";

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
/** Shared model catalog for auto-compact context-window lookups. The catalog
 * caches the /api/ai/v1/models response in-process, so the lookup is free
 * after the first fetch. Provider-level state — not DB-bound. */
let compactModelCatalog: AIChatModelCatalogService | null = null;
let queryEngineDbPath: string | null = null;
let compactAgentDbPath: string | null = null;

/** Build the production AIChatQueryLoop with real service deps. */
function createQueryLoop(): AIChatQueryLoop {
  const deps: AIChatQueryLoopDeps = {
    streamChatCompletion: (request, onChunk, options) => {
      const api = new AiChatApi();
      return api.openAIChatCompletionStream(
        applyLocalToolPolicy(request),
        onChunk,
        options
      );
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
              console.log(
                `[ai-chat-v2] auto-approved tool "${name}" for conversation ${context.conversationId}: ${decision.reason}`
              );
            }
          }
        } catch (err) {
          // Non-fatal: fall back to normal permission flow
          console.warn(
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
  if (queueService) {
    // Rows stay durable in each database; only in-memory drain chains and
    // event associations are dropped (message-queue design §16.2). The next
    // database runs its own recovery on first use.
    queueService = null;
  }
  queueServiceRecovered = false;
  queryEngine = null;
  compactAgent = null;
  queryEngineDbPath = null;
  compactAgentDbPath = null;
  // The catalog is provider-level state; a user/DB switch may change the
  // active provider, so drop the cached model windows.
  compactModelCatalog = null;
  resetSharedAutoDreamService();
  resetSharedWorkspaceAutoDreamService();
}

function getCompactAgent(): AIChatCompactAgentService {
  const dbPath = getCurrentUserDbPath();
  if (compactAgent && compactAgentDbPath !== dbPath) {
    compactAgent = null;
    compactAgentDbPath = null;
    resetSharedAutoDreamService();
    resetSharedWorkspaceAutoDreamService();
  }
  if (!compactAgent) {
    const tokenService = new Token();
    if (!compactModelCatalog) {
      compactModelCatalog = new AIChatModelCatalogService();
    }
    compactAgent = new AIChatCompactAgentService(tokenService, {
      // Route session-memory and full-compact workloads through the shared
      // lightweight completion service so the hosted provider (when the kill
      // switch is enabled) sends model: "small" (tech-design §5.2).
      completeLightweight: (input) =>
        getSharedLightweightCompletionService().complete(input),
      // Compact follows the chat availability resolver so local-provider users
      // can compact conversations without a hosted subscription.
      isEnabled: () => canUseChat().ok,
      // Capability gate for full compact: absent metadata means the small
      // route is not eligible and compact goes to the normal model
      // (tech-design §16.1).
      getSmallModelCapability: () =>
        compactModelCatalog!.getSmallModelCapability(),
      // Real per-model context window so the auto-compact threshold matches
      // the renderer badge denominator (hard-coded 128k would never trip for
      // models with smaller windows).
      getContextWindow: (model) => compactModelCatalog!.getContextWindow(model),
      // Broadcast to the renderer so the context badge drops right away.
      onAutoCompacted: (summary) => {
        AIChatConversationUpdateBroadcaster.getInstance().emitAutoCompacted({
          conversationId: summary.conversationId,
          outputTokenEstimate:
            summary.outputTokenEstimate ??
            Math.ceil(summary.summary.length / 4),
          model: summary.model,
          occurredAt: new Date().toISOString(),
        });
      },
    });
    compactAgentDbPath = dbPath;
  }
  return compactAgent;
}

/** Shared engine singleton — also used by the workspace coordinator. */
export function getQueryEngine(): AIChatQueryEngine {
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
      // Turn mailboxes persist steering via the pending Module (design §10).
      steeringPromoter: createSteeringPromoter(
        new AIChatPendingMessageModule()
      ),
    });
    queryEngineDbPath = dbPath;
  }
  return queryEngine;
}

// -------------------------------------------------------------------------
// Pending-message queue service (message-queue design §9)
// -------------------------------------------------------------------------

let queueService: AIChatTurnQueueService | null = null;
let queueServiceRecovered = false;

function isQueueFeatureEnabled(): boolean {
  return new Token().getValue(AI_CHAT_MESSAGE_QUEUE_ENABLED) !== "false";
}

function isSteeringFeatureEnabled(): boolean {
  return (
    isQueueFeatureEnabled() &&
    new Token().getValue(AI_CHAT_MESSAGE_STEERING_ENABLED) !== "false"
  );
}

/**
 * Broadcaster-backed stream sink for queue-dispatched turns: reuses the
 * shared createChatV2StreamSink mapping and fans it out to every live
 * window, since queue turns start in the main process (design §14.2).
 */
function createBroadcastEventSink(): AIChatQueryEventSink {
  const broadcaster = AIChatV2EventBroadcaster.getInstance();
  return createChatV2StreamSink({
    sendChunk: (chunk) => broadcaster.emitStreamChunk(chunk),
    sendComplete: (chunk) => broadcaster.emitStreamComplete(chunk),
  });
}

function getQueueService(): AIChatTurnQueueService {
  if (!queueService) {
    const pendingModule = new AIChatPendingMessageModule();
    queueService = new AIChatTurnQueueService({
      engine: getQueryEngine(),
      pendingModule,
      eventSink: {
        emit: (event) =>
          AIChatV2EventBroadcaster.getInstance().emitPendingEvent(event),
      },
      streamSinkFactory: () => createBroadcastEventSink(),
      tryAcquireLease: ({ conversationId }) =>
        AIChatConversationTurnCoordinator.getInstance().tryAcquire({
          conversationId,
          owner: "interactive",
          ownerId: "pending-queue",
        }),
      isAiEnabled: () => canUseChat().ok,
      isQueueEnabled: isQueueFeatureEnabled,
      isSteeringEnabled: isSteeringFeatureEnabled,
    });
  }
  return queueService;
}

/**
 * Run startup/database-switch recovery exactly once per queue-service
 * instance (design §16.1). Reconciliation only pauses/deduplicates durable
 * rows — it never starts provider work.
 */
async function ensureQueueRecovered(): Promise<void> {
  if (queueServiceRecovered) return;
  queueServiceRecovered = true;
  try {
    await getQueueService().recoverOnStartup();
  } catch (err) {
    log.error("[ai-chat-v2] pending queue recovery failed:", err);
  }
}

// -------------------------------------------------------------------------
// IPC helpers
// -------------------------------------------------------------------------

/**
 * Chat availability resolver — shared across all AiChatV2 handlers. Allows the
 * hosted path (subscribed) AND the local-provider path (valid config) while
 * every hosted-only AI feature outside this file keeps its own
 * `ensureHostedAIEnabled()` gate.
 *
 * Lazily constructed so importing this module does not touch electron-store.
 */
let chatResolver: AIProviderResolver | null = null;
function getChatResolver(): AIProviderResolver {
  if (!chatResolver) {
    chatResolver = new AIProviderResolver();
  }
  return chatResolver;
}

/** Chat availability gate shared with the workspace coordinator. */
export function canUseChat(): { ok: true } | { ok: false; message: string } {
  const provider = getChatResolver().resolveForChat();
  if (provider.canUse) {
    return { ok: true };
  }
  return { ok: false, message: provider.message };
}

/**
 * When the active provider is local and tool support is not confirmed
 * (capability "unsupported" or unknown/absent), strip tools from the request
 * so the query loop runs plain chat. This is the conservative MVP behavior
 * (design §23.1): unknown → no tools.
 */
function applyLocalToolPolicy(
  request: OpenAIChatCompletionRequest
): OpenAIChatCompletionRequest {
  const provider = getChatResolver().resolveForChat();
  if (!provider.canUse || provider.kind !== "local") {
    return request;
  }
  const tools = provider.config.capabilities?.tools;
  if (tools === "supported") {
    return request;
  }
  // unsupported | unknown | failed → omit tools/tool_choice.
  if (request.tools === undefined && request.tool_choice === undefined) {
    return request;
  }
  const rest: OpenAIChatCompletionRequest = { ...request };
  delete rest.tools;
  delete rest.tool_choice;
  return rest;
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
  console.log(
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
  return createChatV2StreamSink({
    sendChunk: (chunk) => sendChunk(event, chunk),
    sendComplete: (chunk) => sendComplete(event, chunk),
  });
}

// -------------------------------------------------------------------------
// Stream handler (thin — delegates to engine)
// -------------------------------------------------------------------------

/** Stream request validation shared with the workspace coordinator. */
export function validateStreamRequest(
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
  if (
    req.showReasoning !== undefined &&
    typeof req.showReasoning !== "boolean"
  ) {
    return "showReasoning must be a boolean";
  }
  if (req.reasoning !== undefined) {
    const reasoning = req.reasoning as {
      enabled?: unknown;
      effort?: unknown;
      summary?: unknown;
    };
    if (
      !reasoning ||
      typeof reasoning !== "object" ||
      Array.isArray(reasoning) ||
      typeof reasoning.enabled !== "boolean"
    ) {
      return "reasoning must be an object with a boolean 'enabled' field";
    }
    if (
      reasoning.effort !== undefined &&
      (typeof reasoning.effort !== "string" ||
        !["low", "medium", "high"].includes(reasoning.effort))
    ) {
      return "reasoning.effort must be one of low, medium, high";
    }
    if (
      reasoning.summary !== undefined &&
      (typeof reasoning.summary !== "string" ||
        !["auto", "concise", "detailed"].includes(reasoning.summary))
    ) {
      return "reasoning.summary must be one of auto, concise, detailed";
    }
  }

  if (req.pastedContents !== undefined) {
    const parsed = aiChatV2PastedContentsSchema.safeParse(req.pastedContents);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? "invalid pastedContents";
    }
  }
  return null;
}
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;
/**
 * MIME types accepted for `kind === "image"` attachments. The persisted
 * `previewDataUrl` is a `data:${mimeType};base64,...` URL rendered in the
 * renderer DOM, so the MIME must be a real image type — a crafted payload
 * (filename `.png` + `mimeType:"text/html"`) could otherwise persist a
 * non-image `data:` URL that a future viewer might execute. Aligns with the
 * image extensions the composer accepts (png/jpg/jpeg/webp/gif).
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

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

/** Attachment normalization shared with the workspace coordinator. */
export function normalizeChatV2UploadedFiles(
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
      // Reject non-image MIME types (and any CR/LF/whitespace that could
      // break the `data:` URL format) so only real image previews reach the
      // persisted metadata the renderer trusts.
      const normalizedMime = mimeType.toLowerCase();
      if (
        !ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime) ||
        /[\s\r\n]/.test(mimeType)
      ) {
        continue;
      }
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
  // Chat availability gate FIRST, before parsing request data.
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: chatAccess.message,
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

/**
 * Stop active chat turn(s). Accepts an optional `{ conversationId }` payload so
 * the renderer can stop ONE conversation's turn (the Stop button / permission
 * deny) without aborting other conversations' background turns. When no
 * conversationId is supplied, every active + pending turn is stopped (used by
 * DB switch / sign-out via resetAiChatV2RuntimeForDatabaseSwitch).
 */
function handleStop(data?: unknown): void {
  let conversationId: string | undefined;
  let raw: unknown = data;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = undefined;
    }
  }
  if (raw && typeof raw === "object") {
    const value = (raw as { conversationId?: unknown }).conversationId;
    conversationId = typeof value === "string" ? value : undefined;
  }
  getQueryEngine().stopActiveTurn(conversationId);
}

// -------------------------------------------------------------------------
// Resume handler: tool after permission
// -------------------------------------------------------------------------

async function handleResumeToolAfterPermission(
  data: unknown
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
  }
  try {
    const req = data ? JSON.parse(data) : {};
    const searchQuery =
      typeof req.searchQuery === "string" ? req.searchQuery : undefined;
    const module = new AIChatV2Module();
    const summaries = await module.getConversations(searchQuery);
    const engine = getQueryEngine();
    return ok(
      summaries.map((summary) => ({
        ...summary,
        runtimeStatus: engine.getConversationRuntimeStatus(
          summary.conversationId
        ),
      }))
    );
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleHistory(
  _e: IpcEventLike,
  data: unknown
): Promise<CommonMessage<ChatV2HistoryResponse | null>> {
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
  }
  try {
    const req = parseObjectPayload(data);
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
      timestamp: serializeHistoryTimestamp(r.timestamp),
      messageType: r.messageType,
      model: r.model,
      tokensUsed: r.tokensUsed,
      metadata: parseMetadata(r.metadata),
    }));
    let pendingMessages: AIChatPendingMessageView[] | undefined;
    try {
      pendingMessages = await getQueueService().list(conversationId);
    } catch (err) {
      // Pending listing must never break history rendering.
      log.error("[ai-chat-v2] pending list failed:", err);
    }
    return ok({
      conversationId,
      messages: views,
      totalMessages: views.length,
      runtimeStatus:
        getQueryEngine().getConversationRuntimeStatus(conversationId),
      pendingMessages,
    });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleClearConversation(
  _e: IpcEventLike,
  data: string
): Promise<CommonMessage<{ deleted: number } | null>> {
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
    // Queue cascade FIRST (FR-44): stop the runtime, delete pending rows
    // and their staged attachment bytes before the transcript goes away.
    try {
      await getQueueService().clearConversation(conversationId);
    } catch (err) {
      log.error("[ai-chat-v2] pending clearConversation failed:", err);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
  }
  try {
    try {
      await getQueueService().clearAll();
    } catch (err) {
      log.error("[ai-chat-v2] pending clearAll failed:", err);
    }
    const module = new AIChatV2Module();
    const deleted = await module.clearAllV2History();
    return ok({ deleted });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

// -------------------------------------------------------------------------
// Pending-message queue handlers (message-queue PRD §12)
// -------------------------------------------------------------------------

/**
 * registerValidatedHandler-style wrapper that checks CHAT availability
 * before parsing — the queue serves the same users the chat stream does
 * (hosted subscription OR valid local provider), so canUseChat is the
 * correct gate rather than the hosted-only USER_AI_ENABLED check.
 */
function registerChatValidatedHandler<TInput, TOutput>(
  channel: string,
  schema: () => ZodType<TInput>,
  handler: (input: TInput) => Promise<TOutput>
): void {
  ipcMain.handle(channel, async (_event, raw) => {
    const chatAccess = canUseChat();
    if (!chatAccess.ok) {
      return { status: false, msg: chatAccess.message, data: null };
    }
    const input = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parsed = schema().safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((issue) => issue.message).join("; ");
      log.warn(`[${channel}] validation failed: ${msg}`);
      return { status: false, msg, data: null };
    }
    try {
      const data = await handler(parsed.data);
      return { status: true, msg: "ok", data };
    } catch (err) {
      const msg =
        err instanceof AIChatTurnQueueError
          ? `[${err.code}] ${err.message}`
          : err instanceof Error
          ? err.message
          : "Unknown error";
      log.warn(`[${channel}] handler error: ${msg}`);
      return { status: false, msg, data: null };
    }
  });
}

async function handlePendingCreate(input: {
  clientRequestId: string;
  request: ChatV2StreamRequest;
}): Promise<AIChatPendingCreateResult> {
  void ensureQueueRecovered();
  return await getQueueService().submit(input);
}

async function handlePendingList(input: {
  conversationId: string;
}): Promise<AIChatPendingMessageView[]> {
  void ensureQueueRecovered();
  return await getQueueService().list(input.conversationId);
}

async function handlePendingSteer(input: {
  conversationId: string;
  pendingMessageId: string;
}): Promise<AIChatPendingMessageView> {
  void ensureQueueRecovered();
  return await getQueueService().steer(input);
}

async function handlePendingCancel(input: {
  conversationId: string;
  pendingMessageId: string;
}): Promise<AIChatPendingMessageView> {
  return await getQueueService().cancel(input);
}

async function handlePendingResume(input: {
  conversationId: string;
}): Promise<{ resumed: number }> {
  await getQueueService().resumeConversation(input.conversationId);
  return { resumed: 1 };
}

// -------------------------------------------------------------------------
// Plan Mode IPC handlers
// -------------------------------------------------------------------------

async function handlePlanState(
  data: string
): Promise<CommonMessage<AIChatPlanStateView | null>> {
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
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

function parseObjectPayload(data: unknown): Record<string, unknown> {
  if (!data) {
    return {};
  }
  if (typeof data === "string") {
    return (data ? JSON.parse(data) : {}) as Record<string, unknown>;
  }
  if (typeof data === "object") {
    return data as Record<string, unknown>;
  }
  return {};
}

export function serializeHistoryTimestamp(timestamp: unknown): string {
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  if (typeof timestamp === "string") {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toISOString();
  }
  if (typeof timestamp === "number") {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
      ? new Date(0).toISOString()
      : date.toISOString();
  }
  return new Date(0).toISOString();
}

export function parseMetadata(
  raw?: string | null
): ChatV2MessageMetadata | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const metadata = parsed as Partial<ChatV2MessageMetadata>;
      if (metadata.source === "chat-v2") {
        return metadata as ChatV2MessageMetadata;
      }
      if (metadata.reasoning) {
        return {
          ...metadata,
          source: "chat-v2",
        } as ChatV2MessageMetadata;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

async function handleReadPasteCache(
  data: unknown
): Promise<CommonMessage<string | null>> {
  const chatAccess = canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
  }

  const candidate: unknown =
    typeof data === "string"
      ? data
      : (() => {
          const req = parseObjectPayload(data);
          return (
            req.contentHash ?? req.hash ?? req.pasteCacheHash ?? req.pasteHash
          );
        })();

  if (typeof candidate !== "string") {
    return denied("hash must be a string");
  }

  const hash = candidate.trim().toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(hash)) {
    return denied("invalid paste cache hash");
  }

  try {
    const store = new PasteStoreService();
    const content = await store.read(hash);
    return ok(content);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

export function registerAiChatV2IpcHandlers(): void {
  ipcMain.handle(
    AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
    async (_e, data: unknown) => handleResumeToolAfterPermission(data ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_MODELS, async () => handleModels());
  ipcMain.handle(AI_CHAT_V2_CONVERSATIONS, async (_e, data: unknown) =>
    handleConversations(data as string)
  );
  ipcMain.handle(AI_CHAT_V2_HISTORY, async (_e, data: unknown) =>
    handleHistory(_e as IpcEventLike, data)
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
  ipcMain.handle(AI_CHAT_V2_COMPACT_CONVERSATION, async (_e, data: unknown) =>
    handleCompactConversation((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_GET_TOOL_APPROVAL_MODE, async (_e, data: unknown) =>
    handleGetToolApprovalMode((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_SET_TOOL_APPROVAL_MODE, async (_e, data: unknown) =>
    handleSetToolApprovalMode((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_READ_PASTE_CACHE, async (_e, data: unknown) =>
    handleReadPasteCache(data)
  );
  // Stream handler send message to the AI engine and receive chunks back
  ipcMain.on(AI_CHAT_V2_STREAM, async (event, data: unknown) => {
    try {
      await handleStream(event as IpcEventLike, data as string);
    } catch (err) {
      console.error("[ai-chat-v2] unhandled stream error:", err);
      void redirectToLoginOnAuthExpired(err);
      const evt = event as IpcEventLike;
      sendComplete(evt, {
        eventType: "error",
        conversationId: "",
        errorMessage: userSafeError(err),
      });
    }
  });
  ipcMain.on(AI_CHAT_V2_STREAM_STOP, (_e, data?: unknown) => handleStop(data));

  // Pending-message queue (message-queue PRD §12). Handlers call the queue
  // service only — never a Model or repository.
  registerChatValidatedHandler(
    AI_CHAT_V2_PENDING_CREATE,
    aiChatPendingCreateInputSchema,
    handlePendingCreate
  );
  registerChatValidatedHandler(
    AI_CHAT_V2_PENDING_LIST,
    aiChatPendingListInputSchema,
    handlePendingList
  );
  registerChatValidatedHandler(
    AI_CHAT_V2_PENDING_STEER,
    aiChatPendingSteerInputSchema,
    handlePendingSteer
  );
  registerChatValidatedHandler(
    AI_CHAT_V2_PENDING_CANCEL,
    aiChatPendingCancelInputSchema,
    handlePendingCancel
  );
  registerChatValidatedHandler(
    AI_CHAT_V2_PENDING_RESUME,
    aiChatPendingResumeInputSchema,
    handlePendingResume
  );
  // Startup reconciliation (design §16.1): reconcile durable rows once the
  // handlers exist; it only pauses/deduplicates — never dispatches.
  void ensureQueueRecovered();
}
