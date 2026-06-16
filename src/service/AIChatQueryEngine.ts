// src/service/AIChatQueryEngine.ts
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import type {
  OpenAIChatMessage,
  OpenAITool,
  ToolFunction,
} from "@/api/aiChatApi";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  serializeToolResultContent,
  normalizeToolResult,
  isPermissionPromptResult,
} from "@/service/AIChatQueryLoop";
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

export interface AIChatQueryEngineDeps {
  /** Optional. When omitted, a default AIChatContextAssembler is constructed. */
  contextAssembler?: AIChatContextAssembler;
  /** Optional. When provided, the engine enqueues session memory updates
   * after each completed assistant turn. */
  compactAgent?: AIChatCompactAgentService;
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

  constructor(
    private readonly loop: AIChatQueryLoop,
    deps?: AIChatQueryEngineDeps
  ) {
    this.contextAssembler =
      deps?.contextAssembler ?? new AIChatContextAssembler();
    this.compactAgent = deps?.compactAgent;
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
      const basePrompt =
        request.systemPrompt ?? module.getDefaultSystemPrompt();
      const assembled = await this.contextAssembler.assemble({
        conversationId,
        currentUserMessage: request.message,
        baseSystemPrompt: basePrompt,
        mode: isPlanMode ? "plan" : "chat",
        model: request.model,
        maxTokens: request.maxTokens,
        planState,
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
      isActiveTurn: () =>
        this.currentAssistantMessageId === assistantMessageId &&
        this.currentConversationId === conversationId,
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

      pending.eventSink.emit({
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

      const loopInput: AIChatQueryLoopInput = {
        conversationId: pending.conversationId,
        assistantMessageId: pending.assistantMessageId,
        messages: pending.conversationMessages,
        request: pending.request,
        openAITools: pending.openAITools,
        abortController: pending.abortController,
        eventSink: pending.eventSink,
        planContext: pending.planContext,
        startRound: pending.nextRound,
        isActiveTurn: () =>
          this.currentAssistantMessageId === pending.assistantMessageId &&
          this.currentConversationId === pending.conversationId,
      };

      const module = new AIChatV2Module();

      void this.loop
        .run(loopInput)
        .then(async (result) => {
          await this.handleLoopResult(result, module, pending.eventSink);
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

    const loopInput: AIChatQueryLoopInput = {
      conversationId: pending.conversationId,
      assistantMessageId: pending.assistantMessageId,
      messages: pending.conversationMessages,
      request: pending.request,
      openAITools: allOpenAITools,
      abortController: pending.abortController,
      eventSink: pending.eventSink,
      planContext,
      startRound: pending.nextRound,
      isActiveTurn: () =>
        this.currentAssistantMessageId === pending.assistantMessageId &&
        this.currentConversationId === pending.conversationId,
    };

    const module = new AIChatV2Module();

    void this.loop
      .run(loopInput)
      .then(async (result) => {
        await this.handleLoopResult(result, module, pending.eventSink);
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
    switch (result.type) {
      case "completed": {
        const { conversationId, assistantMessageId } = result;
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
        if (this.compactAgent) {
          this.compactAgent
            .enqueueSessionMemoryUpdate({
              conversationId,
              reason: "assistant_turn_completed",
            })
            .catch((err) =>
              console.error(
                "[ai-chat-compact] session memory update failed:",
                err
              )
            );
        }
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
    this.clearActiveTurnState();
    this.pendingPermission = null;
    this.pendingPlanQuestion = null;
  }
}
