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
import { ensureHostedAiEnabled } from "@/service/AiFeatureGate";
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
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import {
  getSharedLightweightCompletionService,
  resetLightweightRuntime,
} from "@/service/AIChatLightweightCompletionFactory";
import { AIChatCompactionCoordinator } from "@/service/AIChatCompactionCoordinator";
import type { CompactionStatusSnapshot } from "@/service/AIChatCompactionCoordinator";
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
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { dispatchSectionSummarize } from "@/service/AIChatSummarizeDispatch";
import { AIChatHistoryRetrievalService } from "@/service/AIChatHistoryRetrievalService";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import { AIChatCompactionModule } from "@/modules/AIChatCompactionModule";
import {
  isHistoryUiEnabled,
  isNewCompactionEnabled,
} from "@/config/featureFlags";
import { evaluateToolApproval } from "@/service/AIChatToolApprovalPolicyService";
import { redirectToLoginOnAuthExpired } from "@/service/AIChatAuthExpiredHandler";
import { userSafeError } from "@/service/AIChatErrorMapper";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
} from "@/service/AIChatQueryEvents";
import { AIChatRunEventAdapter } from "@/service/AIChatRunEventAdapter";
import { sharedWorkspaceEventRouter } from "@/service/aiChatWorkspaceRuntime";
import { ScheduledLoopEngineRegistry } from "@/service/ScheduledLoopEngineRegistry";
import {
  AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
  AI_CHAT_V2_DENY_TOOL_PERMISSION,
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
  AI_CHAT_V2_GET_TOOL_APPROVAL_MODE,
  AI_CHAT_V2_SET_TOOL_APPROVAL_MODE,
  AI_CHAT_V2_READ_PASTE_CACHE,
  AI_CHAT_V2_HISTORY_SEARCH,
  AI_CHAT_V2_HISTORY_READ,
  AI_CHAT_V2_HISTORY_BROWSE,
  AI_CHAT_V2_HISTORY_RESOLVE_SELECTIONS,
  AI_CHAT_V2_HISTORY_UI_ENABLED,
  AI_CHAT_V2_COMPACTION_STATUS,
  AI_CHAT_V2_COMPACTION_CANCEL,
  AI_CHAT_V2_COMPACTION_START,
} from "@/config/channellist";
import type {
  AIChatPlanStateView,
  AIChatPlanVersionView,
  AskUserQuestionAnswer,
} from "@/entityTypes/aiChatPlanTypes";
import type { CommonMessage } from "@/entityTypes/commonType";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";
import { AnswerPlanQuestionAnswersSchema } from "@/main-process/communication/aiChatV2PlanAnswerSchema";
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
  ChatV2GeneratedImageReference,
} from "@/entityTypes/aiChatV2Types";
import { aiChatV2PastedContentsSchema } from "@/schemas/aiChatV2PastedText";
import {
  aiChatHistorySelectionIdsSchema,
  aiChatHistorySubmissionIdSchema,
} from "@/schemas/aiChatHistorySelections";
import { PasteStoreService } from "@/service/pastedText/PasteStoreService";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";
import {
  normalizeGeneratedImageReferences,
  GENERATED_IMAGE_REFERENCE_LIMIT_CODE,
  GENERATED_IMAGE_REFERENCE_INVALID_CODE,
} from "@/service/generatedImageReferenceNormalize";
import { getConfirmedBatchReferenceRegistry } from "@/service/ConfirmedBatchReferenceRegistry";
import { createChatV2StreamSink } from "@/service/aiChatV2StreamSink";

/** Cap for the user-confirmed batch reference set. Matches the batch tool's
 * MAX_BATCH_ITEMS so a confirmed set is never rejected downstream. */
const CONFIRMED_BATCH_MAX_REFERENCES = 50;
import type {
  SearchResult,
  ReadResult,
  ResolveResult,
} from "@/service/AIChatHistoryRetrievalService";
import type {
  ArchiveReadPage,
  RecoverableHistoryErrorCode,
} from "@/entityTypes/aiChatArchiveTypes";

/**
 * Minimal structural type for the IPC event object.
 * Mirrors the inline cast pattern used in ai-chat-ipc.ts (v1 handler).
 */
type IpcEventLike = {
  sender: {
    isDestroyed?: () => boolean;
    send: (channel: string, message: string) => void;
  };
};

// -------------------------------------------------------------------------
// Singleton engine — owns all turn state that used to be module-level.
// -------------------------------------------------------------------------

let queryEngine: AIChatQueryEngine | null = null;
let compactAgent: AIChatCompactAgentService | null = null;
/** Shared incremental-compaction coordinator (technical-design §11). Bound to
 * the same provider-backed summarize callback the compact agent uses, so
 * AI_CHAT_V2_COMPACTION_* handlers can drive coordinator runs without each
 * caller re-supplying a summarizer. Null on legacy/test wiring. */
