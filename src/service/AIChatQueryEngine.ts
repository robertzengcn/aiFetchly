// src/service/AIChatQueryEngine.ts
import { AIChatV2Module } from "@/modules/AIChatV2Module";
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
} from "@/service/AIChatQueryLoop";
import {
  buildImageArtifactHandoffMessage,
  countImageContentParts,
  countImageDataUrlChars,
} from "@/service/AIChatImageHandoff";
import { redirectToLoginOnAuthExpired } from "@/service/AIChatAuthExpiredHandler";
import { userSafeError, isContextWindowExceededError } from "@/service/AIChatErrorMapper";
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
  ChatV2GeneratedImageReference,
  ChatV2GeneratedImageReferenceMetadata,
} from "@/entityTypes/aiChatV2Types";
import type { AIChatScheduledTurnContext } from "@/entityTypes/aiChatScheduledLoopTypes";
import type {
  OpenAITextContentPart,
  OpenAIImageUrlContentPart,
} from "@/api/aiChatApi";
import { openAIContentToString } from "@/api/aiChatApi";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import type {
  ToolCatalog,
  ToolCatalogModeDecision,
  ToolCatalogRuntimeContext,
} from "@/entityTypes/toolCatalogTypes";
import { log } from "@/modules/Logger";

function isActivePlanState(plan?: AIChatPlanStateView | null): boolean {
  if (!plan) return false;
  return (
    plan.status !== "completed" &&
    plan.status !== "cancelled" &&
    plan.status !== "rejected"
  );
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
  generated_image_batch_cancelled:
    "Generated image preparation was cancelled.",
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
}

/**
 * Owns the conversation lifecycle: setup, persistence, pending state,
 * and stop. The engine delegates the inner model/tool round loop to
 * AIChatQueryLoop and handles the result.
 */
