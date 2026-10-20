// src/service/AIChatQueryEngine.ts
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { checkChatMessageForCredentials } from "@/service/ChatCredentialGuard";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { AIChatAttachmentModule } from "@/modules/AIChatAttachmentModule";
import { AIChatToolApprovalModule } from "@/modules/AIChatToolApprovalModule";
import {
  DocumentService,
  StagedAttachmentReference,
} from "@/service/DocumentService";
import type {
  OpenAIChatImage,
  OpenAIChatMessage,
  OpenAITool,
  ToolFunction,
} from "@/api/aiChatApi";
import { AIChatGeneratedImageStorageService } from "@/service/AIChatGeneratedImageStorageService";
import { GeneratedImageReferenceService } from "@/service/GeneratedImageReferenceService";
import {
  GeneratedImageReferenceError,
  type GeneratedImageReferenceErrorCode,
  type ResolveGeneratedImagesResult,
} from "@/entityTypes/generatedImageReferenceTypes";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { HookDispatcher } from "@/service/hooks/HookDispatcher";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import { AtMentionResolutionService } from "@/service/aiChatAtMentions/AtMentionResolutionService";
import { PastedTextResolutionService } from "@/service/pastedText/PastedTextResolutionService";
import type { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import { AIChatGoalModule } from "@/modules/AIChatGoalModule";
import { AIChatHistoryRetrievalService } from "@/service/AIChatHistoryRetrievalService";
import {
  buildSelectedHistoryContextBlock,
  toSelectedHistoryExcerptInputs,
  type SelectedHistoryExcerptInput,
} from "@/service/SelectedHistoryContextBlock";
import { isArchiveReadsEnabled } from "@/config/featureFlags";
import { RecoverableHistoryError } from "@/entityTypes/aiChatArchiveTypes";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatCompactionModule } from "@/modules/AIChatCompactionModule";
import type { ChatV2HistorySelectionMetadata } from "@/entityTypes/aiChatV2Types";
import { AIChatModelCatalogService } from "@/service/AIChatModelCatalogService";
import type { AIAutoDreamService } from "@/service/AIAutoDreamService";
import type { AIWorkspaceAutoDreamService } from "@/service/AIWorkspaceAutoDreamService";
import { DesktopNotifyService } from "@/service/DesktopNotifyService";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  serializeToolResultContent,
  normalizeToolResult,
  isPermissionPromptResult,
  toolResultReceiptUiMetadata,
  buildBoundedToolFailureContent,
} from "@/service/AIChatQueryLoop";
import { ToolResultModule } from "@/modules/ToolResultModule";
import {
  ToolResultPipeline,
  ToolResultPublicationError,
} from "@/service/toolResult/ToolResultPipeline";
import {
  TOOL_RESULT_CONFIG,
  BATCH_PREVIEW_TOOL_NAMES as TOOL_RESULT_BATCH_PREVIEW_TOOL_NAMES,
} from "@/config/toolResultConfig";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { getToolResultStorageRoot } from "@/service/toolResult/toolResultRoot";
import {
  isToolOutputCaptureEnabled,
  isToolOutputModelRefsEnabled,
} from "@/config/featureFlags";
import {
  buildImageArtifactHandoffMessage,
  countImageContentParts,
  countImageDataUrlChars,
} from "@/service/AIChatImageHandoff";
import { buildPromptSkillHandoffMessage } from "@/service/PromptSkillHandoff";
import { redirectToLoginOnAuthExpired } from "@/service/AIChatAuthExpiredHandler";
import {
  userSafeError,
  isContextWindowExceededError,
  imageEditErrorCode,
} from "@/service/AIChatErrorMapper";
import { extractToolResultImages } from "@/service/toolResultImageHarvest";
import {
  AIChatTurnControl,
  type AIChatSteeringInstruction,
  type AIChatSteeringReservation,
} from "@/service/AIChatTurnControl";
import { Token } from "@/modules/token";
import { USER_AI_AUTO_PLAN, USER_AI_ENABLED } from "@/config/usersetting";
import { ENTER_PLAN_MODE_TOOL } from "@/service/EnterPlanModeTool";
import {
  resolveToolCatalogMode,
  resolvePositiveIntEnv,
  TOOL_CATALOG_ENV,
} from "@/config/toolCatalogConfig";
import { ToolCatalogService } from "@/service/ToolCatalogService";
import { ConversationToolStateService } from "@/service/ConversationToolStateService";
import { ToolPromptBudgetService } from "@/service/ToolPromptBudgetService";
import { AIChatRequiredPersistenceError } from "@/service/AIChatQueryEvents";
import { AI_CHAT_RECOVERY_DEFAULTS } from "@/service/AIChatRetryPolicy";
import type {
  AIChatStreamImplementationConfigProvider,
  AIChatStreamImplementationMode,
} from "@/service/aiChat/AIChatStreamImplementationConfig";
import { consumeGenerator } from "@/service/aiChat/consumeGenerator";
import { getStartupStreamImplementationConfig } from "@/service/aiChatWorkspaceRuntime";
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
  AIChatPlanLoopContext,
  AIChatSegmentOutcome,
  AIChatTurnLifecycleListener,
  AIChatTurnTerminalEvent,
  AnswerPlanQuestionRequest,
  PendingPermissionTurn,
  PendingPlanQuestionTurn,
  ResumeToolAfterPermissionRequest,
  ResumeTurnResult,
} from "@/service/AIChatQueryEvents";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import type {
  ChatV2ReasoningMetadata,
  ChatV2StreamRequest,
  ChatV2UploadedAttachment,
  ChatV2AttachmentMetadata,
  ChatV2MessageMetadata,
  ChatV2RuntimeStatus,
  ChatV2GeneratedImageReference,
  ChatV2GeneratedImageReferenceMetadata,
} from "@/entityTypes/aiChatV2Types";
import type { AIChatScheduledTurnContext } from "@/entityTypes/aiChatScheduledLoopTypes";
import type {
  OpenAITextContentPart,
  OpenAIImageUrlContentPart,
} from "@/api/aiChatApi";
import { openAIContentToString } from "@/api/aiChatApi";
import { isPlanStatusPlanningActive } from "@/entityTypes/aiChatPlanTypes";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import type {
  ToolCatalog,
  ToolCatalogModeDecision,
  ToolCatalogRuntimeContext,
} from "@/entityTypes/toolCatalogTypes";
import { log } from "@/modules/Logger";
import { getConfirmedBatchReferenceRegistry } from "@/service/ConfirmedBatchReferenceRegistry";
import { OutboundEmailIntentResolver } from "@/service/outboundEmail/OutboundEmailIntentResolver";
import { hashUserAuthoredText } from "@/service/outboundEmail/OutboundEmailIntentResolver";
import { buildResolverInput } from "@/service/outboundEmail/OutboundEmailPreviousAssistantContext";
import { OUTBOUND_RESOLVER_VERSION } from "@/service/outboundEmail/outboundReliabilityVersions";
import { OutboundEmailIntentModule } from "@/modules/OutboundEmailIntentModule";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import { isAiTaskCompletionPolicyV1Enabled } from "@/config/featureFlags";
import {
  TaskExecutionCoordinator,
  assertOwnership,
  readCurrentLeaseGeneration,
} from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import { buildFinalEventIdentity } from "@/service/aiTaskExecution/TaskExecutionRestartRecovery";
import type { FinalizeManualInput } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import type { TaskExecutionBinding } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import {
  TaskRequestResolver,
  isGoalLinkedMessage,
} from "@/service/aiTaskExecution/TaskRequestResolver";
import { compileCriteria } from "@/service/aiTaskExecution/TaskCriteriaResolver";
import type {
  TaskCompletionContract,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";
import {
  buildEvidenceService,
  makeNativeSendStatusReader,
} from "@/service/aiTaskExecution/EvidenceProviderFactory";
import { snapshotArtifactBaselines } from "@/service/aiTaskExecution/criteriaAdapters";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { SearchModule } from "@/modules/SearchModule";
import { contactInfoRepository } from "@/model/ContactInfo.model";
import type { LoopTaskExecutionBinding } from "@/service/aiTaskExecution/TaskLoopConsult";
import { makeTrackedPersistBudget } from "@/service/aiTaskExecution/TaskLoopConsult";
import { TaskProgressTracker } from "@/service/aiTaskExecution/TaskProgressTracker";
import { deriveCandidateDiagnostics } from "@/service/aiTaskExecution/candidateDiagnostics";
import type {
  TaskCompletionDecision,
  TaskEndCandidate,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Mirrors the renderer's isPlanStateActive (planStateUtil.ts): a plan is
 * plan-mode active while it is being drafted, clarified, or awaiting
 * approval. Once the user approves the plan, execution runs in chat mode
 * with the normal system prompt and full tool access — so "approved" is
 * NOT plan-mode active here either. Both predicates delegate to the shared
 * isPlanStatusPlanningActive (aiChatPlanTypes.ts) so the renderer and main
 * process can never disagree about which prompt/toolset a round uses after
 * approval.
 */
function isActivePlanState(plan?: AIChatPlanStateView | null): boolean {
  if (!plan) return false;
  return isPlanStatusPlanningActive(plan.status);
}

/**
 * Collect recent user message texts from an assembled transcript so contextual
 * tool promotion can inherit intent across short follow-ups like "continue".
 * Excludes synthetic image-handoff markers. Newest messages last; capped.
 */
function collectRecentUserMessages(
  messages: readonly OpenAIChatMessage[],
  limit = 6
): string[] {
  const collected: string[] = [];
  for (let i = messages.length - 1; i >= 0 && collected.length < limit; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = openAIContentToString(message.content).trim();
    if (!text) continue;
    if (text.includes("[AIFETCHLY_IMAGE_HANDOFF_V1]")) continue;
    collected.push(text);
  }
  return collected.reverse();
}

/**
 * Detect whether the assembled transcript contains any AI-generated image
 * references (the `<generated_images>` marker injected by
 * {@link augmentContentWithGeneratedImages}). Informational context flag for
 * tool-catalog awareness only: the tool-load policy no longer auto-promotes
 * export/attach tools for follow-up edits, because a selected generated image
 * arrives attached to the current user turn and is edited directly.
 */
function messagesHaveGeneratedImages(
  messages: readonly OpenAIChatMessage[]
): boolean {
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const text = openAIContentToString(m.content);
    if (text.includes("<generated_images>")) return true;
  }
  return false;
}

/** Maximum persisted reasoning characters per assistant message (32 KB). */
const CHAT_V2_REASONING_MAX_CHARS = 32 * 1024;

/**
 * Stable English fallback strings per generated-image error code. The
 * renderer localizes via `errorCode`; these keep terminal chunks readable
 * when shown raw.
 */
const GENERATED_IMAGE_REFERENCE_ERROR_MESSAGES: Record<
  GeneratedImageReferenceErrorCode,
  string
> = {
  generated_image_reference_invalid:
    "The selected generated image reference is invalid.",
  generated_image_not_owned:
    "You do not have access to the selected generated image.",
  generated_image_missing: "The selected generated image no longer exists.",
  generated_image_outside_store:
    "The selected generated image is outside the allowed storage location.",
  generated_image_symlink_rejected:
    "The selected generated image failed a security check.",
  generated_image_unsupported_type:
    "The selected generated image has an unsupported format.",
  generated_image_too_large: "The generated image exceeds the size limit.",
  generated_image_dimension_limit:
    "The generated image exceeds the dimension limit.",
  generated_image_reference_limit: "Too many images attached to this request.",
  generated_image_ambiguous:
    "The selected generated image reference is ambiguous.",
  generated_image_fusion_limit:
    "Too many generated images selected for this request.",
  generated_image_batch_partial:
    "Some selected generated images could not be prepared.",
  generated_image_batch_cancelled: "Generated image preparation was cancelled.",
};

/**
 * Trigger a proactive pre-turn compact when the assembled context's token
 * estimate reaches this fraction of the model's context window. Kept in sync
 * with AIChatCompactAgentService.AUTO_COMPACT_THRESHOLD_FRACTION so the
 * pre-turn gate and the post-turn auto-compact agree on when to compact.
 * Gives ~30% headroom for intra-turn tool-call/result growth.
 */
const AUTO_COMPACT_THRESHOLD_FRACTION = 0.7;

/**
 * Build persisted reasoning metadata from the loop's final reasoning string.
 * Returns undefined when there is nothing to persist. Truncates above the cap
 * and flags truncated=true so history stays bounded while live streaming stays
 * unbounded.
 */
function buildReasoningMetadata(
  reasoningContent: string | undefined,
  model: string | undefined
): { reasoning: ChatV2ReasoningMetadata } | undefined {
  if (!reasoningContent || reasoningContent.length === 0) {
    return undefined;
  }
  const over = reasoningContent.length > CHAT_V2_REASONING_MAX_CHARS;
  return {
    reasoning: {
      content: over
        ? reasoningContent.slice(0, CHAT_V2_REASONING_MAX_CHARS)
        : reasoningContent,
      format: "plain_text",
      source: "server",
      model,
      truncated: over ? true : false,
    },
  };
}

function isTypedPlanApproval(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const negativeSignals = [
    "do not approve",
    "don't approve",
    "not approved",
    "reject",
    "rejected",
    "request changes",
    "changes requested",
  ];
  if (negativeSignals.some((signal) => normalized.includes(signal))) {
    return false;
  }

  const explicitApprovalSignals = [
    "plan approved",
    "approve the plan",
    "approved the plan",
    "i approve",
  ];
  if (explicitApprovalSignals.some((signal) => normalized.includes(signal))) {
    return true;
  }

  const looksGoodSignals = ["looks good", "looks fine", "looks correct"];
  const executionSignals = [
    "begin executing",
    "start executing",
    "please execute",
    "execute the plan",
  ];
  return (
    looksGoodSignals.some((signal) => normalized.includes(signal)) &&
    executionSignals.some((signal) => normalized.includes(signal))
  );
}

/** Convert ToolFunction[] to OpenAITool[] format. */
function toOpenAITools(toolFunctions: ToolFunction[]): OpenAITool[] {
  return toolFunctions
    .filter((tool) => tool.type === "function" && typeof tool.name === "string")
    .map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
}

interface AttachmentPrepResult {
  enrichedMessage: string;
  contentParts: Array<OpenAITextContentPart | OpenAIImageUrlContentPart>;
  displayMetadata: ChatV2AttachmentMetadata[];
  attachmentRefs: string[];
  docFileNames: string[];
}

export interface AIChatQuerySubmitInput {
  eventSink: AIChatQueryEventSink;
  request: ChatV2StreamRequest;
  /**
   * Trusted scheduled-turn context. Supplied only by main-process code (the
   * scheduled runner); when present the engine uses the stable message IDs,
   * tags the rows with scheduled-loop metadata, and requires an existing v2-*
   * conversation (it does not create one). Renderer input cannot forge this
   * object (technical-design §14.1).
   */
  scheduledContext?: AIChatScheduledTurnContext;
  /**
   * Main-process-only trusted signal: true only for unattended scheduled-loop
   * turns where the user pre-allowlisted `start_email_send_task` via the typed
   * confirmation at loop creation. The renderer cannot forge this flag.
   */
  outboundSendPreAuthorized?: boolean;
  /**
   * Stage A §3.2 (FR-021): owner-supplied lifecycle listener. The engine
   * calls onAwaiting exactly once when it parks this turn and onResumed when
   * a claimed resume starts executing. Synchronous, non-throwing; the owner
   * serializes its own persistence-then-broadcast work.
   */
  lifecycle?: AIChatTurnLifecycleListener;
  /**
   * TODO-05 (FR-023): owner-supplied durable-run gate — awaited after the
   * terminal case's durable message writes but BEFORE post-terminal side
   * effects. The owning coordinator persists the run transition here.
   */
  onSegmentDurable?: (
    conversationId: string,
    outcome: "completed" | "cancelled" | "failed"
  ) => Promise<void>;
  /**
   * Stage A §3.6 (FR-023): when true, the run owner notifies the queue at
   * terminal; the engine's own onTurnTerminal callback is skipped so the
   * queue is notified exactly once per run.
   */
  ownerNotifiesTerminal?: boolean;
  /**
   * T02 (FR-02/05/07/20, AC-01-05/17/30/32): caller-supplied loop binding for
   * scheduled turns. The scheduled runner builds it (frozen contract + real
   * evidence + budget + consult closure mirroring the manual seam) BEFORE
   * calling `submitMessage`, so the engine's loop consults at
   * round_cap/response_end for scheduled turns — same-occurrence continuation
   * via the §7.3 prompt (54/100 → continue → 100/100). Without this field
   * scheduled turns never get a binding (the engine's internal manual
   * enrollment skips scheduledContext turns), so the loop never consults and
   * only the sink's post-stream consult fires — too late to continue.
   *
   * Main-process-only trusted signal: `scheduledContext` is trusted
   * main-process metadata the renderer cannot forge (technical-design
   * §14.1), so this field is unreachable from renderer input. Ignored unless
   * `scheduledContext` is present.
   */
  taskExecutionBinding?: LoopTaskExecutionBinding;
  /**
   * T09 (FR-14/21/22, AC-16/27/28): trusted Continue/Retry successor context.
   * The recovery IPC handler creates the successor execution via the
   * coordinator (T08) and dispatches the engine with the coordinator's
   * created binding + the parent's parsed route. The engine ADOPTS that
   * binding exactly like a scheduled caller-supplied binding: no
   * re-classification, no re-enrollment (startManual never runs — the row
   * already exists), maps + decision slot keyed by the successor executionId
   * so Stop/finalization find it. `route` is threaded into `taskRoute` so
   * goal consults route correctly.
   *
   * Main-process-only trusted signal: submitMessage is only called with this
   * field from `ai-chat-v2-ipc.ts` (the same trust boundary as
   * `scheduledContext`); the renderer cannot forge it.
   */
  successorContext?: {
    binding: TaskExecutionBinding;
    route: TaskExecutionRoute;
  };
}

export interface AIChatQueryEngineDeps {
  /** Optional. When omitted, a default AIChatContextAssembler is constructed. */
  contextAssembler?: AIChatContextAssembler;
  /** Optional. When provided, the engine enqueues session memory updates
   * after each completed assistant turn. */
  compactAgent?: AIChatCompactAgentService;
  /** Optional. When provided, the engine triggers auto-dream consolidation
   * after each completed assistant turn. Failures are logged and swallowed. */
  autoDreamService?: AIAutoDreamService;
  /** Optional. When provided, the engine triggers workspace-scoped auto-dream
   * consolidation after each completed assistant turn. Runs independently of
   * the user-memory auto-dream service. Failures are logged and swallowed. */
  workspaceAutoDreamService?: AIWorkspaceAutoDreamService;
  /** Optional. Stores generated images locally before assistant messages are
   * persisted/emitted so provider URL expiry does not break chat history. */
  generatedImageStorage?: {
    storeImages(input: {
      conversationId: string;
      messageId: string;
      images: OpenAIChatImage[];
    }): Promise<OpenAIChatImage[]>;
    /** Optional. Copies descriptors persisted under a foreign identity
     * (e.g. a sub-agent's `agent-v2-*` conversation) into the final parent
     * conversation + assistant-message identity before persistence, so the
     * parent conversation can re-reference its own outputs later. When
     * omitted, descriptors pass through un-rehomed. */
    rehomeImages?(input: {
      images: OpenAIChatImage[];
      targetConversationId: string;
      targetMessageId: string;
    }): Promise<OpenAIChatImage[]>;
  };
  /** Optional. Resolves renderer-supplied generated-image references into
   * transient edit-input artifacts before the user message is persisted.
   * When omitted, a default GeneratedImageReferenceService is used. */
  generatedImageReferenceResolver?: Pick<
    GeneratedImageReferenceService,
    "resolveGeneratedImages"
  >;
  /** Optional filter scoping which built-in tool schemas the engine advertises
   * to the model. Scheduled (unattended) profiles use this to expose only
   * task-policy-approved tools (FR-16), narrowing the prompt-injection surface
   * beyond the executeTool guard. */
  toolFilter?: (toolName: string) => boolean;
  /**
   * Optional. Persists one steering instruction (atomic user-row insert +
   * pending-row applied flip) when the turn's steering mailbox consumes it.
   * Wired to AIChatPendingMessageModule.promoteSteeringToUserMessage by the
   * interactive engine owner. When omitted, active turns expose no steering
   * mailbox and reserveSteering always returns null.
   */
  steeringPromoter?: (input: {
    readonly instruction: AIChatSteeringInstruction;
    readonly boundary: import("@/entityTypes/aiChatV2Types").AIChatSafeBoundary;
  }) => Promise<void>;
  /**
   * TODO-05 (FR-023): awaited after the terminal case's durable message
   * writes but BEFORE post-terminal side effects (notification, dream,
   * compaction, Stop hook). The owner persists the durable run transition
   * here, so side effects never start ahead of run finalization.
   */
  onSegmentDurable?: (
    conversationId: string,
    outcome: "completed" | "cancelled" | "failed"
  ) => Promise<void>;
  /**
   * Optional. Notified at every turn's true terminal (completed/cancelled/
   * failed), including turns resumed after a permission/plan-question pause —
   * those resumed continuations are fire-and-forget, so their owner (the
   * coordinator for its runs, the durable queue for its drained rows) would
   * otherwise never learn the conversation freed up. Idempotent consumers
   * only: coordinator-run turns also notify through their own path.
   */
  onTurnTerminal?: (
    conversationId: string,
    outcome: "completed" | "cancelled" | "failed"
  ) => void;
  /**
   * Optional factory for the selection re-resolution service (§13.3). When
   * omitted the engine builds its own archive-backed service; tests inject a
   * stub so selection resolution does not need a live database.
   */
  historyRetrievalServiceFactory?: () => AIChatHistoryRetrievalService;
  /** Optional compaction coordinator for budget-pressure relief (dev §8.5). */
  compactionCoordinator?: import("@/service/AIChatCompactionCoordinator").AIChatCompactionCoordinator;
  /**
   * Stage B §16 (FR-018): delivery-mode provider. Default reads
   * AI_CHAT_STREAM_IMPLEMENTATION once (invalid/absent → callback). The mode
   * is captured at acceptance; every segment and resume of that run uses it.
   */
  streamImplementation?: AIChatStreamImplementationConfigProvider;
}

/**
 * Owns the conversation lifecycle: setup, persistence, pending state,
 * and stop. The engine delegates the inner model/tool round loop to
 * AIChatQueryLoop and handles the result.
 */
/**
 * Stage A §3.5 (generator-streaming PRD FR-010/024): result of claiming a
 * pending permission/plan-question action. `already_claimed` is an idempotent
 * duplicate (the first claim proceeds); `not_found` is stale/mismatched.
 */
export type AIChatPendingClaim =
  | {
      readonly status: "claimed";
      readonly kind: "permission" | "question";
      readonly conversationId: string;
      readonly assistantMessageId: string;
      readonly toolCallId?: string;
      readonly questionId?: string;
      readonly pending: PendingPermissionTurn | PendingPlanQuestionTurn;
    }
  | { readonly status: "already_claimed" }
  | { readonly status: "not_found" };

interface ActiveTurnState {
  abortController: AbortController;
  assistantMessageId: string;
  eventSink: AIChatQueryEventSink;
  turnId?: string;
  /**
   * TODO-09 (FR-015/017): safe partial output snapshot — the streamed text
   * observed so far. A consumer/persistence failure writes this through the
   * normal module path so history reload shows what the user already saw.
   */
  partialContent: string;
  /** Steering mailbox for this turn; absent when steering is unavailable. */
  control?: AIChatTurnControl;
  /** Stage A §3.2 (FR-021): owner listener notified when the turn parks. */
  lifecycle?: AIChatTurnLifecycleListener;
}

export class AIChatQueryEngine {
  /**
   * Per-conversation active turns. Replaces the singleton trio
   * (currentAbortController/currentConversationId/currentAssistantMessageId).
   * Keyed by conversationId so concurrent background turns do not collide.
   * Invariant: for any conversationId, at most one entry exists here OR in
   * pendingPermissions/pendingPlanQuestions — the three maps are disjoint.
   */
  private activeTurns = new Map<string, ActiveTurnState>();
  /**
   * G01-312 (FR-06/22; AC-24): pre-stream preparations keyed by
   * conversationId. The slow prep (plan state, attachment staging, mention /
   * history resolution, enrollment, transcript assembly) runs BEFORE the
   * active-turn registration — without this map a Stop during that window
   * finds no abort handle and the turn streams anyway. The entry is
   * registered right after the turn id is minted and promoted into
   * `activeTurns` at the stream-registration point (or discarded on dedup
   * reuse / prep failure / prep abort). It NEVER disturbs the active
   * original: dedup-reuse returns discard only their own turnId's entry
   * (B11), and Stop aborts both pending and active handles.
   */
  private pendingTurns = new Map<
    string,
    {
      abortController: AbortController;
      turnId: string;
      assistantMessageId: string;
      eventSink: AIChatQueryEventSink;
      submissionId: string | null;
    }
  >();
  private pendingPermissions = new Map<string, PendingPermissionTurn>();

  /**
   * Preserved-output pipeline, one per conversation.
   *
   * Cached so the output epoch is resolved once per conversation rather than on
   * every tool result, and shared with the loop's own instance so both paths
   * use the same policy.
   */
  private readonly toolResultPipelines = new Map<string, ToolResultPipeline>();
  private readonly conversationEpochs = new Map<string, string>();
  private toolResultModule: ToolResultModule | null = null;
  private toolResultStorage: ToolResultStorageService | null = null;

  /** Build (or reuse) the pipeline for a conversation. */
  private getToolResultPipeline(conversationId: string): ToolResultPipeline {
    const existing = this.toolResultPipelines.get(conversationId);
    if (existing) return existing;
    const pipeline = new ToolResultPipeline({
      captureEnabled: isToolOutputCaptureEnabled,
      modelRefsEnabled: isToolOutputModelRefsEnabled,
      module: (this.toolResultModule ??= new ToolResultModule()),
      storage:
        this.toolResultStorage ??
        (this.toolResultStorage = new ToolResultStorageService({
          root: getToolResultStorageRoot(),
        })),
    });
    this.toolResultPipelines.set(conversationId, pipeline);
    return pipeline;
  }

  /**
   * Resolve the conversation's current output epoch.
   *
   * A durable fence: a result prepared against a stale epoch is rejected at
   * commit, which is the correct outcome when the user clears the conversation
   * while a tool is being approved.
   */
  private async resolveConversationEpoch(
    conversationId: string
  ): Promise<string> {
    const cached = this.conversationEpochs.get(conversationId);
    if (cached) return cached;
    const module = this.toolResultModule ?? new ToolResultModule();
    const epoch = await module.currentEpoch("default", conversationId);
    this.conversationEpochs.set(conversationId, epoch);
    return epoch;
  }
  private pendingPlanQuestions = new Map<string, PendingPlanQuestionTurn>();
  /**
   * Stage A §3.5 (FR-010/024): pending actions claimed by their run owner.
   * A claim atomically moves the pending entry out of the parked maps; only
   * one resume claims a given action. Duplicate/stale claims are rejected.
   */
  private claimedPending = new Map<
    string,
    {
      kind: "permission" | "question";
      pending: PendingPermissionTurn | PendingPlanQuestionTurn;
    }
  >();
  /**
   * Stage B §10: pending data no longer carries an event sink. The owner
   * supplies the destination via resumeClaimed options; this side map keeps
   * the original sink for legacy (non-owner) resume callers.
   */
  private pendingSinks = new Map<string, AIChatQueryEventSink>();
  /** Stage B §16: run-context delivery-mode pins (FR-018/AC-14). */
  private runStreamModes = new Map<string, AIChatStreamImplementationMode>();


  /**
   * Slice 2 Unit 4 — per-execution decision slots. The loop's consult closure
   * records the controller's terminal decision here via the binding's
   * `recordDecision` callback; the engine's finalization gate (Slice 2 Unit 5)
   * reads it to tell "the loop already consulted" from "no consult ran" and
   * only falls back to its own consult on the latter. Keyed by executionId
   * (stable across pause/resume). Cleared at every terminal binding-delete
   * site (complete/cancelled/failed/Stop/catch + orphan-successor adoption)
   * so a slot cannot outlive its binding and leak on the long-lived engine
   * singleton.
   */
  private readonly taskDecisionSlots = new Map<
    string,
    {
      get: () => TaskCompletionDecision | null;
      set: (decision: TaskCompletionDecision | null) => void;
    }
  >();
  /**
   * Slice 2 Unit 7 — per-conversation bound execution ids (GAP-S2 #10,
   * FR-22/23, AC-24). Populated at the enrollment seam when a manual
   * execution is created; read by `stopConversation` so the Stop button
   * cancels the enrolled execution through the coordinator BEFORE the
   * turn's controller is aborted (the row is finalized while still owned).
   * Removed at the complete-gate (the row is finalized there — a later
   * Stop click must not double-finalize) and cleared with the conversation's
   * turn state. Keyed by conversationId, mirroring activeTurns.
   */
  private readonly taskExecutionBindings = new Map<string, string>();
  /**
   * T16 / NFR-12: conversations whose execution was enrolled WHILE the
   * completion-policy flag was on. The flag value is FROZEN at enrollment
   * and carried here so downstream handling of an ACCEPTED execution
   * (Stop-cancel, finalization gate) does not re-check the mutable runtime
   * flag. Turning the flag off after enrollment cannot convert accepted
   * unfinished work to unchecked success — Stop still cancels the enrolled
   * row, the finalization gate still consults the controller. Mirrors
   * `taskExecutionBindings` keys: set on enrollment, cleared at the
   * complete-gate / Stop / conversation teardown.
   */
  private readonly policyAcceptedConversations = new Set<string>();
  private readonly contextAssembler: AIChatContextAssembler;
  private readonly compactAgent?: AIChatCompactAgentService;
  private readonly modelCatalog: AIChatModelCatalogService;
  private readonly autoDreamService?: AIAutoDreamService;
  private readonly workspaceAutoDreamService?: AIWorkspaceAutoDreamService;
  private readonly generatedImageStorage?: AIChatQueryEngineDeps["generatedImageStorage"];
  private readonly generatedImageReferenceResolver?: AIChatQueryEngineDeps["generatedImageReferenceResolver"];
  /** Optional filter that scopes which tool schemas the engine advertises to
   * the model. Used by the scheduled (unattended) profile to expose only
   * task-policy-approved tools (FR-16), narrowing the prompt-injection
   * surface beyond the executeToken guard. */
  private readonly toolFilter?: (toolName: string) => boolean;
  /** Persists steering instructions consumed by active turns' mailboxes. */
  private readonly steeringPromoter?: AIChatQueryEngineDeps["steeringPromoter"];
  private readonly onTurnTerminalCb?: AIChatQueryEngineDeps["onTurnTerminal"];
  private readonly onSegmentDurableCb?: AIChatQueryEngineDeps["onSegmentDurable"];
  private readonly historyRetrievalServiceFactory?: AIChatQueryEngineDeps["historyRetrievalServiceFactory"];
  private readonly compactionCoordinator?: AIChatQueryEngineDeps["compactionCoordinator"];
  private readonly modelCatalogService = new AIChatModelCatalogService();
  private readonly streamImplementation: AIChatStreamImplementationConfigProvider;
  private readonly pendingEventSaves = new WeakMap<
    AIChatQueryEventSink,
    Array<{
      readonly kind: "tool_call" | "tool_result";
      readonly toolCallId: string;
      readonly promise: Promise<unknown>;
    }>
  >();
  /** Tracks which conversations have already fired SessionStart. */
  private readonly startedConversations = new Set<string>();
  /**
   * TODO-05 (FR-023): conversations whose Stop hook already fired from an
   * explicit stop. The loop's own cancelled resolution must not fire it a
   * second time — Stop hooks run exactly once per turn.
   */
  private readonly stopHooksDispatched = new Set<string>();

  constructor(
    private readonly loop: AIChatQueryLoop,
    deps?: AIChatQueryEngineDeps
  ) {
    this.contextAssembler =
      deps?.contextAssembler ??
      new AIChatContextAssembler({
        compactionReader: new AIChatCompactionModule(),
        archiveModule: new AIChatArchiveModule(),
        // T14: substitute bounded projections for oversized legacy rows.
        projectionLookup: new ToolResultModule().asLegacyProjectionLookup(),
      });
    this.compactAgent = deps?.compactAgent;
    this.modelCatalog = new AIChatModelCatalogService();
    this.autoDreamService = deps?.autoDreamService;
    this.workspaceAutoDreamService = deps?.workspaceAutoDreamService;
    this.generatedImageStorage = deps?.generatedImageStorage;
    this.generatedImageReferenceResolver =
      deps?.generatedImageReferenceResolver;
    this.toolFilter = deps?.toolFilter;
    this.steeringPromoter = deps?.steeringPromoter;
    this.onTurnTerminalCb = deps?.onTurnTerminal;
    this.onSegmentDurableCb = deps?.onSegmentDurable;
    this.streamImplementation =
      deps?.streamImplementation ?? getStartupStreamImplementationConfig();
    this.historyRetrievalServiceFactory = deps?.historyRetrievalServiceFactory;
    this.compactionCoordinator = deps?.compactionCoordinator;
  }

  /**
   * /goal execution should keep calling the model past the per-cycle tool
   * cap. Plan-mode turns still pause (AskUserQuestion must not be skipped).
   * Lookup failures must not fail the turn.
   *
   * T15 (FR-20, NFR-11): goal auto-continue fires only when THIS turn is
   * goal-scoped task work — i.e. the route is NOT response_only. A
   * response_only turn (ordinary question) must not be seized by an
   * unrelated active conversation goal. This closes the audit regression:
   * "unrelated active goal + ordinary question → normal single answer"
   * (the legacy takeover that let any active goal seize the turn). The
   * route is the semantic signal — task/preparation turns are goal-scoped
   * work, response_only turns are not. The route is computed once before
   * the flag-gated enrollment block so it is available regardless of
   * whether the policy flag enrolled a binding.
   */
  private async shouldAutoContinueGoal(
    conversationId: string,
    isPlanMode: boolean,
    taskRoute?: TaskExecutionRoute
  ): Promise<boolean> {
    if (isPlanMode || !conversationId) {
      return false;
    }
    // T15: a response_only turn is not goal-scoped work → do NOT let an
    // unrelated active goal seize an ordinary question turn.
    if (taskRoute === "response_only") {
      return false;
    }
    try {
      const goal = await new AIChatGoalModule().getActiveGoal(conversationId);
      return goal !== null;
    } catch (err) {
      console.warn("[ai-chat-v2] goal lookup for auto-continue failed:", err);
      return false;
    }
  }

  /**
   * Re-resolve submit-time selected-context references (technical-design §13.3).
   *
   * The renderer sends OPAQUE ARCHIVE REFERENCES ONLY — never passage text. The
   * backend re-validates each reference against the current epoch/revision and
   * enforces the final budget. Resolution failure is never fatal to the turn:
   * selections degrade to "not included" and the user's own message still goes
   * out, with the ACCEPTED submitted ids reported back on the `start` event so
   * the UI clears only those chips and retains the rejected drafts.
   */
  private async resolveSelectedHistory(
    conversationId: string,
    turnId: string,
    sourceIds: readonly string[]
  ): Promise<{
    readonly metadata: ChatV2HistorySelectionMetadata[];
    readonly excerpts: SelectedHistoryExcerptInput[];
    readonly rejectedCount: number;
    readonly changedIds: readonly string[];
    readonly rejectedIds: readonly string[];
  }> {
    const empty = {
      metadata: [] as ChatV2HistorySelectionMetadata[],
      excerpts: [] as SelectedHistoryExcerptInput[],
      rejectedCount: 0,
      changedIds: [] as readonly string[],
      rejectedIds: [] as readonly string[],
    };
    if (sourceIds.length === 0) return empty;
    if (!isArchiveReadsEnabled()) return empty;
    try {
      const factory =
        this.historyRetrievalServiceFactory ??
        (() => new AIChatHistoryRetrievalService(new AIChatArchiveModule()));
      const svc = factory();
      const result = await svc.resolveSelections(
        conversationId,
        sourceIds,
        turnId
      );
      // Every selection rejected for size ⇒ the send would ship with zero
      // selected context while the chips still render as attached. FR-10
      // requires the user to narrow the selection, so the turn fails with an
      // actionable capacity error BEFORE persist/send; drafts survive.
      if (result.errorCode === "CONTEXT_REQUIRED_CONTENT_TOO_LARGE") {
        throw new RecoverableHistoryError(
          "CONTEXT_REQUIRED_CONTENT_TOO_LARGE",
          `selected history passages do not fit this turn (${result.rejected.length} rejected); remove or narrow a selection and resend`
        );
      }
      const metadata: ChatV2HistorySelectionMetadata[] = result.resolved.map(
        (e, i) => ({
          // Prefer the SUBMITTED reference so the renderer can reconcile this
          // back to its own chip; the archive re-encodes `e.sourceId`.
          sourceId: result.acceptedSubmittedIds?.[i] ?? e.sourceId,
          messageId: e.messageId,
          role: e.role,
          timestamp: e.timestamp,
          exact: e.exact,
        })
      );
      const changed = (result.refreshed ?? []).map((r) => r.submittedId);
      const changedSet = new Set(changed);
      return {
        metadata,
        excerpts: toSelectedHistoryExcerptInputs(result.resolved),
        rejectedCount: result.rejected.length,
        // Stale references are quoted nowhere; their chips survive for
        // explicit user re-confirmation (§4.2, AC-18).
        changedIds: changed,
        // Hard rejections (unavailable/oversized, not stale) mark chips
        // rejected so the user can remove or replace them (P2-10, AC-18).
        rejectedIds: result.rejected.filter((id) => !changedSet.has(id)),
      };
    } catch (err) {
      // Capacity rejections are turn-blocking, not degrade-to-empty.
      if (
        err instanceof RecoverableHistoryError &&
        err.code === "CONTEXT_REQUIRED_CONTENT_TOO_LARGE"
      ) {
        throw err;
      }
      console.warn("[ai-chat-v2] history selection resolution failed:", err);
      return {
        ...empty,
        rejectedCount: sourceIds.length,
        rejectedIds: [...sourceIds],
      };
    }
  }

  /**
   * Shrink the active context before a dispatch that is already at or over
   * the budget. Awaited so the same turn can rebuild and retry preflight.
   */
  private async compactBeforeDispatch(
    conversationId: string,
    model?: string
  ): Promise<void> {
    if (this.compactionCoordinator) {
      await this.compactionCoordinator.requestCompactionForTurn(
        conversationId,
        { trigger: "reactive-overflow", model }
      );
      return;
    }
    if (this.compactAgent) {
      // Pass the model's real context window as the prompt-token sentinel
      // rather than Number.MAX_SAFE_INTEGER. The threshold in
      // enqueueAutoCompact is 0.8 * contextWindow, so the window itself is
      // always >= threshold and reliably trips compaction — and the value
      // stored in lastPromptTokens stays a realistic finite count instead
      // of poisoning the next turn's session-memory gate with 9e15.
      const promptTokens = await this.resolveCompactionSentinel(model);
      await this.compactAgent.enqueueAutoCompact({
        conversationId,
        reason: "budget-pressure",
        promptTokens,
        model,
      });
    }
  }

  /**
   * Reactive overflow compaction (AC-23, FR-07): after a budget-rejected turn,
   * shrink the active context through the same bounded coordinator every
   * other trigger uses. Without a coordinator, fall back to the compact
   * agent's threshold path with provably-over-window tokens. Never throws —
   * the turn's error emission below is the user-visible outcome.
   */
  private requestReactiveCompaction(
    conversationId: string,
    model?: string
  ): void {
    try {
      if (this.compactionCoordinator) {
        const coordinator = this.compactionCoordinator;
        Promise.resolve(
          coordinator.requestCompactionForTurn(conversationId, {
            trigger: "reactive-overflow",
            model,
          })
        ).catch((err: unknown) =>
          console.error(
            "[ai-chat-compaction] reactive-overflow request failed:",
            err
          )
        );
      } else if (this.compactAgent) {
        const compactAgent = this.compactAgent;
        // Resolve the model's real context window as the prompt-token
        // sentinel (see compactBeforeDispatch): it reliably exceeds the
        // 0.8 * contextWindow threshold without storing 9e15 in
        // lastPromptTokens. The async resolution happens inside the
        // fire-and-forget chain so this method stays synchronous.
        void this.resolveCompactionSentinel(model)
          .then((promptTokens) =>
            compactAgent.enqueueAutoCompact({
              conversationId,
              reason: "reactive-overflow",
              promptTokens,
              model,
            })
          )
          .catch((err: unknown) =>
            console.error(
              "[ai-chat-compact] reactive-overflow auto-compact failed:",
              err
            )
          );
      }
    } catch (err) {
      console.error(
        "[ai-chat-compaction] reactive-overflow dispatch failed:",
        err
      );
    }
  }

  /**
   * Resolve a prompt-token sentinel for the reactive compaction fallback
   * path (no coordinator). Returns the model's real context window — a
   * finite, realistic value that provably meets/exceeds the compact
   * agent's 0.8 * contextWindow threshold, so it reliably trips an
   * auto-compact while keeping lastPromptTokens sane. Falls back to a
   * conservative large window when the catalog lookup is unavailable
   * (tests skip the live catalog fetch). Never throws.
   */
  private async resolveCompactionSentinel(model?: string): Promise<number> {
    try {
      const contextWindow = await this.modelCatalogService.getContextWindow(
        model
      );
      if (contextWindow > 0) {
        return contextWindow;
      }
    } catch (err) {
      console.error(
        "[ai-chat-compaction] sentinel context-window lookup failed:",
        err
      );
    }
    // The catalog is unloaded/unavailable (e.g. VITEST skips the fetch).
    // Use the recovery default (128k) — still finite and above the 8,192
    // unknown-model threshold the compact agent falls back to.
    return AI_CHAT_RECOVERY_DEFAULTS.defaultContextWindowTokens;
  }

  /** Return main-process truth for a conversation's current turn. */
  getConversationRuntimeStatus(conversationId: string): ChatV2RuntimeStatus {
    if (this.claimedPending.has(conversationId)) {
      // Review F8: a claimed-but-not-yet-resumed action is still owned by
      // this conversation — reporting idle admitted racing turns.
      return "awaiting_permission";
    }
    if (this.pendingPermissions.has(conversationId)) {
      return "awaiting_permission";
    }
    if (this.pendingPlanQuestions.has(conversationId)) {
      return "awaiting_user";
    }
    if (this.activeTurns.has(conversationId)) {
      return "running";
    }
    return "idle";
  }

  /**
   * Resolve the real context window (tokens) for a model. Falls back to
   * the model catalog's default (128k) when the model is unknown. Never
   * throws. Used by the pre-turn proactive compact gate.
   */
  private async resolveContextWindowForModel(model?: string): Promise<number> {
    try {
      return await this.modelCatalog.getContextWindow(model);
    } catch {
      return 128_000;
    }
  }

  /**
   * Prepare attachment content enrichment (no DB writes).
   * Returns enriched message text, content parts (for images), and metadata.
   *
   * @param files       All uploaded files (images + documents).
   * @param stagedRefs  Already-staged document references (with refId from
   *                    stageAttachmentMarkdown). Images have no refId.
   * @param originalMessage  The user's original text message.
   */
  private prepareAttachmentContent(
    files: ChatV2UploadedAttachment[],
    stagedRefs: StagedAttachmentReference[],
    originalMessage: string
  ): AttachmentPrepResult {
    const displayMetadata: ChatV2AttachmentMetadata[] = [];
    const contentParts: Array<
      OpenAITextContentPart | OpenAIImageUrlContentPart
    > = [];
    const attachmentRefs: string[] = [];
    const docFileNames: string[] = [];

    // Build a set of filenames that were successfully staged (for enrichment).
    const stagedFileNames = new Set(stagedRefs.map((r) => r.fileName));

    for (const file of files) {
      if (file.kind === "image") {
        const dataUrl = `data:${file.mimeType};base64,${file.contentBase64}`;
        contentParts.push({
          type: "image_url",
          image_url: { url: dataUrl, detail: "auto" },
        });
        displayMetadata.push({
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          kind: "image",
          processingMode: "image_url",
          // Persist the inline preview so the user's own message bubble can
          // re-render the attached image after a history reload, not just
          // during the live turn. Reuses the downscaled bytes sent to the
          // model — no extra storage cost beyond the existing request body.
          previewDataUrl: dataUrl,
        });
      } else if (stagedFileNames.has(file.fileName)) {
        // Only include documents that were successfully staged
        docFileNames.push(file.fileName);
        displayMetadata.push({
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          kind: "document",
          processingMode: "staged_markdown",
        });
      } else {
        // Document was too large or staging failed — skip enrichment
        log.info(
          `[ai-chat-v2] document ${file.fileName} not staged — skipping enrichment`
        );
      }
    }

    // Build enriched user message with attachment reference block for documents
    let enrichedMessage = originalMessage || "";
    if (stagedRefs.length > 0) {
      const blockLines = [
        "",
        `Attached ${stagedRefs.length} file(s) are staged locally and available below.`,
        "A `read_attachment_content` tool is available to load their contents.",
        ...stagedRefs.map(
          (ref, i) =>
            `${i + 1}. file_name="${ref.fileName}" attachment_ref="${
              ref.refId
            }" file_path="${
              ref.filePath
            }" → call \`read_attachment_content\` with attachment_ref="${
              ref.refId
            }" to load this file. For local shell tools, use file_path to access the file directly on disk.`
        ),
      ];
      enrichedMessage = enrichedMessage
        ? `${enrichedMessage}\n\n${blockLines.join("\n")}`
        : blockLines.join("\n");
    }

    return {
      enrichedMessage,
      contentParts,
      displayMetadata,
      attachmentRefs,
      docFileNames,
    };
  }

  /**
   * Convert small documents to markdown and stage them on disk.
   * Returns the list of successfully staged attachment references (with refId)
   * so they can be injected into the enriched user message before sending.
   */
  private async stageDocumentMarkdowns(
    files: ChatV2UploadedAttachment[],
    conversationId: string
  ): Promise<StagedAttachmentReference[]> {
    const docService = new DocumentService();
    const SMALL_DOC_THRESHOLD = 1 * 1024 * 1024; // 1 MB
    const staged: StagedAttachmentReference[] = [];

    for (const file of files) {
      if (file.sizeBytes > SMALL_DOC_THRESHOLD) {
        log.info(
          `[ai-chat-v2] large document ${file.fileName} (${file.sizeBytes}b) — staging skipped`
        );
        continue;
      }
      try {
        const markdown = await docService.convertUploadedAttachmentToMarkdown(
          file.fileName,
          file.mimeType,
          file.contentBase64
        );
        const ref = await docService.stageAttachmentMarkdown(
          conversationId,
          file.fileName,
          markdown,
          { originalContentBase64: file.contentBase64 }
        );
        staged.push(ref);
      } catch (err) {
        log.error(
          `[ai-chat-v2] failed to stage document ${file.fileName}:`,
          err
        );
      }
    }
    return staged;
  }

  /**
   * Persist attachment bytes to DB.
   */
  private async persistAttachmentBytes(
    files: ChatV2UploadedAttachment[],
    conversationId: string,
    messageId: string
  ): Promise<void> {
    const attachmentModule = new AIChatAttachmentModule();
    await attachmentModule.saveUploadedFiles(
      conversationId,
      messageId,
      files.map((f) => ({
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        contentBase64: f.contentBase64,
      }))
    );
  }

  private readonly catalogService = new ToolCatalogService();
  private readonly budgetService = new ToolPromptBudgetService();
  private readonly conversationToolStateService =
    new ConversationToolStateService();

  /**
   * Resolve renderer-supplied generated-image references into transient
   * data-URL artifacts for the current turn, enforcing the combined image
   * count (uploaded + referenced) and the data-URL budget. Returns the
   * resolver result, or a stable error code to emit as a terminal chunk.
   */
  private async resolveGeneratedImageInputs(input: {
    conversationId: string;
    references: readonly ChatV2GeneratedImageReference[];
    uploadedImageCount: number;
  }): Promise<
    | { ok: true; result: ResolveGeneratedImagesResult }
    | { ok: false; errorCode: GeneratedImageReferenceErrorCode }
  > {
    let resolved: ResolveGeneratedImagesResult;
    try {
      const resolver =
        this.generatedImageReferenceResolver ??
        new GeneratedImageReferenceService();
      resolved = await resolver.resolveGeneratedImages({
        conversationId: input.conversationId,
        references: input.references,
        detail: "auto",
      });
    } catch (err: unknown) {
      if (err instanceof GeneratedImageReferenceError) {
        return { ok: false, errorCode: err.code };
      }
      throw err;
    }
    if (
      input.uploadedImageCount + resolved.artifacts.length >
      CHAT_IMAGE_LIMITS.maxImagesPerRequest
    ) {
      return { ok: false, errorCode: "generated_image_reference_limit" };
    }
    if (
      resolved.totalDataUrlChars > CHAT_IMAGE_LIMITS.targetTotalDataUrlChars
    ) {
      return { ok: false, errorCode: "generated_image_too_large" };
    }
    return { ok: true, result: resolved };
  }

  /**
   * Build the deferred tool catalog + mode decision for a turn (FR-8, design
   * §15.1). Returns undefined when the feature flag is off or catalog building
   * fails, so the loop falls back to standard full-tool behavior.
   */
  private buildToolCatalogForTurn(input: {
    readonly tools: readonly OpenAITool[];
    readonly conversationId: string;
    readonly isPlanMode: boolean;
    readonly autoPlanEnabled: boolean;
    readonly userMessage: string;
    readonly recentUserMessages?: readonly string[];
    readonly model?: string;
    readonly contextWindowTokens?: number;
    readonly hasRecentGeneratedImages?: boolean;
    readonly initialState?: ToolCatalogRuntimeContext;
  }): {
    toolCatalog?: ToolCatalog;
    toolCatalogModeDecision?: ToolCatalogModeDecision;
  } {
    const mode = resolveToolCatalogMode(process.env[TOOL_CATALOG_ENV.mode]);
    if (mode.mode === "off") {
      // Still emit the decision so the loop can log the reason, but no catalog.
      return {};
    }

    const context: ToolCatalogRuntimeContext = {
      conversationId: input.conversationId,
      model: input.model,
      isPlanMode: input.isPlanMode,
      autoPlanEnabled: input.autoPlanEnabled,
      currentUserMessage: input.userMessage,
      recentUserMessages: input.recentUserMessages,
      uploadedFileTypes: [],
      contextWindowTokens: input.contextWindowTokens,
      hasRecentGeneratedImages: input.hasRecentGeneratedImages,
      ...(input.initialState ?? {}),
    };

    let catalog: ToolCatalog;
    try {
      catalog = this.catalogService.buildFromOpenAITools({
        tools: input.tools,
        context,
      });
    } catch (err) {
      log.warn(
        `[tool-catalog] catalog build failed, using standard mode:`,
        err
      );
      return {};
    }

    const thresholdPercent = resolvePositiveIntEnv(
      process.env[TOOL_CATALOG_ENV.thresholdPercent]
    );
    const decision = this.budgetService.resolveMode({
      configuredMode: mode.mode,
      deferredEstimatedTokens: catalog.deferredEstimatedTokens,
      contextWindowTokens: input.contextWindowTokens,
      thresholdPercent,
    });

    // Auto mode with effectively no deferred payload stays standard.
    if (decision.mode === "standard") {
      return {};
    }

    return { toolCatalog: catalog, toolCatalogModeDecision: decision };
  }

  /**
   * Full conversation lifecycle for one user message:
   * resolve plan, create conversation, save user message, build transcript,
   * assemble tools, run the loop, and handle the result.
   *
   * Stage A (generator-streaming PRD FR-022): the outcome-returning engine
   * entry point. Owners consume the explicit segment outcome instead of
   * inferring completion from the absence of a terminal event.
   */
  async runTurn(input: AIChatQuerySubmitInput): Promise<AIChatSegmentOutcome> {
    // TODO-08 (FR-018/AC-14): capture the delivery mode at OWNER ACCEPTANCE —
    // before admission/preparation — so an already-accepted run keeps its
    // mode even if the provider changes while it waits for capacity.
    this.captureStreamMode(input.request.conversationId ?? "");
    const {
      eventSink,
      request,
      scheduledContext,
      outboundSendPreAuthorized,
      successorContext,
    } = input;
    const module = new AIChatV2Module();
    const planModule = new AIChatPlanModule();

    // FR-31 / NFR-03 (audit finding 8): a pasted credential is rejected at
    // the ORDINARY CHAT boundary — BEFORE any persistence, provider call,
    // or conversation creation. The message text never reaches the
    // transcript; the user gets the typed error with secure-input guidance.
    if (!scheduledContext) {
      const credentialCheck = checkChatMessageForCredentials(
        request.message || ""
      );
      if (credentialCheck.rejected) {
        eventSink.emit({
          type: "error",
          conversationId: request.conversationId || "",
          errorMessage: `${credentialCheck.errorCode}: ${credentialCheck.message}`,
        });
        // Outcome contract (Stage A FR-022): the boundary rejection is a
        // failed segment. Nothing was persisted, so the ids are the
        // request's own (assistant id empty by construction).
        return {
          type: "failed",
          conversationId: request.conversationId || "",
          assistantMessageId: "",
        };
      }
    }

    // ------------------------------------------------------------------
    // 1. Resolve plan state
    // ------------------------------------------------------------------
    let planState: AIChatPlanStateView | null = null;
    if (request.conversationId && request.conversationId.startsWith("v2-")) {
      try {
        planState = await planModule.getPlanState(request.conversationId);
      } catch {
        // ignore lookup failures before conversation resolution
      }
    }
    const isPlanMode = request.mode === "plan" || isActivePlanState(planState);

    // ------------------------------------------------------------------
    // 2. Create/reuse conversation + plan, save user message, build transcript
    // ------------------------------------------------------------------
    let conversationId: string;
    let assistantMessageId: string;
    let turnId: string;
    let messages: OpenAIChatMessage[];
    // G01-312: pre-stream abort state, initialized to inert values so every
    // exit path (including the pre-stream catch, which cannot prove the
    // try-body assignments) can use them safely. Assigned at turn accept;
    // prepExecutionId tracks OUR enrolled row for orphan-cancel on abort.
    let prepAbortController: AbortController | null = null;
    let prepTurnId = "";
    let prepAssistantMessageId = "";
    let prepExecutionId: string | null = null;
    // G01-312: the controller THIS turn's prep boundaries check — the
    // registered handle normally, or a local one when a same-submission
    // retry keeps the original's registered handle (B11).
    let prepOwnController: AbortController | null = null;
    let reassembleMessages: (() => Promise<OpenAIChatMessage[]>) | null = null;
    let textApprovedPlanState: AIChatPlanStateView | null = null;
    let intentDecisionId: number | null = null;
    let sourceUserMessageId: string | undefined;
    /**
     * Slice 2 completion-policy binding for this turn (technical-design §5/§7).
     * Two sources: (a) scheduled turns — initialized inside the try block
     * from the caller-supplied `input.taskExecutionBinding` (the scheduled
     * runner enrolled via `enrollScheduledExecution` BEFORE submitMessage, so
     * the binding already exists — T02); (b) manual turns — constructed by
     * the enrollment seam below from the coordinator's binding when the
     * policy flag is on. Undefined otherwise (byte-identical legacy
     * behavior). Carried through loopInput and the three resume paths so
     * budget persists across pause/resume.
     */
    let taskExecutionBinding: LoopTaskExecutionBinding | undefined;
    /**
     * T15 (FR-20, NFR-11): the request route for THIS turn, computed inside
     * the flag gate and assigned to this outer scope so it is available at
     * all four `shouldAutoContinueGoal` consult sites. When the flag is off
     * (or the turn is scheduled), `taskRoute` stays `undefined` and the
     * consult falls through to the goal lookup — preserving the legacy
     * goal-auto-continue behavior the existing chat-mode-with-active-goal
     * test pins (NFR-12 byte-identical). When the flag is on, the route is
     * the semantic signal that gates goal takeover: `response_only`
     * (ordinary question) is NOT goal-scoped work and must not be seized by
     * an unrelated active goal, while `task_*` / `preparation` turns are
     * goal-scoped. See `shouldAutoContinueGoal`.
     */
    let taskRoute: TaskExecutionRoute | undefined;
    /**
     * T10 (FR-17/21, AC-26): accepted-submission dedup short-circuit. Set by
     * the enrollment seam when `startManual` returns `reused` (transport retry
     * of the same accepted submission) or `conflict` (same submissionId,
     * different requestHash). When set, the loop dispatch is skipped — no
     * maker/provider re-dispatch, no renewed budget, no repeated effect. The
     * engine emits a terminal event carrying the dedup signal so the renderer
     * and tests can verify no dispatch happened. The DB-level dedup alone
     * never stopped duplicate work; this gate makes the dedup decisive at the
     * dispatch boundary. Cleared (undefined) on the `created` path and when
     * the flag is off, so legacy/created behavior is byte-identical.
     */
    let dedupShortCircuit:
      | { kind: "reused"; executionId: string; finalized: boolean }
      | { kind: "conflict"; executionId: string }
      | { kind: "denied"; reasonCode: string }
      | undefined;
    /**
     * T09 (AC-28): the successor executionId adopted this turn from a trusted
     * `successorContext` (the coordinator already created the successor row
     * before dispatching this engine turn). Set only when the adoption block
     * ran (flag-on + successorContext). The pre-stream catch cancels this
     * execution when startup fails so no orphan active row remains.
     */
    let adoptedSuccessorExecutionId: string | undefined;
    /** Opaque refs accepted for this turn (§13.3), reported on `start`. */
    let historySelectionAcceptedIds: readonly string[] = [];
    /** Submitted refs whose source moved (§4.2), reported on `start`. */
    let historySelectionChangedIds: readonly string[] = [];
    /** Submitted refs hard-rejected (unavailable/oversized), reported on `start`. */
    let historySelectionRejectedIds: readonly string[] = [];

    try {
      conversationId = module.createConversationIfNeeded(
        request.conversationId
      );
      // T02: scheduled turns arrive with a caller-supplied binding (the
      // runner enrolled this occurrence via startScheduled + built the loop
      // binding before submitMessage). Adopt it here so the loop's
      // maybeConsultPolicy consults at round_cap/response_end for scheduled
      // turns too (same-occurrence continuation, FR-05/07). The
      // manual-enrollment seam below already excludes scheduledContext turns
      // (its guard is `isAiTaskCompletionPolicyV1Enabled() &&
      // !scheduledContext`), so no double-enrollment. The map/slot mirrors
      // below are keyed by the scheduled binding's executionId so
      // Stop-cancel and the finalization gate can find this execution
      // exactly as they do for manual ones.
      if (scheduledContext && input.taskExecutionBinding) {
        taskExecutionBinding = input.taskExecutionBinding;
        this.taskExecutionBindings.set(
          conversationId,
          input.taskExecutionBinding.executionId
        );
        // G01-312: track our enrolled row for orphan-cancel on prep abort.
        prepExecutionId = input.taskExecutionBinding.executionId;
        this.policyAcceptedConversations.add(conversationId);
        let recordedDecision: TaskCompletionDecision | null = null;
        this.taskDecisionSlots.set(input.taskExecutionBinding.executionId, {
          get: () => recordedDecision,
          set: (d: TaskCompletionDecision | null) => {
            recordedDecision = d;
          },
        });
      }
      // T09 (FR-14/21/22, AC-16/27/28): a Continue/Retry successor turn
      // arrives with a trusted `successorContext` — the IPC handler already
      // created the successor execution via the coordinator
      // (continueExecution/retryExecution) BEFORE dispatching this engine
      // turn. Adopt the coordinator's binding exactly like the scheduled
      // caller-supplied binding above: no re-classification and no
      // re-enrollment (startManual must never run — the successor row already
      // exists). Build the full LoopTaskExecutionBinding mirroring the manual
      // created-branch below (fresh expectedStateVersion, lease guard,
      // evidence stack, progress tracker, budget closures delegating to the
      // coordinator's live budget — the ORIGINAL remaining limits for
      // Continue, never renewed), write the maps + decision slot keyed by the
      // successor executionId, and thread the parent's parsed route into the
      // outer `taskRoute`. No replacement fencing: this turn is the lineage
      // successor, not a replacement submission.
      if (isAiTaskCompletionPolicyV1Enabled() && successorContext) {
        try {
          const created = successorContext.binding;
          const execModule = new AiTaskExecutionModule();
          const { evidenceService, checkerDispatch, observationProvider, operationReceiptProvider, artifactBaseDir } =
            buildEvidenceService({
              executionId: created.executionId,
              execModule,
              operationModule: new AiTaskOperationModule(),
              searchModule: new SearchModule(),
              contactInfoRepository,
              deliveryStatusReader: makeNativeSendStatusReader(),
            });
          // B13c (FR-08/23, AC-08/27/29): tracked durable-spend persister
          // shared by the loop binding and the evidence context's
          // checker-spend hook, so one flush barrier covers every
          // fire-and-forget persist this execution fires.
          const budgetPersists = makeTrackedPersistBudget((delta) =>
            execModule.persistBudgetConsumption({
              ledgerId: created.ledgerId,
              expectedOwnerGeneration: created.leaseGeneration,
              activeExecutionId: created.executionId,
              delta,
            })
          );
          // One tracker per execution closing over the SAME budget the
          // controller consults (FR-09 / §7.2 step 7). BaseModule TDZ —
          // never constructed at module top level.
          const progressTracker = new TaskProgressTracker({
            budget: created.budget,
            persistBudgetSpending: budgetPersists.persistBudget,
          });
          // B21 (FR-02/03/19): pre-action artifact baselines for the
          // successor execution (same contract as the manual branch).
          const successorArtifactBaselines = await snapshotArtifactBaselines(
            artifactBaseDir ?? undefined,
            created.contract?.criteria ?? []
          );
          // Per-turn decision slot keyed by the successor executionId (the
          // finalization gate reads it back — same contract as the manual
          // created-branch below).
          let recordedDecision: TaskCompletionDecision | null = null;
          taskExecutionBinding = {
            executionId: created.executionId,
            policyAccepted: true,
            // B12: frozen semantic owner (inherited from the parent row) so
            // the loop selects goal-flavored prompts exclusively for
            // goal-owned turns.
            completionOwner: created.completionOwner,
            getAbortSignal: () =>
              this.activeTurns.get(conversationId)?.abortController.signal,
            consult: async (candidate) => {
              // B12: goal-owned successors end with an internal iteration
              // yield before any standalone verification (owner inherited
              // from the parent execution row via successorContext).
              if (created.completionOwner === "goal") {
                return {
                  type: "yield_owner" as const,
                  owner: "goal" as const,
                  result: "maker_iteration_ended" as const,
                };
              }
              // Read the CAS token fresh per consult so evidence writes
              // persist (AC-32) — identical to the manual created-branch.
              const exec = await execModule.getExecution(created.executionId);
              const expectedStateVersion = exec?.execution_state_version;
              // T15b lease guard: reject the consult when this execution no
              // longer holds the lineage lease (a further successor may have
              // superseded it). Fail-closed on a missing ledger.
              if (
                created.ledgerId !== undefined &&
                created.leaseGeneration !== undefined
              ) {
                const currentGen = await readCurrentLeaseGeneration(
                  (id) => execModule.getLedgerById(id),
                  created.ledgerId as string
                );
                const ownership = assertOwnership(
                  { leaseGeneration: created.leaseGeneration },
                  currentGen ?? -1
                );
                if (!ownership.ok) {
                  console.error(
                    `[ai-chat-v2] successor consult rejected — stale lease (executionId=${created.executionId}, bindingGen=${created.leaseGeneration}, ledgerGen=${currentGen ?? "missing"})`
                  );
                  return {
                    type: "yield_owner" as const,
                    owner: "goal" as const,
                    result: "maker_iteration_ended" as const,
                  };
                }
              }
              return created.controller.decide(candidate, {
                route: created.route,
                owner: created.completionOwner,
                contract: created.contract ?? undefined,
                evidenceService,
                evidenceContext: {
                  content: candidate.content,
                  source: "loop_consult",
                  sourceRevision: "slice2-t03-manual",
                  checkerDispatch,
                  observationProvider,
                  operationReceiptProvider,
                  artifactBaseDir: artifactBaseDir ?? undefined,
                  artifactBaselines: successorArtifactBaselines,
                  persistBudgetSpending: budgetPersists.persistBudget,
                  abortSignal: this.activeTurns.get(conversationId)
                    ?.abortController.signal,
                  expectedStateVersion,
                },
                budget: created.budget,
              });
            },
            reserveContinuation: (continuationId) =>
              created.budget.reserveContinuation(continuationId),
            reserveProviderAttempt: (requestId) =>
              created.budget.reserveProviderAttempt(requestId),
            reserveToolExecution: (toolRequestId) =>
              created.budget.reserveToolExecution(toolRequestId),
            reconcileTokens: (requestId, actualTokens) =>
              created.budget.reconcileTokens(requestId, actualTokens),
            addActiveRuntime: (ms) => created.budget.addActiveRuntime(ms),
            addWaitMs: (ms) => created.budget.addWaitMs(ms),
            getRemainingBudgets: () => created.budget.getRemaining(),
            ledgerId: created.ledgerId,
            leaseGeneration: created.leaseGeneration,
            persistBudget: budgetPersists.persistBudget,
            flushPersistedBudget: budgetPersists.flushPersistedBudget,
            recordDecision: (decision) => {
              recordedDecision = decision;
            },
            recordToolRoundProgress: (observation) => {
              progressTracker.recordToolRound(observation);
            },
            recordAssistantTextProgress: (content) => {
              progressTracker.recordAssistantTextRound(content);
            },
          };
          this.taskDecisionSlots.set(created.executionId, {
            get: () => recordedDecision,
            set: (d: TaskCompletionDecision | null) => {
              recordedDecision = d;
            },
          });
          this.taskExecutionBindings.set(conversationId, created.executionId);
          this.policyAcceptedConversations.add(conversationId);
          // G01-312: track our enrolled row for orphan-cancel on prep abort.
          prepExecutionId = created.executionId;
          // Route: the parent's parsed route (re-classification would risk
          // demoting a task continuation to response_only).
          taskRoute = successorContext.route;
          adoptedSuccessorExecutionId = created.executionId;
          // T13 (PRD FR-13, NFR-10/11, AC-16): emit the lifecycle state for
          // the successor so the badge tracks the new executionId as soon as
          // Continue/Retry enrollment commits, before the successor stream
          // attaches. G01-313: the owned phase really is `continuing` (a
          // lineage successor resuming approved work), not a fresh `active`
          // turn. The renderer's executionId dedup (Piece C) drops any late
          // terminal chunk from the parent execution in favor of this one.
          eventSink.emit({
            type: "task_execution_state",
            conversationId,
            executionId: created.executionId,
            status: "continuing",
          });
        } catch (err) {
          console.error(
            "[ai-chat-v2] successor binding adoption failed:",
            err
          );
          taskExecutionBinding = undefined;
          // D2/core(c) review fix: the coordinator created the successor row
          // BEFORE this dispatch, so an adoption failure leaves an orphan
          // active row. The old catch cleared adoptedSuccessorExecutionId,
          // hiding the orphan from the pre-stream cancel (:2090) — and a
          // turn that then succeeded never touched the row at all, so it
          // stayed `running` forever (AC-24/25). The binding setup failed,
          // so no stream will ever attach to this execution: cancel it
          // durably right here (fire-and-forget, never masks the original
          // error; alreadyFinalized is a no-op success). Keep the id set —
          // the pre-stream catch stays a second net.
          const orphanedExecutionId = successorContext.binding.executionId;
          this.taskDecisionSlots.delete(orphanedExecutionId);
          this.taskExecutionBindings.delete(conversationId);
          this.policyAcceptedConversations.delete(conversationId);
          void new TaskExecutionCoordinator()
            .cancel(orphanedExecutionId)
            .then((cancelResult) => {
              if (!cancelResult.ok && !cancelResult.alreadyFinalized) {
                console.error(
                  `[ai-chat-v2] orphan successor cancel failed (executionId=${orphanedExecutionId}): ${cancelResult.reasonCode ?? "unknown"}`
                );
              }
            })
            .catch((cancelErr: unknown) =>
              console.error(
                `[ai-chat-v2] orphan successor cancel threw (executionId=${orphanedExecutionId}):`,
                cancelErr
              )
            );
        }
      }
      // Generate the turn id once, at accept time (technical-design §4.3).
      // Scheduled turns reuse the stable scheduled id so a crash-retry stamps
      // the same turn association on replayed rows (§14.2).
      turnId = scheduledContext
        ? scheduledContext.userMessageId
        : `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      // G01-312: mint the assistant message id alongside the turn id (it
      // depends only on the scheduled context) so the abort handle below
      // can emit a correlated cancelled event however early Stop lands.
      assistantMessageId = scheduledContext
        ? scheduledContext.assistantMessageId
        : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // G01-312: register the pre-stream abort handle BEFORE the slow prep
      // (plan state, attachments, resolutions, enrollment, assembly). A Stop
      // during that window aborts this controller; prep stage boundaries
      // check it and exit before any loop dispatch (see pre-stream catch).
      // Keyed by conversation; promotion/discard paths match on turnId so a
      // concurrent turn never clears another turn's handle. A same-
      // submission transport retry (B11) keeps the ORIGINAL's handle: the
      // retry preps with a local controller and either reuses (returns,
      // original untouched) or adopts its handle post-enrollment.
      // A different submission supersedes: abort the prior pending prep
      // (mirrors the active-turn replacement at stream registration).
      const controller = new AbortController();
      prepAbortController = controller;
      prepTurnId = turnId;
      prepAssistantMessageId = assistantMessageId;
      {
        const priorPending = this.pendingTurns.get(conversationId);
        const sameSubmission =
          request.submissionId != null &&
          priorPending?.submissionId === request.submissionId;
        if (priorPending && !sameSubmission) {
          this.pendingTurns.delete(conversationId);
          priorPending.abortController.abort();
        }
        if (!sameSubmission) {
          this.pendingTurns.set(conversationId, {
            abortController: controller,
            turnId,
            assistantMessageId,
            eventSink,
            submissionId: request.submissionId ?? null,
          });
          prepOwnController = controller;
        } else {
          // B11: a same-submission transport retry keeps the ORIGINAL's
          // registered handle — Stop aborts the original, while the retry
          // always reaches the enrollment dedup (reused → return, original
          // untouched). Its boundaries watch a local controller Stop never
          // aborts.
          prepOwnController = new AbortController();
        }
      }
      // G01-312: prep stage boundaries call this after each slow await. A
      // Stop that landed mid-prep throws here; the pre-stream catch turns it
      // into a controlled cancelled exit (abortPrepExit) before any loop
      // dispatch — never a half-prepped stream, never an orphan row.
      const throwIfPrepAborted = (): void => {
        prepOwnController?.signal.throwIfAborted();
      };
      if (request.toolApprovalMode) {
        new AIChatToolApprovalModule().setMode(
          conversationId,
          request.toolApprovalMode
        );
      }

      // Resolve plan state now that we have the final conversation id.
      if (isPlanMode) {
        if (!planState) {
          planState = await planModule.ensurePlanForConversation({
            conversationId,
            title: request.message.slice(0, 80) || "New plan",
            objective: request.message.slice(0, 500),
          });
        } else if (planState.conversationId !== conversationId) {
          planState = await planModule.getPlanState(conversationId);
        }
        if (
          planState?.status === "awaiting_approval" &&
          isTypedPlanApproval(request.message)
        ) {
          planState = await planModule.approvePlan({
            conversationId,
            planId: planState.planId,
            version: planState.currentVersion,
          });
          textApprovedPlanState = planState;
        }
      }

      // Handle uploaded attachments:
      //   1. Stage documents FIRST (convert to markdown, write to disk), capture refIds.
      //   2. Build the enriched message WITH the correct attachment_ref values so the
      //      LLM can call read_attachment_content with a valid refId — not a filename.
      //   3. Persist attachment bytes to the database.
      throwIfPrepAborted();
      const hasFiles =
        Array.isArray(request.uploadedFiles) &&
        request.uploadedFiles.length > 0;
      let messageToSave = request.message || "";
      let attachmentMetadata: ChatV2AttachmentMetadata[] | undefined;
      let currentUserContentParts:
        | Array<OpenAITextContentPart | OpenAIImageUrlContentPart>
        | undefined;

      if (hasFiles) {
        // Stage documents *before* building the enrichment so refIds are available.
        const docFiles = request.uploadedFiles!.filter(
          (f) => f.kind === "document"
        );
        const stagedRefs: StagedAttachmentReference[] =
          docFiles.length > 0
            ? await this.stageDocumentMarkdowns(docFiles, conversationId)
            : [];

        const prep = this.prepareAttachmentContent(
          request.uploadedFiles!,
          stagedRefs,
          request.message || ""
        );
        messageToSave = prep.enrichedMessage;
        attachmentMetadata = prep.displayMetadata;
        if (prep.contentParts.length > 0) {
          currentUserContentParts = [
            { type: "text", text: prep.enrichedMessage },
            ...prep.contentParts,
          ];
        }
      }

      // Resolve pasted-text placeholders on the (attachment-enriched)
      // message BEFORE resolving @-mentions. This ensures mention tokens
      // inside pasted content get expanded correctly.
      throwIfPrepAborted();
      const pastedTextResolution =
        await new PastedTextResolutionService().resolveMessage(
          messageToSave,
          request.pastedContents
        );

      // Resolve @-mentions on the pasted-expanded (model-facing) message:
      // append a model-facing context block while keeping it out of the
      // saved display.
      const atMentionResolution =
        await new AtMentionResolutionService().resolveMessage(
          conversationId,
          pastedTextResolution.modelMessage
        );
      const modelUserMessage = atMentionResolution.modelMessage;

      // Re-resolve user-selected archived passages (§13.3). The renderer sends
      // opaque source ids only; the backend re-validates epoch/revision and the
      // final budget. Accepted excerpts become the "current user + selected"
      // context block below; the references (never the text) are persisted with
      // the user row. Rejected/unavailable selections never block the turn.
      throwIfPrepAborted();
      const selectionResolution = await this.resolveSelectedHistory(
        conversationId,
        turnId,
        request.historySelectionIds ?? []
      );
      const selectedHistoryBlock = buildSelectedHistoryContextBlock(
        selectionResolution.excerpts
      );
      historySelectionAcceptedIds = selectionResolution.metadata.map(
        (m) => m.sourceId
      );
      historySelectionChangedIds = selectionResolution.changedIds;
      historySelectionRejectedIds = selectionResolution.rejectedIds;

      // "Current user + selected" allocation slot: the selected archive
      // passages are folded into the SAME user message the user authored, so
      // preflight can never evict them as an independent optional block
      // (technical-design line 372) and they are included exactly once.
      throwIfPrepAborted();
      const userMessageForModel =
        selectedHistoryBlock.length > 0
          ? `${modelUserMessage}\n\n${selectedHistoryBlock}`
          : modelUserMessage;
      if (currentUserContentParts && currentUserContentParts.length > 0) {
        // Fold the @-mention context (+ selected passages) into the multimodal text part.
        currentUserContentParts = [
          { type: "text", text: userMessageForModel },
          ...currentUserContentParts.slice(1),
        ];
      }

      // Resolve selected generated images into transient edit-input parts.
      // Runs AFTER the final conversation id is known and BEFORE any
      // user-message persistence so a failed resolution leaves the
      // transcript untouched. Artifacts carry dataUrls in memory only.
      let generatedImageRefMetadata:
        | ChatV2GeneratedImageReferenceMetadata[]
        | undefined;
      if (
        request.generatedImageReferences &&
        request.generatedImageReferences.length > 0
      ) {
        const uploadedImageCount =
          currentUserContentParts?.filter((part) => part.type === "image_url")
            .length ?? 0;
        const resolution = await this.resolveGeneratedImageInputs({
          conversationId,
          references: request.generatedImageReferences,
          uploadedImageCount,
        });
        if (!resolution.ok) {
          log.warn(
            `[ai-chat-v2] rejecting generated-image edit conv=${conversationId} code=${resolution.errorCode}`
          );
          eventSink.emit({
            type: "error",
            conversationId,
            errorMessage:
              GENERATED_IMAGE_REFERENCE_ERROR_MESSAGES[resolution.errorCode],
            errorCode: resolution.errorCode,
          });
          return {
            type: "failed",
            conversationId,
            assistantMessageId: "",
          };
        }
        const generatedParts: OpenAIImageUrlContentPart[] =
          resolution.result.artifacts.map((artifact) => ({
            type: "image_url",
            image_url: { url: artifact.dataUrl, detail: artifact.detail },
          }));
        const effectiveText =
          modelUserMessage.trim().length > 0
            ? modelUserMessage
            : "Describe the selected image.";
        currentUserContentParts = [
          { type: "text", text: effectiveText },
          ...(currentUserContentParts ? currentUserContentParts.slice(1) : []),
          ...generatedParts,
        ];
        generatedImageRefMetadata = [...resolution.result.metadata];
      }

      // Build user-message metadata (source + attachments + @-mentions).
      const userMetadata: ChatV2MessageMetadata = {
        source: scheduledContext ? "scheduled-loop" : "chat-v2",
        ...(generatedImageRefMetadata
          ? { generatedImageReferences: generatedImageRefMetadata }
          : {}),
      };
      if (scheduledContext) {
        userMetadata.scheduledLoop = {
          scheduleId: scheduledContext.scheduleId,
          taskId: scheduledContext.taskId,
          runId: scheduledContext.runId,
          occurrence: scheduledContext.occurrence,
          scheduledFor: scheduledContext.scheduledFor,
          catchUp: scheduledContext.catchUp,
        };
      }
      if (attachmentMetadata) userMetadata.attachments = attachmentMetadata;
      if (atMentionResolution.metadata.length > 0) {
        userMetadata.atMentions = atMentionResolution.metadata;
      }
      if (pastedTextResolution.pastedBlocks.length > 0) {
        userMetadata.pastedBlocks = pastedTextResolution.pastedBlocks;
      }
      // Persist only the ACCEPTED references (provenance, never the text).
      if (selectionResolution.metadata.length > 0) {
        userMetadata.historySelections = selectionResolution.metadata;
      }
      const hasUserMetadataBeyondSource =
        !!attachmentMetadata ||
        atMentionResolution.metadata.length > 0 ||
        pastedTextResolution.pastedBlocks.length > 0 ||
        !!scheduledContext ||
        !!generatedImageRefMetadata ||
        selectionResolution.metadata.length > 0;

      // Save user message (display text = attachment-enriched message; the
      // @-mention context block lives only in modelUserMessage for the model).
      // Scheduled turns use a stable message id + insert-if-absent so a
      // crash-retry does not duplicate the transcript row (technical-design §14.2).
      // Interactive turns with a submissionId take the same idempotent path with
      // a derived stable id so a transport retry reuses the accepted user row
      // (§13.3) instead of writing a second one.
      const idempotentMessageId = scheduledContext
        ? scheduledContext.userMessageId
        : request.submissionId
        ? `user-${request.submissionId}`
        : undefined;
      const savedUser =
        (scheduledContext && scheduledContext.userMessageId) ||
        request.submissionId
          ? await module.saveUserMessageIfAbsent({
              conversationId,
              content: messageToSave,
              messageId: idempotentMessageId ?? "",
              metadata: userMetadata,
              turnId,
            })
          : await module.saveUserMessage({
              conversationId,
              content: messageToSave,
              metadata: hasUserMetadataBeyondSource ? userMetadata : undefined,
              turnId,
            });

      // Persist attachment bytes to DB (original file bytes, not the staged markdown).
      if (hasFiles) {
        await this.persistAttachmentBytes(
          request.uploadedFiles!,
          conversationId,
          savedUser.messageId
        );
      }

      // Resolve and persist the outbound-email delivery intent for this turn
      // from TRUSTED user-authored text only (technical design §9): raw user
      // message, never tool args / retrieved content / assistant statements.
      // Idempotent across stream retries via the (conversationId, sourceUserMessageId)
      // unique index. Failures resolve to draft_only and never break chat.
      throwIfPrepAborted();
      sourceUserMessageId = savedUser.messageId;
      try {
        const intentModule = new OutboundEmailIntentModule();
        const existing = await intentModule.findBySource(
          conversationId,
          savedUser.messageId
        );
        // Re-verify the cached decision against the CURRENT user-authored
        // text before reusing it (technical design §9): the (conversationId,
        // sourceUserMessageId) row is only a valid cache hit when its stored
        // sourceTextHash still matches this turn's text and it was produced
        // by the current resolver version. A mismatch (text changed or the
        // resolver was upgraded) re-resolves and overwrites the stale row.
        const userAuthoredText = request.message || "";
        const currentHash = hashUserAuthoredText(userAuthoredText);
        if (
          existing &&
          existing.sourceTextHash === currentHash &&
          existing.resolverVersion === OUTBOUND_RESOLVER_VERSION
        ) {
          intentDecisionId = existing.id;
        } else {
          // Load the conversation's messages (chronological ASC) so the
          // resolver can evaluate the contextual-affirmation path (§9.1/§9.4):
          // a short "yes, send it" authorizes a send ONLY when the immediately
          // preceding assistant message asked an explicit send-confirmation
          // question. Passing null here (the prior bug, RC3) made that path
          // dead and forced every affirmation back to draft_only.
          const priorMessages = await module.getConversationMessages(
            conversationId
          );
          const decision = OutboundEmailIntentResolver.resolve(
            buildResolverInput(
              {
                conversationId,
                sourceUserMessageId: savedUser.messageId,
                userAuthoredText,
              },
              priorMessages
            )
          );
          const decisionFields = {
            mode: decision.mode,
            reasonCode: decision.reasonCode,
            confidence: decision.confidence,
            evidenceJson: JSON.stringify(decision.evidence),
            sourceTextHash: decision.sourceTextHash,
            resolverVersion: decision.resolverVersion,
          };
          if (existing) {
            await intentModule.updateDecision(existing.id, decisionFields);
            intentDecisionId = existing.id;
          } else {
            const persisted = await intentModule.create({
              conversationId,
              sourceUserMessageId: savedUser.messageId,
              ...decisionFields,
            } as OutboundEmailIntentEntity);
            intentDecisionId = persisted.id;
          }
        }
      } catch (err) {
        console.error("[outbound-email-intent] resolve failed:", err);
        intentDecisionId = null;
      }

      // ------------------------------------------------------------------
      // T15c (FR-20/21, AC-31): resolve the request route ONCE into the
      // outer `taskRoute` (declared above) so it is in scope at all four
      // `shouldAutoContinueGoal` consult sites below (live turn + the three
      // resume paths). The route is the semantic signal that gates goal
      // takeover: `response_only` (ordinary question) must NOT be seized by
      // an unrelated active goal, while `task_*` / `preparation` turns ARE
      // goal-scoped work. NFR-12: the flag gates request resolution, so the
      // classify call sits inside the flag gate — flag-off leaves
      // `taskRoute` undefined and the consult falls through to the legacy
      // goal lookup (byte-identical legacy goalAutoContinue). An approved
      // plan = approved task template (task_verified); a plan awaiting
      // approval or a turn awaiting permission = preparation. The previous
      // `hasApprovedTaskTemplate: false` hardcode meant every task was
      // best_effort and every preparation was misrouted — the classifier's
      // preparation branch was unreachable, so plan-draft Stop never waited
      // on actual approved scope. `planState` was resolved above (step 1);
      // `pendingPermissions` is the runtime map of conversations
      // mid-permission-prompt.
      // ------------------------------------------------------------------
      if (
        isAiTaskCompletionPolicyV1Enabled() &&
        !scheduledContext &&
        !successorContext
      ) {
        const pendingPlanApproval = planState?.status === "awaiting_approval";
        const pendingPermission = this.pendingPermissions.has(conversationId);
        const hasApprovedTaskTemplate = planState?.status === "approved";
        taskRoute = new TaskRequestResolver().classify({
          userMessage: request.message || "",
          hasApprovedTaskTemplate,
          pendingPlanApproval,
          pendingPermission,
        });
      }

      // ------------------------------------------------------------------
      // Slice 2 Unit 4 — Enroll this turn into the completion policy
      // (technical-design §5/§7, FR-01/02/03/04/19, AC-01/02/03/26).
      //
      // When the policy flag is on, freeze a contract for verified tasks,
      // call `coordinator.startManual`, and build the LoopTaskExecutionBinding
      // the loop consults at its four terminal-stop sites. The binding
      // carries closures (not the runtime controller/budget) so the loop
      // never imports those types. Fail-closed: any enrollment error leaves
      // `taskExecutionBinding` undefined and the turn proceeds with
      // byte-identical legacy behavior (no consult). A `reused` result is a
      // transport retry (no fresh effects); a `conflict` is a submissionId
      // collision with different text — both skip consult. Flag-off: the
      // whole block is skipped, `taskExecutionBinding` stays undefined, and
      // the loop's consult guards no-op.
      // ------------------------------------------------------------------
      if (
        isAiTaskCompletionPolicyV1Enabled() &&
        !scheduledContext &&
        !successorContext
      ) {
        try {
          // Only enroll routes that can do work OR wait on preparation.
          // response_only turns end naturally and never need a completion
          // consult (FR-02). T15c: preparation NOW enrolls (was skipped) so
          // a plan-draft / approval-wait / permission-wait turn has a
          // ledger row + Stop available, with a NULL contract — the
          // controller can never verify (no required criteria → never
          // verified_complete), and a Stop finalizes incomplete /
          // PREPARATION_REQUIRED (never a verified outcome). One execution
          // spans preparation → approval → execution (FR-21).
          // Unit 6 seam guard (GAP-S2 #8): scheduled turns are enrolled by
          // ScheduledAiMessageRunner via startScheduled (with the claim's
          // occurrence key). This manual-enrollment seam must not
          // double-enroll them as manual executions — scheduledContext is
          // trusted main-process metadata the renderer cannot forge.
          if (taskRoute && taskRoute !== "response_only") {
            // `taskRoute` is narrowed to a non-response_only route here; the
            // outer scope declares it as `| undefined` only because the
            // flag-off / scheduled paths never compute it. Capture a narrowed
            // local so the compiler, startManual, and freeze path see a
            // definite TaskExecutionRoute.
            const route: TaskExecutionRoute = taskRoute;
            const coordinator = new TaskExecutionCoordinator();
            const requestHash = hashUserAuthoredText(request.message || "");
            const submissionId =
              request.submissionId ??
              `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // T01 (FR-19): derive real criteria from the actual user message
            // for BOTH best-effort and verified routes, then freeze a
            // source-anchored contract before startManual dispatches (FR-01).
            // The compiler is structural (no LLM, no authorization
            // broadening); every criterion carries sourceRefs validated by
            // freeze() against the approved content (T17's offset check).
            // Best-effort with zero required criteria is a legal shape
            // (FR-04), but the compiler always derives at least one criterion
            // for actionable requests so the controller has unmet work to
            // continue on (AC-02/18). Ambiguous scope emits a qualitative
            // fallback criterion that can never pass without a checker —
            // the request stays explicitly unverified (AC-21).
            // T15: wire an approved-task-template signal here when the
            // template entity lands; the compiler already handles
            // `task_verified` via the same structural path.
            const shouldFreezeContract =
              route === "task_verified" || route === "task_best_effort";
            let contract: TaskCompletionContract | null = null;
            if (shouldFreezeContract) {
              const mode: "verified" | "best_effort" =
                route === "task_verified" ? "verified" : "best_effort";
              try {
                const compiled = compileCriteria({
                  userMessage: request.message || "",
                  sourceUserMessageId: savedUser.messageId,
                  route,
                  approvedSourceMessageIds: [savedUser.messageId],
                });
                contract = coordinator.freezeContract({
                  objective: request.message.slice(0, 20000) || "User task",
                  sourceUserMessageId: savedUser.messageId,
                  approvedSourceMessageIds: [savedUser.messageId],
                  approvedSourceContents: {
                    [savedUser.messageId]: request.message || "",
                  },
                  mode,
                  criteria: compiled.criteria,
                });
                if (compiled.ambiguityReason) {
                  console.log(
                    `[ai-chat-v2] task criteria ambiguous (execution scope unstructured): ${compiled.ambiguityReason}`
                  );
                }
              } catch (compileErr) {
                // T01 / NFR-12: contract-generation failure must not bypass
                // enrollment. Fall through with contract=null — startManual
                // still runs (identity registered, Stop available), but the
                // null contract means the controller can never verify (no
                // required criteria → allRequiredPass=false → never
                // verified_complete). This is a controlled non-success, not
                // a silent legacy fallback.
                console.error(
                  "[ai-chat-v2] task criteria compilation failed:",
                  compileErr
                );
                contract = null;
              }
            }
            // T15 (FR-20, one semantic owner): resolve which completion
            // owner enrolls this execution. B12: an active conversation goal
            // owns the work ONLY when the request actually links to it
            // (goal command, goal-id mention, or shared objective
            // vocabulary — isGoalLinkedMessage); mere co-presence never
            // seizes unrelated tasks, which retain standalone ownership
            // with an independent objective/budget. The goal controller is
            // the sole semantic owner of linked turns — the standalone
            // controller must not add its own nudges or claim goal
            // completion (§3 of the design). Lookup failures fall back to
            // "standalone" (fail-closed: never crash enrollment over an
            // ownership ambiguity). The goal lookup is bounded to this
            // conversation, so an unrelated conversation's goal can never
            // take ownership.
            let completionOwner: "standalone" | "goal" = "standalone";
            try {
              const owningGoal = await new AIChatGoalModule().getActiveGoal(
                conversationId
              );
              if (
                owningGoal &&
                isGoalLinkedMessage(request.message || "", {
                  goalId: owningGoal.goalId,
                  objective: owningGoal.objective,
                })
              ) {
                completionOwner = "goal";
              }
            } catch (ownerErr) {
              console.warn(
                "[ai-chat-v2] goal ownership lookup at enrollment failed:",
                ownerErr
              );
            }
            const startResult = await coordinator.startManual({
              conversationId,
              sourceUserMessageId: savedUser.messageId,
              submissionId,
              requestHash,
              route,
              completionOwner,
              contract,
            });
            if (startResult.status === "created") {
              const created = startResult.binding;
              // Unit 7 (AC-25): a replacement submission fences the old
              // execution — the prior turn was already aborted above; finalize
              // its execution cancelled/TASK_REPLACED so it can never emit a
              // late verified outcome. Fire-and-forget: enrollment must never
              // block the new turn, and the new execution wins the lease.
              const replacedExecutionId =
                this.taskExecutionBindings.get(conversationId);
              if (replacedExecutionId) {
                void new TaskExecutionCoordinator()
                  .cancel(replacedExecutionId)
                  .then((cancelResult) => {
                    if (!cancelResult.ok && !cancelResult.alreadyFinalized) {
                      console.error(
                        `[ai-chat-v2] task-replacement fencing failed (executionId=${replacedExecutionId}): ${cancelResult.reasonCode ?? "unknown"}`
                      );
                    }
                  })
                  .catch((err: unknown) =>
                    console.error(
                      `[ai-chat-v2] task-replacement fencing threw (executionId=${replacedExecutionId}):`,
                      err
                    )
                  );
              }
              // Bind the new execution to the conversation so Stop cancels it
              // (Unit 7 stop wiring, FR-22/23).
              this.taskExecutionBindings.set(
                conversationId,
                created.executionId
              );
              // G01-312: track our enrolled row for orphan-cancel on prep abort.
              prepExecutionId = created.executionId;
              // T16: freeze the flag-at-enrollment value so Stop-cancel and
              // the finalization gate do not re-check the mutable runtime
              // flag for this accepted execution (NFR-12, AC-12/32).
              this.policyAcceptedConversations.add(conversationId);
              // Per-turn decision slot: the loop's consult closure records
              // here, and the engine's finalization gate (Slice 2 Unit 5)
              // reads it to tell "loop already consulted" from "no consult
              // ran" — only falling back to its own consult on the latter.
              // Keyed by executionId so the engine can look it up from the
              // binding's executionId without holding the binding itself.
              let recordedDecision: TaskCompletionDecision | null = null;
              this.taskDecisionSlots.set(created.executionId, {
                get: () => recordedDecision,
                set: (d: TaskCompletionDecision | null) => {
                  recordedDecision = d;
                },
              });
              // Evidence service (T03, FR-03/04/24, AC-03/04/32): build the
              // authoritative evidence stack — module-backed store whose
              // `mergeEvidenceCas` calls `AiTaskExecutionModel.
              // applyShadowDecisionCas`, provider-backed observation /
              // operation-receipt / record-count lookups, and a bounded
              // tool-free checker dispatch — via the shared factory. The
              // `expectedStateVersion` is read FRESH per consult (evidence
              // writes bump the version, so a frozen token would mismatch)
              // so `persistEvidence` writes rows before terminal delivery
              // (AC-32 reload resolves every evidence ID). Constructed
              // lazily here (BaseModule TDZ — never at module top level).
              const execModule = new AiTaskExecutionModule();
              const {
                evidenceService,
                checkerDispatch,
                observationProvider,
                operationReceiptProvider,
                artifactBaseDir,
              } = buildEvidenceService({
                executionId: created.executionId,
                execModule,
                operationModule: new AiTaskOperationModule(),
                searchModule: new SearchModule(),
                contactInfoRepository,
                deliveryStatusReader: makeNativeSendStatusReader(),
              });
              // B21 (FR-02/03/19): capture pre-action artifact baselines at
              // enrollment — after the contract froze, before the maker
              // dispatches. Files the run itself creates have no baseline
              // and stay honestly unknown.
              const artifactBaselines = await snapshotArtifactBaselines(
                artifactBaseDir ?? undefined,
                contract?.criteria ?? []
              );
              // B13c: tracked durable-spend persister (see successor seam).
              const manualBudgetPersists = makeTrackedPersistBudget((delta) =>
                execModule.persistBudgetConsumption({
                  ledgerId: created.ledgerId,
                  expectedOwnerGeneration: created.leaseGeneration,
                  activeExecutionId: created.executionId,
                  delta,
                })
              );
              // FR-09 / §7.2 step 7 (GAP-S2 #2): one tracker per execution,
              // closing over the SAME budget the controller consults, so the
              // streak the tracker increments is the streak the controller's
              // continue-branch gate reads. Constructed once per enrollment
              // (NOT at module top level — BaseModule TDZ). Holds no DB
              // state; only mutates the budget's no-progress streak counter.
              const progressTracker = new TaskProgressTracker({
                budget: created.budget,
                persistBudgetSpending: manualBudgetPersists.persistBudget,
              });
              taskExecutionBinding = {
                executionId: created.executionId,
                // T16: freeze the flag value at enrollment so downstream
                // handling of THIS accepted execution (loop consult,
                // finalization gate, Stop-cancel) does not re-check the
                // mutable runtime flag. Turning the flag off after
                // enrollment cannot convert accepted unfinished work to
                // unchecked success (NFR-12, AC-12/32).
                policyAccepted: true,
                // B12: frozen semantic owner (linkage-gated at enrollment)
                // so the loop selects goal-flavored prompts exclusively for
                // goal-owned turns.
                completionOwner,
                // T04 (NFR-02/04, AC-24): the per-turn abort controller is
                // created AFTER this enrollment block runs (at the turn-state
                // registration). Read it fresh per consult so the checker
                // dispatch races the CURRENT turn's Stop signal + a deadline
                // (§9: a hanging request cannot hold the gate).
                getAbortSignal: () =>
                  this.activeTurns.get(conversationId)?.abortController.signal,
                consult: async (candidate) => {
                  // B12 (FR-20, NFR-01/07, AC-14/31): goal-owned turns end
                  // with an internal iteration yield before any standalone
                  // verification, evidence spend, or lease reads — the goal
                  // loop exclusively owns goal completion decisions. One
                  // semantic owner, no stacked standalone nudges.
                  if (completionOwner === "goal") {
                    return {
                      type: "yield_owner" as const,
                      owner: "goal" as const,
                      result: "maker_iteration_ended" as const,
                    };
                  }
                  // T03: read the CAS token fresh per consult so evidence
                  // writes persist (AC-32). A frozen version would mismatch
                  // the moment any prior consult bumped the row.
                  const exec = await execModule.getExecution(created.executionId);
                  const expectedStateVersion = exec?.execution_state_version;
                  // T15b (FR-20, NFR-01/07, AC-22/31): single-owner lease
                  // guard. A Continue successor has bumped owner_generation
                  // on the shared lineage ledger; this binding still carries
                  // the parent's frozen generation. Re-read the ledger fresh
                  // and reject the consult on mismatch — a stale ancestor
                  // must not drive the loop or emit decisions for a lineage
                  // it no longer owns. Fail-closed: a missing ledger (null)
                  // also rejects. The loop maps yield_owner to
                  // MAKER_ITERATION_ENDED (break, no dispatch). Skipped when
                  // the binding carries no lease (legacy/test bindings with
                  // no lineage ledger — nothing to guard).
                  if (
                    created.ledgerId !== undefined &&
                    created.leaseGeneration !== undefined
                  ) {
                    const currentGen = await readCurrentLeaseGeneration(
                      (id) => execModule.getLedgerById(id),
                      created.ledgerId as string
                    );
                    const ownership = assertOwnership(
                      { leaseGeneration: created.leaseGeneration },
                      currentGen ?? -1
                    );
                    if (!ownership.ok) {
                      console.error(
                        `[ai-chat-v2] consult rejected — stale lease (executionId=${created.executionId}, bindingGen=${created.leaseGeneration}, ledgerGen=${currentGen ?? "missing"})`
                      );
                      return {
                        type: "yield_owner" as const,
                        owner: "goal" as const,
                        result: "maker_iteration_ended" as const,
                      };
                    }
                  }
                  return created.controller.decide(candidate, {
                    route: created.route,
                    owner: completionOwner,
                    contract: created.contract ?? undefined,
                    evidenceService,
                    evidenceContext: {
                      content: candidate.content,
                      source: "loop_consult",
                      sourceRevision: "slice2-t03-manual",
                      checkerDispatch,
                      observationProvider,
                      operationReceiptProvider,
                      artifactBaseDir: artifactBaseDir ?? undefined,
                      artifactBaselines,
                      persistBudgetSpending: manualBudgetPersists.persistBudget,
                      // T04: thread the per-turn abort signal into the
                      // checker dispatch (read fresh — the turn may have
                      // changed between consults).
                      abortSignal: this.activeTurns.get(conversationId)
                        ?.abortController.signal,
                      expectedStateVersion,
                    },
                    budget: created.budget,
                  });
                },
                reserveContinuation: (continuationId) =>
                  created.budget.reserveContinuation(continuationId),
                // T05 (FR-08/10/23, AC-06/08/22/27/29): provider-attempt gate.
                // The loop calls this before streamChatCompletion with a
                // B13b-unique per-attempt ID. Exhausted → loop
                // throws RecoverableHistoryError("MODEL_ATTEMPT_LIMIT").
                reserveProviderAttempt: (requestId) =>
                  created.budget.reserveProviderAttempt(requestId),
                // T05 (FR-08/10/23, AC-27) + B13a: tool-execution fail-closed
                // gate. The loop calls this with a stable `tool:<call.id>`
                // ID before deps.executeTool; Exhausted/persist-false throws.
                reserveToolExecution: (toolRequestId) =>
                  created.budget.reserveToolExecution(toolRequestId),
                // T05 (FR-08/10/23, AC-22): reconcile actual token usage after
                // a dispatch against the in-memory mirror. Returns true when
                // the round was new (loop then persists `tokens` to the
                // ledger); false on dedup (loop skips the persist).
                reconcileTokens: (requestId, actualTokens) =>
                  created.budget.reconcileTokens(requestId, actualTokens),
                // T05 (FR-08/10/23, AC-29): accumulate active runtime (provider
                // stream wall-clock) against the in-memory mirror. The loop
                // calls this after each stream completes with the per-round
                // delta.
                addActiveRuntime: (ms) =>
                  created.budget.addActiveRuntime(ms),
                addWaitMs: (ms) => created.budget.addWaitMs(ms),
                getRemainingBudgets: () => created.budget.getRemaining(),
                // T05 (FR-08/10/23, AC-06/08/22/27/29): durable ledger-backed
                // budget persistence. The in-memory `created.budget` is a
                // mirror; this closure is the authoritative path. Each dispatch
                // site in the loop calls it after a successful in-memory
                // reservation, fenced by `leaseGeneration` (= owner_generation)
                // + `executionId` (= active_execution_id) so only the
                // currently-active execution may spend. Returns false when the
                // lease no longer holds (released, superseded by a Continue
                // successor, or row missing) — the loop's dispatch sites
                // fail-closed on false (FR-08: refuse to dispatch when
                // persistence fails). The closure captures `execModule`
                // (already in scope above) so the loop never imports the model
                // or coordinator types.
                ledgerId: created.ledgerId,
                leaseGeneration: created.leaseGeneration,
                persistBudget: manualBudgetPersists.persistBudget,
                flushPersistedBudget: manualBudgetPersists.flushPersistedBudget,
                recordDecision: (decision) => {
                  recordedDecision = decision;
                },
                recordToolRoundProgress: (observation) => {
                  progressTracker.recordToolRound(observation);
                },
                // T20b: text-only rounds (goalTextStop consults carry no
                // committed tool round) feed the same tracker so repeated
                // identical text counts as no-progress.
                recordAssistantTextProgress: (content) => {
                  progressTracker.recordAssistantTextRound(content);
                },
              };
              // T13 (PRD FR-13, NFR-10/11, AC-16): emit the active lifecycle
              // state once the binding is fully constructed and registered.
              // The renderer shows the badge immediately (no waiting for the
              // first consult) and the executionId is stable for dedup. A
              // terminal event for THIS execution later replaces this state.
              eventSink.emit({
                type: "task_execution_state",
                conversationId,
                executionId: created.executionId,
                status: "active",
              });
            } else if (startResult.status === "reused") {
              // T10 (FR-17/21, AC-26): transport retry of the same accepted
              // submission. The DB dedup recorded the existing execution — but
              // dedup at the DB layer alone never stopped the maker from
              // re-dispatching. Set the short-circuit so the loop dispatch is
              // skipped: no provider call, no renewed budget, no repeated
              // effect. The existing execution's current/final status is
              // authoritative; the engine emits a terminal event so the
              // renderer stops the turn instead of running new work.
              dedupShortCircuit = {
                kind: "reused",
                executionId: startResult.existing.executionId,
                finalized: startResult.existing.finalized,
              };
              console.log(
                `[ai-chat-v2] task execution reused (submissionId=${submissionId}) — transport retry, skipping dispatch`
              );
            } else if (startResult.status === "conflict") {
              // T10: conflict — same submissionId, different requestHash.
              // Surface SUBMISSION_CONFLICT and skip dispatch entirely. Never
              // persist a second row, never run the maker.
              dedupShortCircuit = {
                kind: "conflict",
                executionId: startResult.existing.executionId,
              };
              console.error(
                `[ai-chat-v2] task execution conflict (submissionId=${submissionId}) — SUBMISSION_CONFLICT, skipping dispatch`
              );
            } else {
              // T08: `denied` — a Continue/retry successor's lineage ledger
              // claim was rejected (dangling, released, or superseded). This
              // path enrolls a fresh manual submission with no
              // parentExecutionId/lineageLedgerId, so a denial is unreachable
              // here; treat it as a hard enrollment failure so the turn
              // surfaces the reason and never dispatches on a missing ledger.
              dedupShortCircuit = {
                kind: "denied",
                reasonCode: startResult.reasonCode,
              };
              console.error(
                `[ai-chat-v2] task execution denied (submissionId=${submissionId}) — ${startResult.reasonCode}, skipping dispatch`
              );
            }
          }
        } catch (err) {
          console.error("[ai-chat-v2] task completion enrollment failed:", err);
          taskExecutionBinding = undefined;
        }
      }

      // Load history and build transcript.
      // G01-312: the enrollment seam above may have committed a row — a Stop
      // landing mid-enrollment exits here, and abortPrepExit cancels the
      // just-enrolled execution (no orphan active row).
      throwIfPrepAborted();
      const basePrompt =
        request.systemPrompt ?? module.getDefaultSystemPrompt();
      const assembled = await this.contextAssembler.assemble({
        conversationId,
        currentUserMessage: userMessageForModel,
        currentUserMessageId: savedUser.messageId,
        baseSystemPrompt: basePrompt,
        mode: isPlanMode ? "plan" : "chat",
        model: request.model,
        maxTokens: request.maxTokens,
        planState,
        currentUserContentParts,
      });

      // G01-312: assistantMessageId was minted at accept time (with turnId)
      // so the pending abort handle can emit a correlated cancelled event
      // however early Stop lands.
      messages = [...assembled.messages];

      // Proactive pre-turn compact: if the assembled context's token estimate
      // already exceeds the auto-compact threshold, run a full compact NOW
      // (before sending) and re-assemble so the request stays within the
      // model's context window. Without this, a long conversation can grow
      // past 100% on the next turn and hit a ContextWindowExceededError —
      // which the post-turn compact (case "completed") can't prevent because
      // it only runs AFTER a successful turn.
      const compactAgent = this.compactAgent;
      if (compactAgent && assembled.tokenEstimate > 0) {
        const contextWindow = await this.resolveContextWindowForModel(
          request.model
        );
        const threshold = Math.floor(
          AUTO_COMPACT_THRESHOLD_FRACTION * contextWindow
        );
        if (assembled.tokenEstimate >= threshold) {
          log.info(
            `[ai-chat-compact] pre-turn compact triggered conv=${conversationId} estimate=${assembled.tokenEstimate} threshold=${threshold} window=${contextWindow}`
          );
          try {
            const compacted = await compactAgent.enqueueAutoCompact({
              conversationId,
              reason: "pre_turn_proactive",
              promptTokens: assembled.tokenEstimate,
              model: request.model,
            });
            if (compacted) {
              // Re-assemble with the fresh compact boundary so the request
              // uses the shrunk context.
              const reassembled = await this.contextAssembler.assemble({
                conversationId,
                currentUserMessage: modelUserMessage,
                currentUserMessageId: savedUser.messageId,
                baseSystemPrompt: basePrompt,
                mode: isPlanMode ? "plan" : "chat",
                model: request.model,
                maxTokens: request.maxTokens,
                planState,
                currentUserContentParts,
              });
              messages = [...reassembled.messages];
              log.info(
                `[ai-chat-compact] pre-turn compact done, re-assembled conv=${conversationId} newEstimate=${reassembled.tokenEstimate}`
              );
            }
          } catch (err) {
            log.error(
              "[ai-chat-compact] pre-turn compact failed (continuing with original context):",
              err
            );
          }
        }
      }
      // G01-312: last prep gate before stream registration — an abort here
      // still precedes every loop dispatch.
      throwIfPrepAborted();
      const assembleInput = {
        conversationId,
        currentUserMessage: userMessageForModel,
        currentUserMessageId: savedUser.messageId,
        baseSystemPrompt: basePrompt,
        mode: (isPlanMode ? "plan" : "chat") as "plan" | "chat",
        model: request.model,
        maxTokens: request.maxTokens,
        planState,
        currentUserContentParts,
      };
      reassembleMessages = async () => {
        const again = await this.contextAssembler.assemble(assembleInput);
        return [...again.messages];
      };
    } catch (err) {
      log.error("[ai-chat-v2] pre-stream error:", err);
      // G01-312: prep aborted via Stop → controlled cancelled exit (the
      // loop never ran, nothing streamed). Any just-enrolled execution is
      // cancelled inside abortPrepExit — no orphan active row. Outer lets
      // (never bare try-assigned locals: the catch cannot prove those).
      if (prepAbortController?.signal.aborted) {
        await this.abortPrepExit({
          conversationId: request.conversationId ?? "",
          turnId: prepTurnId,
          assistantMessageId: prepAssistantMessageId,
          eventSink,
          executionId: prepExecutionId,
        });
        // abortPrepExit already emitted the terminal `cancelled` event —
        // the owner sees the explicit cancelled classification here.
        return {
          type: "cancelled",
          conversationId: request.conversationId ?? "",
          assistantMessageId: prepAssistantMessageId,
        };
      }
      // G01-312: prep failed — drop this turn's pending handle so a later
      // Stop cannot abort a dead controller (turnId-guarded, B11-safe).
      this.discardPendingTurn(request.conversationId ?? "", prepTurnId);
      // T09 (AC-28): the successor execution row was created before this
      // dispatch; a startup failure would leave it active forever. Cancel it
      // through the coordinator (fire-and-forget) so no orphan active row
      // remains, then surface the terminal error to the renderer.
      if (adoptedSuccessorExecutionId) {
        void new TaskExecutionCoordinator()
          .cancel(adoptedSuccessorExecutionId)
          .then((cancelResult) => {
            if (!cancelResult.ok && !cancelResult.alreadyFinalized) {
              log.error(
                `[ai-chat-v2] orphan successor cancel failed (executionId=${adoptedSuccessorExecutionId}): ${cancelResult.reasonCode ?? "unknown"}`
              );
            }
          })
          .catch((cancelErr: unknown) =>
            log.error(
              `[ai-chat-v2] orphan successor cancel threw (executionId=${adoptedSuccessorExecutionId}):`,
              cancelErr
            )
          );
      }
      this.clearActiveTurnState(request.conversationId ?? "");
      void redirectToLoginOnAuthExpired(err);
      eventSink.emit({
        type: "error",
        conversationId: request.conversationId ?? "",
        errorMessage: userSafeError(err),
      });
      return {
        type: "failed",
        conversationId: request.conversationId ?? "",
        assistantMessageId: "",
      };
    }

    // ------------------------------------------------------------------
    // 3-9. Run the turn (shared execution path; design §12.2)
    // ------------------------------------------------------------------
    // B11 (FR-21, AC-26): a reused/conflict/denied submission must NOT
    // abort the accepted original run. The enrollment seam above already
    // resolved `dedupShortCircuit` — return the accepted status WITHOUT
    // touching `activeTurns` so the original stream continues and only one
    // message/execution/provider dispatch exists.
    if (dedupShortCircuit) {
      if (dedupShortCircuit.kind === "conflict") {
        eventSink.emit({
          type: "error",
          conversationId,
          messageId: assistantMessageId,
          errorMessage: `SUBMISSION_CONFLICT: submissionId already accepted with different request content (executionId=${dedupShortCircuit.executionId})`,
        });
        return { type: "failed", conversationId, assistantMessageId };
      } else if (dedupShortCircuit.kind === "denied") {
        eventSink.emit({
          type: "error",
          conversationId,
          messageId: assistantMessageId,
          errorMessage: `TASK_CONTINUE_DENIED: ${dedupShortCircuit.reasonCode}`,
        });
        return { type: "failed", conversationId, assistantMessageId };
      } else {
        eventSink.emit({
          type: "complete",
          conversationId,
          messageId: assistantMessageId,
          fullContent: "",
          finishReason: "stop",
        });
        return { type: "completed", conversationId, assistantMessageId };
      }
    }
    // G01-312: a Stop that landed anywhere in prep wins over streaming —
    // exit controlled (abortPrepExit cancels any just-enrolled row) instead
    // of registering a turn the user already stopped.
    if (prepAbortController?.signal.aborted) {
      await this.abortPrepExit({
        conversationId: request.conversationId ?? "",
        turnId: prepTurnId,
        assistantMessageId: prepAssistantMessageId,
        eventSink,
        executionId: prepExecutionId,
      });
      return {
        type: "cancelled",
        conversationId: request.conversationId ?? "",
        assistantMessageId: prepAssistantMessageId,
      };
    }
    return await this.runPersistedTurn({
      conversationId,
      assistantMessageId,
      messages,
      request,
      eventSink,
      isPlanMode,
      planState,
      textApprovedPlanState,
      sourceUserMessageId,
      reassembleMessages,
      intentDecisionId,
      turnId,
      historySelectionAcceptedIds,
      historySelectionChangedIds,
      historySelectionRejectedIds,
      outboundSendPreAuthorized,
      taskExecutionBinding,
      taskRoute,
      ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
      ...(input.ownerNotifiesTerminal !== undefined
        ? { ownerNotifiesTerminal: input.ownerNotifiesTerminal }
        : {}),
      ...(input.onSegmentDurable ? { onSegmentDurable: input.onSegmentDurable } : {}),
    });
  }

  /**
   * @deprecated Outcome-swallowing wrapper for callers not yet migrated to
   * `runTurn` (generator-streaming PRD FR-013: legacy V2 send handler,
   * scheduled runner). Kept until those callers adopt the owner contract.
   */
  async submitMessage(input: AIChatQuerySubmitInput): Promise<void> {
    const outcome = await this.runTurn(input);
    if (outcome.type === "conversation_busy") {
      // The legacy direct path cannot queue; surface a clear error instead of
      // silently dropping the message. The queue service avoids this by
      // checking engine status before dispatch.
      input.eventSink.emit({
        type: "error",
        conversationId: outcome.conversationId,
        errorMessage:
          "This conversation is still working on the previous message. Please wait for it to finish or stop it.",
      });
    }
  }

  /**
   * Queue-dispatch entry point (design §12.1): run a turn for a user row the
   * pending queue already persisted. Assembles context from the stored
   * model-facing content, then delegates to the shared execution path and
   * returns the narrow terminal classification the queue service acts on.
   */
  async submitPersistedUserMessage(input: {
    readonly eventSink: AIChatQueryEventSink;
    readonly request: ChatV2StreamRequest;
    // (mode captured at the top of the body — see TODO-08 below)
    readonly savedUser: AIChatMessageEntity;
    readonly modelContent: string;
    readonly contentParts?:
      | Array<OpenAITextContentPart | OpenAIImageUrlContentPart>
      | undefined;
    readonly assistantMessageId?: string;
  }): Promise<AIChatTurnTerminalEvent> {
    // TODO-08: acceptance-time capture for queue-drained runs.
    this.captureStreamMode(input.savedUser.conversationId);
    const { eventSink, request, savedUser, modelContent } = input;
    const conversationId = savedUser.conversationId;
    const planModule = new AIChatPlanModule();

    let planState: AIChatPlanStateView | null = null;
    try {
      planState = await planModule.getPlanState(conversationId);
    } catch {
      // ignore lookup failures
    }
    const isPlanMode = request.mode === "plan" || isActivePlanState(planState);
    const module = new AIChatV2Module();

    // Queue-dispatched turns bypass submitMessage's persistence path, so bind
    // outbound-email intent here as well. This preserves the trusted
    // user-message/decision chain for the normal queued UI flow.
    let queuedIntentDecisionId: number | null = null;
    try {
      const intentModule = new OutboundEmailIntentModule();
      const existing = await intentModule.findBySource(
        conversationId,
        savedUser.messageId
      );
      const userAuthoredText = request.message || modelContent;
      const currentHash = hashUserAuthoredText(userAuthoredText);
      if (
        existing &&
        existing.sourceTextHash === currentHash &&
        existing.resolverVersion === OUTBOUND_RESOLVER_VERSION
      ) {
        queuedIntentDecisionId = existing.id;
      } else {
        const priorMessages = await module.getConversationMessages(
          conversationId
        );
        const decision = OutboundEmailIntentResolver.resolve(
          buildResolverInput(
            {
              conversationId,
              sourceUserMessageId: savedUser.messageId,
              userAuthoredText,
            },
            priorMessages
          )
        );
        const decisionFields = {
          mode: decision.mode,
          reasonCode: decision.reasonCode,
          confidence: decision.confidence,
          evidenceJson: JSON.stringify(decision.evidence),
          sourceTextHash: decision.sourceTextHash,
          resolverVersion: decision.resolverVersion,
        };
        if (existing) {
          await intentModule.updateDecision(existing.id, decisionFields);
          queuedIntentDecisionId = existing.id;
        } else {
          const persisted = await intentModule.create({
            conversationId,
            sourceUserMessageId: savedUser.messageId,
            ...decisionFields,
          } as OutboundEmailIntentEntity);
          queuedIntentDecisionId = persisted.id;
        }
      }
    } catch (err) {
      log.error("[outbound-email-intent] queued resolve failed:", err);
    }

    // Codex P2: queued turns resolve selected archive passages IDENTICALLY
    // to the direct path (§13.3) — opaque ids re-validate here (ownership/
    // epoch/budget), accepted excerpts fold into the model message, and the
    // ack ids ride the start event so the renderer's chips clear.
    let historySelectionAcceptedIds: readonly string[] = [];
    let historySelectionChangedIds: readonly string[] = [];
    let historySelectionRejectedIds: readonly string[] = [];
    let resolvedSelectionMetadata: readonly ChatV2HistorySelectionMetadata[] = [];
    let assemblyContent = modelContent;
    let selectedHistoryBlock = "";
    try {
      const selectionResolution = await this.resolveSelectedHistory(
        conversationId,
        savedUser.messageId,
        request.historySelectionIds ?? []
      );
      resolvedSelectionMetadata = selectionResolution.metadata;
      selectedHistoryBlock = buildSelectedHistoryContextBlock(
        selectionResolution.excerpts
      );
      if (selectedHistoryBlock.length > 0) {
        assemblyContent = `${modelContent}\n\n${selectedHistoryBlock}`;
      }
      historySelectionAcceptedIds = selectionResolution.metadata.map(
        (m) => m.sourceId
      );
      historySelectionChangedIds = selectionResolution.changedIds;
      historySelectionRejectedIds = selectionResolution.rejectedIds;
    } catch (err) {
      if (err instanceof RecoverableHistoryError) {
        // Turn-BLOCKING by contract (§13.3): the selected passages cannot fit
        // the budget — the user must narrow the selection. Re-throw so the
        // dispatch fails instead of silently running without the context the
        // chips already acknowledged.
        throw err;
      }
      // Non-capacity failures never block the turn (§13.3).
      log.error("[ai-chat-v2] queued history-selection resolve failed:", err);
    }

    // AC-18/G02: persist the ACCEPTED references onto the promoted user
    // row (references/provenance only — never the text; §13.3). The direct
    // path attaches this metadata at row creation; the queued path promotes
    // first and resolves after, so it merges here. Best-effort: a metadata
    // write failure logs but never blocks the turn.
    if (resolvedSelectionMetadata.length > 0) {
      try {
        await module.mergeMessageMetadata(savedUser.messageId, {
          historySelections: resolvedSelectionMetadata,
        } as Record<string, unknown>);
      } catch (metaErr) {
        log.error(
          "[ai-chat-v2] queued history-selection provenance persist failed:",
          metaErr
        );
      }
    }

    // Codex P2 (round 3): when persisted image contentParts exist, the
    // assembler uses THEM (not currentUserMessage) — fold the resolved
    // history block into the leading text part or the model never sees the
    // selected passages despite the chips acknowledging acceptance.
    const contentPartsForAssembly =
      input.contentParts && selectedHistoryBlock.length > 0
        ? input.contentParts.map((part, index) =>
            index === 0 && part.type === "text"
              ? { ...part, text: assemblyContent }
              : part
          )
        : input.contentParts;
    let messages: OpenAIChatMessage[];
    try {
      const basePrompt =
        request.systemPrompt ?? module.getDefaultSystemPrompt();
      const assembled = await this.contextAssembler.assemble({
        conversationId,
        currentUserMessage: assemblyContent,
        currentUserMessageId: savedUser.messageId,
        baseSystemPrompt: basePrompt,
        mode: isPlanMode ? "plan" : "chat",
        model: request.model,
        maxTokens: request.maxTokens,
        planState,
        currentUserContentParts: contentPartsForAssembly,
      });
      messages = [...assembled.messages];

      // Proactive pre-turn compact (same gate as submitMessage §2).
      const compactAgent = this.compactAgent;
      if (compactAgent && assembled.tokenEstimate > 0) {
        const contextWindow = await this.resolveContextWindowForModel(
          request.model
        );
        const threshold = Math.floor(
          AUTO_COMPACT_THRESHOLD_FRACTION * contextWindow
        );
        if (assembled.tokenEstimate >= threshold) {
          log.info(
            `[ai-chat-compact] pre-turn compact (queued) conv=${conversationId} estimate=${assembled.tokenEstimate} threshold=${threshold} window=${contextWindow}`
          );
          try {
            const compacted = await compactAgent.enqueueAutoCompact({
              conversationId,
              reason: "pre_turn_proactive",
              promptTokens: assembled.tokenEstimate,
              model: request.model,
            });
            if (compacted) {
              const reassembled = await this.contextAssembler.assemble({
                conversationId,
                currentUserMessage: assemblyContent,
                currentUserMessageId: savedUser.messageId,
                baseSystemPrompt: basePrompt,
                mode: isPlanMode ? "plan" : "chat",
                model: request.model,
                maxTokens: request.maxTokens,
                planState,
                currentUserContentParts: contentPartsForAssembly,
              });
              messages = [...reassembled.messages];
            }
          } catch (err) {
            log.error(
              "[ai-chat-compact] pre-turn compact failed (continuing with original context):",
              err
            );
          }
        }
      }
    } catch (err) {
      log.error("[ai-chat-v2] persisted-turn assembly error:", err);
      void redirectToLoginOnAuthExpired(err);
      eventSink.emit({
        type: "error",
        conversationId,
        errorMessage: userSafeError(err),
      });
      return { type: "failed", conversationId, assistantMessageId: "" };
    }

    const assistantMessageId =
      input.assistantMessageId ??
      `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return await this.runPersistedTurn({
      historySelectionAcceptedIds,
      historySelectionChangedIds,
      historySelectionRejectedIds,
      conversationId,
      assistantMessageId,
      messages,
      request,
      eventSink,
      isPlanMode,
      planState,
      textApprovedPlanState: null,
      scheduledContext: undefined,
      sourceUserMessageId: savedUser.messageId,
      intentDecisionId: queuedIntentDecisionId,
    });
  }

  /**
   * Phase 1 of steering acceptance: synchronously reserve the running turn
   * for one pending message. Returns null when the conversation has no
   * steerable (running, mailbox-equipped) turn (design §10.3).
   */
  reserveSteering(
    conversationId: string,
    pendingMessageId: string
  ): AIChatSteeringReservation | null {
    const entry = this.activeTurns.get(conversationId);
    if (!entry || !entry.control) return null;
    return entry.control.reserve(pendingMessageId);
  }

  /**
   * Drop an uncommitted steering reservation (the DB claim failed). No-op
   * when the turn already closed.
   */
  cancelSteeringReservation(
    conversationId: string,
    reservation: AIChatSteeringReservation
  ): void {
    const entry = this.activeTurns.get(conversationId);
    entry?.control?.cancelReservation(reservation.reservationId);
  }

  /**
   * Phase 3 of steering acceptance: commit the DB-claimed instruction into
   * the turn's mailbox. Returns false when the turn closed first — the
   * caller must restore the row to queued.
   */
  commitSteering(
    conversationId: string,
    reservation: AIChatSteeringReservation,
    instruction: AIChatSteeringInstruction
  ): boolean {
    const entry = this.activeTurns.get(conversationId);
    if (!entry || !entry.control) return false;
    if (entry.assistantMessageId !== reservation.targetAssistantMessageId) {
      return false;
    }
    return entry.control.commit(reservation, instruction);
  }

  /**
   * Shared turn execution (design §12.2): SessionStart hook, tool catalog,
   * active-turn registration, start event, plan context, prompt hook, loop
   * run, and result handling. Returns the terminal classification.
   *
   * CONVERSATION_BUSY (design §12.3): an active/pending turn already owns
   * the conversation. The prior-turn REPLACEMENT behavior is removed — a
   * late queue drain must never replace a newer turn; only explicit Stop
   * aborts an active turn.
   */
  private async runPersistedTurn(input: {
    readonly conversationId: string;
    readonly assistantMessageId: string;
    readonly messages: OpenAIChatMessage[];
    readonly request: ChatV2StreamRequest;
    readonly eventSink: AIChatQueryEventSink;
    readonly isPlanMode: boolean;
    readonly planState: AIChatPlanStateView | null;
    readonly textApprovedPlanState: AIChatPlanStateView | null;
    readonly scheduledContext?: AIChatScheduledTurnContext;
    readonly sourceUserMessageId?: string;
    readonly intentDecisionId?: number | null;
    readonly turnId?: string;
    readonly historySelectionAcceptedIds?: readonly string[];
    readonly historySelectionChangedIds?: readonly string[];
    readonly historySelectionRejectedIds?: readonly string[];
    readonly reassembleMessages?: (() => Promise<OpenAIChatMessage[]>) | null;
    readonly outboundSendPreAuthorized?: boolean;
    readonly lifecycle?: AIChatTurnLifecycleListener;
    readonly ownerNotifiesTerminal?: boolean;
    readonly onSegmentDurable?: (
      conversationId: string,
      outcome: "completed" | "cancelled" | "failed"
    ) => Promise<void>;
    /** Completion-policy binding (T02/Slice 2), threaded from runTurn. */
    readonly taskExecutionBinding?: LoopTaskExecutionBinding;
    /** T15 route classification, threaded from runTurn. */
    readonly taskRoute?: TaskExecutionRoute;
  }): Promise<AIChatTurnTerminalEvent> {
    const {
      conversationId,
      assistantMessageId,
      messages,
      request,
      eventSink,
      isPlanMode,
      planState,
      textApprovedPlanState,
      sourceUserMessageId,
      intentDecisionId,
      turnId,
      historySelectionAcceptedIds,
      historySelectionChangedIds,
      historySelectionRejectedIds,
      reassembleMessages,
      outboundSendPreAuthorized,
      lifecycle,
      ownerNotifiesTerminal,
      onSegmentDurable,
      taskExecutionBinding,
      taskRoute,
    } = input;
    const module = new AIChatV2Module();
    const planModule = new AIChatPlanModule();

    // Busy gate (§12.3): never replace an in-flight turn.
    if (
      this.activeTurns.has(conversationId) ||
      this.pendingPermissions.has(conversationId) ||
      this.pendingPlanQuestions.has(conversationId)
    ) {
      return { type: "conversation_busy", conversationId };
    }

    // ------------------------------------------------------------------
    // Lifecycle hooks: SessionStart (once per conversation)
    // ------------------------------------------------------------------
    if (!this.startedConversations.has(conversationId)) {
      this.startedConversations.add(conversationId);
      try {
        const aggregate = await HookDispatcher.executeHooks({
          eventName: "SessionStart",
          input: {
            eventName: "SessionStart",
            hookRunId: `hookrun-session-${conversationId}`,
            source: "ai-chat-v2",
            conversationId,
            timestamp: new Date().toISOString(),
            mode: isPlanMode ? "plan" : "chat",
          },
        });
        for (const content of [
          ...aggregate.systemMessages,
          ...aggregate.additionalContexts,
        ]) {
          messages.push({ role: "system", content });
        }
      } catch {
        // Hook errors are non-fatal
      }
    }

    // ------------------------------------------------------------------
    // Resolve tools (skills + plan mode tools)
    // ------------------------------------------------------------------
    const allToolFunctions = await SkillRegistry.getAllToolFunctions();
    // Scheduled (unattended) profiles scope the advertised catalog to
    // task-policy-approved tools so the model only sees tools it may call
    // (FR-16); the executeTool guard remains the safety backstop.
    const toolFunctions = this.toolFilter
      ? allToolFunctions.filter((t) => this.toolFilter!(t.name))
      : allToolFunctions;
    const openAITools = toOpenAITools(toolFunctions);

    // Resolve auto-plan config. Only active in plain chat mode (not when the
    // conversation is already in plan mode), only when AI is enabled, and only
    // when USER_AI_AUTO_PLAN is not explicitly "false" (default-on).
    // An approved plan also blocks auto-entry: its execution rounds run in
    // chat mode (isActivePlanState is false), but EnterPlanMode would be
    // guaranteed to fail there — ensurePlanForConversation resolves the
    // approved plan and handleEnterPlanMode rejects re-entry — so advertising
    // the tool mid-execution only invites a doomed call.
    const tokenService = new Token();
    const autoPlanEnabled =
      !isPlanMode &&
      planState?.status !== "approved" &&
      tokenService.getValue(USER_AI_ENABLED) === "true" &&
      tokenService.getValue(USER_AI_AUTO_PLAN) !== "false";

    const planTools = PlanModeToolRegistry.toOpenAITools();
    const allOpenAITools = isPlanMode
      ? [...openAITools, ...planTools]
      : autoPlanEnabled
      ? [...openAITools, ENTER_PLAN_MODE_TOOL]
      : openAITools;

    // Build the deferred tool catalog (no-op when AI_TOOL_SEARCH is off or the
    // auto-mode threshold is not crossed). Fresh turn starts with no discovered
    // tools; the loop accumulates discovery state in memory.
    const toolCatalogContext = this.buildToolCatalogForTurn({
      tools: allOpenAITools,
      conversationId,
      isPlanMode,
      autoPlanEnabled,
      userMessage: request.message,
      recentUserMessages: collectRecentUserMessages(messages),
      model: request.model,
      hasRecentGeneratedImages: messagesHaveGeneratedImages(messages),
      contextWindowTokens: await this.resolveContextWindowTokens(request.model),
    });

    // Load persisted discovered-tool state so tools discovered in earlier turns
    // (before an app restart / conversation reload) remain exposed (FR-5/AC-8).
    const persistedToolCatalogState = toolCatalogContext.toolCatalog
      ? await this.conversationToolStateService.loadSnapshot(conversationId)
      : undefined;

    // ------------------------------------------------------------------
    // Register the turn. A steering mailbox is attached only when the engine
    // has a steering promoter AND this is an interactive turn (scheduled
    // turns are not steerable in v1). B11 dedup/prep-abort gates run in
    // runTurn before this handoff (they consume runTurn's prep scope).
    // ------------------------------------------------------------------
    const abortController = new AbortController();
    const control = this.steeringPromoter
      ? new AIChatTurnControl(async ({ instruction, boundary }) => {
          await this.steeringPromoter!({ instruction, boundary });
        }, assistantMessageId)
      : undefined;
    this.activeTurns.set(conversationId, {
      abortController,
      assistantMessageId,
      turnId,
      eventSink,
      partialContent: "",
      ...(control ? { control } : {}),
    });
    // G01-312: promotion — the pending handle served its purpose.
    this.discardPendingTurn(conversationId, turnId ?? "");
    this.pendingPermissions.delete(conversationId);
    this.pendingPlanQuestions.delete(conversationId);

    // ------------------------------------------------------------------
    // Emit start event
    // ------------------------------------------------------------------
    eventSink.emit({
      type: "start",
      conversationId,
      messageId: assistantMessageId,
      historySelectionAcceptedIds,
      historySelectionChangedIds,
      historySelectionRejectedIds,
    });
    if (textApprovedPlanState) {
      eventSink.emit({
        type: "plan_state",
        conversationId,
        messageId: assistantMessageId,
        planState: textApprovedPlanState,
      });
    }

    // ------------------------------------------------------------------
    // Build plan context if in plan mode
    // ------------------------------------------------------------------
    const planContext: AIChatPlanLoopContext | undefined =
      isPlanMode && planState
        ? {
            planModule: {
              saveQuestion: (inp) => planModule.saveQuestion(inp),
              submitPlanForApproval: (inp) =>
                planModule.submitPlanForApproval(inp),
              getPlanStateByPlanId: (planId) =>
                planModule.getPlanStateByPlanId(planId),
              answerQuestion: (inp) => planModule.answerQuestion(inp),
            },
            planState,
          }
        : undefined;

    // ------------------------------------------------------------------
    // UserPromptSubmit lifecycle hook
    // ------------------------------------------------------------------
    HookDispatcher.executeHooks({
      eventName: "UserPromptSubmit",
      input: {
        eventName: "UserPromptSubmit",
        hookRunId: `hookrun-prompt-${conversationId}-${Date.now()}`,
        source: "ai-chat-v2",
        conversationId,
        timestamp: new Date().toISOString(),
        prompt: request.message,
        mode: isPlanMode ? "plan" : "chat",
      },
    }).catch(() => {
      // Hook errors are non-fatal
    });

    // ------------------------------------------------------------------
    // Run the loop
    // ------------------------------------------------------------------
    const streamEventSink = this.createPersistingEventSink(module, eventSink);
    const loopInput: AIChatQueryLoopInput = {
      conversationId,
      assistantMessageId,
      messages,
      request,
      openAITools: allOpenAITools,
      abortController,
      eventSink: streamEventSink,
      skillRegistry: SkillRegistry,
      planContext,
      autoPlan: autoPlanEnabled
        ? {
            planModule: new AIChatPlanModule(),
            planTools,
          }
        : undefined,
      startRound: 0,
      isActiveTurn: () => {
        const entry = this.activeTurns.get(conversationId);
        return !!entry && entry.assistantMessageId === assistantMessageId;
      },
      toolCatalog: toolCatalogContext.toolCatalog,
      toolCatalogModeDecision: toolCatalogContext.toolCatalogModeDecision,
      toolCatalogState: persistedToolCatalogState,
      ...(control ? { steeringControl: control } : {}),
      sourceUserMessageId,
      intentDecisionId,
      turnId,
      outboundSendPreAuthorized,
      goalAutoContinue: await this.shouldAutoContinueGoal(
        conversationId,
        isPlanMode,
        taskRoute
      ),
      ...(lifecycle ? { lifecycle } : {}),
      ...(ownerNotifiesTerminal !== undefined
        ? { ownerNotifiesTerminal }
        : {}),
      relieveBudgetPressure: async () => {
        await this.compactBeforeDispatch(conversationId, request.model);
        return reassembleMessages ? reassembleMessages() : null;
      },
      taskExecutionBinding,
      // T15: thread the route into the loopInput so the loop's
      // paused_for_permission / paused_for_plan_question pending state
      // carries it across the pause for the resumed goalAutoContinue consult.
      taskRoute,
    };

    // B11 early return above already handled reused/conflict/denied without
    // touching activeTurns; reaching here means a fresh dispatch.
    try {
      // R04 (FR-018/AC-14): READ the acceptance-time pin — recapturing here
      // (after async preparation) let a provider change mid-preparation flip
      // an already-accepted run's delivery mode.
      const streamMode = this.pinnedStreamMode(conversationId);
      const result = await this.runLoopSegment(
        this.loop,
        loopInput,
        streamMode
      );
      await this.handleLoopResult(result, module, streamEventSink, {
        ownerNotifiesTerminal: ownerNotifiesTerminal === true,
        ...(onSegmentDurable ? { onSegmentDurable } : {}),
      }, taskExecutionBinding);
      if (result.type === "paused_for_permission") {
        return {
          type: "paused_for_permission",
          conversationId,
          assistantMessageId,
        };
      }
      if (result.type === "paused_for_plan_question") {
        return {
          type: "paused_for_plan_question",
          conversationId,
          assistantMessageId,
        };
      }
      return {
        type: result.type,
        conversationId,
        assistantMessageId,
      };
    } catch (err) {
      await this.handleFailure(
        err,
        conversationId,
        assistantMessageId,
        eventSink,
        taskExecutionBinding
      );
      return { type: "failed", conversationId, assistantMessageId };
    } finally {
      control?.close();
      // Clear this turn's map entry unless it was paused (permission/plan
      // question handlers move the entry into the pending maps themselves).
      // Only delete when the current entry still points at THIS turn AND
      // the conversation has not been paused.
      const entry = this.activeTurns.get(conversationId);
      const paused =
        this.pendingPermissions.has(conversationId) ||
        this.pendingPlanQuestions.has(conversationId);
      if (entry && entry.assistantMessageId === assistantMessageId && !paused) {
        this.activeTurns.delete(conversationId);
      }
    }
  }

  /**
   * Stage B §6/§8 (FR-001/018): generator-mode consumption. Drains
   * iterate() through the result-preserving consumer; required writes
   * (tool_call / tool_result) are AWAITED before the generator advances, so
   * the tool never starts before its call row is durable and a save failure
   * (AIChatRequiredPersistenceError) fails the segment instead of the tool
   * running. Consumer failure aborts the producer (turn controller) first.
   * The forced-close value is never routed as success.
   */
  private async runLoopSegment(
    loop: AIChatQueryLoop,
    loopInput: AIChatQueryLoopInput,
    mode: AIChatStreamImplementationMode
  ): Promise<AIChatQueryLoopResult> {
    if (mode === "callback") {
      return await loop.run(loopInput);
    }
    const { eventSink: _sink, ...restInput } = loopInput;
    void _sink;
    // Auxiliary channel for closure-scope emits inside awaited helpers
    // (G01-313 badge): the generator cannot yield while suspended in an
    // await, so helpers push through the turn's real sink instead.
    const generatorInput: import("@/service/AIChatQueryEvents").AIChatQueryGeneratorInput =
      {
        ...restInput,
        emitAuxiliary: (event) => {
          loopInput.eventSink.emit(event);
        },
      };
    return await consumeGenerator(
      loop.iterate(generatorInput),
      async (event) => {
        loopInput.eventSink.emit(event);
        if (event.type === "tool_call" || event.type === "tool_result") {
          // §8 table: forward, then await the required write before the
          // generator advances (persist-before-execute / before dependent
          // model work). flush() rejects on save failure.
          await loopInput.eventSink.flush?.();
        }
      },
      (reason: unknown) => {
        // Synchronous, non-throwing: abort the producer's underlying work.
        try {
          loopInput.abortController.abort();
        } catch {
          // never masks the primary error
        }
        void reason;
      },
      (cleanupError: unknown) => {
        log.error("[ai-chat-v2] generator cleanup failed:", cleanupError);
      }
    );
  }

  private async resolveContextWindowTokens(
    model?: string
  ): Promise<number | undefined> {
    if (process.env.VITEST === "true") {
      return undefined;
    }
    return this.modelCatalogService.getContextWindow(model);
  }

  async denyToolPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult> {
    const convId = request.conversationId;
    const lookupKey = convId ?? undefined;
    const pending = lookupKey
      ? this.pendingPermissions.get(lookupKey)
      : this.firstEntry(this.pendingPermissions);
    const matchedByToolId =
      pending && pending.toolCallId === request.toolId ? pending : undefined;
    if (!matchedByToolId) {
      return {
        ok: false,
        error: "No active permission-gated tool call to continue.",
      };
    }
    if (
      request.conversationId &&
      request.conversationId !== matchedByToolId.conversationId
    ) {
      return {
        ok: false,
        error: "Conversation mismatch for pending tool call.",
      };
    }

    const conversationId = matchedByToolId.conversationId;
    this.pendingPermissions.delete(conversationId);
    const denySink = this.takePendingSink(conversationId);
    this.activeTurns.set(conversationId, {
      abortController: matchedByToolId.abortController,
      assistantMessageId: matchedByToolId.assistantMessageId,
      turnId: matchedByToolId.turnId,
      eventSink: denySink,
      partialContent:
        (matchedByToolId as { streamedPartial?: string }).streamedPartial ?? "",
    });
    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(module, denySink);

    try {
      // Synthesize the denied tool result — do NOT re-execute the tool. The
      // renderer's deny path (AiChatV2.vue handleSkillPermissionDeny) already
      // expects a denied-message content, so we match that shape here.
      const deniedPayload = {
        success: false,
        executionTimeMs: 0,
        error: "Permission denied. The tool will not be executed.",
      };
      const toolContent = JSON.stringify(deniedPayload);
      eventSink.emit({
        type: "tool_result",
        conversationId,
        messageId: matchedByToolId.assistantMessageId,
        toolCallId: matchedByToolId.toolCallId,
        toolName: matchedByToolId.toolName,
        fullContent: toolContent,
        toolResult: deniedPayload,
        replacesPermissionPromptForToolId: matchedByToolId.toolCallId,
      });
      // Review F4 (FR-006): the denied result is a REQUIRED write — await
      // it before any continuation, exactly like the approve path.
      await this.flushEventSaves(eventSink);

      matchedByToolId.conversationMessages.push({
        role: "tool",
        tool_call_id: matchedByToolId.toolCallId,
        content: toolContent,
      });

      // Rebuild the deferred catalog (mirrors resumeToolAfterPermission).
      const resumeCatalogContext = this.buildToolCatalogForTurn({
        tools: matchedByToolId.openAITools,
        conversationId,
        isPlanMode: Boolean(matchedByToolId.planContext),
        autoPlanEnabled: false,
        userMessage: matchedByToolId.request.message,
        recentUserMessages: collectRecentUserMessages(
          matchedByToolId.conversationMessages
        ),
        model: matchedByToolId.request.model,
        contextWindowTokens: await this.resolveContextWindowTokens(
          matchedByToolId.request.model
        ),
      });

      const loopInput: AIChatQueryLoopInput = {
        conversationId,
        assistantMessageId: matchedByToolId.assistantMessageId,
        messages: matchedByToolId.conversationMessages,
        request: matchedByToolId.request,
        openAITools: matchedByToolId.openAITools,
        abortController: matchedByToolId.abortController,
        eventSink,
        skillRegistry: SkillRegistry,
        planContext: matchedByToolId.planContext,
        startRound: matchedByToolId.nextRound,
        isActiveTurn: () => {
          const entry = this.activeTurns.get(conversationId);
          return (
            !!entry &&
            entry.assistantMessageId === matchedByToolId.assistantMessageId
          );
        },
        toolCatalog: resumeCatalogContext.toolCatalog,
        toolCatalogModeDecision: resumeCatalogContext.toolCatalogModeDecision,
        toolCatalogState: matchedByToolId.toolCatalogState,
        sourceUserMessageId: matchedByToolId.sourceUserMessageId,
        intentDecisionId: matchedByToolId.intentDecisionId,
        turnId: matchedByToolId.turnId,
        outboundSendPreAuthorized: matchedByToolId.outboundSendPreAuthorized,
        // Slice 2 (§7/§9): the denied continuation consults under the SAME
        // execution — budget persists across the pause; no new row.
        taskExecutionBinding: matchedByToolId.taskExecutionBinding,
        // T15: the resumed goalAutoContinue consult must keep gating on the
        // actual route (a response_only resume is not goal-scoped work).
        taskRoute: matchedByToolId.taskRoute,
        goalAutoContinue: await this.shouldAutoContinueGoal(
          conversationId,
          Boolean(matchedByToolId.planContext),
          matchedByToolId.taskRoute
        ),
      };

      // Review F4 (FR-018): the deny continuation honors the run's pinned
      // delivery mode instead of raw loop.run.
      const denyMode = this.pinnedStreamMode(conversationId);
      void this.runLoopSegment(this.loop, loopInput, denyMode)
        .then(async (result) => {
          await this.handleLoopResult(result, module, eventSink);
        })
        .catch((err) => {
          log.error("[ai-chat-v2] deny-resume loop failed:", err);
          void redirectToLoginOnAuthExpired(err);
          denySink.emit({
            type: "error",
            conversationId,
            messageId: matchedByToolId.assistantMessageId,
            errorMessage: userSafeError(err),
          });
          this.clearConversationTurnState(conversationId);
        });

      return { ok: true };
    } catch (err) {
      this.clearActiveTurnState(conversationId);
      return { ok: false, error: userSafeError(err) };
    }
  }

  private dispatchStop(
    conversationId: string | undefined,
    reason: "completed" | "user_stopped" | "error"
  ): void {
    HookDispatcher.executeHooks({
      eventName: "Stop",
      input: {
        eventName: "Stop",
        hookRunId: `hookrun-stop-${conversationId ?? "unknown"}-${Date.now()}`,
        source: "ai-chat-v2",
        conversationId,
        timestamp: new Date().toISOString(),
        reason,
      },
    }).catch(() => {
      // Hook errors are non-fatal
    });
  }

  /**
   * Stop the active turn(s).
   *
   * - With `conversationId`: stops ONLY that conversation — aborts its active
   *   controller, cancels any pending permission/plan-question for it, and
   *   emits `cancelled` on the pending sink. Does NOT touch other
   *   conversations' background turns. The active-loop's own `cancelled` path
   *   handles emit/persist for running turns (so we do not emit here for
   *   active streaming turns — only for pending-permission/plan-question turns
   *   which have no running loop to resolve).
   * - Without `conversationId`: stops ALL active + pending turns across every
   *   conversation (used by DB switch / unmount).
   */
  stopActiveTurn(conversationId?: string): void {
    if (conversationId) {
      this.stopConversation(conversationId);
      return;
    }
    // Stop-all: iterate over snapshots so deletion during iteration is safe.
    for (const id of [...this.activeTurns.keys()]) {
      this.stopConversation(id);
    }
    for (const id of [...this.pendingPermissions.keys()]) {
      this.stopConversation(id);
    }
    for (const id of [...this.pendingPlanQuestions.keys()]) {
      this.stopConversation(id);
    }
    for (const id of [...this.claimedPending.keys()]) {
      this.clearClaimedPending(id);
    }
  }

  /**
   * Stop a single conversation's active or pending turn. Only emits `cancelled`
   * for pending-permission / pending-plan-question turns — running streaming
   * turns are aborted and their loop resolves `cancelled`, which emits + persists.
   *
   * Unit 7 (FR-22/23, AC-24): when the completion policy is on and this
   * conversation has a bound execution (enrolled at the submission seam), the
   * execution is cancelled through the coordinator BEFORE any controller is
   * aborted — the row finalizes cancelled/USER_CANCELLED while still owned,
   * so a stop during checking/recovery can never produce a late
   * verified_complete. The in-flight consult (if any) sees its fetch abort
   * and returns unknown criteria; the controller's finish decision then
   * hits ALREADY_FINALIZED and no-ops. Covers all three turn shapes: active
   * streaming, paused-for-permission, and paused-for-plan-question — a paused
   * turn's execution stays enrolled, so Stop must cancel it too.
   */
  private stopConversation(conversationId: string): void {
    if (!this.stopHooksDispatched.has(conversationId)) {
      this.stopHooksDispatched.add(conversationId);
      this.dispatchStop(conversationId, "user_stopped");
    }
    // G01-312: a turn still in pre-stream prep has no activeTurns entry yet
    // — abort its pending handle so the next stage boundary exits before
    // any loop dispatch (the exit path emits cancelled + cancels any
    // just-enrolled row). Enrolled-execution cancellation below covers the
    // post-enrollment case via the binding map.
    const pending = this.pendingTurns.get(conversationId);
    if (pending) {
      this.pendingTurns.delete(conversationId);
      pending.abortController.abort();
    }
    // T16: check the FROZEN flag-at-enrollment value, not the live runtime
    // flag. An execution enrolled while the flag was on stays accepted for
    // Stop-cancel even if the flag was turned off midstream — otherwise
    // the row would never be finalized cancelled and a late complete emit
    // could convert accepted unfinished work to unchecked success
    // (NFR-12, AC-12/32).
    if (this.policyAcceptedConversations.has(conversationId)) {
      const boundExecutionId = this.taskExecutionBindings.get(conversationId);
      // The binding is consumed: a second Stop click (or the loop's own
      // cancelled resolution) must not double-finalize.
      this.taskExecutionBindings.delete(conversationId);
      this.policyAcceptedConversations.delete(conversationId);
      // D-slot leak fix: the Stop path finalizes (cancels) the enrolled
      // execution. The decision slot is keyed by executionId and must be
      // dropped with the binding so it cannot leak on the singleton.
      if (boundExecutionId) {
        this.taskDecisionSlots.delete(boundExecutionId);
      }
      if (boundExecutionId) {
        // T12: a Stop-cancel write failure must NOT be swallowed silently.
        // The row may stay `running` with no durable outcome — surface it
        // as a recoverable persistence error event so the renderer can show
        // the user the durable record is suspect and restart-time repair
        // (AC-24/25) is required. Fire-and-forget: Stop must return
        // promptly so the UI aborts the streaming turn without waiting on
        // the durable write, but the error is emitted (not just logged).
        const cancelSink = this.pendingPermissions.get(conversationId)?.eventSink
          ?? this.pendingPlanQuestions.get(conversationId)?.eventSink
          ?? this.activeTurns.get(conversationId)?.eventSink;
        void new TaskExecutionCoordinator()
          .cancel(boundExecutionId)
          .then((cancelResult) => {
            if (!cancelResult.ok && !cancelResult.alreadyFinalized) {
              console.error(
                `[ai-chat-v2] task-execution cancel failed (executionId=${boundExecutionId}): ${cancelResult.reasonCode ?? "unknown"}`
              );
              cancelSink?.emit({
                type: "error",
                conversationId,
                messageId: this.activeTurns.get(conversationId)?.assistantMessageId,
                errorMessage: `Task cancel persistence failed (${cancelResult.reasonCode ?? "unknown"}); the execution row may need restart-time repair.`,
                taskOutcome: "cancelled",
                taskExecutionId: boundExecutionId,
                taskReasonCode: cancelResult.reasonCode ?? "CANCEL_FAILED",
              });
            }
          })
          .catch((err: unknown) => {
            console.error(
              `[ai-chat-v2] task-execution cancel threw (executionId=${boundExecutionId}):`,
              err
            );
            cancelSink?.emit({
              type: "error",
              conversationId,
              messageId: this.activeTurns.get(conversationId)?.assistantMessageId,
              errorMessage: `Task cancel persistence threw; the execution row may need restart-time repair.`,
              taskOutcome: "cancelled",
              taskExecutionId: boundExecutionId,
              taskReasonCode: "CANCEL_THREW",
            });
          });
      }
    }
    const pendingPermission = this.pendingPermissions.get(conversationId);
    if (pendingPermission) {
      const permSink =
        this.pendingSinks.get(conversationId) ?? pendingPermission.eventSink;
      this.pendingPermissions.delete(conversationId);
      this.pendingSinks.delete(conversationId);
      this.runStreamModes.delete(conversationId);
      this.stopHooksDispatched.delete(conversationId);
      pendingPermission.abortController.abort();
      permSink?.emit({
        type: "cancelled",
        conversationId: pendingPermission.conversationId,
        messageId: pendingPermission.assistantMessageId,
        fullContent: "",
      });
    }
    const pendingPlanQuestion = this.pendingPlanQuestions.get(conversationId);
    if (pendingPlanQuestion) {
      // R06 (FR-013/015): capture the sink BEFORE deleting the map entry —
      // delete-then-read emitted nothing, so compatibility callers waiting
      // on the pending sink never received the cancelled terminal.
      const questionSink =
        this.pendingSinks.get(conversationId) ?? pendingPlanQuestion.eventSink;
      this.pendingPlanQuestions.delete(conversationId);
      this.pendingSinks.delete(conversationId);
      this.runStreamModes.delete(conversationId);
      this.stopHooksDispatched.delete(conversationId);
      pendingPlanQuestion.abortController.abort();
      questionSink?.emit({
        type: "cancelled",
        conversationId: pendingPlanQuestion.conversationId,
        messageId: pendingPlanQuestion.assistantMessageId,
        fullContent: "",
      });
    }
    const active = this.activeTurns.get(conversationId);
    if (active) {
      // Abort the controller; do NOT delete the entry — the loop's own
      // `cancelled` resolution path calls handleLoopResult which clears it.
      // Pre-deleting would make isActiveTurn return false inside the loop.
      active.abortController.abort();
    }
  }

  /** Stage A §3.5: stop-all also invalidates claimed (undispatched) resumes. */
  private clearClaimedPending(conversationId: string): void {
    const claimed = this.claimedPending.get(conversationId);
    if (!claimed) return;
    this.claimedPending.delete(conversationId);
    claimed.pending.abortController.abort();
  }

  // -------------------------------------------------------------------------
  // Resume methods
  // -------------------------------------------------------------------------

  /**
   * Stage A §3.5 (generator-streaming PRD FR-010/024): idempotent claim of a
   * pending permission. Only one resume claims a given action; duplicates and
   * stale tool ids never re-execute the tool.
   */
  claimPendingPermission(
    conversationId: string,
    toolId: string
  ): AIChatPendingClaim {
    return this.claimPending(
      conversationId,
      "permission",
      this.pendingPermissions,
      (pending) => pending.toolCallId === toolId
    );
  }

  /**
   * Stage A §3.5: idempotent claim of a pending plan question. The answer is
   * persisted by the caller BEFORE claiming (existing semantics).
   */
  claimPendingQuestion(
    conversationId: string,
    questionId: string
  ): AIChatPendingClaim {
    return this.claimPending(
      conversationId,
      "question",
      this.pendingPlanQuestions,
      (pending) => pending.questionId === questionId
    );
  }

  /**
   * Cancel a claimed-but-not-yet-resumed pending action (Stop while the
   * resume waits for scheduler capacity): the approved tool never starts and
   * the turn is finalized cancelled by its owner (FR-024).
   */
  cancelClaimed(conversationId: string): boolean {
    const claimed = this.claimedPending.get(conversationId);
    if (!claimed) return false;
    this.claimedPending.delete(conversationId);
    this.runStreamModes.delete(conversationId);
    this.stopHooksDispatched.delete(conversationId);
    claimed.pending.abortController.abort();
    const sink = this.takePendingSink(conversationId);
    sink.emit({
      type: "cancelled",
      conversationId: claimed.pending.conversationId,
      messageId: claimed.pending.assistantMessageId,
      fullContent: "",
    });
    return true;
  }

  private claimPending<P extends PendingPermissionTurn | PendingPlanQuestionTurn>(
    conversationId: string,
    kind: "permission" | "question",
    map: Map<string, P>,
    matches: (pending: P) => boolean
  ): AIChatPendingClaim {
    const existingClaim = this.claimedPending.get(conversationId);
    if (existingClaim) {
      // Same action claimed again → idempotent duplicate. A DIFFERENT id
      // while another claim holds the conversation is stale, not a dup.
      return matches(existingClaim.pending as P)
        ? { status: "already_claimed" }
        : { status: "not_found" };
    }
    const pending = map.get(conversationId);
    if (!pending || !matches(pending)) {
      return { status: "not_found" };
    }
    map.delete(conversationId);
    this.claimedPending.set(conversationId, { kind, pending });
    const base = {
      status: "claimed" as const,
      kind,
      conversationId,
      assistantMessageId: pending.assistantMessageId,
      pending,
    };
    return kind === "permission"
      ? {
          ...base,
          toolCallId: (pending as PendingPermissionTurn).toolCallId,
        }
      : {
          ...base,
          questionId: (pending as PendingPlanQuestionTurn).questionId,
        };
  }

  /**
   * Stage A §3.5: execute a claimed resume and RETURN its segment outcome —
   * the continuation is owner-observed, never a fire-and-forget promise.
   * `options.eventSink` lets the run owner redirect events to its live run
   * sink (sequence continuity); `options.lifecycle` receives onResumed.
   */
  async resumeClaimed(
    claim: Extract<AIChatPendingClaim, { status: "claimed" }>,
    options?: {
      readonly eventSink?: AIChatQueryEventSink;
      readonly lifecycle?: AIChatTurnLifecycleListener;
      readonly onSegmentDurable?: (
        conversationId: string,
        outcome: "completed" | "cancelled" | "failed"
      ) => Promise<void>;
    }
  ): Promise<AIChatSegmentOutcome> {
    if (claim.kind === "permission") {
      return this.resumeClaimedPermission(
        claim.pending as PendingPermissionTurn,
        options
      );
    }
    return this.resumeClaimedQuestion(
      claim.pending as PendingPlanQuestionTurn,
      options
    );
  }

  /** Permission continuation (extracted from the legacy resume path). */
  private async resumeClaimedPermission(
    matchedByToolId: PendingPermissionTurn,
    options?: {
      readonly eventSink?: AIChatQueryEventSink;
      readonly lifecycle?: AIChatTurnLifecycleListener;
      readonly onSegmentDurable?: (
        conversationId: string,
        outcome: "completed" | "cancelled" | "failed"
      ) => Promise<void>;
    }
  ): Promise<AIChatSegmentOutcome> {
    const conversationId = matchedByToolId.conversationId;
    const lifecycle = options?.lifecycle ?? matchedByToolId.lifecycle;
    // The claim is consumed by this execution: duplicates during the
    // continuation are rejected (never re-executed).
    this.claimedPending.delete(conversationId);
    const baseSink = options?.eventSink ?? this.takePendingSink(conversationId);
    this.activeTurns.set(conversationId, {
      abortController: matchedByToolId.abortController,
      assistantMessageId: matchedByToolId.assistantMessageId,
      eventSink: baseSink,
      partialContent:
        (matchedByToolId as { streamedPartial?: string }).streamedPartial ?? "",
      ...(lifecycle ? { lifecycle } : {}),
    });
    // Stage A §3.2 (FR-021): the claimed resume starts executing now.
    this.notifyResumed(lifecycle, {
      conversationId: matchedByToolId.conversationId,
      assistantMessageId: matchedByToolId.assistantMessageId,
    });
    // G01-313: the turn is really running again — restore the `active`
    // badge (it showed `waiting_permission` while parked). Enrolled turns
    // only; the binding map survives the pause.
    const resumedExecutionId =
      this.taskExecutionBindings.get(conversationId);
    if (resumedExecutionId && matchedByToolId.eventSink) {
      matchedByToolId.eventSink.emit({
        type: "task_execution_state",
        conversationId,
        executionId: resumedExecutionId,
        status: "active",
      });
    }
    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(module, baseSink);

    try {
      const toolResult = await SkillExecutor.execute(
        matchedByToolId.toolName,
        matchedByToolId.toolArguments,
        {
          conversationId: matchedByToolId.conversationId,
          toolCallId: matchedByToolId.toolCallId,
          args: matchedByToolId.toolArguments,
          skipPermissionCheck: true,
          // Trusted intent context (technical design §9/§14.2): re-thread the
          // originating turn's persisted user-message id + intent decision id
          // so outbound-email tools bind the draft to the exact user message
          // even when executed via the permission-resume path.
          sourceUserMessageId: matchedByToolId.sourceUserMessageId,
          intentDecisionId: matchedByToolId.intentDecisionId,
          // Re-thread the gate-resolved outbound authorization (§14.2/§15.1)
          // so the approved send claims the draft batch instead of silently
          // falling to the legacy send path (RC4).
          outboundAuthorization: matchedByToolId.outboundAuthorization,
          // Mirror the loop's foreground context: combined request image
          // capacity + cumulative data-URL budget (enforced by the tool), and
          // the abort signal so the user can still cancel after approval.
          currentRequestImageCount: countImageContentParts(
            matchedByToolId.conversationMessages
          ),
          currentRequestImageDataUrlChars: countImageDataUrlChars(
            matchedByToolId.conversationMessages
          ),
          signal: matchedByToolId.abortController.signal,
        }
      );

      let toolPayload = normalizeToolResult(toolResult);
      let toolContent = serializeToolResultContent(toolPayload);

      // Preserved-output pipeline on the RESUME path (technical design §9.2).
      // A resumed attempt must use exactly the same preparation and storage
      // policy as a foreground one (AC-09); otherwise the first tool call of
      // any session - which always takes this path - bypasses the receipt,
      // which is where gated tools (outbound email, file edit, shell) live.
      const toolResultPipeline = this.getToolResultPipeline(
        matchedByToolId.conversationId
      );
      if (toolResultPipeline.isActive()) {
        try {
          const conversationEpoch = await this.resolveConversationEpoch(
            matchedByToolId.conversationId
          );
          // A NEW execution identity: the permission placeholder and this
          // resumed attempt are different phases, so they must not share an
          // artifact key (technical design §5.1).
          const executionId = `${matchedByToolId.conversationId}:${
            matchedByToolId.turnId ?? matchedByToolId.assistantMessageId
          }:${matchedByToolId.toolCallId}:resume`;
          const prepared = await toolResultPipeline.process({
            context: {
              profileId: "default",
              conversationId: matchedByToolId.conversationId,
              conversationEpoch,
              turnId:
                matchedByToolId.turnId ?? matchedByToolId.assistantMessageId,
              executionId,
              toolCallId: matchedByToolId.toolCallId,
              toolName: matchedByToolId.toolName,
              signal: matchedByToolId.abortController.signal,
            },
            outcome: {
              success: toolResult.success,
              executionTimeMs: toolResult.execution_time_ms,
              summary:
                typeof toolResult.result.summary === "string"
                  ? toolResult.result.summary
                  : undefined,
              error:
                typeof toolResult.result.error === "string"
                  ? toolResult.result.error
                  : undefined,
              control: toolResult.result,
              output: toolResult.result,
              outputFormat: "json",
              previewKind: Array.isArray(toolResult.result)
                ? "records"
                : "text",
              // Batch aggregate receipts are parsed by the renderer's batch
              // progress card, so their preview needs the larger budget —
              // a 2KB default cut lands mid-JSON and the card cannot render.
              ...(TOOL_RESULT_BATCH_PREVIEW_TOOL_NAMES.has(
                matchedByToolId.toolName
              )
                ? {
                    previewMaxBytes:
                      TOOL_RESULT_CONFIG.batchPreviewMaxBytes,
                  }
                : {}),
              sourceCompleteness: toolResult.partial ? "partial" : "complete",
              isEmpty:
                Object.keys(toolResult.result).length === 0 &&
                !toolResult.result.summary,
            },
            store: async ({ receipt }) => {
              // The receipt REPLACES the permission-prompt row, which is the
              // existing `replacesPermissionPromptForToolId` contract.
              await module.saveToolResultMessage({
                conversationId: matchedByToolId.conversationId,
                assistantMessageId: matchedByToolId.assistantMessageId,
                toolCallId: matchedByToolId.toolCallId,
                toolName: matchedByToolId.toolName,
                content: JSON.stringify(receipt),
                toolResult: toolResultReceiptUiMetadata(receipt),
                replacesPermissionPromptForToolId: matchedByToolId.toolCallId,
                ...(matchedByToolId.turnId
                  ? { turnId: matchedByToolId.turnId }
                  : {}),
              });
            },
          });
          toolContent = prepared.modelContent;
          if (prepared.receipt) {
            // Rebuilt from the trusted outcome plus bounded descriptors: the
            // legacy payload spread the producer's whole body. The LIVE
            // metadata uses the SAME display envelope the durable row saves
            // (toolResultReceiptUiMetadata) — the preparation service's own
            // snake_case uiMetadata would otherwise make the renderer two
            // shapes (live event camelCase vs durable row) for one receipt.
            toolPayload = {
              success: toolResult.success,
              executionTimeMs: toolResult.execution_time_ms,
              toolResultReceipt: prepared.receipt,
              ...toolResultReceiptUiMetadata(prepared.receipt),
            } as Record<string, unknown>;
          }
        } catch (err: unknown) {
          if (err instanceof ToolResultPublicationError) {
            // Durable publication failed: stop rather than continue and imply
            // the result was saved.
            throw err;
          }
          console.warn(
            `[ai-chat-v2] resumed tool result preparation failed, using bounded fallback: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          // Bounded fallback, for the same reason as the main loop: the legacy
          // payload is the producer's whole body.
          toolContent = buildBoundedToolFailureContent({
            result: toolResult,
            code: "OUTPUT_NOT_AVAILABLE",
            message: err instanceof Error ? err.message : String(err),
          });
          toolPayload = JSON.parse(toolContent) as Record<string, unknown>;
        }
      }

      eventSink.emit({
        type: "tool_result",
        conversationId: matchedByToolId.conversationId,
        messageId: matchedByToolId.assistantMessageId,
        toolCallId: matchedByToolId.toolCallId,
        toolName: matchedByToolId.toolName,
        fullContent: toolContent,
        toolResult: toolPayload,
        replacesPermissionPromptForToolId: matchedByToolId.toolCallId,
      });

      // TODO-02 (FR-006/017): the approved tool's result is a REQUIRED write —
      // await it before ANY continuation (next model round, message mutation,
      // or re-parking) on every branch. A rejected save fails the segment via
      // the catch below; the approved tool is never re-run.
      await this.flushEventSaves(eventSink);

      if (isPermissionPromptResult(toolResult)) {
        // Permission still required — park again through the COMMON parking
        // path (TODO-10, FR-021): refresh the side-map sink to the resume's
        // destination so a later legacy resume and the owner both reach the
        // CURRENT consumer, and re-notify the owner exactly once per park.
        this.activeTurns.delete(conversationId);
        this.rememberPendingSink(conversationId, baseSink);
        this.pendingPermissions.set(conversationId, matchedByToolId);
        this.notifyAwaiting(
          matchedByToolId.lifecycle ?? lifecycle,
          {
            kind: "permission",
            conversationId: matchedByToolId.conversationId,
            assistantMessageId: matchedByToolId.assistantMessageId,
            toolCallId: matchedByToolId.toolCallId,
          }
        );
        return {
          type: "paused_for_permission",
          conversationId,
          assistantMessageId: matchedByToolId.assistantMessageId,
        };
      }

      matchedByToolId.conversationMessages.push({
        role: "tool",
        tool_call_id: matchedByToolId.toolCallId,
        content: toolContent,
      });

      // Transient image handoff (attach_local_images): if the tool returned
      // prepared images, append the model-only multimodal message so the next
      // loop round sees them — mirroring AIChatQueryLoop's foreground path.
      // Without this, the first call in a session (which always takes the
      // permission-resume path) would deliver metadata but no image parts.
      if (
        toolResult.success &&
        toolResult.modelArtifacts &&
        toolResult.modelArtifacts.length > 0
      ) {
        matchedByToolId.conversationMessages.push(
          buildImageArtifactHandoffMessage({
            artifacts: toolResult.modelArtifacts,
            originalUserRequest: matchedByToolId.request.message,
            toolCallId: matchedByToolId.toolCallId,
          })
        );
      }

      // Prompt-skill hidden context (design §10.5/§17.2): the SAME shared
      // builder as AIChatQueryLoop so both streaming paths deliver one
      // short acknowledgement followed by one model-only instruction block.
      if (toolResult.success && toolResult.promptSkillContext) {
        matchedByToolId.conversationMessages.push(
          buildPromptSkillHandoffMessage(toolResult.promptSkillContext)
        );
      }

      // Rebuild the deferred catalog for the resumed turn and carry forward the
      // discovered-tool snapshot so discovered tools remain exposed (AC-8).
      const resumeCatalogContext = this.buildToolCatalogForTurn({
        tools: matchedByToolId.openAITools,
        conversationId: matchedByToolId.conversationId,
        isPlanMode: Boolean(matchedByToolId.planContext),
        autoPlanEnabled: false,
        userMessage: matchedByToolId.request.message,
        recentUserMessages: collectRecentUserMessages(
          matchedByToolId.conversationMessages
        ),
        model: matchedByToolId.request.model,
        hasRecentGeneratedImages: messagesHaveGeneratedImages(
          matchedByToolId.conversationMessages
        ),
      });

      const loopInput: AIChatQueryLoopInput = {
        conversationId: matchedByToolId.conversationId,
        assistantMessageId: matchedByToolId.assistantMessageId,
        messages: matchedByToolId.conversationMessages,
        request: matchedByToolId.request,
        openAITools: matchedByToolId.openAITools,
        abortController: matchedByToolId.abortController,
        eventSink,
        skillRegistry: SkillRegistry,
        planContext: matchedByToolId.planContext,
        startRound: matchedByToolId.nextRound,
        isActiveTurn: () => {
          const entry = this.activeTurns.get(matchedByToolId.conversationId);
          return (
            !!entry &&
            entry.assistantMessageId === matchedByToolId.assistantMessageId
          );
        },
        toolCatalog: resumeCatalogContext.toolCatalog,
        toolCatalogModeDecision: resumeCatalogContext.toolCatalogModeDecision,
        toolCatalogState: matchedByToolId.toolCatalogState,
        // The approved tool executed OUTSIDE the loop (direct SkillExecutor
        // call above), so its generated-image outputs would otherwise never
        // be folded into the turn's result.images. Seed them here — the loop
        // merges them with anything its own rounds produce (FR-4).
        seededToolImages: extractToolResultImages(toolResult),
        // Keep the originating user turn attached to every round after a
        // permission resume. Without these fields, a successfully approved
        // draft is followed by a send round with no trusted intent, so the
        // outbound gate incorrectly falls back to `draft_required`.
        sourceUserMessageId: matchedByToolId.sourceUserMessageId,
        intentDecisionId: matchedByToolId.intentDecisionId,
        ...(lifecycle ? { lifecycle } : {}),
        ...(matchedByToolId.ownerNotifiesTerminal !== undefined
          ? { ownerNotifiesTerminal: matchedByToolId.ownerNotifiesTerminal }
          : {}),
        turnId: matchedByToolId.turnId,
        outboundSendPreAuthorized: matchedByToolId.outboundSendPreAuthorized,
        goalAutoContinue: await this.shouldAutoContinueGoal(
          matchedByToolId.conversationId,
          Boolean(matchedByToolId.planContext),
          matchedByToolId.taskRoute
        ),
        taskExecutionBinding: matchedByToolId.taskExecutionBinding,
        taskRoute: matchedByToolId.taskRoute,
      };

      // Stage A §3.5: the continuation is AWAITED and its outcome returned to
      // the owner — no unobserved fire-and-forget promise remains.
      const result = await this.runLoopSegment(
        this.loop,
        loopInput,
        this.pinnedStreamMode(conversationId)
      );
      await this.handleLoopResult(result, module, eventSink, {
        ownerNotifiesTerminal: matchedByToolId.ownerNotifiesTerminal === true,
        // Review F3 (FR-023): the durable-run gate applies to resumed
        // segments too — side effects wait for the owner's run transition.
        ...(options?.onSegmentDurable
          ? { onSegmentDurable: options.onSegmentDurable }
          : {}),
      }, matchedByToolId.taskExecutionBinding);
      if (result.type === "paused_for_permission") {
        return {
          type: "paused_for_permission",
          conversationId,
          assistantMessageId: matchedByToolId.assistantMessageId,
        };
      }
      if (result.type === "paused_for_plan_question") {
        return {
          type: "paused_for_plan_question",
          conversationId,
          assistantMessageId: matchedByToolId.assistantMessageId,
        };
      }
      return {
        type: result.type,
        conversationId,
        assistantMessageId: matchedByToolId.assistantMessageId,
      };
    } catch (err) {
      this.handleFailure(err, conversationId, matchedByToolId.assistantMessageId, baseSink);
      return {
        type: "failed",
        conversationId,
        assistantMessageId: matchedByToolId.assistantMessageId,
      };
    }
  }

  /** Plan-question continuation (extracted from the legacy answer path). */
  private async resumeClaimedQuestion(
    pending: PendingPlanQuestionTurn,
    options?: {
      readonly eventSink?: AIChatQueryEventSink;
      readonly lifecycle?: AIChatTurnLifecycleListener;
      readonly onSegmentDurable?: (
        conversationId: string,
        outcome: "completed" | "cancelled" | "failed"
      ) => Promise<void>;
    }
  ): Promise<AIChatSegmentOutcome> {
    const conversationId = pending.conversationId;
    const lifecycle = options?.lifecycle ?? pending.lifecycle;
    this.claimedPending.delete(conversationId);
    const baseSink = options?.eventSink ?? this.takePendingSink(conversationId);
    this.activeTurns.set(conversationId, {
      abortController: pending.abortController,
      assistantMessageId: pending.assistantMessageId,
      eventSink: baseSink,
      partialContent:
        (pending as { streamedPartial?: string }).streamedPartial ?? "",
      ...(lifecycle ? { lifecycle } : {}),
    });
    this.notifyResumed(lifecycle, {
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
    });
    // G01-313: the answered turn is really running again — restore the
    // `active` badge (it showed `waiting_approval` while parked). Enrolled
    // turns only; the binding map survives the pause.
    const answeredResumeExecutionId =
      this.taskExecutionBindings.get(conversationId);
    if (answeredResumeExecutionId && baseSink) {
      baseSink.emit({
        type: "task_execution_state",
        conversationId,
        executionId: answeredResumeExecutionId,
        status: "active",
      });
    }

    // The CALLER persisted the answer before claiming; the ack message was
    // built from it. Re-serialize the standard answered ack here from the
    // persisted question state.
    const answerContent = serializeToolResultContent({
      success: true,
      status: "answered",
      questionId: pending.questionId,
    });
    void answerContent;

    const toolMsgIndex = pending.conversationMessages.findIndex(
      (m) => m.role === "tool" && m.tool_call_id === pending.toolCallId
    );
    const answerAck = serializeToolResultContent({
      success: true,
      status: "answered",
      questionId: pending.questionId,
    });
    if (toolMsgIndex >= 0) {
      pending.conversationMessages[toolMsgIndex] = {
        role: "tool",
        tool_call_id: pending.toolCallId,
        content: answerAck,
      };
    } else {
      pending.conversationMessages.push({
        role: "tool",
        tool_call_id: pending.toolCallId,
        content: answerAck,
      });
    }

    const planModule = new AIChatPlanModule();
    const planState = await planModule.getPlanStateByPlanId(pending.planId);
    const toolFunctions = await SkillRegistry.getAllToolFunctions();
    const allOpenAITools = [
      ...toOpenAITools(toolFunctions),
      ...PlanModeToolRegistry.toOpenAITools(),
    ];

    const planContext: AIChatPlanLoopContext | undefined = planState
      ? {
          planModule: {
            saveQuestion: (inp) => planModule.saveQuestion(inp),
            submitPlanForApproval: (inp) =>
              planModule.submitPlanForApproval(inp),
            getPlanStateByPlanId: (planId) =>
              planModule.getPlanStateByPlanId(planId),
            answerQuestion: (inp) => planModule.answerQuestion(inp),
          },
          planState,
        }
      : undefined;

    // Rebuild the deferred catalog for the resumed plan turn and carry forward
    // the discovered-tool snapshot (AC-8).
    const resumePlanCatalogContext = this.buildToolCatalogForTurn({
      tools: allOpenAITools,
      conversationId: pending.conversationId,
      isPlanMode: Boolean(planContext),
      autoPlanEnabled: false,
      userMessage: pending.request.message,
      recentUserMessages: collectRecentUserMessages(pending.conversationMessages),
      model: pending.request.model,
      hasRecentGeneratedImages: messagesHaveGeneratedImages(
        pending.conversationMessages
      ),
    });

    const loopInput: AIChatQueryLoopInput = {
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      messages: pending.conversationMessages,
      request: pending.request,
      openAITools: allOpenAITools,
      abortController: pending.abortController,
      eventSink: baseSink,
      skillRegistry: SkillRegistry,
      planContext,
      startRound: pending.nextRound,
      isActiveTurn: () => {
        const entry = this.activeTurns.get(pending.conversationId);
        return !!entry && entry.assistantMessageId === pending.assistantMessageId;
      },
      toolCatalog: resumePlanCatalogContext.toolCatalog,
      toolCatalogModeDecision: resumePlanCatalogContext.toolCatalogModeDecision,
      toolCatalogState: pending.toolCatalogState,
      ...(lifecycle ? { lifecycle } : {}),
      ...(pending.ownerNotifiesTerminal !== undefined
        ? { ownerNotifiesTerminal: pending.ownerNotifiesTerminal }
        : {}),
    };

    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(module, baseSink);

    // Parked-question answer publication (R03-family): the answer moved the
    // plan out of awaiting_question, but the renderer's pinned surface is
    // derived from persisted plan metadata which still holds the parked
    // snapshot (status awaiting_question + pending question). Publish the
    // authoritative post-answer view so the question card releases as soon
    // as the continuation starts.
    if (planState) {
      try {
        eventSink.emit({
          type: "plan_state",
          conversationId,
          messageId: pending.assistantMessageId,
          planState,
        });
      } catch (err) {
        log.warn(
          "[ai-chat-v2] post-answer plan state publication failed:",
          err
        );
      }
    }

    try {
      const result = await this.runLoopSegment(
        this.loop,
        { ...loopInput, eventSink },
        this.pinnedStreamMode(conversationId)
      );
      await this.handleLoopResult(result, module, eventSink, {
        ownerNotifiesTerminal: pending.ownerNotifiesTerminal === true,
        ...(options?.onSegmentDurable
          ? { onSegmentDurable: options.onSegmentDurable }
          : {}),
      });
      if (result.type === "paused_for_permission") {
        return {
          type: "paused_for_permission",
          conversationId,
          assistantMessageId: pending.assistantMessageId,
        };
      }
      if (result.type === "paused_for_plan_question") {
        return {
          type: "paused_for_plan_question",
          conversationId,
          assistantMessageId: pending.assistantMessageId,
        };
      }
      return {
        type: result.type,
        conversationId,
        assistantMessageId: pending.assistantMessageId,
      };
    } catch (err) {
      this.handleFailure(err, conversationId, pending.assistantMessageId, baseSink);
      return {
        type: "failed",
        conversationId,
        assistantMessageId: pending.assistantMessageId,
      };
    }
  }

  /**
   * @deprecated Legacy fire-and-forget resume for callers not yet migrated to
   * the owner contract (FR-013): claims the pending action and runs the
   * continuation detached through the ORIGINAL pending sink, preserving the
   * pre-Stage-A IPC response shape.
   */
  async resumeToolAfterPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult> {
    const lookupKey = request.conversationId ?? undefined;
    const pending = lookupKey
      ? this.pendingPermissions.get(lookupKey)
      : this.firstEntry(this.pendingPermissions);
    if (!pending) {
      return {
        ok: false,
        error: "No active permission-gated tool call to continue.",
      };
    }
    if (
      request.conversationId &&
      request.conversationId !== pending.conversationId
    ) {
      return {
        ok: false,
        error: "Conversation mismatch for pending tool call.",
      };
    }
    const claim = this.claimPendingPermission(
      pending.conversationId,
      request.toolId
    );
    if (claim.status === "already_claimed") {
      return { ok: true };
    }
    if (claim.status === "not_found") {
      return {
        ok: false,
        error: "No active permission-gated tool call to continue.",
      };
    }
    const pendingSink = this.pendingSinks.get(pending.conversationId) ?? {
      emit: () => undefined,
    };
    void this.resumeClaimed(claim).catch((err: unknown) => {
      log.error("[ai-chat-v2] resume loop failed:", err);
      void redirectToLoginOnAuthExpired(err);
      pendingSink.emit({
        type: "error",
        conversationId: pending.conversationId,
        messageId: pending.assistantMessageId,
        errorMessage: userSafeError(err),
      });
      this.clearConversationTurnState(pending.conversationId);
      this.clearStagedConfirmedBatchRefs(pending.conversationId);
    });
    return { ok: true };
  }

  /**
   * @deprecated Legacy fire-and-forget plan-question resume (FR-013): the
   * answer is persisted first (existing semantics), then the continuation
   * runs detached through the original pending sink.
   */
  async answerPlanQuestion(
    request: AnswerPlanQuestionRequest
  ): Promise<ResumeTurnResult> {
    const planModule = new AIChatPlanModule();
    try {
      await planModule.answerQuestion({
        conversationId: request.conversationId,
        questionId: request.questionId,
        answers: request.answers,
      });
    } catch (err) {
      return { ok: false, error: userSafeError(err) };
    }

    const claim = this.claimPendingQuestion(
      request.conversationId,
      request.questionId
    );
    if (claim.status === "not_found") {
      return { ok: true };
    }
    if (claim.status === "already_claimed") {
      return { ok: true };
    }
    const pendingSink = this.pendingSinks.get(claim.pending.conversationId) ?? {
      emit: () => undefined,
    };
    void this.resumeClaimed(claim).catch((err: unknown) => {
      log.error("[ai-chat-v2] answer-question loop failed:", err);
      void redirectToLoginOnAuthExpired(err);
      pendingSink.emit({
        type: "error",
        conversationId: claim.pending.conversationId,
        messageId: claim.pending.assistantMessageId,
        errorMessage: userSafeError(err),
      });
      this.clearConversationTurnState(claim.pending.conversationId);
      this.clearStagedConfirmedBatchRefs(claim.pending.conversationId);
    });
    return { ok: true };
  }

  /** Helper: return the first value from a Map, or undefined. */
  private firstEntry<V>(map: Map<string, V>): V | undefined {
    for (const v of map.values()) return v;
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Handle the result from AIChatQueryLoop.run().
   * Persist messages and emit terminal events based on the result type.
   */
  private async handleLoopResult(
    result: AIChatQueryLoopResult,
    module: AIChatV2Module,
    eventSink: AIChatQueryEventSink,
    options?: {
      readonly ownerNotifiesTerminal?: boolean;
      /** TODO-05: per-segment durable-run gate (see AIChatQuerySubmitInput). */
      readonly onSegmentDurable?: (
        conversationId: string,
        outcome: "completed" | "cancelled" | "failed"
      ) => Promise<void>;
    },
    taskExecutionBinding?: LoopTaskExecutionBinding
  ): Promise<void> {
    await this.flushEventSaves(eventSink);
    // Persist deferred-catalog discovered state on terminal results so it
    // survives app restart / conversation reload (FR-5/AC-8). Pause variants
    // carry the snapshot on `pending` and persist via the resumed turn.
    if ("toolCatalogState" in result && result.toolCatalogState) {
      await this.conversationToolStateService.saveSnapshot({
        conversationId: result.conversationId,
        snapshot: result.toolCatalogState,
      });
    }
    // True-terminal notification (see deps.onTurnTerminal): resumed-turn
    // continuations are fire-and-forget, so this is the only place their
    // owner learns the conversation freed up. Stage A §3.6 (FR-023): runs
    // dispatched with ownerNotifiesTerminal (the coordinator) skip this —
    // the owner notifies the queue exactly once per run itself.
    const notifyCompatibilityOwner =
      (result.type === "completed" ||
        result.type === "cancelled" ||
        result.type === "failed") &&
      options?.ownerNotifiesTerminal !== true;
    switch (result.type) {
      case "completed": {
        const { conversationId, assistantMessageId } = result;
        const generatedImages = await this.storeGeneratedImages({
          conversationId,
          assistantMessageId,
          images: result.images,
        });
        if (result.fullContent.length > 0 || generatedImages) {
          await module.saveAssistantMessage({
            conversationId,
            content: result.fullContent,
            messageId: assistantMessageId,
            model: result.model,
            tokensUsed: result.totalTokens,
            metadata: {
              source: "chat-v2",
              openaiResponseId: result.responseId,
              finishReason: result.finishReason,
              ...buildReasoningMetadata(result.reasoningContent, result.model),
              generatedImages,
              recovery: result.recoveryMetadata,
              ...(result.directionTransitions &&
              result.directionTransitions.length > 0
                ? { directionTransitions: result.directionTransitions }
                : {}),
            },
          });
        }
        // Slice 2 Unit 5 — hard finalization gate: when the turn was
        // enrolled (binding present), finalize the execution row BEFORE
        // the complete emit so the UI never sees a completion whose
        // execution is still "running" (FR-10/15, AC-11/15). Flag-off /
        // unenrolled turns no-op inside the gate.
        // T12: the gate returns the committed (or synthesized) outcome +
        // reasonCode so the complete event carries them as terminal-delivery
        // identity. A generic `complete` event is NOT proof that an enrolled
        // task is verified_complete — the renderer reads `taskOutcome` to
        // badge honestly (FR-10/12/14/24, NFR-10/11, AC-15/24/25/30/32).
        let taskOutcome: TaskOutcome | undefined;
        let taskExecutionId: string | undefined;
        let taskReasonCode: string | undefined;
                if (taskExecutionBinding) {
          // B13c (FR-08/23, AC-08/27/29): await in-flight durable accounting
          // before any finalization releases the ledger owner — funded spend
          // must land before owner release, never after.
          await taskExecutionBinding.flushPersistedBudget?.();
          // T02 (D2): scheduled bindings are finalized by the runner's
          // `finalizeScheduledPolicyRun` (pass-through, enrollment-snapshot
          // expectedVersion, no retry) AFTER the sink captures the outcome.
          // Running the manual gate here would double-finalize (CAS on a row
          // the runner also finalizes) and carry a taskOutcome the sink
          // already owns — so skip the gate for scheduled kind. The map/set
          // cleanup below still runs: the turn is done, Stop-cancel is no
          // longer needed.
          if (taskExecutionBinding.executionKind !== "scheduled") {
            const gateResult = await this.finalizeManualAtCompleteGate(
              result,
              taskExecutionBinding,
              eventSink
            );
            if (
              gateResult &&
              (gateResult.status === "committed" ||
                gateResult.status === "alreadyFinalized")
            ) {
              // Committed winner (or stored winner on idempotent retry):
              // publish it as the single terminal truth (NFR-10).
              taskOutcome = gateResult.outcome;
              taskExecutionId = taskExecutionBinding.executionId;
              taskReasonCode = gateResult.reasonCode;
            } else if (
              gateResult &&
              (gateResult.status === "failed" ||
                gateResult.status === "staleLease")
            ) {
              // B06: durability failure — NO success delivery. The row has
              // no committed outcome for this turn, so emitting `complete`
              // with the intended verified outcome (plus notify + terminal
              // verified state) would disagree with durable truth. Surface
              // an explicit recoverable error and RETAIN the binding +
              // frozen-policy marker for repair; only the streaming turn
              // state is cleared. The assistant content is already saved
              // above; no notification escapes.
              eventSink.emit({
                type: "error",
                conversationId,
                messageId: assistantMessageId,
                errorMessage: `TASK_FINALIZE_FAILED: ${gateResult.reasonCode} (executionId=${taskExecutionBinding.executionId})`,
                taskExecutionId: taskExecutionBinding.executionId,
                taskReasonCode: gateResult.reasonCode,
              });
              this.dispatchStop(conversationId, "error");
              this.clearActiveTurnState(conversationId, assistantMessageId);
              break;
            }
            // gateResult null (policy not accepted): legacy path below emits
            // a generic complete without task fields.
          }
          // Unit 7: the row is finalized (committed or idempotent winner) —
          // drop the conversation binding so a later Stop click never
          // double-finalizes. Failure/stale paths returned above and retain
          // the binding for recovery control.
          this.taskExecutionBindings.delete(conversationId);
          // T16: also drop the frozen-policy marker so the set does not leak
          // past the turn (the execution is finalized; the conversation no
          // longer holds an accepted execution).
          this.policyAcceptedConversations.delete(conversationId);
          // D-slot leak fix: the decision slot is keyed by executionId and
          // must live no longer than the binding. Without this delete the
          // slot (and its captured TaskCompletionDecision) leaks on the
          // long-lived engine singleton — the conversation binding is gone
          // but the slot map grows without bound across turns.
          this.taskDecisionSlots.delete(taskExecutionBinding.executionId);
        }
        // B08 (PRD FR-13/14, NFR-10, AC-16/24/25/27/32): emit ONE terminal
        // task_execution_state event BEFORE the stream-terminal `complete`
        // emit. Both are AFTER durable finalization (authoritative state,
        // never speculative), but the terminal state must reach the renderer
        // first: the renderer's complete handler synchronously detaches both
        // stream listeners, so a terminal state emitted after `complete` is
        // dropped and the badge sticks until reload. Only enrolled turns
        // (taskExecutionId set) emit; response-only answers never enrolled and
        // never get a badge. The renderer dedups by executionId + drops a
        // terminal replay (NFR-10: one terminal event per execution).
        if (taskExecutionId && taskOutcome) {
          eventSink.emit({
            type: "task_execution_state",
            conversationId,
            executionId: taskExecutionId,
            status: "terminal",
            outcome: taskOutcome,
            reasonCode: taskReasonCode,
            // G02 (design §6.3, NFR-10): durable delivery identity, stamped
            // by finalization in the same transaction as the outcome. IPC,
            // notifications, and consumers dedup on it — a redelivery
            // reuses, never mints.
            finalEventIdentity: buildFinalEventIdentity(taskExecutionId),
          });
        }
        eventSink.emit({
          type: "complete",
          conversationId,
          messageId: assistantMessageId,
          fullContent: result.fullContent,
          images: generatedImages,
          model: result.model,
          finishReason: result.finishReason,
          totalTokens: result.totalTokens,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          reasoningContent: result.reasoningContent,
          taskOutcome,
          taskExecutionId,
          taskReasonCode,
        });
        // TODO-05: durable-run gate — side effects wait for the owner's run
        // transition (or proceed when no owner provides one).
        const durableGate = options?.onSegmentDurable ?? this.onSegmentDurableCb;
        if (durableGate) {
          await durableGate(conversationId, "completed");
        }
        const compactAgent = this.compactAgent;
        if (compactAgent) {
          const compactInput = {
            conversationId,
            reason: "assistant_turn_completed",
            promptTokens: result.promptTokens,
            model: result.model,
          };
          // Auto full-compact takes priority when the turn pushed the context
          // near the model's window: it actually shrinks the next assembled
          // prompt. Fall back to the advisory session-memory update otherwise.
          // Optional call guards test fakes that only stub one method.
          Promise.resolve(
            compactAgent.enqueueAutoCompact?.(compactInput) ?? false
          )
            .then((compacted) =>
              compacted
                ? undefined
                : compactAgent.enqueueSessionMemoryUpdate(compactInput)
            )
            .catch((err) =>
              log.error("[ai-chat-compact] post-turn compaction failed:", err)
            );
        }
        if (this.autoDreamService) {
          this.autoDreamService
            .evaluateAfterChatTurn({
              conversationId,
              reason: "assistant_turn_completed",
            })
            .catch((err) =>
              log.error("[ai-auto-dream] chat trigger failed:", err)
            );
        }
        if (this.workspaceAutoDreamService) {
          this.workspaceAutoDreamService
            .evaluateAfterChatTurn({
              conversationId,
              reason: "assistant_turn_completed",
            })
            .catch((err) =>
              log.error("[workspace-auto-dream] chat trigger failed:", err)
            );
        }
        // B07 (FR-12/14): scheduled turns finalize in the runner AFTER the
        // engine resolves — a pre-commit notify would escape before the
        // scheduled transaction commits (and would notify even when the
        // commit later fails). The runner notifies once post-commit using
        // the committed identity; the engine stays silent for scheduled
        // kind. Manual turns notify here as before.
        if (taskExecutionBinding?.executionKind !== "scheduled") {
          DesktopNotifyService.getInstance()
            .show({
              type: "turn_complete",
              title: "AI reply ready",
              body: "Your AI chat response is ready.",
              conversationId,
            })
            .catch((err: unknown) =>
              log.error("[desktop-notify] turn_complete failed:", err)
            );
        }
        this.dispatchStop(conversationId, "completed");
        this.clearActiveTurnState(conversationId, assistantMessageId);
        this.forgetStreamMode(conversationId);
        // Terminal: drop any staged confirmed reference set the turn did not
        // consume so it can never feed a later unrelated batch call.
        this.clearStagedConfirmedBatchRefs(conversationId);
        break;
      }
      case "cancelled": {
        const { conversationId, assistantMessageId } = result;
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
              ...buildReasoningMetadata(result.reasoningContent, result.model),
            },
          });
        }
        // T12: durable finalization gate for the CANCELLED path. If the loop
        // resolved `cancelled` for a reason OTHER than the user hitting Stop
        // (window close mid-stream, controller abort, etc.), the enrolled
        // execution still needs an honest `cancelled`/`USER_CANCELLED` row —
        // otherwise it stays `running` and restart cannot tell the work was
        // abandoned (FR-10/12/14/24, NFR-10/11, AC-24/25). Stop's own cancel
        // already finalized the row in that path; ALREADY_FINALIZED is a
        // no-op success here.
        let cancelledTaskOutcome: TaskOutcome | undefined;
        let cancelledTaskExecutionId: string | undefined;
        let cancelledTaskReasonCode: string | undefined;
                if (taskExecutionBinding) {
          // B13c (FR-08/23, AC-08/27/29): await in-flight durable accounting
          // before any finalization releases the ledger owner — funded spend
          // must land before owner release, never after.
          await taskExecutionBinding.flushPersistedBudget?.();
          // T02 (D2): scheduled bindings are finalized by the runner's
          // `finalizeScheduledPolicyRun` after the sink captures the outcome
          // (pass-through, enrollment-snapshot expectedVersion). Running the
          // manual CAS gate here would double-finalize, so skip it for
          // scheduled kind. The sink's `cancelled` commit owns the outcome.
          if (taskExecutionBinding.executionKind !== "scheduled") {
            const carried = await this.finalizeManualAtTerminalFailure(
              taskExecutionBinding,
              "cancelled",
              "USER_CANCELLED",
              result.partialContent
            );
            if (carried) {
              cancelledTaskOutcome = carried.outcome;
              cancelledTaskExecutionId = taskExecutionBinding.executionId;
              cancelledTaskReasonCode = carried.reasonCode;
            }
          }
          this.taskExecutionBindings.delete(conversationId);
          this.policyAcceptedConversations.delete(conversationId);
          // D-slot leak fix: the cancelled execution is finalized — its
          // decision slot must not outlive the binding (see complete gate).
          this.taskDecisionSlots.delete(taskExecutionBinding.executionId);
        }
        // B08: terminal state BEFORE the stream-terminal `cancelled` emit
        // (same listener-cleanup hazard as the complete path — both follow
        // durable finalization).
        if (cancelledTaskExecutionId && cancelledTaskOutcome) {
          eventSink.emit({
            type: "task_execution_state",
            conversationId,
            executionId: cancelledTaskExecutionId,
            status: "terminal",
            outcome: cancelledTaskOutcome,
            reasonCode: cancelledTaskReasonCode,
            // G02: durable delivery identity (see complete gate).
            finalEventIdentity: buildFinalEventIdentity(cancelledTaskExecutionId),
          });
        }
        eventSink.emit({
          type: "cancelled",
          conversationId,
          messageId:
            result.partialContent.length > 0 ? assistantMessageId : undefined,
          fullContent: result.partialContent,
          taskOutcome: cancelledTaskOutcome,
          taskExecutionId: cancelledTaskExecutionId,
          taskReasonCode: cancelledTaskReasonCode,
        });
        const durableGate = options?.onSegmentDurable ?? this.onSegmentDurableCb;
        if (durableGate) {
          await durableGate(conversationId, "cancelled");
        }
        // TODO-05: the explicit stop already fired the hook — exactly once.
        this.stopHooksDispatched.delete(conversationId);
        this.clearActiveTurnState(conversationId, assistantMessageId);
        this.forgetStreamMode(conversationId);
        this.clearStagedConfirmedBatchRefs(conversationId);
        break;
      }
      case "failed": {
        const { conversationId, assistantMessageId } = result;
        void redirectToLoginOnAuthExpired(result.error);
        // R03: reactive compaction waits for the failure's durable writes
        // (partial save + run-row gate below) — it previously started
        // before them, violating the durable-before-effects ordering.
        const needsReactiveCompaction =
          result.error instanceof RecoverableHistoryError &&
          result.error.code === "CONTEXT_REQUIRED_CONTENT_TOO_LARGE";
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
              ...buildReasoningMetadata(result.reasoningContent, result.model),
            },
          });
        }
        // T12: durable finalization gate for the FAILED path. An enrolled
        // execution whose loop failed must NOT stay `running` — the row gets
        // a `failed` outcome (or honors a recorded finish decision) BEFORE
        // the error emit so restart/repair can see the work is dead and why
        // (FR-10/12/14/24, NFR-10/11, AC-15/24/25/30/32). Stop already
        // cancelled the row if the user hit Stop; ALREADY_FINALIZED is a
        // no-op success here.
        let failedTaskOutcome: TaskOutcome | undefined;
        let failedTaskExecutionId: string | undefined;
        let failedTaskReasonCode: string | undefined;
                if (taskExecutionBinding) {
          // B13c (FR-08/23, AC-08/27/29): await in-flight durable accounting
          // before any finalization releases the ledger owner — funded spend
          // must land before owner release, never after.
          await taskExecutionBinding.flushPersistedBudget?.();
          // T02 (D2): scheduled bindings are finalized by the runner's
          // `finalizeScheduledPolicyRun` after the sink captures the outcome
          // (pass-through, enrollment-snapshot expectedVersion). Running the
          // manual CAS gate here would double-finalize, so skip it for
          // scheduled kind. The sink's `error` commit owns the outcome.
          if (taskExecutionBinding.executionKind !== "scheduled") {
            const carried = await this.finalizeManualAtTerminalFailure(
              taskExecutionBinding,
              "failed",
              "MODEL_FAILURE",
              result.partialContent
            );
            if (carried) {
              failedTaskOutcome = carried.outcome;
              failedTaskExecutionId = taskExecutionBinding.executionId;
              failedTaskReasonCode = carried.reasonCode;
            }
          }
          this.taskExecutionBindings.delete(conversationId);
          this.policyAcceptedConversations.delete(conversationId);
          // D-slot leak fix: the failed execution is finalized — its decision
          // slot must not outlive the binding (see complete gate).
          this.taskDecisionSlots.delete(taskExecutionBinding.executionId);
        }
        // B08: terminal state BEFORE the stream-terminal `error` emit
        // (same listener-cleanup hazard as the complete path — both follow
        // durable finalization).
        if (failedTaskExecutionId && failedTaskOutcome) {
          eventSink.emit({
            type: "task_execution_state",
            conversationId,
            executionId: failedTaskExecutionId,
            status: "terminal",
            outcome: failedTaskOutcome,
            reasonCode: failedTaskReasonCode,
            // G02: durable delivery identity (see complete gate).
            finalEventIdentity: buildFinalEventIdentity(failedTaskExecutionId),
          });
        }
        eventSink.emit({
          type: "error",
          conversationId,
          messageId:
            result.partialContent.length > 0 ? assistantMessageId : undefined,
          errorMessage: userSafeError(result.error),
          // Stable image-edit codes let the renderer localize provider edit
          // failures distinctly from invalid references and transient issues.
          // Required-persistence failures (Stage A §3.3) carry their own
          // code + toolCallId so the tool card shows the precise failure.
          ...(result.error instanceof AIChatRequiredPersistenceError
            ? {
                errorCode: result.error.persistenceCode,
                toolCallId: result.error.toolCallId,
              }
            : {
                errorCode: imageEditErrorCode(result.error) ?? undefined,
              }),
          taskOutcome: failedTaskOutcome,
          taskExecutionId: failedTaskExecutionId,
          taskReasonCode: failedTaskReasonCode,
        });
        const durableGate = options?.onSegmentDurable ?? this.onSegmentDurableCb;
        if (durableGate) {
          await durableGate(conversationId, "failed");
        }
        // R03: reactive compaction (dev) — a budget-preflight rejection means
        // the context no longer fits — compact through the SAME bounded
        // coordinator (trigger "reactive-overflow"), never a secondary
        // unbounded path. Runs AFTER the durable writes (fire-and-forget).
        if (needsReactiveCompaction) {
          this.requestReactiveCompaction(conversationId, result.model);
        }
        // Emergency auto-compact: when the turn failed because the context
        // window was exceeded, immediately run a full compact so the next
        // turn has a smaller context. Without this the user is stuck in a
        // failure loop — every retry sends the same oversized history.
        const compactAgent = this.compactAgent;
        if (compactAgent && isContextWindowExceededError(result.error)) {
          log.info(
            `[ai-chat-compact] emergency compact triggered (context window exceeded) conv=${conversationId}`
          );
          compactAgent
            .enqueueAutoCompact({
              conversationId,
              reason: "context_window_exceeded",
              // Use a very high token count to force the compact past the
              // threshold check, since we don't have the exact prompt token
              // count on a failed turn.
              promptTokens: Number.MAX_SAFE_INTEGER,
              model: result.model,
            })
            .catch((err) =>
              log.error(
                "[ai-chat-compact] emergency compact after context window failure failed:",
                err
              )
            );
        }
        this.dispatchStop(conversationId, "error");
        this.clearConversationTurnState(conversationId, assistantMessageId);
        this.clearStagedConfirmedBatchRefs(conversationId);
        break;
      }
      case "paused_for_permission": {
        // Move the turn from activeTurns into pendingPermissions so the three
        // maps stay disjoint (a conversation is in exactly one of them). The
        // activeTurns entry is dropped; resuming re-adds it.
        // The steering mailbox closes (design §12.4): committed-but-unapplied
        // steering is paused by the queue service via the pause classification.
        const pausedPermissionEntry = this.activeTurns.get(
          result.pending.conversationId
        );
        pausedPermissionEntry?.control?.close();
        this.activeTurns.delete(result.pending.conversationId);
        // Review F13: carry the streamed-so-far text onto the pending so a
        // post-resume failure writes the FULL partial history, not just
        // post-resume tokens.
        (result.pending as { streamedPartial?: string }).streamedPartial =
          pausedPermissionEntry?.partialContent ?? "";
        this.pendingPermissions.set(
          result.pending.conversationId,
          result.pending
        );
        this.rememberPendingSink(result.pending.conversationId, eventSink);
        log.info(
          `[ai-chat-v2] tool ${result.pending.toolName} needs permission — paused (nextRound=${result.pending.nextRound})`
        );
        // G01-313: badge the actual owned waiting phase (the turn really is
        // parked on a permission gate). Enrolled turns only — unenrolled
        // turns have no badge to update.
        if (taskExecutionBinding) {
          eventSink.emit({
            type: "task_execution_state",
            conversationId: result.pending.conversationId,
            executionId: taskExecutionBinding.executionId,
            status: "waiting_permission",
          });
        }
        // Stage A §3.2 (FR-021): explicit waiting notification — synchronous,
        // non-throwing, exactly once per park. The owner persists the run
        // transition before broadcasting its summary.
        this.notifyAwaiting(result.pending.lifecycle, {
          kind: "permission",
          conversationId: result.pending.conversationId,
          assistantMessageId: result.pending.assistantMessageId,
          toolCallId: result.pending.toolCallId,
        });
        break;
      }
      case "paused_for_plan_question": {
        const pausedPlanEntry = this.activeTurns.get(
          result.pending.conversationId
        );
        pausedPlanEntry?.control?.close();
        this.activeTurns.delete(result.pending.conversationId);
        (result.pending as { streamedPartial?: string }).streamedPartial =
          pausedPlanEntry?.partialContent ?? "";
        this.pendingPlanQuestions.set(
          result.pending.conversationId,
          result.pending
        );
        this.rememberPendingSink(result.pending.conversationId, eventSink);
        log.info(
          `[ai-chat-v2] AskUserQuestion paused (questionId=${result.pending.questionId}, nextRound=${result.pending.nextRound})`
        );
        // G01-313: badge the actual owned waiting phase (see permission
        // pause above). Enrolled turns only.
        if (taskExecutionBinding) {
          eventSink.emit({
            type: "task_execution_state",
            conversationId: result.pending.conversationId,
            executionId: taskExecutionBinding.executionId,
            status: "waiting_approval",
          });
        }
        this.notifyAwaiting(result.pending.lifecycle, {
          kind: "user_input",
          conversationId: result.pending.conversationId,
          assistantMessageId: result.pending.assistantMessageId,
          questionId: result.pending.questionId,
        });
        break;
      }
    }
    // TODO-05 (FR-007/023): the compatibility queue hears completion only
    // AFTER the terminal case's durable writes (assistant row, terminal
    // event) completed — never before the save could still fail.
    if (notifyCompatibilityOwner) {
      this.onTurnTerminalCb?.(result.conversationId, result.type);
    }
  }

  /**
   * Slice 2 Unit 5 — the HARD finalization gate (FR-10/15, AC-11/15).
   * Runs inside the completed-case BEFORE the `complete` emit so the
   * execution row is always finalized when the UI sees the completion.
   *
   * - No binding (flag off, response_only, transport retry, enrollment
   *   failure) → no-op (legacy behavior).
   * - A decision recorded by the loop's consult closures (Unit 4) is
   *   authoritative and is used directly.
   * - No recorded decision (natural response_end — no consult site hit) →
   *   the gate consults the controller as a fallback, forming a
   *   `TaskEndCandidate` from the final assistant content, then records
   *   the decision.
   * - Decision → finalization mapping: `finish` copies fields directly;
   *   `finish_response` (the loop accepted the natural end) finalizes
   *   incomplete/RESPONSE_ENDED; `continue` post-exit is defensive
   *   (continuation is impossible after the loop returned) and finalizes
   *   incomplete; `wait`/`yield_owner` post-exit finalize incomplete too.
   * - B06 (FR-12/24, NFR-10/11, AC-15/32): the gate NEVER publishes the
   *   intended outcome on a durability failure. `ok` commits the intended
   *   outcome; `alreadyFinalized` loads and publishes the STORED winner
   *   (Stop-vs-complete race); `!ok`/throw/stale-lease return an explicit
   *   failure status so the caller suppresses success delivery (no
   *   `complete` with intended outcome, no terminal verified state, no
   *   success notify) and retains the binding for recovery.
   *
   * T12 / FR-10/12/14/24 / NFR-10/11 / AC-15/24/25/30/32: returns a
   * discriminated gate result so the complete-case caller can carry the
   * committed outcome on the `complete` event or surface an explicit
   * persistence error. Terminal delivery is now bound to a durable
   * finalization decision, not to a generic stream-end: a `complete`
   * event without `taskOutcome` is NOT proof that an enrolled task is
   * `verified_complete`.
   */
  private async finalizeManualAtCompleteGate(
    result: Extract<AIChatQueryLoopResult, { type: "completed" }>,
    binding: LoopTaskExecutionBinding,
    eventSink: AIChatQueryEventSink
  ): Promise<
    | { status: "committed"; outcome: TaskOutcome; reasonCode: string }
    | { status: "alreadyFinalized"; outcome: TaskOutcome; reasonCode: string }
    | { status: "failed"; reasonCode: string }
    | { status: "staleLease"; reasonCode: string }
    | null
  > {
    // T16: check the FROZEN flag-at-enrollment value on the binding, not the
    // live runtime flag. An execution enrolled while the flag was on stays
    // accepted for finalization even if the flag was turned off midstream —
    // otherwise the row would never receive its outcome and a late complete
    // emit could convert accepted unfinished work to unchecked success
    // (NFR-12, AC-12/32). The binding is undefined for flag-off/unenrolled
    // turns, and the complete-case caller already guards on its presence.
    if (!binding.policyAccepted) return null;
    const slot = this.taskDecisionSlots.get(binding.executionId);
    let decision = slot?.get() ?? null;
    if (!decision) {
      // Fallback consult: the loop ended naturally without hitting any
      // consult site. Form the candidate from the final assistant content.
      // T21a: derive provenance/streamTerminalSeen/safetyRestriction from the
      // actual finishReason + content — do NOT hardcode "provider terminal,
      // no restriction". A `length`/`error`/`null` finishReason or a
      // content_filter refusal surfaces honestly. The loop's completed variant
      // carries `finishReason` as a required string, but a missing value still
      // degrades to "unknown" provenance via the helper (missing-terminal
      // STREAM_INCOMPLETE downstream).
      const finishReason = result.finishReason ?? null;
      const diagnostics = deriveCandidateDiagnostics({
        finishReason,
        content: result.fullContent,
      });
      const candidate: TaskEndCandidate = {
        candidateId: `cand:${binding.executionId}:response_end`,
        executionId: binding.executionId,
        content: result.fullContent,
        finishReason,
        provenance: diagnostics.provenance,
        streamTerminalSeen: diagnostics.streamTerminalSeen,
        boundary: "response_end",
        pendingPermission: false,
        pendingQuestion: false,
        pendingPlanApproval: false,
        safetyRestriction: diagnostics.safetyRestriction,
      };
      try {
        // G01-313: badge the fallback consult as the actual verifying
        // phase (terminal finalization always follows in this path, so no
        // active restore is needed). No ownership guard: sends are blocked
        // while this turn streams and Stop preserves the active entry, so
        // no newer turn can own this conversation mid-gate; the binding is
        // single-owner by construction.
        eventSink.emit({
          type: "task_execution_state",
          conversationId: result.conversationId,
          executionId: binding.executionId,
          status: "verifying",
        });
        decision = await binding.consult(candidate);
      } catch (err) {
        console.error(
          `[ai-chat-v2] completion-policy fallback consult failed (executionId=${binding.executionId}):`,
          err
        );
        decision = null;
      }
      if (decision) {
        slot?.set(decision);
      }
    }
    if (!decision) {
      console.error(
        `[ai-chat-v2] completion-policy gate has no decision after fallback consult (executionId=${binding.executionId}) — finalizing incomplete/EVIDENCE_UNAVAILABLE`
      );
      decision = {
        type: "finish",
        outcome: "incomplete",
        reasonCode: "EVIDENCE_UNAVAILABLE",
        evidenceIds: [],
        summary: result.fullContent.slice(0, 2000),
        remainingWork: [],
      };
    }
    const finalizeInput = this.decisionToFinalizeInput(
      result,
      binding.executionId,
      decision
    );
    if (!finalizeInput) {
      return null;
    }
    const carried: { outcome: TaskOutcome; reasonCode: string } = {
      outcome: finalizeInput.outcome,
      reasonCode: finalizeInput.reasonCode,
    };
    // T15b (FR-20, NFR-01/07, AC-22/31): single-owner lease guard at the
    // finalization gate. The manual finalize transaction releases the shared
    // lineage ledger unconditionally (`WHERE ledger_id = ?`), so a stale
    // ancestor finalizing after a Continue successor claimed the ledger would
    // free the successor's lease. Re-read owner_generation fresh and reject
    // on mismatch — B06: surface STALE_LEASE explicitly with no success
    // delivery; the successor holds the lease and owns the durable write.
    // The binding is retained by the caller for recovery control.
    if (binding.ledgerId && binding.leaseGeneration !== undefined) {
      const execModule = new AiTaskExecutionModule();
      const currentGen = await readCurrentLeaseGeneration(
        (id) => execModule.getLedgerById(id),
        binding.ledgerId
      );
      const ownership = assertOwnership(
        { leaseGeneration: binding.leaseGeneration },
        currentGen ?? -1
      );
      if (!ownership.ok) {
        console.error(
          `[ai-chat-v2] finalize skipped — stale lease (executionId=${binding.executionId}, bindingGen=${binding.leaseGeneration}, ledgerGen=${currentGen ?? "missing"})`
        );
        return { status: "staleLease", reasonCode: "STALE_LEASE" };
      }
    }
    try {
      const finalizeResult = await new TaskExecutionCoordinator().finalizeManual(
        finalizeInput
      );
      if (finalizeResult.ok) {
        return {
          status: "committed",
          outcome: carried.outcome,
          reasonCode: carried.reasonCode,
        };
      }
      if (finalizeResult.alreadyFinalized) {
        // B06: idempotent finalization must publish the COMMITTED winner,
        // not the intended outcome. A Stop-cancel (or newer owner) that won
        // the race owns the terminal state; the loser converges to it so
        // live badges/history/notifications match the stored row (NFR-10).
        try {
          const execModule = new AiTaskExecutionModule();
          const stored = await execModule.getExecution(binding.executionId);
          if (stored?.task_outcome) {
            return {
              status: "alreadyFinalized",
              outcome: stored.task_outcome,
              reasonCode: stored.outcome_reason_code ?? "ALREADY_FINALIZED",
            };
          }
        } catch (err) {
          console.error(
            `[ai-chat-v2] stored-winner re-read failed (executionId=${binding.executionId}):`,
            err
          );
        }
        // Stored row unreadable: fall back to the intended outcome so the
        // UI does not hang, but mark it as the idempotent path.
        return {
          status: "alreadyFinalized",
          outcome: carried.outcome,
          reasonCode: "ALREADY_FINALIZED",
        };
      }
      // B06: a finalization failure must NOT publish intended success. The
      // row may still be `running` with no durable outcome — return an
      // explicit failure so the caller emits a recoverable error (no
      // `complete`, no terminal verified state, no success notify) and
      // retains the binding for repair.
      console.error(
        `[ai-chat-v2] completion-policy finalize failed (executionId=${binding.executionId}): ${finalizeResult.reasonCode ?? "unknown"}`
      );
      return {
        status: "failed",
        reasonCode: finalizeResult.reasonCode ?? carried.reasonCode,
      };
    } catch (err) {
      console.error(
        `[ai-chat-v2] completion-policy finalize threw (executionId=${binding.executionId}):`,
        err
      );
      return { status: "failed", reasonCode: "FINALIZE_THREW" };
    }
  }

  /**
   * Map a `TaskCompletionDecision` to the manual-finalization input
   * (Unit 5). Returns null only for decisions that must not finalize the
   * row (none in practice — every branch maps to an outcome).
   */
  private decisionToFinalizeInput(
    result: Extract<AIChatQueryLoopResult, { type: "completed" }>,
    executionId: string,
    decision: TaskCompletionDecision
  ): FinalizeManualInput {
    const summary = result.fullContent.slice(0, 2000);
    switch (decision.type) {
      case "finish":
        return {
          executionId,
          outcome: decision.outcome,
          reasonCode: decision.reasonCode,
          summary: decision.summary || summary,
          evidenceIds: decision.evidenceIds,
          remainingWork: decision.remainingWork,
          assistantResultMessageId: result.assistantMessageId,
        };
      case "finish_response":
        // The loop accepted the natural end of the response.
        return {
          executionId,
          outcome: "incomplete",
          reasonCode: "RESPONSE_ENDED",
          summary,
          evidenceIds: [],
          remainingWork: [],
          assistantResultMessageId: result.assistantMessageId,
        };
      case "continue":
        // Defensive: continuation is impossible after the loop returned.
        // Finalize incomplete so the row never stays running (FR-15).
        console.error(
          "[ai-chat-v2] completion-policy continue decision after loop exit — finalizing incomplete"
        );
        return {
          executionId,
          outcome: "incomplete",
          reasonCode: "NO_PROGRESS",
          summary,
          evidenceIds: [],
          remainingWork: decision.unmetCriterionIds,
          assistantResultMessageId: result.assistantMessageId,
        };
      case "wait":
      case "yield_owner":
        // Defensive post-exit: no dispatch is possible after the loop
        // returned; finalize incomplete so the row never stays running.
        console.error(
          `[ai-chat-v2] completion-policy ${decision.type} decision after loop exit — finalizing incomplete`
        );
        return {
          executionId,
          outcome: "incomplete",
          reasonCode: "NO_PROGRESS",
          summary,
          evidenceIds: [],
          remainingWork: [],
          assistantResultMessageId: result.assistantMessageId,
        };
    }
  }

  /**
   * T12 / FR-10/12/14/24 / NFR-10/11 / AC-15/24/25/30/32 — durable
   * finalization gate for the FAILED and CANCELLED terminal paths.
   *
   * The completed-case gate ({@link finalizeManualAtCompleteGate}) is the
   * happy path. But a loop that ends `failed` or `cancelled` (or throws and
   * lands in {@link handleFailure}) on an enrolled execution must ALSO
   * leave an honest durable record — otherwise the row stays `running` and
   * a later restart cannot tell that the work is dead, let alone why
   * (AC-24/25: restart interruption + repair requires a finalized row).
   *
   * Behavior:
   * - No binding / `policyAccepted` false → no-op (legacy behavior).
   * - Honors any controller decision the loop already recorded on the slot
   *   (a `finish` decision at a consult site that then threw, for example).
   *   The recorded decision's outcome is used as-is when it is a terminal
   *   finish; a `continue`/`wait` recorded decision is overridden to the
   *   caller's terminal outcome (continue/wait are impossible after the loop
   *   has failed or been cancelled).
   * - Otherwise synthesizes the caller's outcome + reasonCode (failed/
   *   MODEL_FAILURE or cancelled/USER_CANCELLED).
   * - Finalizes via the SAME CAS path as the complete gate
   *   ({@link TaskExecutionCoordinator.finalizeManual}); ALREADY_FINALIZED
   *   is a no-op success (Stop already cancelled, for example).
   * - Failures are logged AND surfaced to the caller via the returned
   *   reasonCode so the terminal emit can carry them; the UI never sees a
   *   generic terminal event as proof of an enrolled verified outcome.
   */
  private async finalizeManualAtTerminalFailure(
    binding: LoopTaskExecutionBinding,
    terminalOutcome: TaskOutcome,
    terminalReasonCode: string,
    summary: string
  ): Promise<{ outcome: TaskOutcome; reasonCode: string } | null> {
    if (!binding.policyAccepted) return null;
    const slot = this.taskDecisionSlots.get(binding.executionId);
    const recorded = slot?.get() ?? null;
    let outcome = terminalOutcome;
    let reasonCode = terminalReasonCode;
    // Honor a recorded finish decision's outcome/reason when it is itself a
    // terminal finish (a consult site decided finish before the loop threw).
    // continue/wait post-failure is impossible; keep the caller's terminal
    // outcome so the row never lands verified_complete by accident.
    if (recorded && recorded.type === "finish") {
      outcome = recorded.outcome;
      reasonCode = recorded.reasonCode;
    }
    const finalizeInput: FinalizeManualInput = {
      executionId: binding.executionId,
      outcome,
      reasonCode,
      summary: summary.slice(0, 2000),
      evidenceIds: [],
      remainingWork:
        recorded && recorded.type === "finish"
          ? recorded.remainingWork
          : [],
      assistantResultMessageId: null,
    };
    // D2/R3 review fix (mirror of the complete gate's T15b guard): the
    // terminal-failure path finalizes through the same
    // `finalizeManual` transaction, which releases the lineage ledger
    // unconditionally. Without the owner-generation re-check here, a stale
    // ancestor's terminal failure would free a Continue successor's lease
    // and double-release the ledger. On mismatch: skip the durable write,
    // return the carried outcome (the renderer badges honestly; the
    // successor owns the row and finalizes on its own completion).
    // The ledger re-read is wrapped: an unreadable ledger (transient
    // SQLITE_BUSY, module failure) is fail-closed the SAME as a stale lease
    // — skip the durable write rather than risk double-releasing a live
    // successor's ledger. A thrown read must never escalate out of the
    // terminal-failure path (the row can be recovered by the scheduler; a
    // released successor lease cannot).
    if (binding.ledgerId && binding.leaseGeneration !== undefined) {
      try {
        const execModule = new AiTaskExecutionModule();
        const currentGen = await readCurrentLeaseGeneration(
          (id) => execModule.getLedgerById(id),
          binding.ledgerId
        );
        const ownership = assertOwnership(
          { leaseGeneration: binding.leaseGeneration },
          currentGen ?? -1
        );
        if (!ownership.ok) {
          console.error(
            `[ai-chat-v2] terminal-failure finalize skipped — stale lease (executionId=${binding.executionId}, bindingGen=${binding.leaseGeneration}, ledgerGen=${currentGen ?? "missing"})`
          );
          return { outcome, reasonCode };
        }
      } catch (err) {
        console.error(
          `[ai-chat-v2] terminal-failure lease re-read failed — finalize skipped (executionId=${binding.executionId}, bindingGen=${binding.leaseGeneration}):`,
          err
        );
        return { outcome, reasonCode };
      }
    }
    try {
      const finalizeResult = await new TaskExecutionCoordinator().finalizeManual(
        finalizeInput
      );
      if (finalizeResult.ok || finalizeResult.alreadyFinalized) {
        return { outcome, reasonCode };
      }
      console.error(
        `[ai-chat-v2] completion-policy terminal-failure finalize failed (executionId=${binding.executionId}, outcome=${outcome}): ${finalizeResult.reasonCode ?? "unknown"}`
      );
      return { outcome, reasonCode: finalizeResult.reasonCode ?? reasonCode };
    } catch (err) {
      console.error(
        `[ai-chat-v2] completion-policy terminal-failure finalize threw (executionId=${binding.executionId}):`,
        err
      );
      return { outcome, reasonCode: "FINALIZE_THREW" };
    }
  }

  /**
   * Remove the active-turn entry for ONE conversation only. Called after
   * terminal results (completed/cancelled/failed) and on unexpected failures.
   * Scoped by conversationId so a terminal result for conversation A never
   * touches conversation B's entry — this is the fix for the cross-conversation
   * clobber bug (a cancelled result for A used to wipe B's singleton state).
   *
   * When `assistantMessageId` is supplied, the entry is deleted ONLY if it
   * still belongs to that turn. A same-conversation re-send replaces the entry
   * with a newer turn; the stale turn's late terminal result must not delete
   * the newer turn's entry.
   */
  private clearActiveTurnState(
    conversationId: string,
    assistantMessageId?: string
  ): void {
    const entry = this.activeTurns.get(conversationId);
    if (!entry) return;
    if (
      assistantMessageId !== undefined &&
      entry.assistantMessageId !== assistantMessageId
    ) {
      return;
    }
    this.activeTurns.delete(conversationId);
  }

  /**
   * Drop any staged user-confirmed batch reference set for ONE conversation.
   * Called on every terminal turn path (completed/cancelled/failed, unexpected
   * engine failure, and resume-loop failures). The batch tool consumes the
   * staged set at job start INSIDE the running turn — the query loop blocks
   * on the job via pollAsyncJobToCompletion — so clearing here can never race
   * a legitimate pending consume; anything still staged when the turn ends is
   * stale (the turn finished without a generated-batch call) and must not
   * leak into a later unrelated turn.
   */
  private clearStagedConfirmedBatchRefs(conversationId: string): void {
    getConfirmedBatchReferenceRegistry().clear(conversationId);
  }

  /**
   * G01-312: discard a pre-stream abort handle, but only when it still
   * belongs to this turn (turnId-guarded — a concurrent turn's
   * registration/adoption must survive another turn's exit path, B11).
   */
  private discardPendingTurn(conversationId: string, turnId: string): void {
    if (this.pendingTurns.get(conversationId)?.turnId === turnId) {
      this.pendingTurns.delete(conversationId);
    }
  }

  /**
   * G01-312: controlled exit for a turn whose pre-stream prep was aborted
   * via Stop. No loop ever ran and nothing streamed: consume any enrolled
   * execution binding (cancelling the just-enrolled row so no orphan active
   * row remains — the mid-enrollment abort window), then emit `cancelled`
   * on the turn's own sink so the renderer clears streaming state.
   */
  private async abortPrepExit(input: {
    conversationId: string;
    turnId: string;
    assistantMessageId: string;
    eventSink: AIChatQueryEventSink;
    /**
     * G01-312: this turn's enrolled execution row, when one was committed
     * before the abort (tracked at enrollment, never read back from the
     * shared binding map — a superseding turn may already own that map
     * entry, and cancelling ITS row would be a cross-turn kill).
     */
    executionId: string | null;
  }): Promise<void> {
    const { conversationId, turnId, assistantMessageId, eventSink, executionId } = input;
    this.discardPendingTurn(conversationId, turnId);
    if (executionId) {
      // Consume the shared binding entry only when it still points at our
      // row (a superseding turn owns it otherwise — leave it alone).
      if (this.taskExecutionBindings.get(conversationId) === executionId) {
        this.taskExecutionBindings.delete(conversationId);
        this.policyAcceptedConversations.delete(conversationId);
      }
      this.taskDecisionSlots.delete(executionId);
      try {
        await new TaskExecutionCoordinator().cancel(executionId);
      } catch (err) {
        log.error(
          `[ai-chat-v2] prep-abort execution cancel failed (executionId=${executionId}):`,
          err
        );
      }
    }
    eventSink.emit({
      type: "cancelled",
      conversationId,
      messageId: assistantMessageId,
      fullContent: "",
    });
  }

  /**
   * Defensively clear ALL turn state for one conversation — the active entry
   * plus any pending permission / plan-question entries. Used on
   * failure / catch paths where state may be inconsistent. Terminal success
   * paths (completed/cancelled) do NOT use this: a streaming turn lives only
   * in activeTurns, so they call clearActiveTurnState directly.
   */
  private clearConversationTurnState(
    conversationId: string,
    assistantMessageId?: string
  ): void {
    this.clearActiveTurnState(conversationId, assistantMessageId);
    this.pendingPermissions.delete(conversationId);
    this.pendingPlanQuestions.delete(conversationId);
    this.pendingSinks.delete(conversationId);
    this.runStreamModes.delete(conversationId);
    this.stopHooksDispatched.delete(conversationId);
    this.taskExecutionBindings.delete(conversationId);
  }

  private createPersistingEventSink(
    module: AIChatV2Module,
    eventSink: AIChatQueryEventSink
  ): AIChatQueryEventSink {
    if (this.pendingEventSaves.has(eventSink)) {
      return eventSink;
    }
    // Stage A §3.3 (FR-006/007): required tool-call/tool-result saves are
    // STRICT — flush() rejects with AIChatRequiredPersistenceError so the
    // loop's persist-before-execute barrier blocks dependent work. The emit
    // path still forwards first so the UI stays responsive.
    const saves: Array<{
      readonly kind: "tool_call" | "tool_result";
      readonly toolCallId: string;
      readonly promise: Promise<unknown>;
    }> = [];
    // Track the latest server-reported usage so it can be attributed to
    // intermediate tool_call messages. Without this, every tool_call row
    // is persisted with null tokensUsed/model, losing per-round cost data.
    let latestUsage: { totalTokens: number; model?: string } | undefined;
    const wrapped: AIChatQueryEventSink = {
      emit: (event) => {
        eventSink.emit(event);
        if (event.type === "token") {
          // TODO-09: track the visible partial for failure-path history.
          const entry = this.activeTurns.get(event.conversationId);
          if (entry && entry.assistantMessageId === event.messageId) {
            entry.partialContent += event.contentDelta;
          }
        }
        if (event.type === "usage_update") {
          latestUsage = {
            totalTokens: event.totalTokens,
            model: event.model,
          };
        }
        if (event.type === "tool_call") {
          saves.push({
            kind: "tool_call",
            toolCallId: event.toolCallId,
            promise: module.saveToolCallMessage({
              conversationId: event.conversationId,
              assistantMessageId: event.messageId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              toolArguments: event.toolArguments,
              model: latestUsage?.model,
              tokensUsed: latestUsage?.totalTokens,
              turnId: this.activeTurns.get(event.conversationId)?.turnId,
            }),
          });
        }
        if (event.type === "tool_result") {
          // A result that already carries a saved-receipt was persisted
          // DURABLY by the pipeline's publisher before the event was emitted.
          // Writing it again here would double-write the same row (and could
          // race the archive coupler), so the pipeline is the single writer for
          // that case and this sink only handles the legacy inline path.
          if (
            (event.toolResult as Record<string, unknown> | undefined)
              ?.toolResultReceipt !== undefined
          ) {
            return;
          }
          // Stage A strict persistence (FR-006/017): NO .catch — a rejected
          // save propagates through flush() as
          // AIChatRequiredPersistenceError so dependent execution blocks.
          saves.push({
            kind: "tool_result",
            toolCallId: event.toolCallId,
            promise: module.saveToolResultMessage({
              conversationId: event.conversationId,
              assistantMessageId: event.messageId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              content: event.fullContent,
              toolResult: event.toolResult,
              replacesPermissionPromptForToolId:
                event.replacesPermissionPromptForToolId,
              turnId: this.activeTurns.get(event.conversationId)?.turnId,
            }),
          });
        }
      },
      flush: async () => {
        await this.flushPendingEventSaves(saves);
      },
    };
    this.pendingEventSaves.set(wrapped, saves);
    return wrapped;
  }

  private async flushPendingEventSaves(
    saves: Array<{
      readonly kind: "tool_call" | "tool_result";
      readonly toolCallId: string;
      readonly promise: Promise<unknown>;
    }>
  ): Promise<void> {
    if (saves.length === 0) {
      return;
    }
    const batch = saves.splice(0, saves.length);
    const settled = await Promise.allSettled(
      batch.map((save) => save.promise)
    );
    const failedIndex = settled.findIndex((r) => r.status === "rejected");
    if (failedIndex >= 0) {
      const failed = settled[failedIndex];
      const reason =
        failed.status === "rejected" ? failed.reason : undefined;
      log.error(
        `[ai-chat-v2] required ${batch[failedIndex].kind} save failed:`,
        reason
      );
      throw new AIChatRequiredPersistenceError(
        batch[failedIndex].kind === "tool_call"
          ? "tool_call_persist_failed"
          : "tool_result_persist_failed",
        batch[failedIndex].toolCallId,
        reason
      );
    }
  }

  private async flushEventSaves(
    eventSink: AIChatQueryEventSink
  ): Promise<void> {
    const saves = this.pendingEventSaves.get(eventSink);
    if (!saves) {
      return;
    }
    await this.flushPendingEventSaves(saves);
  }

  private async storeGeneratedImages(input: {
    conversationId: string;
    assistantMessageId: string;
    images?: OpenAIChatImage[];
  }): Promise<OpenAIChatImage[] | undefined> {
    if (!input.images || input.images.length === 0) {
      return undefined;
    }
    const storage =
      this.generatedImageStorage ?? new AIChatGeneratedImageStorageService();
    try {
      const stored = await storage.storeImages({
        conversationId: input.conversationId,
        messageId: input.assistantMessageId,
        images: input.images,
      });
      // Re-home descriptors persisted under foreign identities (e.g. a batch
      // sub-agent's `agent-v2-*` conversation) into THIS parent conversation
      // + assistant-message identity before metadata.generatedImages is
      // written, so the parent conversation can re-reference its outputs in
      // later turns. Direct completions are already stored under the final
      // identity, so this is a no-op pass-through for them (idempotent).
      const rehomed = storage.rehomeImages
        ? await storage.rehomeImages({
            images: stored,
            targetConversationId: input.conversationId,
            targetMessageId: input.assistantMessageId,
          })
        : stored;
      return rehomed.length > 0 ? rehomed : undefined;
    } catch (err) {
      log.warn(
        `[ai-chat-v2] failed to store generated images locally for conversation ${input.conversationId}:`,
        err
      );
      return input.images;
    }
  }

  /**
   * Stage B §16 (FR-018): capture the delivery mode in run context at
   * acceptance. A later provider change never starts a second implementation
   * for the same run — resumed segments reuse the captured mode (AC-14).
   */
  private captureStreamMode(
    conversationId: string
  ): AIChatStreamImplementationMode {
    const mode = this.streamImplementation.mode;
    this.runStreamModes.set(conversationId, mode);
    return mode;
  }

  /** The mode captured for this conversation's live/paused run. */
  private pinnedStreamMode(
    conversationId: string
  ): AIChatStreamImplementationMode {
    return this.runStreamModes.get(conversationId) ?? "callback";
  }

  private forgetStreamMode(conversationId: string): void {
    this.runStreamModes.delete(conversationId);
    this.stopHooksDispatched.delete(conversationId);
  }

  private rememberPendingSink(
    conversationId: string,
    sink: AIChatQueryEventSink | undefined
  ): void {
    if (sink) {
      this.pendingSinks.set(conversationId, sink);
    }
  }

  private takePendingSink(conversationId: string): AIChatQueryEventSink {
    const sink = this.pendingSinks.get(conversationId);
    this.pendingSinks.delete(conversationId);
    return sink ?? { emit: () => undefined };
  }

  /** Stage A §3.2 (FR-021): fire a lifecycle notification, never throwing. */
  private notifyAwaiting(
    listener: AIChatTurnLifecycleListener | undefined,
    event: Parameters<AIChatTurnLifecycleListener["onAwaiting"]>[0]
  ): void {
    if (!listener) return;
    try {
      listener.onAwaiting(event);
    } catch (err) {
      log.error("[ai-chat-v2] lifecycle onAwaiting listener failed:", err);
    }
  }

  /** Stage A §3.2 (FR-021): fire a resume notification, never throwing. */
  private notifyResumed(
    listener: AIChatTurnLifecycleListener | undefined,
    event: Parameters<AIChatTurnLifecycleListener["onResumed"]>[0]
  ): void {
    if (!listener) return;
    try {
      listener.onResumed(event);
    } catch (err) {
      log.error("[ai-chat-v2] lifecycle onResumed listener failed:", err);
    }
  }

  /**
   * Handle an unexpected failure during the loop run.
   */
  private async handleFailure(
    err: unknown,
    conversationId: string,
    assistantMessageId: string,
    eventSink: AIChatQueryEventSink,
    taskExecutionBinding?: LoopTaskExecutionBinding
  ): Promise<void> {
    this.dispatchStop(conversationId, "error");
    log.error("[ai-chat-v2] engine failure:", err);
    void redirectToLoginOnAuthExpired(err);
    // TODO-09 (FR-015/017): preserve the safe partial history the user
    // already saw. Attempt the write through the normal module path; a
    // further storage failure is logged but never replaces the primary
    // error (the error event below still fires first-hand).
    const partial = this.activeTurns.get(conversationId)?.partialContent;
    if (partial && partial.length > 0) {
      void new AIChatV2Module()
        .saveAssistantMessage({
          conversationId,
          content: partial,
          messageId: assistantMessageId,
          metadata: {
            source: "chat-v2",
            finishReason: "error",
            error: userSafeError(err),
          },
        })
        .catch((persistErr: unknown) => {
          log.error(
            "[ai-chat-v2] partial-history write after failure also failed:",
            persistErr
          );
        });
    }
    // T12: durable finalization gate for the catch path. An enrolled
    // execution whose loop THREW (vs. cleanly resolved `failed`) must still
    // leave an honest durable record — finalize `failed`/MODEL_FAILURE
    // before the error emit. A write failure here is logged inside the
    // helper and the row stays `running` for restart-time repair
    // (AC-24/25). The map is cleared so a later Stop click never
    // double-finalizes. ALREADY_FINALIZED (Stop already cancelled) is a
    // no-op success.
    let failureTaskOutcome: TaskOutcome | undefined;
    let failureTaskExecutionId: string | undefined;
    let failureTaskReasonCode: string | undefined;
    if (taskExecutionBinding) {
      // B13c (FR-08/23, AC-08/27/29): await in-flight durable accounting
      // before any finalization releases the ledger owner — funded spend
      // must land before owner release, never after.
      await taskExecutionBinding.flushPersistedBudget?.();
      // T02 (D2): scheduled bindings are finalized by the runner's
      // `finalizeScheduledPolicyRun` after the sink captures the outcome
      // (the sink's `error` commit or `failOutstanding`). Running the manual
      // CAS gate here would double-finalize, so skip it for scheduled kind.
      if (taskExecutionBinding.executionKind !== "scheduled") {
        failureTaskExecutionId = taskExecutionBinding.executionId;
        const carried = await this.finalizeManualAtTerminalFailure(
          taskExecutionBinding,
          "failed",
          "MODEL_FAILURE",
          userSafeError(err)
        );
        if (carried) {
          failureTaskOutcome = carried.outcome;
          failureTaskReasonCode = carried.reasonCode;
        }
      }
      this.taskExecutionBindings.delete(conversationId);
      this.policyAcceptedConversations.delete(conversationId);
      // D-slot leak fix: the catch-path execution is finalized (failed) —
      // drop its decision slot with the binding so it cannot leak.
      this.taskDecisionSlots.delete(taskExecutionBinding.executionId);
    }
    eventSink.emit({
      type: "error",
      conversationId,
      messageId: assistantMessageId,
      errorMessage: userSafeError(err),
      // Stage A §3.3 (FR-006): classify required-persistence failures so the
      // renderer can mark the affected tool card instead of showing success.
      ...(err instanceof AIChatRequiredPersistenceError
        ? {
            errorCode: err.persistenceCode,
            toolCallId: err.toolCallId,
          }
        : {
            errorCode: imageEditErrorCode(err) ?? undefined,
          }),
      taskOutcome: failureTaskOutcome,
      taskExecutionId: failureTaskExecutionId,
      taskReasonCode: failureTaskReasonCode,
    });
    this.clearConversationTurnState(conversationId, assistantMessageId);
    this.clearStagedConfirmedBatchRefs(conversationId);
  }
}
