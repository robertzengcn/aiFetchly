// src/service/AIChatQueryEngine.ts
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import { AIChatGoalModule } from "@/modules/AIChatGoalModule";
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
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { HookDispatcher } from "@/service/hooks/HookDispatcher";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import { AtMentionResolutionService } from "@/service/aiChatAtMentions/AtMentionResolutionService";
import { PastedTextResolutionService } from "@/service/pastedText/PastedTextResolutionService";
import type { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import type { AIChatCompactionCoordinator } from "@/service/AIChatCompactionCoordinator";
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
import { redirectToLoginOnAuthExpired } from "@/service/AIChatAuthExpiredHandler";
import { userSafeError } from "@/service/AIChatErrorMapper";
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
import { AIChatModelCatalogService } from "@/service/AIChatModelCatalogService";
import { AI_CHAT_RECOVERY_DEFAULTS } from "@/service/AIChatRetryPolicy";
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
  AIChatPlanLoopContext,
  AnswerPlanQuestionRequest,
  PendingPermissionTurn,
  PendingPlanQuestionTurn,
  ResumeToolAfterPermissionRequest,
  ResumeTurnResult,
} from "@/service/AIChatQueryEvents";
import type {
  ChatV2ReasoningMetadata,
  ChatV2StreamRequest,
  ChatV2UploadedAttachment,
  ChatV2AttachmentMetadata,
  ChatV2MessageMetadata,
  ChatV2RuntimeStatus,
  ChatV2HistorySelectionMetadata,
} from "@/entityTypes/aiChatV2Types";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatCompactionModule } from "@/modules/AIChatCompactionModule";
import { RecoverableHistoryError } from "@/entityTypes/aiChatArchiveTypes";
import { AIChatHistoryRetrievalService } from "@/service/AIChatHistoryRetrievalService";
import {
  buildSelectedHistoryContextBlock,
  toSelectedHistoryExcerptInputs,
  type SelectedHistoryExcerptInput,
} from "@/service/SelectedHistoryContextBlock";
import { isArchiveReadsEnabled } from "@/config/featureFlags";
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
import type { FinalizeManualInput } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import type { TaskExecutionBinding } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import { TaskRequestResolver } from "@/service/aiTaskExecution/TaskRequestResolver";
import { compileCriteria } from "@/service/aiTaskExecution/TaskCriteriaResolver";
import type {
  TaskCompletionContract,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";
import { buildEvidenceService } from "@/service/aiTaskExecution/EvidenceProviderFactory";
import { snapshotArtifactBaselines } from "@/service/aiTaskExecution/criteriaAdapters";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { SearchModule } from "@/modules/SearchModule";
import { contactInfoRepository } from "@/model/ContactInfo.model";
import type { LoopTaskExecutionBinding } from "@/service/aiTaskExecution/TaskLoopConsult";
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

/** Maximum persisted reasoning characters per assistant message (32 KB). */
const CHAT_V2_REASONING_MAX_CHARS = 32 * 1024;

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
   * confirmation at loop creation (policy.autoApproveTools AND
   * policy.allowedTools includes the send tool). When true, the outbound-email
   * gate honors `skip_review=true` even for blocking reasonCodes (e.g. a dedup
   * negation the pure resolver misreads as do-not-send), because that typed
   * pre-allowlist IS the trusted authorization AD-003 requires and there is no
   * human present to click Review. Never set for interactive chat — the
   * renderer cannot forge `scheduledContext`, so this flag is unreachable there.
   */
  outboundSendPreAuthorized?: boolean;
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
  /** Optional. When provided, the engine routes post-turn compaction through
   * the durable incremental coordinator (technical-design §11) instead of the
   * legacy compact agent's all-history path. The coordinator is opt-in so
   * existing tests and the legacy flow remain unchanged when absent. */
  compactionCoordinator?: AIChatCompactionCoordinator;
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
  };
  /** Optional filter scoping which built-in tool schemas the engine advertises
   * to the model. Scheduled (unattended) profiles use this to expose only
   * task-policy-approved tools (FR-16), narrowing the prompt-injection surface
   * beyond the executeTool guard. */
  toolFilter?: (toolName: string) => boolean;
  /**
   * Optional factory for the selection re-resolution service (§13.3). When
   * omitted the engine builds its own archive-backed service; tests inject a
   * stub so selection resolution does not need a live database.
   */
  historyRetrievalServiceFactory?: () => AIChatHistoryRetrievalService;
}

