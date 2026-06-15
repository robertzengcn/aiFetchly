// src/service/AIChatQueryEngine.ts
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import type {
  OpenAIChatMessage,
  OpenAITool,
  ToolFunction,
} from "@/api/aiChatApi";
import { SkillRegistry } from "@/config/skillsRegistry";
import { buildOpenAITranscript } from "@/service/OpenAIChatTranscriptBuilder";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { userSafeError } from "@/service/AIChatErrorMapper";
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
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

const CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES = 30;

/** Check whether a plan state is still active (not completed/cancelled/rejected). */
function isActivePlanState(plan?: AIChatPlanStateView | null): boolean {
  if (!plan) return false;
  return (
    plan.status !== "completed" &&
    plan.status !== "cancelled" &&
    plan.status !== "rejected"
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

export interface AIChatQuerySubmitInput {
  eventSink: AIChatQueryEventSink;
  request: ChatV2StreamRequest;
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

  constructor(private readonly loop: AIChatQueryLoop) {}

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

    try {
      conversationId = module.createConversationIfNeeded(
        request.conversationId
      );
      this.currentConversationId = conversationId;

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
      }

      // Save user message before remote call.
      const savedUser = await module.saveUserMessage({
        conversationId,
        content: request.message,
      });

      // Load history and build transcript.
      const history = await module.getConversationMessages(conversationId);
      const basePrompt =
        request.systemPrompt ?? module.getDefaultSystemPrompt();
      const transcript = buildOpenAITranscript({
        history: history.filter((r) => r.messageId !== savedUser.messageId),
        currentUserMessage: request.message,
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
      this.currentAssistantMessageId = assistantMessageId;
      messages = [...transcript.messages];
    } catch (err) {
      console.error("[ai-chat-v2] pre-stream error:", err);
      this.currentConversationId = null;
      this.currentAssistantMessageId = null;
      eventSink.emit({
        type: "error",
        conversationId: request.conversationId ?? "",
        errorMessage: userSafeError(err),
      });
      return;
    }

    // ------------------------------------------------------------------
    // 3. Resolve tools (skills + plan mode tools)
    // ------------------------------------------------------------------
    const toolFunctions = await SkillRegistry.getAllToolFunctions();
    const openAITools = toOpenAITools(toolFunctions);
    const allOpenAITools = isPlanMode
      ? [...openAITools, ...PlanModeToolRegistry.toOpenAITools()]
      : openAITools;

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
    // 7. Run the loop
    // ------------------------------------------------------------------
    const loopInput: AIChatQueryLoopInput = {
      conversationId,
      assistantMessageId,
      messages,
      request,
      openAITools: allOpenAITools,
      abortController,
      eventSink,
      planContext,
      startRound: 0,
    };

    try {
      const result = await this.loop.run(loopInput);
      await this.handleLoopResult(result, module, eventSink);
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

  /**
   * Stop the active turn: abort streaming, cancel pending permission/plan
   * question turns, and emit cancelled events through the stored event sinks.
   */
  stopActiveTurn(): void {
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
  // Accessor methods for pending state (Step 3 compatibility — resume
  // handlers in IPC use these until Step 4 moves resume into the engine).
  // -------------------------------------------------------------------------

  getPendingPermission(): PendingPermissionTurn | null {
    return this.pendingPermission;
  }

  getPendingPlanQuestion(): PendingPlanQuestionTurn | null {
    return this.pendingPlanQuestion;
  }

  clearPendingPermission(): void {
    this.pendingPermission = null;
  }

  clearPendingPlanQuestion(): void {
    this.pendingPlanQuestion = null;
  }

  /** Set active turn state from IPC resume handlers (Step 3 compat). */
  setActiveTurn(params: {
    conversationId: string;
    assistantMessageId: string;
    abortController: AbortController;
  }): void {
    this.currentConversationId = params.conversationId;
    this.currentAssistantMessageId = params.assistantMessageId;
    this.currentAbortController = params.abortController;
  }

  /**
   * Handle a loop result from a resume path (tool permission resume or
   * plan question answer resume). Sets the active turn fields so that
   * handleLoopResult can persist with the correct IDs, then delegates.
   *
   * This is public because IPC's resume handlers call the loop directly
   * in Step 3. Step 4 will move resume logic into the engine and remove
   * this method.
   */
  async handleResumeLoopResult(
    result: AIChatQueryLoopResult,
    module: AIChatV2Module,
    eventSink: AIChatQueryEventSink,
    conversationId: string,
    assistantMessageId: string
  ): Promise<void> {
    this.currentConversationId = conversationId;
    this.currentAssistantMessageId = assistantMessageId;
    try {
      await this.handleLoopResult(result, module, eventSink);
    } finally {
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
    const conversationId = this.currentConversationId ?? "";
    const assistantMessageId = this.currentAssistantMessageId ?? "";

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
        eventSink.emit({
          type: "complete",
          conversationId,
          messageId: assistantMessageId,
          fullContent: result.fullContent,
          model: result.model,
          finishReason: result.finishReason,
        });
        this.currentAbortController = null;
        this.currentConversationId = null;
        this.currentAssistantMessageId = null;
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
        this.currentAbortController = null;
        this.currentConversationId = null;
        this.currentAssistantMessageId = null;
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
        eventSink.emit({
          type: "error",
          conversationId,
          messageId:
            result.partialContent.length > 0 ? assistantMessageId : undefined,
          errorMessage: userSafeError(result.error),
        });
        this.currentAbortController = null;
        this.currentConversationId = null;
        this.currentAssistantMessageId = null;
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
   * Handle an unexpected failure during the loop run.
   */
  private handleFailure(
    err: unknown,
    conversationId: string,
    assistantMessageId: string,
    eventSink: AIChatQueryEventSink
  ): void {
    console.error("[ai-chat-v2] engine failure:", err);
    eventSink.emit({
      type: "error",
      conversationId,
      messageId: assistantMessageId,
      errorMessage: userSafeError(err),
    });
    this.currentAbortController = null;
    this.currentConversationId = null;
    this.currentAssistantMessageId = null;
    this.pendingPermission = null;
    this.pendingPlanQuestion = null;
  }

  // -------------------------------------------------------------------------
  // Resume methods — properly implemented in Step 4.
  // For Step 3, these throw to indicate they should not be called directly.
  // IPC resume handlers use the pending state accessors instead.
  // -------------------------------------------------------------------------

  async resumeToolAfterPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult> {
    void request;
    throw new Error("Not implemented in step 3");
  }

  async answerPlanQuestion(
    request: AnswerPlanQuestionRequest
  ): Promise<ResumeTurnResult> {
    void request;
    throw new Error("Not implemented in step 3");
  }
}
