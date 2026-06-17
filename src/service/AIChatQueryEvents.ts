// src/service/AIChatQueryEvents.ts
import type { OpenAIChatMessage, OpenAITool } from "@/api/aiChatApi";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";
import type {
  AIChatPlanQuestionView,
  AIChatPlanStateView,
  AskUserQuestionAnswer,
  AskUserQuestionPayload,
  SubmitPlanForApprovalPayload,
} from "@/entityTypes/aiChatPlanTypes";

/**
 * Sink the engine emits non-terminal and terminal events into.
 * IPC implements this to forward events to the renderer channel.
 */
export interface AIChatQueryEventSink {
  emit(event: AIChatQueryEvent): void;
}

export interface AIChatQueryStartEvent {
  type: "start";
  conversationId: string;
  messageId: string;
}

export interface AIChatQueryTokenEvent {
  type: "token";
  conversationId: string;
  messageId: string;
  contentDelta: string;
  model?: string;
}

export interface AIChatQueryRetryEvent {
  type: "retry_connect";
  conversationId: string;
  messageId: string;
  retryAttempt: number;
  retryMaxAttempts: number;
  retryDelayMs: number;
}

export interface AIChatQueryToolCallEvent {
  type: "tool_call";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
}

export interface AIChatQueryToolResultEvent {
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  fullContent: string;
  toolResult: Record<string, unknown>;
  replacesPermissionPromptForToolId?: string;
}

export interface AIChatQueryToolResultNormalEvent
  extends AIChatQueryToolResultEvent {
  type: "tool_result";
}

export interface AIChatQueryPlanBlockedToolEvent {
  type: "plan_blocked_tool";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  fullContent: string;
  planBlockedToolName: string;
  planBlockedReason?: string;
}

export interface AIChatQueryAskUserQuestionEvent {
  type: "ask_user_question";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  question: AIChatPlanQuestionView;
  planState: AIChatPlanStateView;
}

export interface AIChatQueryPlanSubmittedEvent {
  type: "plan_submitted";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  planState: AIChatPlanStateView;
}

export interface AIChatQueryCompleteEvent {
  type: "complete";
  conversationId: string;
  messageId: string;
  fullContent: string;
  model?: string;
  finishReason?: string | null;
}

export interface AIChatQueryCancelledEvent {
  type: "cancelled";
  conversationId: string;
  messageId?: string;
  fullContent: string;
}

export interface AIChatQueryErrorEvent {
  type: "error";
  conversationId: string;
  messageId?: string;
  errorMessage: string;
}

export interface AIChatQueryUsageUpdateEvent {
  type: "usage_update";
  conversationId: string;
  messageId: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type AIChatQueryEvent =
  | AIChatQueryStartEvent
  | AIChatQueryTokenEvent
  | AIChatQueryRetryEvent
  | AIChatQueryToolCallEvent
  | AIChatQueryToolResultNormalEvent
  | AIChatQueryPlanBlockedToolEvent
  | AIChatQueryAskUserQuestionEvent
  | AIChatQueryPlanSubmittedEvent
  | AIChatQueryCompleteEvent
  | AIChatQueryCancelledEvent
  | AIChatQueryErrorEvent
  | AIChatQueryUsageUpdateEvent;

/**
 * Result returned by AIChatQueryLoop.run().
 * The engine decides persistence and terminal event emission based on this.
 */
export type AIChatQueryLoopResult =
  | {
      type: "completed";
      conversationId: string;
      assistantMessageId: string;
      fullContent: string;
      finishReason: string;
      model?: string;
      responseId?: string;
    }
  | {
      type: "cancelled";
      conversationId: string;
      assistantMessageId: string;
      partialContent: string;
      model?: string;
      responseId?: string;
    }
  | {
      type: "paused_for_permission";
      pending: PendingPermissionTurn;
    }
  | {
      type: "paused_for_plan_question";
      pending: PendingPlanQuestionTurn;
    }
  | {
      type: "failed";
      conversationId: string;
      assistantMessageId: string;
      error: unknown;
      partialContent: string;
      model?: string;
      responseId?: string;
    };

/** State stored when a tool needs user permission. */
export interface PendingPermissionTurn {
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  request: ChatV2StreamRequest;
  openAITools: OpenAITool[];
  nextRound: number;
  toolCallId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  planContext?: AIChatPlanLoopContext;
  eventSink: AIChatQueryEventSink;
}

/** State stored when plan mode asks the user a question. */
export interface PendingPlanQuestionTurn {
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  request: ChatV2StreamRequest;
  openAITools: OpenAITool[];
  nextRound: number;
  toolCallId: string;
  questionId: string;
  planId: string;
  eventSink: AIChatQueryEventSink;
}

/** Plan context carried through the loop. */
export interface AIChatPlanLoopContext {
  planModule: {
    saveQuestion(input: {
      conversationId: string;
      planId?: string;
      payload: AskUserQuestionPayload;
    }): Promise<AIChatPlanQuestionView>;
    submitPlanForApproval(input: {
      conversationId: string;
      planId?: string;
      payload: SubmitPlanForApprovalPayload;
    }): Promise<AIChatPlanStateView>;
    getPlanStateByPlanId(planId: string): Promise<AIChatPlanStateView | null>;
    answerQuestion(input: {
      conversationId: string;
      questionId: string;
      answers: AskUserQuestionAnswer[];
    }): Promise<{
      question: AIChatPlanQuestionView;
      planState: AIChatPlanStateView;
    }>;
  };
  planState: AIChatPlanStateView;
}

/** Loop input assembled by the engine. */
export interface AIChatQueryLoopInput {
  conversationId: string;
  assistantMessageId: string;
  messages: OpenAIChatMessage[];
  request: ChatV2StreamRequest;
  openAITools: OpenAITool[];
  abortController: AbortController;
  eventSink: AIChatQueryEventSink;
  planContext?: AIChatPlanLoopContext;
  startRound: number;
  /**
   * Returns false when this turn is no longer the active turn on the engine
   * (superseded by a newer submitMessage/resume). The loop uses this to
   * suppress stale stream chunks that arrive after the turn was superseded
   * but before the abort signal propagates through the underlying fetch.
   */
  isActiveTurn: () => boolean;
}

/** Request payload for resumeToolAfterPermission. */
export interface ResumeToolAfterPermissionRequest {
  toolId: string;
  conversationId?: string;
}

/** Request payload for answerPlanQuestion. */
export interface AnswerPlanQuestionRequest {
  questionId: string;
  conversationId: string;
  answers: AskUserQuestionAnswer[];
}

/** Result of a resume operation. */
export interface ResumeTurnResult {
  ok: boolean;
  error?: string;
}