/**
 * Owns the conversation lifecycle: setup, persistence, pending state,
 * and stop. The engine delegates the inner model/tool round loop to
 * AIChatQueryLoop and handles the result.
 */
interface ActiveTurnState {
  abortController: AbortController;
  assistantMessageId: string;
  /** Turn association (technical-design §4.3). Generated at turn-accept and
   * propagated to every assistant/tool save so the archive can group rows.
   * Optional because legacy rows / resumed flows may carry no association. */
  turnId?: string;
  eventSink: AIChatQueryEventSink;
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
  private readonly compactionCoordinator?: AIChatCompactionCoordinator;
  private readonly autoDreamService?: AIAutoDreamService;
  private readonly workspaceAutoDreamService?: AIWorkspaceAutoDreamService;
  private readonly generatedImageStorage?: AIChatQueryEngineDeps["generatedImageStorage"];
  /** Optional filter that scopes which tool schemas the engine advertises to
   * the model. Used by the scheduled (unattended) profile to expose only
   * task-policy-approved tools (FR-16), narrowing the prompt-injection
   * surface beyond the executeToken guard. */
  private readonly toolFilter?: (toolName: string) => boolean;
  private readonly historyRetrievalServiceFactory?: () => AIChatHistoryRetrievalService;
  private readonly pendingEventSaves = new WeakMap<
    AIChatQueryEventSink,
    Promise<unknown>[]
  >();
  /** Tracks which conversations have already fired SessionStart. */
  private readonly startedConversations = new Set<string>();

