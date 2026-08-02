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
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { HookDispatcher } from "@/service/hooks/HookDispatcher";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import { AtMentionResolutionService } from "@/service/aiChatAtMentions/AtMentionResolutionService";
import type { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import type { AIAutoDreamService } from "@/service/AIAutoDreamService";
import type { AIWorkspaceAutoDreamService } from "@/service/AIWorkspaceAutoDreamService";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  serializeToolResultContent,
  normalizeToolResult,
  isPermissionPromptResult,
} from "@/service/AIChatQueryLoop";
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
  ChatV2AttachmentKind,
  ChatV2AttachmentMetadata,
  ChatV2MessageMetadata,
  ChatV2RuntimeStatus,
} from "@/entityTypes/aiChatV2Types";
import type {
  OpenAITextContentPart,
  OpenAIImageUrlContentPart,
  OpenAIMessageContent,
} from "@/api/aiChatApi";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import type {
  ToolCatalog,
  ToolCatalogModeDecision,
  ToolCatalogRuntimeContext,
} from "@/entityTypes/toolCatalogTypes";

function isActivePlanState(plan?: AIChatPlanStateView | null): boolean {
  if (!plan) return false;
  return (
    plan.status !== "completed" &&
    plan.status !== "cancelled" &&
    plan.status !== "rejected"
  );
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
}

/**
 * Owns the conversation lifecycle: setup, persistence, pending state,
 * and stop. The engine delegates the inner model/tool round loop to
 * AIChatQueryLoop and handles the result.
 */