interface ActiveTurnState {
  abortController: AbortController;
  assistantMessageId: string;
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
  private pendingPlanQuestions = new Map<string, PendingPlanQuestionTurn>();
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
    this.contextAssembler =
      deps?.contextAssembler ?? new AIChatContextAssembler();
    this.compactAgent = deps?.compactAgent;
    this.modelCatalog = new AIChatModelCatalogService();
    this.autoDreamService = deps?.autoDreamService;
    this.workspaceAutoDreamService = deps?.workspaceAutoDreamService;
    this.generatedImageStorage = deps?.generatedImageStorage;
    this.generatedImageReferenceResolver =
      deps?.generatedImageReferenceResolver;
    this.toolFilter = deps?.toolFilter;
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
   * Resolve the real context window (tokens) for a model. Falls back to
   * the model catalog's default (128k) when the model is unknown. Never
   * throws. Used by the pre-turn proactive compact gate.
   */
  private async resolveContextWindowForModel(
    model?: string
  ): Promise<number> {
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
   */
  async submitMessage(input: AIChatQuerySubmitInput): Promise<void> {
    const { eventSink, request, scheduledContext } = input;
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
    let messages: OpenAIChatMessage[];
    let textApprovedPlanState: AIChatPlanStateView | null = null;

    try {
      conversationId = module.createConversationIfNeeded(
        request.conversationId
      );
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
      if (currentUserContentParts && currentUserContentParts.length > 0) {
        // Fold the @-mention context into the multimodal text part.
        currentUserContentParts = [
          { type: "text", text: modelUserMessage },
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
          currentUserContentParts?.filter(
            (part) => part.type === "image_url"
          ).length ?? 0;
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
          return;
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
      const hasUserMetadataBeyondSource =
        !!attachmentMetadata ||
        atMentionResolution.metadata.length > 0 ||
        pastedTextResolution.pastedBlocks.length > 0 ||
        !!scheduledContext ||
        !!generatedImageRefMetadata;

      // Save user message (display text = attachment-enriched message; the
      // @-mention context block lives only in modelUserMessage for the model).
      // Scheduled turns use a stable message id + insert-if-absent so a
      // crash-retry does not duplicate the transcript row (technical-design §14.2).
      const savedUser = scheduledContext
        ? await module.saveUserMessageIfAbsent({
            conversationId,
            content: messageToSave,
            messageId: scheduledContext.userMessageId,
            metadata: userMetadata,
          })
        : await module.saveUserMessage({
            conversationId,
            content: messageToSave,
            metadata: hasUserMetadataBeyondSource ? userMetadata : undefined,
          });

      // Persist attachment bytes to DB (original file bytes, not the staged markdown).
      if (hasFiles) {
        await this.persistAttachmentBytes(
          request.uploadedFiles!,
          conversationId,
          savedUser.messageId
        );
      }

      // Load history and build transcript.
      const basePrompt =
        request.systemPrompt ?? module.getDefaultSystemPrompt();
      const assembled = await this.contextAssembler.assemble({
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

      assistantMessageId = scheduledContext
        ? scheduledContext.assistantMessageId
        : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    } catch (err) {
      log.error("[ai-chat-v2] pre-stream error:", err);
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
    const tokenService = new Token();
    const autoPlanEnabled =
      !isPlanMode &&
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
    // ------------------------------------------------------------------
    const prior = this.activeTurns.get(conversationId);
    if (prior) {
      prior.abortController.abort();
    }
    const abortController = new AbortController();
    this.activeTurns.set(conversationId, {
      abortController,
      assistantMessageId,
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
    };

    try {
      const result = await this.loop.run(loopInput);
      await this.handleLoopResult(result, module, streamEventSink);
    } catch (err) {
      this.handleFailure(err, conversationId, assistantMessageId, eventSink);
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
   */
  private stopConversation(conversationId: string): void {
    this.dispatchStop(conversationId, "user_stopped");
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

      const toolPayload = normalizeToolResult(toolResult);
      const toolContent = serializeToolResultContent(toolPayload);

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
      };

      void this.loop
        .run(loopInput)
        .then(async (result) => {
          await this.handleLoopResult(result, module, eventSink);
        })
        .catch((err) => {
          log.error("[ai-chat-v2] resume loop failed:", err);
          void redirectToLoginOnAuthExpired(err);
          matchedByToolId.eventSink.emit({
            type: "error",
            conversationId: matchedByToolId.conversationId,
            messageId: matchedByToolId.assistantMessageId,
            errorMessage: userSafeError(err),
          });
          this.clearConversationTurnState(matchedByToolId.conversationId);
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
    };

    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(module, pending.eventSink);

    void this.loop
      .run({ ...loopInput, eventSink })
      .then(async (result) => {
        await this.handleLoopResult(result, module, eventSink);
      })
      .catch((err) => {
        log.error("[ai-chat-v2] answer-question loop failed:", err);
        void redirectToLoginOnAuthExpired(err);
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
    eventSink: AIChatQueryEventSink
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
            },
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
        });
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
          Promise.resolve(compactAgent.enqueueAutoCompact?.(compactInput) ?? false)
            .then((compacted) =>
              compacted
                ? undefined
                : compactAgent.enqueueSessionMemoryUpdate(compactInput)
            )
            .catch((err) =>
              log.error(
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
        this.dispatchStop(conversationId, "completed");
        this.clearActiveTurnState(conversationId, assistantMessageId);
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
        eventSink.emit({
          type: "cancelled",
          conversationId,
          messageId:
            result.partialContent.length > 0 ? assistantMessageId : undefined,
          fullContent: result.partialContent,
        });
        this.dispatchStop(conversationId, "user_stopped");
        this.clearActiveTurnState(conversationId, assistantMessageId);
        break;
      }
      case "failed": {
        const { conversationId, assistantMessageId } = result;
        void redirectToLoginOnAuthExpired(result.error);
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
        eventSink.emit({
          type: "error",
          conversationId,
          messageId:
            result.partialContent.length > 0 ? assistantMessageId : undefined,
          errorMessage: userSafeError(result.error),
        });
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
        log.info(
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
        log.info(
          `[ai-chat-v2] AskUserQuestion paused (questionId=${result.pending.questionId}, nextRound=${result.pending.nextRound})`
        );
        break;
      }
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
              })
              .catch((err: unknown) => {
                log.error("[ai-chat-v2] save tool call failed:", err);
              })
          );
        }
        if (event.type === "tool_result") {
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
              })
              .catch((err: unknown) => {
                log.error("[ai-chat-v2] save tool result failed:", err);
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
      log.warn(
        `[ai-chat-v2] failed to store generated images locally for conversation ${input.conversationId}:`,
        err
      );
      return input.images;
    }
  }

  /**
   * Handle an unexpected failure during the loop run.
   */
  private handleFailure(
    err: unknown,
    conversationId: string,
    assistantMessageId: string,
    eventSink: AIChatQueryEventSink
  ): void {
    this.dispatchStop(conversationId, "error");
    log.error("[ai-chat-v2] engine failure:", err);
    void redirectToLoginOnAuthExpired(err);
    eventSink.emit({
      type: "error",
      conversationId,
      messageId: assistantMessageId,
      errorMessage: userSafeError(err),
    });
    this.clearConversationTurnState(conversationId, assistantMessageId);
  }
}