  constructor(
    private readonly loop: AIChatQueryLoop,
    deps?: AIChatQueryEngineDeps
  ) {
    // Default assembler reads the published generation (§12) and retains
    // token-budgeted complete turns (FR-05) so EVERY engine consumer —
    // interactive, scheduled, subagent, recovery — assembles published
    // context without each call site remembering the injections (FR-04/08).
    this.contextAssembler =
      deps?.contextAssembler ??
      new AIChatContextAssembler({
        compactionReader: new AIChatCompactionModule(),
        archiveModule: new AIChatArchiveModule(),
        // T14: substitute bounded projections for oversized legacy rows.
        projectionLookup: new ToolResultModule().asLegacyProjectionLookup(),
      });
    this.compactAgent = deps?.compactAgent;
    this.compactionCoordinator = deps?.compactionCoordinator;
    this.autoDreamService = deps?.autoDreamService;
    this.workspaceAutoDreamService = deps?.workspaceAutoDreamService;
    this.generatedImageStorage = deps?.generatedImageStorage;
    this.toolFilter = deps?.toolFilter;
    this.historyRetrievalServiceFactory = deps?.historyRetrievalServiceFactory;
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
        console.log(
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
        console.log(
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
        console.error(
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
  private readonly modelCatalogService = new AIChatModelCatalogService();
  private readonly conversationToolStateService =
    new ConversationToolStateService();

  /**
   * Real per-model context window for tool-catalog auto mode. Vitest skips
   * the live catalog fetch so unit tests do not hang on the models API.
   */
  private async resolveContextWindowTokens(
    model?: string
  ): Promise<number | undefined> {
    if (process.env.VITEST === "true") {
      return undefined;
    }
    return this.modelCatalogService.getContextWindow(model);
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
      ...(input.initialState ?? {}),
    };

    let catalog: ToolCatalog;
    try {
      catalog = this.catalogService.buildFromOpenAITools({
        tools: input.tools,
        context,
      });
    } catch (err) {
      console.warn(
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
   */
  async submitMessage(input: AIChatQuerySubmitInput): Promise<void> {
    const {
      eventSink,
      request,
      scheduledContext,
      outboundSendPreAuthorized,
      successorContext,
    } = input;
    const module = new AIChatV2Module();
    const planModule = new AIChatPlanModule();

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
            });
          // One tracker per execution closing over the SAME budget the
          // controller consults (FR-09 / §7.2 step 7). BaseModule TDZ —
          // never constructed at module top level.
          const progressTracker = new TaskProgressTracker({
            budget: created.budget,
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
            getAbortSignal: () =>
              this.activeTurns.get(conversationId)?.abortController.signal,
            consult: async (candidate) => {
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
            ledgerId: created.ledgerId,
            leaseGeneration: created.leaseGeneration,
            persistBudget: (delta) =>
              execModule.persistBudgetConsumption({
                ledgerId: created.ledgerId,
                expectedOwnerGeneration: created.leaseGeneration,
                activeExecutionId: created.executionId,
                delta,
              }),
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
          // Route: the parent's parsed route (re-classification would risk
          // demoting a task continuation to response_only).
          taskRoute = successorContext.route;
          adoptedSuccessorExecutionId = created.executionId;
          // T13 (PRD FR-13, NFR-10/11, AC-16): emit the active lifecycle state
          // for the successor so the badge tracks the new executionId as soon
          // as Continue/Retry enrollment commits, before the successor stream
          // attaches. The renderer's executionId dedup (Piece C) drops any late
          // terminal chunk from the parent execution in favor of this one.
          eventSink.emit({
            type: "task_execution_state",
            conversationId,
            executionId: created.executionId,
            status: "active",
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

      // Build user-message metadata (source + attachments + @-mentions).
      const userMetadata: ChatV2MessageMetadata = {
        source: scheduledContext ? "scheduled-loop" : "chat-v2",
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
        selectionResolution.metadata.length > 0 ||
        !!scheduledContext;

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
            // owner enrolls this execution. When an active conversation goal
            // owns the work, the goal controller is the sole semantic owner
            // of completion decisions for this turn — the standalone
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
              if (owningGoal) {
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
              });
              // B21 (FR-02/03/19): capture pre-action artifact baselines at
              // enrollment — after the contract froze, before the maker
              // dispatches. Files the run itself creates have no baseline
              // and stay honestly unknown.
              const artifactBaselines = await snapshotArtifactBaselines(
                artifactBaseDir ?? undefined,
                contract?.criteria ?? []
              );
              // FR-09 / §7.2 step 7 (GAP-S2 #2): one tracker per execution,
              // closing over the SAME budget the controller consults, so the
              // streak the tracker increments is the streak the controller's
              // continue-branch gate reads. Constructed once per enrollment
              // (NOT at module top level — BaseModule TDZ). Holds no DB
              // state; only mutates the budget's no-progress streak counter.
              const progressTracker = new TaskProgressTracker({
                budget: created.budget,
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
                // T04 (NFR-02/04, AC-24): the per-turn abort controller is
                // created AFTER this enrollment block runs (at the turn-state
                // registration). Read it fresh per consult so the checker
                // dispatch races the CURRENT turn's Stop signal + a deadline
                // (§9: a hanging request cannot hold the gate).
                getAbortSignal: () =>
                  this.activeTurns.get(conversationId)?.abortController.signal,
                consult: async (candidate) => {
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
                // stable `prov:<executionId>:<round>` ID. Exhausted → loop
                // throws RecoverableHistoryError("MODEL_ATTEMPT_LIMIT").
                reserveProviderAttempt: (requestId) =>
                  created.budget.reserveProviderAttempt(requestId),
                // T05 (FR-08/10/23, AC-27): tool-execution record-but-no-gate
                // (D4 — gating mid-operation leaves tool state in limbo; the
                // hard cap is enforced at continuation time). The loop calls
                // this with a stable `tool:<call.id>` ID before
                // deps.executeTool.
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
                persistBudget: (delta) =>
                  execModule.persistBudgetConsumption({
                    ledgerId: created.ledgerId,
                    expectedOwnerGeneration: created.leaseGeneration,
                    activeExecutionId: created.executionId,
                    delta,
                  }),
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

      assistantMessageId = scheduledContext
        ? scheduledContext.assistantMessageId
        : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      messages = [...assembled.messages];
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
      console.error("[ai-chat-v2] pre-stream error:", err);
      // T09 (AC-28): the successor execution row was created before this
      // dispatch; a startup failure would leave it active forever. Cancel it
      // through the coordinator (fire-and-forget) so no orphan active row
      // remains, then surface the terminal error to the renderer.
      if (adoptedSuccessorExecutionId) {
        void new TaskExecutionCoordinator()
          .cancel(adoptedSuccessorExecutionId)
          .then((cancelResult) => {
            if (!cancelResult.ok && !cancelResult.alreadyFinalized) {
              console.error(
                `[ai-chat-v2] orphan successor cancel failed (executionId=${adoptedSuccessorExecutionId}): ${cancelResult.reasonCode ?? "unknown"}`
              );
            }
          })
          .catch((cancelErr: unknown) =>
            console.error(
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
      return;
    }

    // ------------------------------------------------------------------
    // 3. Lifecycle hooks: SessionStart (once per conversation)
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
    // 4. Resolve tools (skills + plan mode tools)
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
      contextWindowTokens: await this.resolveContextWindowTokens(request.model),
    });

    // Load persisted discovered-tool state so tools discovered in earlier turns
    // (before an app restart / conversation reload) remain exposed (FR-5/AC-8).
    const persistedToolCatalogState = toolCatalogContext.toolCatalog
      ? await this.conversationToolStateService.loadSnapshot(conversationId)
      : undefined;

    // ------------------------------------------------------------------
    // 4. Abort any prior active turn FOR THIS CONVERSATION ONLY, then register
    //    the new turn. Cross-conversation turns are left alone so background
    //    streaming can continue (concurrent-turns support).
    //    B11 (FR-21, AC-26): a reused/conflict/denied submission must NOT
    //    abort the accepted original run. The enrollment seam above already
    //    resolved `dedupShortCircuit` — return the accepted status WITHOUT
    //    touching `activeTurns` so the original stream continues and only one
    //    message/execution/provider dispatch exists.
    // ------------------------------------------------------------------
    if (dedupShortCircuit) {
      if (dedupShortCircuit.kind === "conflict") {
        eventSink.emit({
          type: "error",
          conversationId,
          messageId: assistantMessageId,
          errorMessage: `SUBMISSION_CONFLICT: submissionId already accepted with different request content (executionId=${dedupShortCircuit.executionId})`,
        });
      } else if (dedupShortCircuit.kind === "denied") {
        eventSink.emit({
          type: "error",
          conversationId,
          messageId: assistantMessageId,
          errorMessage: `TASK_CONTINUE_DENIED: ${dedupShortCircuit.reasonCode}`,
        });
      } else {
        eventSink.emit({
          type: "complete",
          conversationId,
          messageId: assistantMessageId,
          fullContent: "",
          finishReason: "stop",
        });
      }
      return;
    }
    const prior = this.activeTurns.get(conversationId);
    if (prior) {
      prior.abortController.abort();
    }
    const abortController = new AbortController();
    this.activeTurns.set(conversationId, {
      abortController,
      assistantMessageId,
      turnId,
      eventSink,
    });
    this.pendingPermissions.delete(conversationId);
    this.pendingPlanQuestions.delete(conversationId);

    // ------------------------------------------------------------------
    // 5. Emit start event
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
    // 6. Build plan context if in plan mode
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
    // 8. UserPromptSubmit lifecycle hook
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
    // 9. Run the loop
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
      sourceUserMessageId,
      intentDecisionId,
      turnId,
      outboundSendPreAuthorized,
      goalAutoContinue: await this.shouldAutoContinueGoal(
        conversationId,
        isPlanMode,
        taskRoute
      ),
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
      const result = await this.loop.run(loopInput);
      await this.handleLoopResult(result, module, streamEventSink, taskExecutionBinding);
    } catch (err) {
      await this.handleFailure(
        err,
        conversationId,
        assistantMessageId,
        eventSink,
        taskExecutionBinding
      );
    } finally {
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
    this.dispatchStop(conversationId, "user_stopped");
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
      this.pendingPermissions.delete(conversationId);
      pendingPermission.abortController.abort();
      pendingPermission.eventSink.emit({
        type: "cancelled",
        conversationId: pendingPermission.conversationId,
        messageId: pendingPermission.assistantMessageId,
        fullContent: "",
      });
    }
    const pendingPlanQuestion = this.pendingPlanQuestions.get(conversationId);
    if (pendingPlanQuestion) {
      this.pendingPlanQuestions.delete(conversationId);
      pendingPlanQuestion.abortController.abort();
      pendingPlanQuestion.eventSink.emit({
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

  // -------------------------------------------------------------------------
  // Resume methods
  // -------------------------------------------------------------------------

  /**
   * Resume a paused tool after the user grants permission.
   * Re-executes the tool with skipPermissionCheck, then re-enters the loop.
   */
  async resumeToolAfterPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult> {
    const convId = request.conversationId;
    // When the renderer provides conversationId, key by it directly; otherwise
    // fall back to the single-entry assumption (only meaningful when exactly
    // one permission is pending).
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
    this.activeTurns.set(conversationId, {
      abortController: matchedByToolId.abortController,
      assistantMessageId: matchedByToolId.assistantMessageId,
      turnId: matchedByToolId.turnId,
      eventSink: matchedByToolId.eventSink,
    });
    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(
      module,
      matchedByToolId.eventSink
    );

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
              sourceCompleteness: toolResult.partial ? "partial" : "complete",
              isEmpty:
                Object.keys(toolResult.result).length === 0 &&
                !toolResult.result.summary,
            },
            store: async ({ receipt }) => {
              // The receipt REPLACES the permission-prompt row, which is the
              // existing `replacesPermissionPromptForToolId` contract.
              const { AIChatV2Module } = await import(
                "@/modules/AIChatV2Module"
              );
              await new AIChatV2Module().saveToolResultMessage({
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
            // legacy payload spread the producer's whole body.
            toolPayload = {
              success: toolResult.success,
              executionTimeMs: toolResult.execution_time_ms,
              toolResultReceipt: prepared.receipt,
              ...prepared.uiMetadata,
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

      if (isPermissionPromptResult(toolResult)) {
        await this.flushEventSaves(eventSink);
        // Permission still required — move back to the pending map. The
        // activeTurns entry we just created must be removed so the disjoint
        // invariant holds.
        this.activeTurns.delete(conversationId);
        this.pendingPermissions.set(conversationId, matchedByToolId);
        return {
          ok: false,
          error: "Permission is still required for this tool.",
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
        contextWindowTokens: await this.resolveContextWindowTokens(
          matchedByToolId.request.model
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
        // Keep the originating user turn attached to every round after a
        // permission resume. Without these fields, a successfully approved
        // draft is followed by a send round with no trusted intent, so the
        // outbound gate incorrectly falls back to `draft_required`.
        sourceUserMessageId: matchedByToolId.sourceUserMessageId,
        intentDecisionId: matchedByToolId.intentDecisionId,
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

      void this.loop
        .run(loopInput)
        .then(async (result) => {
          await this.handleLoopResult(
            result,
            module,
            eventSink,
            matchedByToolId.taskExecutionBinding
          );
        })
        .catch(async (err) => {
          console.error("[ai-chat-v2] resume loop failed:", err);
          void redirectToLoginOnAuthExpired(err);
          // T12: finalize the enrolled execution as failed/MODEL_FAILURE
          // before the error emit so the row never stays running on a
          // resume-path throw (FR-10/12/14/24, AC-24/25).
          await this.handleFailure(
            err,
            matchedByToolId.conversationId,
            matchedByToolId.assistantMessageId,
            matchedByToolId.eventSink,
            matchedByToolId.taskExecutionBinding
          );
        });

      return { ok: true };
    } catch (err) {
      this.clearActiveTurnState(conversationId);
      return { ok: false, error: userSafeError(err) };
    }
  }

  /**
   * Deny a paused tool after the user declines permission (scheduled-loop
   * deny-and-continue path). Unlike the interactive path (which stops the
   * whole conversation on deny), this synthesizes a denied tool_result,
   * pushes it to the conversation, and re-enters the loop from nextRound so
   * the scheduled run can proceed WITHOUT the tool. The model receives a
   * "permission denied" tool result and may continue with an alternate plan.
   *
   * Structural twin of {@link resumeToolAfterPermission} with three
   * differences: (1) synthesizes a denied ToolExecutionResult instead of
   * calling SkillExecutor.execute; (2) skips the isPermissionPromptResult
   * re-check (a deny is terminal, the tool won't re-prompt); (3) skips the
   * image-artifact handoff (a denied tool produces no artifacts).
   */
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
    this.activeTurns.set(conversationId, {
      abortController: matchedByToolId.abortController,
      assistantMessageId: matchedByToolId.assistantMessageId,
      turnId: matchedByToolId.turnId,
      eventSink: matchedByToolId.eventSink,
    });
    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(
      module,
      matchedByToolId.eventSink
    );

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
        goalAutoContinue: await this.shouldAutoContinueGoal(
          conversationId,
          Boolean(matchedByToolId.planContext),
          matchedByToolId.taskRoute
        ),
        taskExecutionBinding: matchedByToolId.taskExecutionBinding,
        taskRoute: matchedByToolId.taskRoute,
      };

      void this.loop
        .run(loopInput)
        .then(async (result) => {
          await this.handleLoopResult(
            result,
            module,
            eventSink,
            matchedByToolId.taskExecutionBinding
          );
        })
        .catch(async (err) => {
          console.error("[ai-chat-v2] deny-resume loop failed:", err);
          void redirectToLoginOnAuthExpired(err);
          // T12: finalize the enrolled execution as failed/MODEL_FAILURE
          // before the error emit so the row never stays running on a
          // deny-resume throw (FR-10/12/14/24, AC-24/25).
          await this.handleFailure(
            err,
            conversationId,
            matchedByToolId.assistantMessageId,
            matchedByToolId.eventSink,
            matchedByToolId.taskExecutionBinding
          );
        });

      return { ok: true };
    } catch (err) {
      this.clearActiveTurnState(conversationId);
      return { ok: false, error: userSafeError(err) };
    }
  }

  /** Helper: return the first value from a Map, or undefined. */
  private firstEntry<V>(map: Map<string, V>): V | undefined {
    for (const v of map.values()) return v;
    return undefined;
  }

  /**
   * Answer a plan-mode question and resume the paused turn.
   */
  async answerPlanQuestion(
    request: AnswerPlanQuestionRequest
  ): Promise<ResumeTurnResult> {
    const planModule = new AIChatPlanModule();

    let answered: {
      question: import("@/entityTypes/aiChatPlanTypes").AIChatPlanQuestionView;
      planState: AIChatPlanStateView;
    };
    try {
      answered = await planModule.answerQuestion({
        conversationId: request.conversationId,
        questionId: request.questionId,
        answers: request.answers,
      });
    } catch (err) {
      return { ok: false, error: userSafeError(err) };
    }

    const pending = this.pendingPlanQuestions.get(request.conversationId);
    if (
      !pending ||
      pending.questionId !== request.questionId ||
      pending.conversationId !== request.conversationId
    ) {
      return { ok: true };
    }

    this.pendingPlanQuestions.delete(request.conversationId);
    this.activeTurns.set(request.conversationId, {
      abortController: pending.abortController,
      assistantMessageId: pending.assistantMessageId,
      turnId: pending.turnId,
      eventSink: pending.eventSink,
    });

    const answerContent = serializeToolResultContent({
      success: true,
      status: "answered",
      questionId: answered.question.questionId,
      answers: request.answers,
    });

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
      recentUserMessages: collectRecentUserMessages(
        pending.conversationMessages
      ),
      model: pending.request.model,
      contextWindowTokens: await this.resolveContextWindowTokens(
        pending.request.model
      ),
    });

    const loopInput: AIChatQueryLoopInput = {
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      messages: pending.conversationMessages,
      request: pending.request,
      openAITools: allOpenAITools,
      abortController: pending.abortController,
      eventSink: pending.eventSink,
      skillRegistry: SkillRegistry,
      planContext,
      startRound: pending.nextRound,
      isActiveTurn: () => {
        const entry = this.activeTurns.get(pending.conversationId);
        return (
          !!entry && entry.assistantMessageId === pending.assistantMessageId
        );
      },
      toolCatalog: resumePlanCatalogContext.toolCatalog,
      toolCatalogModeDecision: resumePlanCatalogContext.toolCatalogModeDecision,
      toolCatalogState: pending.toolCatalogState,
      turnId: pending.turnId,
      goalAutoContinue: await this.shouldAutoContinueGoal(
        pending.conversationId,
        Boolean(planContext),
        pending.taskRoute
      ),
      taskExecutionBinding: pending.taskExecutionBinding,
      taskRoute: pending.taskRoute,
    };

    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(module, pending.eventSink);

    void this.loop
      .run({ ...loopInput, eventSink })
      .then(async (result) => {
        await this.handleLoopResult(
          result,
          module,
          eventSink,
          pending.taskExecutionBinding
        );
      })
      .catch(async (err) => {
        console.error("[ai-chat-v2] answer-question loop failed:", err);
        void redirectToLoginOnAuthExpired(err);
        // D2/R1 review fix: a policy-enrolled turn whose loop throws here
        // never reached any finalization path — the execution row stayed
        // `running` forever (AC-24/25 restart repair needs a finalized row).
        // finalizeManualAtTerminalFailure no-ops on !policyAccepted, so the
        // legacy path is untouched; never let a finalize error mask the
        // original loop failure.
        if (pending.taskExecutionBinding) {
          try {
            await this.finalizeManualAtTerminalFailure(
              pending.taskExecutionBinding,
              "failed",
              "MODEL_FAILURE",
              userSafeError(err)
            );
          } catch (finalizeErr) {
            console.error(
              "[ai-chat-v2] answer-question terminal finalize threw:",
              finalizeErr
            );
          }
        }
        pending.eventSink.emit({
          type: "error",
          conversationId: pending.conversationId,
          messageId: pending.assistantMessageId,
          errorMessage: userSafeError(err),
        });
        this.clearConversationTurnState(pending.conversationId);
      });

    return { ok: true };
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
    switch (result.type) {
      case "completed": {
        const { conversationId, assistantMessageId } = result;
        const activeTurn = this.activeTurns.get(conversationId);
        const completedTurnId = activeTurn?.turnId;
        const generatedImages = await this.storeGeneratedImages({
          conversationId,
          assistantMessageId,
          images: result.images,
        });
        if (
          result.fullContent.length > 0 ||
          generatedImages ||
          (typeof result.reasoningContent === "string" &&
            result.reasoningContent.length > 0)
        ) {
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
            },
            turnId: completedTurnId,
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
              taskExecutionBinding
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
        // Post-turn compaction. The durable incremental coordinator (§11) takes
        // precedence when injected — it dedups concurrent requests, acquires a
        // durable claim with fence/lease, and atomically saves/publishes the
        // bounded representation. Fall back to the legacy in-memory auto-compact
        // + session-memory advisory update when only the legacy agent is present.
        const coordinator = this.compactionCoordinator;
        if (coordinator) {
          Promise.resolve(
            coordinator.requestCompactionForTurn(conversationId, {
              trigger: "auto",
              model: result.model,
            })
          ).catch((err: unknown) =>
            console.error(
              "[ai-chat-compaction] post-turn coordinator request failed:",
              err
            )
          );
        } else if (this.compactAgent) {
          const compactAgent = this.compactAgent;
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
              console.error(
                "[ai-chat-compact] post-turn compaction failed:",
                err
              )
            );
        }
        if (this.autoDreamService) {
          this.autoDreamService
            .evaluateAfterChatTurn({
              conversationId,
              reason: "assistant_turn_completed",
              model: result.model,
            })
            .catch((err) =>
              console.error("[ai-auto-dream] chat trigger failed:", err)
            );
        }
        if (this.workspaceAutoDreamService) {
          this.workspaceAutoDreamService
            .evaluateAfterChatTurn({
              conversationId,
              reason: "assistant_turn_completed",
              model: result.model,
            })
            .catch((err) =>
              console.error("[workspace-auto-dream] chat trigger failed:", err)
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
              console.error("[desktop-notify] turn_complete failed:", err)
            );
        }
        this.dispatchStop(conversationId, "completed");
        this.clearActiveTurnState(conversationId, assistantMessageId);
        break;
      }
      case "cancelled": {
        const { conversationId, assistantMessageId } = result;
        const activeTurn = this.activeTurns.get(conversationId);
        const cancelledTurnId = activeTurn?.turnId;
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
            turnId: cancelledTurnId,
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
        this.dispatchStop(conversationId, "user_stopped");
        this.clearActiveTurnState(conversationId, assistantMessageId);
        break;
      }
      case "failed": {
        const { conversationId, assistantMessageId } = result;
        const activeTurn = this.activeTurns.get(conversationId);
        const failedTurnId = activeTurn?.turnId;
        void redirectToLoginOnAuthExpired(result.error);
        // Reactive overflow (AC-23): a budget-rejected turn means the active
        // context no longer fits — compact it through the SAME bounded
        // coordinator (trigger "reactive-overflow"), never a secondary
        // unbounded path. Fire-and-forget; the error below still surfaces.
        if (
          result.error instanceof RecoverableHistoryError &&
          result.error.code === "CONTEXT_REQUIRED_CONTENT_TOO_LARGE"
        ) {
          this.requestReactiveCompaction(conversationId, result.model);
        }
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
            turnId: failedTurnId,
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
          });
        }
        eventSink.emit({
          type: "error",
          conversationId,
          messageId:
            result.partialContent.length > 0 ? assistantMessageId : undefined,
          errorMessage: userSafeError(result.error),
          taskOutcome: failedTaskOutcome,
          taskExecutionId: failedTaskExecutionId,
          taskReasonCode: failedTaskReasonCode,
        });
        this.dispatchStop(conversationId, "error");
        this.clearConversationTurnState(conversationId, assistantMessageId);
        break;
      }
      case "paused_for_permission": {
        // Move the turn from activeTurns into pendingPermissions so the three
        // maps stay disjoint (a conversation is in exactly one of them). The
        // activeTurns entry is dropped; resuming re-adds it.
        this.activeTurns.delete(result.pending.conversationId);
        this.pendingPermissions.set(
          result.pending.conversationId,
          result.pending
        );
        console.log(
          `[ai-chat-v2] tool ${result.pending.toolName} needs permission — paused (nextRound=${result.pending.nextRound})`
        );
        break;
      }
      case "paused_for_plan_question": {
        this.activeTurns.delete(result.pending.conversationId);
        this.pendingPlanQuestions.set(
          result.pending.conversationId,
          result.pending
        );
        console.log(
          `[ai-chat-v2] AskUserQuestion paused (questionId=${result.pending.questionId}, nextRound=${result.pending.nextRound})`
        );
        break;
      }
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
    binding: LoopTaskExecutionBinding
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
    this.taskExecutionBindings.delete(conversationId);
  }

  private createPersistingEventSink(
    module: AIChatV2Module,
    eventSink: AIChatQueryEventSink
  ): AIChatQueryEventSink {
    if (this.pendingEventSaves.has(eventSink)) {
      return eventSink;
    }
    const saves: Promise<unknown>[] = [];
    // Track the latest server-reported usage so it can be attributed to
    // intermediate tool_call messages. Without this, every tool_call row
    // is persisted with null tokensUsed/model, losing per-round cost data.
    let latestUsage: { totalTokens: number; model?: string } | undefined;
    const wrapped: AIChatQueryEventSink = {
      emit: (event) => {
        eventSink.emit(event);
        if (event.type === "usage_update") {
          latestUsage = {
            totalTokens: event.totalTokens,
            model: event.model,
          };
        }
        if (event.type === "tool_call") {
          const toolTurnId = this.activeTurns.get(event.conversationId)?.turnId;
          saves.push(
            module
              .saveToolCallMessage({
                conversationId: event.conversationId,
                assistantMessageId: event.messageId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                toolArguments: event.toolArguments,
                model: latestUsage?.model,
                tokensUsed: latestUsage?.totalTokens,
                turnId: toolTurnId,
              })
              .catch((err: unknown) => {
                console.error("[ai-chat-v2] save tool call failed:", err);
              })
          );
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
          const toolTurnId = this.activeTurns.get(event.conversationId)?.turnId;
          saves.push(
            module
              .saveToolResultMessage({
                conversationId: event.conversationId,
                assistantMessageId: event.messageId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                content: event.fullContent,
                toolResult: event.toolResult,
                replacesPermissionPromptForToolId:
                  event.replacesPermissionPromptForToolId,
                turnId: toolTurnId,
              })
              .catch((err: unknown) => {
                console.error("[ai-chat-v2] save tool result failed:", err);
              })
          );
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
    saves: Promise<unknown>[]
  ): Promise<void> {
    if (saves.length === 0) {
      return;
    }
    await Promise.allSettled(saves);
    saves.length = 0;
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
      return stored.length > 0 ? stored : undefined;
    } catch (err) {
      console.warn(
        `[ai-chat-v2] failed to store generated images locally for conversation ${input.conversationId}:`,
        err
      );
      return input.images;
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
    console.error("[ai-chat-v2] engine failure:", err);
    void redirectToLoginOnAuthExpired(err);
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
      taskOutcome: failureTaskOutcome,
      taskExecutionId: failureTaskExecutionId,
      taskReasonCode: failureTaskReasonCode,
    });
    this.clearConversationTurnState(conversationId, assistantMessageId);
  }
}