export class AIChatQueryEngine {
  private currentAbortController: AbortController | null = null;
  private currentConversationId: string | null = null;
  private currentAssistantMessageId: string | null = null;
  private pendingPermission: PendingPermissionTurn | null = null;
  private pendingPlanQuestion: PendingPlanQuestionTurn | null = null;
  private readonly contextAssembler: AIChatContextAssembler;
  private readonly compactAgent?: AIChatCompactAgentService;
  private readonly autoDreamService?: AIAutoDreamService;
  private readonly workspaceAutoDreamService?: AIWorkspaceAutoDreamService;
  private readonly generatedImageStorage?: AIChatQueryEngineDeps["generatedImageStorage"];
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
    this.autoDreamService = deps?.autoDreamService;
    this.workspaceAutoDreamService = deps?.workspaceAutoDreamService;
    this.generatedImageStorage = deps?.generatedImageStorage;
  }

  /** Return main-process truth for a conversation's current turn. */
  getConversationRuntimeStatus(
    conversationId: string
  ): ChatV2RuntimeStatus {
    if (this.pendingPermission?.conversationId === conversationId) {
      return "awaiting_permission";
    }
    if (this.pendingPlanQuestion?.conversationId === conversationId) {
      return "awaiting_user";
    }
    if (this.currentConversationId === conversationId) {
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
  private readonly conversationToolStateService =
    new ConversationToolStateService();

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
    const { eventSink, request } = input;
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
      this.currentConversationId = conversationId;
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

      // Resolve @-mentions on the (attachment-enriched) message: append a
      // model-facing context block while keeping it out of the saved display.
      const atMentionResolution =
        await new AtMentionResolutionService().resolveMessage(
          conversationId,
          messageToSave
        );
      const modelUserMessage = atMentionResolution.modelMessage;
      if (currentUserContentParts && currentUserContentParts.length > 0) {
        // Fold the @-mention context into the multimodal text part.
        currentUserContentParts = [
          { type: "text", text: modelUserMessage },
          ...currentUserContentParts.slice(1),
        ];
      }

      // Build user-message metadata (source + attachments + @-mentions).
      const userMetadata: ChatV2MessageMetadata = { source: "chat-v2" };
      if (attachmentMetadata) userMetadata.attachments = attachmentMetadata;
      if (atMentionResolution.metadata.length > 0) {
        userMetadata.atMentions = atMentionResolution.metadata;
      }
      const hasUserMetadataBeyondSource =
        !!attachmentMetadata || atMentionResolution.metadata.length > 0;

      // Save user message (display text = attachment-enriched message; the
      // @-mention context block lives only in modelUserMessage for the model).
      const savedUser = await module.saveUserMessage({
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

      assistantMessageId = `assistant-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      this.currentAssistantMessageId = assistantMessageId;
      messages = [...assembled.messages];
    } catch (err) {
      console.error("[ai-chat-v2] pre-stream error:", err);
      this.clearActiveTurnState();
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
    const toolFunctions = await SkillRegistry.getAllToolFunctions();
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
      model: request.model,
    });

    // Load persisted discovered-tool state so tools discovered in earlier turns
    // (before an app restart / conversation reload) remain exposed (FR-5/AC-8).
    const persistedToolCatalogState = toolCatalogContext.toolCatalog
      ? await this.conversationToolStateService.loadSnapshot(conversationId)
      : undefined;

    // ------------------------------------------------------------------
    // 4. Abort any prior active turn, create new abort controller
    // ------------------------------------------------------------------
    const abortController = new AbortController();
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    this.currentAbortController = abortController;
    this.pendingPermission = null;
    this.pendingPlanQuestion = null;

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
      isActiveTurn: () =>
        this.currentAssistantMessageId === assistantMessageId &&
        this.currentConversationId === conversationId,
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
      // Clear active turn unless paused for permission or plan question.
      if (
        this.currentConversationId === conversationId &&
        !this.pendingPermission &&
        !this.pendingPlanQuestion
      ) {
        this.currentAbortController = null;
        this.currentConversationId = null;
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
   * Stop the active turn: abort streaming, cancel pending permission/plan
   * question turns, and emit cancelled events through the stored event sinks.
   */
  stopActiveTurn(): void {
    this.dispatchStop(this.currentConversationId ?? undefined, "user_stopped");
    if (this.pendingPermission) {
      const pending = this.pendingPermission;
      this.pendingPermission = null;
      this.currentAbortController = null;
      this.currentConversationId = null;
      this.currentAssistantMessageId = null;
      pending.eventSink.emit({
        type: "cancelled",
        conversationId: pending.conversationId,
        messageId: pending.assistantMessageId,
        fullContent: "",
      });
    }
    if (this.pendingPlanQuestion) {
      const pending = this.pendingPlanQuestion;
      this.pendingPlanQuestion = null;
      this.currentAbortController = null;
      this.currentConversationId = null;
      this.currentAssistantMessageId = null;
      pending.eventSink.emit({
        type: "cancelled",
        conversationId: pending.conversationId,
        messageId: pending.assistantMessageId,
        fullContent: "",
      });
    }
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this.currentConversationId = null;
    this.currentAssistantMessageId = null;
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
    const pending = this.pendingPermission;
    if (!pending || pending.toolCallId !== request.toolId) {
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

    this.pendingPermission = null;
    this.currentAbortController = pending.abortController;
    this.currentConversationId = pending.conversationId;
    this.currentAssistantMessageId = pending.assistantMessageId;
    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(module, pending.eventSink);

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

      eventSink.emit({
        type: "tool_result",
        conversationId: pending.conversationId,
        messageId: pending.assistantMessageId,
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        fullContent: toolContent,
        toolResult: toolPayload,
        replacesPermissionPromptForToolId: pending.toolCallId,
      });

      if (isPermissionPromptResult(toolResult)) {
        await this.flushEventSaves(eventSink);
        this.pendingPermission = pending;
        return {
          ok: false,
          error: "Permission is still required for this tool.",
        };
      }

      pending.conversationMessages.push({
        role: "tool",
        tool_call_id: pending.toolCallId,
        content: toolContent,
      });

      // Rebuild the deferred catalog for the resumed turn and carry forward the
      // discovered-tool snapshot so discovered tools remain exposed (AC-8).
      const resumeCatalogContext = this.buildToolCatalogForTurn({
        tools: pending.openAITools,
        conversationId: pending.conversationId,
        isPlanMode: Boolean(pending.planContext),
        autoPlanEnabled: false,
        userMessage: pending.request.message,
        model: pending.request.model,
      });

      const loopInput: AIChatQueryLoopInput = {
        conversationId: pending.conversationId,
        assistantMessageId: pending.assistantMessageId,
        messages: pending.conversationMessages,
        request: pending.request,
        openAITools: pending.openAITools,
        abortController: pending.abortController,
        eventSink,
        skillRegistry: SkillRegistry,
        planContext: pending.planContext,
        startRound: pending.nextRound,
        isActiveTurn: () =>
          this.currentAssistantMessageId === pending.assistantMessageId &&
          this.currentConversationId === pending.conversationId,
        toolCatalog: resumeCatalogContext.toolCatalog,
        toolCatalogModeDecision: resumeCatalogContext.toolCatalogModeDecision,
        toolCatalogState: pending.toolCatalogState,
      };

      void this.loop
        .run(loopInput)
        .then(async (result) => {
          await this.handleLoopResult(result, module, eventSink);
        })
        .catch((err) => {
          console.error("[ai-chat-v2] resume loop failed:", err);
          pending.eventSink.emit({
            type: "error",
            conversationId: pending.conversationId,
            messageId: pending.assistantMessageId,
            errorMessage: userSafeError(err),
          });
          this.clearActiveTurnState();
          this.pendingPermission = null;
          this.pendingPlanQuestion = null;
        });

      return { ok: true };
    } catch (err) {
      this.currentAbortController = null;
      this.currentConversationId = null;
      this.currentAssistantMessageId = null;
      return { ok: false, error: userSafeError(err) };
    }
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

    const pending = this.pendingPlanQuestion;
    if (
      !pending ||
      pending.questionId !== request.questionId ||
      pending.conversationId !== request.conversationId
    ) {
      return { ok: true };
    }

    this.pendingPlanQuestion = null;

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

    this.currentAbortController = pending.abortController;
    this.currentConversationId = pending.conversationId;
    this.currentAssistantMessageId = pending.assistantMessageId;

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
      model: pending.request.model,
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
      isActiveTurn: () =>
        this.currentAssistantMessageId === pending.assistantMessageId &&
        this.currentConversationId === pending.conversationId,
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
        console.error("[ai-chat-v2] answer-question loop failed:", err);
        pending.eventSink.emit({
          type: "error",
          conversationId: pending.conversationId,
          messageId: pending.assistantMessageId,
          errorMessage: userSafeError(err),
        });
        this.clearActiveTurnState();
        this.pendingPermission = null;
        this.pendingPlanQuestion = null;
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
        if (this.compactAgent) {
          this.compactAgent
            .enqueueSessionMemoryUpdate({
              conversationId,
              reason: "assistant_turn_completed",
              promptTokens: result.promptTokens,
              model: result.model,
            })
            .catch((err) =>
              console.error(
                "[ai-chat-compact] session memory update failed:",
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
              console.error("[ai-auto-dream] chat trigger failed:", err)
            );
        }
        if (this.workspaceAutoDreamService) {
          this.workspaceAutoDreamService
            .evaluateAfterChatTurn({
              conversationId,
              reason: "assistant_turn_completed",
            })
            .catch((err) =>
              console.error("[workspace-auto-dream] chat trigger failed:", err)
            );
        }
        this.dispatchStop(conversationId, "completed");
        this.clearActiveTurnState();
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
        this.clearActiveTurnState();
        break;
      }
      case "failed": {
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
        this.dispatchStop(conversationId, "error");
        this.clearActiveTurnState();
        this.pendingPermission = null;
        this.pendingPlanQuestion = null;
        break;
      }
      case "paused_for_permission": {
        this.pendingPermission = result.pending;
        console.log(
          `[ai-chat-v2] tool ${result.pending.toolName} needs permission — paused (nextRound=${result.pending.nextRound})`
        );
        break;
      }
      case "paused_for_plan_question": {
        this.pendingPlanQuestion = result.pending;
        console.log(
          `[ai-chat-v2] AskUserQuestion paused (questionId=${result.pending.questionId}, nextRound=${result.pending.nextRound})`
        );
        break;
      }
    }
  }

  /**
   * Clear active-turn singleton state. Called after terminal results
   * (completed/cancelled/failed) and on unexpected failures.
   */
  private clearActiveTurnState(): void {
    this.currentAbortController = null;
    this.currentConversationId = null;
    this.currentAssistantMessageId = null;
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
                console.error("[ai-chat-v2] save tool call failed:", err);
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
  private handleFailure(
    err: unknown,
    conversationId: string,
    assistantMessageId: string,
    eventSink: AIChatQueryEventSink
  ): void {
    this.dispatchStop(conversationId, "error");
    console.error("[ai-chat-v2] engine failure:", err);
    eventSink.emit({
      type: "error",
      conversationId,
      messageId: assistantMessageId,
      errorMessage: userSafeError(err),
    });
    this.clearActiveTurnState();
    this.pendingPermission = null;
    this.pendingPlanQuestion = null;
  }
}