let compactionCoordinator: AIChatCompactionCoordinator | null = null;
/** Shared model catalog for auto-compact context-window lookups. The catalog
 * caches the /api/ai/v1/models response in-process, so the lookup is free
 * after the first fetch. Provider-level state — not DB-bound. */
let compactModelCatalog: AIChatModelCatalogService | null = null;
let queryEngineDbPath: string | null = null;
let compactAgentDbPath: string | null = null;

/**
 * Build the production AIChatQueryLoop with real service deps.
 *
 * Exported for the production-wiring test (every engine consumer must check
 * the mandatory final request preflight — FR-04/FR-08, AC-11/AC-16).
 */
export function createQueryLoop(): AIChatQueryLoop {
  const deps: AIChatQueryLoopDeps = {
    // §8.5 mandatory final request preflight: every interactive dispatch is
    // budget-checked immediately before streamChatCompletion (FR-04/FR-08,
    // AC-11/AC-16). Never omit this service on a production path.
    requestBudgetService: new AIChatRequestBudgetService(),
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

/**
 * Rollout-flag snapshot captured alongside the singletons below. Flags are
 * read live (cheap Token reads), so a stage toggle rebuilds the engine/agent
 * on next use instead of sticking until restart or DB switch (design §18).
 */
let singletonNewCompactionFlag: boolean | null = null;

function readNewCompactionFlag(): boolean {
  try {
    return isNewCompactionEnabled();
  } catch {
    return false;
  }
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
  singletonNewCompactionFlag = null;
  // The coordinator captures the DB path at construction (BaseModule); a
  // user/DB switch invalidates it, so drop the singleton so the next
  // getCompactionCoordinator() mints one bound to the new path.
  compactionCoordinator = null;
  // The catalog is provider-level state; a user/DB switch may change the
  // active provider, so drop the cached model windows.
  compactModelCatalog = null;
  resetSharedAutoDreamService();
  resetSharedWorkspaceAutoDreamService();
  // Clear the shared lightweight route cooldowns so one account/provider
  // cannot suppress another (tech-design §12).
  resetLightweightRuntime();
  // Staged confirmed reference sets belong to the previous account's
  // conversations; drop them so they can never feed a new account's batch.
  getConfirmedBatchReferenceRegistry().clearAll();
}

function getCompactAgent(): AIChatCompactAgentService {
  const dbPath = getCurrentUserDbPath();
  const flag = readNewCompactionFlag();
  if (
    compactAgent &&
    (compactAgentDbPath !== dbPath || singletonNewCompactionFlag !== flag)
  ) {
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
      // §11.1: when the new-compaction stage is on, the interactive manual
      // compact (runFullCompact) delegates to the shared durable coordinator.
      // The flag is read live here (engine construction) so a toggle takes
      // effect on the next engine rebuild. Flag-off uses the budget-checked
      // legacy-summary rollback (design §15/§18 — the removed all-history
      // model call is never restored; only a bounded recent window is
      // summarized and no generation is published).
      ...(flag ? { compactionCoordinator: getCompactionCoordinator() } : {}),
    });
    compactAgentDbPath = dbPath;
    singletonNewCompactionFlag = flag;
  }
  return compactAgent;
}

/**
 * Provider-backed summarize callback shared by every coordinator run in this
 * process (manual, auto, session-memory, reactive). Preflights the exact
 * serialized request against the model window (§8.5) and pins the explicit
 * output cap (§8.3); oversized input/output is rejected locally, never sent
 * or blindly cut.
 */
async function providerSummarize(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  return dispatchSectionSummarize({
    systemPrompt,
    userPrompt,
    model,
    completeChat: (request) => new AiChatApi().openAIChatCompletion(request),
  });
}

/**
 * Shared incremental-compaction coordinator (technical-design §11). Bound to
 * the provider summarize callback so AI_CHAT_V2_COMPACTION_STATUS / CANCEL /
 * START and the manual compact flow share one coordinator instance.
 */
function getCompactionCoordinator(): AIChatCompactionCoordinator {
  if (!compactionCoordinator) {
    compactionCoordinator = new AIChatCompactionCoordinator({
      summarize: providerSummarize,
    });
  }
  return compactionCoordinator;
}

/**
 * Map a coordinator terminal state (or legacy view status) onto the progress
 * event vocabulary (design §13.1). Paused/joined/cancelled are NOT failures.
 */
function coordinatorStateToProgress(state: string): string {
  switch (state) {
    case "completed":
    case "active":
      return "completed";
    case "paused":
      return "paused";
    case "joined":
      return "joined";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

/**
 * Build a per-call retrieval service for local history browsing (§13.1).
 * Browsing is NOT turn-scoped (no model budget), so a fresh service instance is
 * fine — the retrieval budget only accumulates within a single model turn.
 */
function newRetrievalService(): AIChatHistoryRetrievalService {
  return new AIChatHistoryRetrievalService(new AIChatArchiveModule());
}


/** Shared engine singleton — also used by the workspace coordinator. */
export function getQueryEngine(): AIChatQueryEngine {
  const dbPath = getCurrentUserDbPath();
  if (
    queryEngine &&
    (queryEngineDbPath !== dbPath ||
      singletonNewCompactionFlag !== readNewCompactionFlag())
  ) {
    resetAiChatV2RuntimeForDatabaseSwitch();
  }
  if (!queryEngine) {
    const loop = createQueryLoop();
    queryEngine = new AIChatQueryEngine(loop, {
      compactAgent: getCompactAgent(),
      autoDreamService: getSharedAutoDreamService(),
      workspaceAutoDreamService: getSharedWorkspaceAutoDreamService(),
      // Turn mailboxes persist steering via the pending Module (design §10).
      // The applied flip broadcasts as a pending lifecycle event so every
      // surface's steering bubble clears (the shell store removes on it).
      steeringPromoter: createSteeringPromoter(
        new AIChatPendingMessageModule(),
        ({ conversationId, pendingMessageId, view }) => {
          AIChatV2EventBroadcaster.getInstance().emitPendingEvent({
            conversationId,
            pendingMessageId,
            status: "applied",
            occurredAt: new Date().toISOString(),
            ...(view ? { pendingMessage: view } : {}),
          });
        }
      ),
      // True-terminal notification for the durable queue: resumed-turn
      // continuations (permission / plan-question grants) are fire-and-forget,
      // so this is the only drain/hold trigger for rows queued behind them.
      // Coordinator-run terminals notify through the same queue call — the
      // double notification is idempotent (drain chains serialize; holds
      // re-pause already-paused rows).
      onTurnTerminal: (conversationId, outcome) => {
        void getQueueService()
          .notifyExternalTurnTerminal(conversationId, outcome)
          .catch((err: unknown) => {
            log.warn("[ai-chat-v2] queue terminal notification failed:", err);
          });
      },
      // §11.1: share one coordinator across the interactive engine and the
      // compact agent when the new-compaction stage is on, so the post-turn
      // auto-compaction hook takes the durable incremental path. Flag-off
      // omits it and compact attempts fail closed with an actionable
      // limitation (never the removed unbounded path — see above).
      ...(isNewCompactionEnabled()
        ? { compactionCoordinator: getCompactionCoordinator() }
        : {}),
      // §12 assembler with the compaction reader so the interactive engine
      // assembles from the active generation's boundary + overview when one is
      // published (degrades to legacy trim otherwise).
      contextAssembler: new AIChatContextAssembler({
        compactionReader: new AIChatCompactionModule(),
        archiveModule: new AIChatArchiveModule(),
      }),
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
 *
 * The same chunks are ALSO wrapped with run identity and routed through the
 * workspace detail channel (chat-first shell unification): the shell's
 * transcript consumes ChatRunDetailEvent, not the legacy stream channel, so
 * without this bridge a queue-drained turn would render only after a
 * history reload. The sink instance is per dispatch, so the adapter's
 * sequence stays monotonic within one turn; the synthetic runId is stable
 * for the turn (the presenter binds runs by opening "start" events).
 */
let pendingTurnSinkCounter = 0;
function createBroadcastEventSink(): AIChatQueryEventSink {
  const broadcaster = AIChatV2EventBroadcaster.getInstance();
  pendingTurnSinkCounter += 1;
  const adapter = new AIChatRunEventAdapter(
    `pending-queue-${pendingTurnSinkCounter}`,
    "" // per-chunk: the envelope id is overridden below (chunks carry it)
  );
  const routeDetail = (chunk: ChatV2StreamChunk): void => {
    if (!chunk.conversationId) return;
    // The adapter's envelope copies its CONSTRUCTOR conversationId, so bind
    // the chunk's real conversation here — the router only delivers events
    // whose conversation matches the window's selection.
    sharedWorkspaceEventRouter.sendDetailEvent({
      ...adapter.wrap(chunk),
      conversationId: chunk.conversationId,
    });
  };
  return createChatV2StreamSink({
    sendChunk: (chunk) => {
      broadcaster.emitStreamChunk(chunk);
      routeDetail(chunk);
    },
    sendComplete: (chunk) => {
      broadcaster.emitStreamComplete(chunk);
      routeDetail(chunk);
    },
  });
}

export function getQueueService(): AIChatTurnQueueService {
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

/**
 * Provider-aware Chat V2 availability gate. Exported so sibling AI-chat
 * handler files (e.g. generated-image export, workspace coordinator) enforce
 * the SAME gate FIRST, before parsing payloads or touching the filesystem.
 */
export function canUseChat(): { ok: true } | { ok: false; message: string } {
  const provider = getChatResolver().resolveForChat();
  if (provider.canUse) {
    return { ok: true };
  }
  return { ok: false, message: provider.message };
}

/**
 * Async chat-availability check with a lazy entitlement reconcile (PRD FR-6.1
 * / FR-6.2). When the denial is `hosted_subscription_required` (hosted mode +
 * USER_AI_ENABLED off), runs one `gated_feature` reconcile (30s cooldown) then
 * re-resolves — so a user who just paid but whose notify/cache hasn't caught
 * up is unlocked without a remount. Local-provider mode is untouched.
 *
 * GET failures keep the cache, so a Community user is never falsely unlocked.
 */
async function canUseChatWithReconcile(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const first = getChatResolver().resolveForChat();
  if (first.canUse) {
    return { ok: true };
  }
  // Only attempt a lazy reconcile for the hosted-subscription denial. Other
  // denials (local provider misconfigured) are not entitlement problems.
  if ("reason" in first && first.reason === "hosted_subscription_required") {
    await ensureHostedAiEnabled();
    const second = getChatResolver().resolveForChat();
    if (second.canUse) {
      return { ok: true };
    }
    return { ok: false, message: second.message };
  }
  return { ok: false, message: first.message };
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
  sendToRenderer(event, channel, JSON.stringify(chunk));
}

function sendToRenderer(
  event: IpcEventLike,
  channel: string,
  message: string
): void {
  if (event.sender.isDestroyed?.()) {
    return;
  }

  try {
    event.sender.send(channel, message);
  } catch (error) {
    // The renderer can be destroyed between isDestroyed() and send(). That is
    // expected during window/app shutdown and must not become a chat error.
    if (
      error instanceof Error &&
      error.message === "Object has been destroyed"
    ) {
      return;
    }
    throw error;
  }
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
  sendToRenderer(event, AI_CHAT_V2_STREAM_COMPLETE, JSON.stringify(chunk));
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
  // Generated-image references count as message content: the engine supplies
  // a neutral instruction when the text is blank.
  const hasReferences =
    Array.isArray(req.generatedImageReferences) &&
    req.generatedImageReferences.length > 0;
  if (
    !req ||
    typeof req.message !== "string" ||
    req.message.trim().length === 0
  ) {
    if (!hasFiles && !hasReferences) {
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
  if (req.historySelectionIds !== undefined) {
    const parsed = aiChatHistorySelectionIdsSchema.safeParse(
      req.historySelectionIds
    );
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? "invalid historySelectionIds";
    }
  }
  if (req.submissionId !== undefined) {
    const parsed = aiChatHistorySubmissionIdSchema.safeParse(req.submissionId);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? "invalid submissionId";
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
/**
 * Result of validating a chat request's generated-image fields.
 *  - ok: the normalized fields (references possibly empty; the confirmed
 *    batch staged into trusted main-process state when present) plus the
 *    request with those fields replaced/stripped for engine consumption.
 *  - !ok: a typed error to report on whichever surface the caller owns.
 */
type GeneratedImageValidationResult =
  | {
      ok: true;
      request: ChatV2StreamRequest;
    }
  | {
      ok: false;
      errorMessage: string;
      errorCode?: string;
    };

/**
 * Shared validation + trusted staging for generated-image request fields —
 * used by BOTH the direct stream handler and the pending-message queue path
 * (every renderer send now creates a pending row first, so the queue path
 * must enforce the exact same contract):
 *
 *  1. uploaded image attachments + direct generated-image references share
 *     one per-request budget (CHAT_IMAGE_LIMITS);
 *  2. the user-confirmed batch reference set is normalized and STAGED into
 *     ConfirmedBatchReferenceRegistry under the conversation id, then the
 *     field is stripped so the stored request / engine / model never see it.
 *
 * Never trusts renderer-supplied shapes; rejects before any provider work.
 */
function validateAndStageGeneratedImageFields(
  uploadedFiles: readonly { kind: string }[],
  req: ChatV2StreamRequest
): GeneratedImageValidationResult {
  const uploadedImageCount = uploadedFiles.filter(
    (file) => file.kind === "image"
  ).length;

  // Validate opaque generated-image references (never trust the renderer).
  const normalizedReferences = normalizeGeneratedImageReferences(
    req.generatedImageReferences,
    CHAT_IMAGE_LIMITS.maxImagesPerRequest
  );
  if (!normalizedReferences.ok) {
    return {
      ok: false,
      errorMessage: normalizedReferences.reason,
      errorCode: normalizedReferences.errorCode,
    };
  }

  // Combined image cap: uploaded image attachments + referenced generated
  // images share one per-request budget.
  if (
    uploadedImageCount + normalizedReferences.references.length >
    CHAT_IMAGE_LIMITS.maxImagesPerRequest
  ) {
    return {
      ok: false,
      errorMessage: `Too many images: at most ${CHAT_IMAGE_LIMITS.maxImagesPerRequest} combined uploaded and referenced images are allowed per request.`,
      errorCode: GENERATED_IMAGE_REFERENCE_LIMIT_CODE,
    };
  }

  // User-confirmed batch reference set: normalized here and staged into
  // trusted main-process state under this conversation's id. Staging runs
  // AFTER every other validation so no earlier failure leaves a stale set
  // behind, and the field is stripped from the request so the engine/model
  // never see it.
  const confirmedBatch = req.confirmedGeneratedImageBatch as
    | { references?: unknown }
    | undefined;
  if (confirmedBatch !== undefined) {
    const batchRecord =
      typeof confirmedBatch === "object" &&
      confirmedBatch !== null &&
      !Array.isArray(confirmedBatch)
        ? confirmedBatch
        : undefined;
    if (
      !batchRecord ||
      !Array.isArray(batchRecord.references) ||
      typeof req.conversationId !== "string" ||
      req.conversationId.length === 0
    ) {
      return {
        ok: false,
        errorMessage:
          "confirmedGeneratedImageBatch requires a conversationId and a non-empty references array",
        errorCode: GENERATED_IMAGE_REFERENCE_INVALID_CODE,
      };
    }
    const normalizedConfirmed = normalizeGeneratedImageReferences(
      batchRecord.references,
      CONFIRMED_BATCH_MAX_REFERENCES
    );
    if (
      !normalizedConfirmed.ok ||
      normalizedConfirmed.references.length === 0
    ) {
      return {
        ok: false,
        errorMessage: normalizedConfirmed.ok
          ? "confirmedGeneratedImageBatch.references must contain at least one reference"
          : normalizedConfirmed.reason,
        errorCode: normalizedConfirmed.ok
          ? GENERATED_IMAGE_REFERENCE_INVALID_CODE
          : normalizedConfirmed.errorCode ??
            GENERATED_IMAGE_REFERENCE_INVALID_CODE,
      };
    }
    getConfirmedBatchReferenceRegistry().stage(
      req.conversationId,
      normalizedConfirmed.references
    );
  }

  return {
    ok: true,
    request: {
      ...req,
      generatedImageReferences:
        normalizedReferences.references.length > 0
          ? normalizedReferences.references
          : undefined,
      // Trusted channel only: never stored, forwarded, or model-visible.
      confirmedGeneratedImageBatch: undefined,
    },
  };
}

async function handleStream(event: IpcEventLike, data: string): Promise<void> {
  // Chat availability gate FIRST, before parsing request data.
  const chatAccess = await canUseChatWithReconcile();
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
  const validated = validateAndStageGeneratedImageFields(uploadedFiles, req);
  if (!validated.ok) {
    sendComplete(event, {
      eventType: "error",
      conversationId:
        typeof req.conversationId === "string" ? req.conversationId : "",
      errorMessage: validated.errorMessage,
      ...(validated.errorCode ? { errorCode: validated.errorCode } : {}),
    });
    return;
  }
  const processedReq: ChatV2StreamRequest = {
    ...validated.request,
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
  // A staged confirmed reference set belongs to the turn being stopped:
  // dropping it prevents a cancelled turn from feeding a later batch run.
  const registry = getConfirmedBatchReferenceRegistry();
  if (conversationId !== undefined) {
    registry.clear(conversationId);
  } else {
    registry.clearAll();
  }
  getQueryEngine().stopActiveTurn(conversationId);
}

// -------------------------------------------------------------------------
// Resume handler: tool after permission
// -------------------------------------------------------------------------

export async function handleResumeToolAfterPermission(
  data: unknown
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  const chatAccess = await canUseChatWithReconcile();
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

  const conversationId =
    typeof parsed.conversationId === "string"
      ? parsed.conversationId
      : undefined;

  // Scheduled-loop permission routing (Task 7): when a scheduled engine owns
  // the paused turn for this conversation + toolId, route the grant directly
  // to it instead of the interactive singleton engine. The scheduled engine
  // parked the turn and is the only one that can resume it.
  if (conversationId) {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const entry = registry.getByConversation(conversationId);
    if (entry && registry.hasPendingPermission(conversationId, parsed.toolId)) {
      const result = await entry.engine.resumeToolAfterPermission({
        toolId: parsed.toolId,
        conversationId,
      });
      entry.clearPermissionBackstop?.();
      registry.clearPendingPermission(conversationId);
      return ok(result);
    }
  }

  const engine = getQueryEngine();
  const result = await engine.resumeToolAfterPermission({
    toolId: parsed.toolId,
    conversationId,
  });
  return ok(result);
}

/**
 * Deny a paused tool permission (Task 7). When a scheduled-loop engine owns
 * the paused turn, route the deny to it so it synthesizes a denied tool_result
 * and continues the run. When no scheduled engine owns the permission, return
 * `handled: false` so the renderer falls back to `stopChatV2Stream` (the
 * interactive engine is stopped rather than resumed with a deny).
 */
export async function handleDenyToolPermission(
  data: unknown
): Promise<CommonMessage<{ ok: boolean; handled: boolean; error?: string }>> {
  const chatAccess = await canUseChat();
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
    return denied("Invalid deny payload");
  }
  if (!parsed.toolId || typeof parsed.toolId !== "string") {
    return denied("toolId is required");
  }

  const conversationId =
    typeof parsed.conversationId === "string"
      ? parsed.conversationId
      : undefined;

  if (conversationId) {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const entry = registry.getByConversation(conversationId);
    if (entry && registry.hasPendingPermission(conversationId, parsed.toolId)) {
      const result = await entry.engine.denyToolPermission({
        toolId: parsed.toolId,
        conversationId,
      });
      entry.clearPermissionBackstop?.();
      registry.clearPendingPermission(conversationId);
      return ok({ ok: result.ok, handled: true, error: result.error });
    }
  }

  // No scheduled engine owns this permission — renderer falls back to
  // stopChatV2Stream (interactive deny).
  return ok({ ok: true, handled: false });
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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
  // Same generated-image contract as the direct stream handler (every send
  // now queues first): validate reference shapes + combined image cap, stage
  // the user-confirmed batch set into trusted main-process state, and strip
  // the trusted field so neither the stored row nor the engine/model see it.
  const uploadedFiles = normalizeChatV2UploadedFiles(
    input.request.uploadedFiles
  );
  const validated = validateAndStageGeneratedImageFields(
    uploadedFiles,
    input.request
  );
  if (!validated.ok) {
    throw new AIChatTurnQueueError("INVALID_REQUEST", validated.errorMessage);
  }
  return await getQueueService().submit({
    clientRequestId: input.clientRequestId,
    request: {
      ...validated.request,
      uploadedFiles: uploadedFiles.length > 0 ? uploadedFiles : undefined,
    },
  });
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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

/**
 * Start (or resume) a bounded compaction run and return IMMEDIATELY
 * (design §13.1 start/status/progress — never one blocking RPC for the whole
 * batch). The run continues in the main process; the renderer drives its
 * badge from progress events + AI_CHAT_V2_COMPACTION_STATUS, so navigating
 * away mid-batch loses nothing. Resume is just another start call: a fresh
 * claim resumes from persisted checkpoints (paused runs are never joined).
 */
async function handleCompactionStart(
  data: string
): Promise<CommonMessage<{ started: boolean }>> {
  const chatAccess = await canUseChatWithReconcile();
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
  if (!readNewCompactionFlag()) {
    return denied(
      "Compaction unavailable: bounded incremental coordinator is not wired. " +
        "Enable new compaction publication; unbounded all-history summarization is disabled."
    );
  }
  const conversationId = parsed.conversationId;
  const model = parsed.model;
  try {
    AIChatConversationUpdateBroadcaster.getInstance().emitCompactionProgress({
      conversationId,
      runId: "",
      state: "running",
      sectionsPacked: 0,
      occurredAt: new Date().toISOString(),
    });
    // Fire-and-forget BY DESIGN: settle only via progress events. The promise
    // chain is always observed here, so no unhandled rejection can escape.
    void getCompactionCoordinator()
      .requestCompaction(conversationId, {
        trigger: "manual",
        model,
        summarize: providerSummarize,
      })
      .then(
        (result) => {
          AIChatConversationUpdateBroadcaster.getInstance().emitCompactionProgress(
            {
              conversationId,
              runId: result.runId,
              state: coordinatorStateToProgress(result.state),
              generationId: result.generationId,
              sectionsPacked: result.sectionsPacked,
              occurredAt: new Date().toISOString(),
            }
          );
        },
        (err: unknown) => {
          AIChatConversationUpdateBroadcaster.getInstance().emitCompactionProgress(
            {
              conversationId,
              runId: "",
              state: "failed",
              sectionsPacked: 0,
              occurredAt: new Date().toISOString(),
              message: userSafeError(err),
            }
          );
        }
      );
    return ok({ started: true });
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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
  const chatAccess = await canUseChatWithReconcile();
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

// -------------------------------------------------------------------------
// Recoverable-history handlers (technical-design §13).
//
// History search/read/resolve are LOCAL browsing only — no AI calls, so they
// are NOT gated on USER_AI_ENABLED (§13 explicitly scopes history endpoints as
// local browsing). Compaction status/cancel ARE AI-gated because they drive
// the incremental-compaction coordinator which calls the AI provider.
// -------------------------------------------------------------------------

/** Envelope for local history browsing results (carries errorCode from the
 * retrieval service so the renderer can render partial-scan / no-match states
 * without distinguishing error vs empty). */
interface HistoryBrowseEnvelope<T> {
  data: T | null;
  errorCode?: RecoverableHistoryErrorCode;
  errorMessage?: string;
}

function historyOk<T>(
  data: T,
  errorCode?: RecoverableHistoryErrorCode
): CommonMessage<HistoryBrowseEnvelope<T>> {
  return ok({ data, errorCode });
}

function historyDenied<T>(
  msg: string
): CommonMessage<HistoryBrowseEnvelope<T>> {
  return denied(msg);
}

/**
 * Validate a conversationId for history browsing. Must be a non-empty v2- id;
 * the archive layer enforces epoch/revision scoping beyond this.
 */
function validateHistoryConversationId(id: unknown): string | null {
  if (typeof id !== "string" || id.length === 0) return null;
  if (!id.startsWith("v2-")) return null;
  return id;
}

async function handleHistoryBrowse(
  data: unknown
): Promise<CommonMessage<HistoryBrowseEnvelope<ArchiveReadPage>>> {
  const req = parseObjectPayload(data);
  const conversationId = validateHistoryConversationId(req.conversationId);
  if (!conversationId) {
    return historyDenied("conversationId is required");
  }
  const cursor = typeof req.cursor === "string" ? req.cursor : undefined;
  try {
    // Paginated chronological browse (local, no AI). Bounded page: 20 rows +
    // 8k code points so viewing history never loads the archive into memory
    // or the model — viewing is independent of model-context selection (§13).
    const archive = new AIChatArchiveModule();
    const page = await archive.readPage({
      conversationId,
      cursor,
      maxRows: 20,
      maxCodePoints: 8_000,
    });
    return historyOk(page);
  } catch (err) {
    return historyDenied(userSafeError(err));
  }
}

async function handleHistorySearch(
  data: unknown
): Promise<CommonMessage<HistoryBrowseEnvelope<SearchResult>>> {
  const req = parseObjectPayload(data);
  const conversationId = validateHistoryConversationId(req.conversationId);
  if (!conversationId) {
    return historyDenied("conversationId is required");
  }
  const query = typeof req.query === "string" ? req.query : "";
  if (query.length === 0 || query.length > 200) {
    return historyDenied("query must be 1-200 characters");
  }
  const cursor = typeof req.cursor === "string" ? req.cursor : undefined;
  const limit =
    typeof req.limit === "number" && req.limit > 0 && req.limit <= 20
      ? Math.floor(req.limit)
      : undefined;
  try {
    const svc = newRetrievalService();
    const result = await svc.search({
      conversationId,
      query,
      cursor,
      limit,
    });
    return historyOk(result, result.errorCode);
  } catch (err) {
    return historyDenied(userSafeError(err));
  }
}

async function handleHistoryRead(
  data: unknown
): Promise<CommonMessage<HistoryBrowseEnvelope<ReadResult>>> {
  const req = parseObjectPayload(data);
  const conversationId = validateHistoryConversationId(req.conversationId);
  if (!conversationId) {
    return historyDenied("conversationId is required");
  }
  // args is the model/tool argument object (source_id/message_id or
  // from_source_id/to_source_id). The retrieval service runs the Zod schema
  // (conversationHistoryReadInputSchema) internally; we pass it through.
  const args =
    req.args && typeof req.args === "object"
      ? (req.args as Record<string, unknown>)
      : {};
  const cursor = typeof req.cursor === "string" ? req.cursor : undefined;
  try {
    const svc = newRetrievalService();
    const result = await svc.read({
      conversationId,
      args: { ...args, ...(cursor ? { cursor } : {}) },
    });
    return historyOk(result, result.errorCode);
  } catch (err) {
    return historyDenied(userSafeError(err));
  }
}

async function handleHistoryResolveSelections(
  data: unknown
): Promise<CommonMessage<HistoryBrowseEnvelope<ResolveResult>>> {
  const req = parseObjectPayload(data);
  const conversationId = validateHistoryConversationId(req.conversationId);
  if (!conversationId) {
    return historyDenied("conversationId is required");
  }
  const rawIds = req.sourceIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return historyDenied("sourceIds must be a non-empty array");
  }
  if (rawIds.length > 50) {
    return historyDenied("too many selections (max 50)");
  }
  const sourceIds = rawIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
  if (sourceIds.length === 0) {
    return historyDenied("sourceIds must contain non-empty strings");
  }
  try {
    const svc = newRetrievalService();
    const result = await svc.resolveSelections(conversationId, sourceIds);
    return historyOk(result, result.errorCode);
  } catch (err) {
    return historyDenied(userSafeError(err));
  }
}

async function handleHistoryUiEnabled(): Promise<
  CommonMessage<{ enabled: boolean }>
> {
  // Token lives in main (design §18, stage 3). Read live so a runtime toggle
  // takes effect without restart. Fail-closed on store errors.
  try {
    return ok({ enabled: isHistoryUiEnabled() });
  } catch {
    return ok({ enabled: false });
  }
}

async function handleCompactionStatus(
  data: unknown
): Promise<CommonMessage<CompactionStatusSnapshot | null>> {
  const chatAccess = await canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
  }
  const req = parseObjectPayload(data);
  const conversationId = validateHistoryConversationId(req.conversationId);
  if (!conversationId) {
    return denied("conversationId is required");
  }
  try {
    const status = await getCompactionCoordinator().getStatus(conversationId);
    return ok(status);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleCompactionCancel(
  data: unknown
): Promise<CommonMessage<{ cancelled: boolean }>> {
  const chatAccess = await canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
  }
  const req = parseObjectPayload(data);
  const conversationId = validateHistoryConversationId(req.conversationId);
  if (!conversationId) {
    return denied("conversationId is required");
  }
  // The coordinator does not expose a public cancel-run entry from the IPC
  // layer; cancellation is driven by the AbortSignal supplied to
  // requestCompaction. For a user-initiated cancel of an in-flight run, we
  // call the coordinator's requestCompaction with a pre-aborted signal so the
  // in-flight dedup path joins and immediately short-circuits. If no run is
  // in flight, this is a no-op that resolves cleanly.
  try {
    const controller = new AbortController();
    controller.abort();
    await getCompactionCoordinator().requestCompaction(conversationId, {
      trigger: "manual",
      summarize: async () => "",
      signal: controller.signal,
    });
    return ok({ cancelled: true });
  } catch {
    // Abort surfaces as a RecoverableHistoryError; the run is cancelled
    // regardless, so report success to the renderer.
    return ok({ cancelled: true });
  }
}

export function registerAiChatV2IpcHandlers(): void {
  ipcMain.handle(
    AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
    async (_e, data: unknown) => handleResumeToolAfterPermission(data ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_DENY_TOOL_PERMISSION, async (_e, data: unknown) =>
    handleDenyToolPermission(data ?? "")
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
  ipcMain.handle(AI_CHAT_V2_GET_TOOL_APPROVAL_MODE, async (_e, data: unknown) =>
    handleGetToolApprovalMode((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_SET_TOOL_APPROVAL_MODE, async (_e, data: unknown) =>
    handleSetToolApprovalMode((data as string) ?? "")
  );
  ipcMain.handle(AI_CHAT_V2_READ_PASTE_CACHE, async (_e, data: unknown) =>
    handleReadPasteCache(data)
  );
  // Recoverable-history channels (§13). History browsing is local (no AI gate);
  // compaction status/cancel ARE AI-gated.
  ipcMain.handle(AI_CHAT_V2_HISTORY_SEARCH, async (_e, data: unknown) =>
    handleHistorySearch(data)
  );
  ipcMain.handle(AI_CHAT_V2_HISTORY_READ, async (_e, data: unknown) =>
    handleHistoryRead(data)
  );
  ipcMain.handle(AI_CHAT_V2_HISTORY_BROWSE, async (_e, data: unknown) =>
    handleHistoryBrowse(data)
  );
  ipcMain.handle(
    AI_CHAT_V2_HISTORY_RESOLVE_SELECTIONS,
    async (_e, data: unknown) => handleHistoryResolveSelections(data)
  );
  ipcMain.handle(AI_CHAT_V2_HISTORY_UI_ENABLED, async () =>
    handleHistoryUiEnabled()
  );
  ipcMain.handle(AI_CHAT_V2_COMPACTION_STATUS, async (_e, data: unknown) =>
    handleCompactionStatus(data)
  );
  ipcMain.handle(AI_CHAT_V2_COMPACTION_CANCEL, async (_e, data: unknown) =>
    handleCompactionCancel(data)
  );
  ipcMain.handle(AI_CHAT_V2_COMPACTION_START, async (_e, data: unknown) =>
    handleCompactionStart((data as string) ?? "")
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
