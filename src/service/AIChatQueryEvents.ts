// src/service/AIChatQueryEvents.ts
import type {
  OpenAIChatImage,
  OpenAIChatMessage,
  OpenAITool,
} from "@/api/aiChatApi";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";
import type {
  AIChatPlanQuestionView,
  AIChatPlanStateView,
  AskUserQuestionAnswer,
  AskUserQuestionPayload,
  SubmitPlanForApprovalPayload,
} from "@/entityTypes/aiChatPlanTypes";
import type { SkillDefinition } from "@/entityTypes/skillTypes";
import type {
  ToolCatalog,
  ToolCatalogModeDecision,
  ToolCatalogStateSnapshot,
} from "@/entityTypes/toolCatalogTypes";
import type {
  AIChatRecoveryLayer,
  AIChatRecoveryReason,
  ChatV2RecoveryMetadata,
} from "@/service/AIChatRecoveryTypes";

/**
 * Sink the engine emits non-terminal and terminal events into.
 * IPC implements this to forward events to the renderer channel.
 */
export interface AIChatQueryEventSink {
  emit(event: AIChatQueryEvent): void;
  /**
   * Optional persistence barrier for sinks that save events asynchronously.
   * The query loop calls this before executing a tool so tool-call persistence
   * does not race DB-writing tools such as artifact creation.
   */
  flush?(): Promise<void>;
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

export interface AIChatQueryReasoningDeltaEvent {
  type: "reasoning_delta";
  conversationId: string;
  messageId: string;
  reasoningDelta: string;
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

export type ToolProgressPhase =
  | "queued"
  | "running"
  | "fetching"
  | "extracting"
  | "finalizing";

export interface AIChatQueryToolProgressEvent {
  type: "tool_progress";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  phase: ToolProgressPhase;
  /** i18n key or fallback English string. */
  message: string;
  /** 0..1 when known, null when indeterminate. */
  progress: number | null;
  partialCount: number | null;
  expectedCount: number | null;
  timestamp: number;
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

export interface AIChatQueryPlanStateEvent {
  type: "plan_state";
  conversationId: string;
  messageId: string;
  planState: AIChatPlanStateView;
  /** Present when the transition was initiated by EnterPlanMode. */
  autoEntered?: boolean;
  rationale?: string;
}

export interface AIChatQueryCompleteEvent {
  type: "complete";
  conversationId: string;
  messageId: string;
  fullContent: string;
  images?: OpenAIChatImage[];
  model?: string;
  finishReason?: string | null;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
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

/**
 * Recovery status event for the seven-layer recovery strategy. Emitted
 * whenever a recovery layer becomes active, advances, or resolves.
 * Technical-design §4.4.
 */
export interface AIChatQueryRecoveryStatusEvent {
  type: "recovery_status";
  conversationId: string;
  messageId: string;
  /** Which recovery layer is reporting. */
  layer: AIChatRecoveryLayer;
  /** Classified reason for the underlying failure. */
  reason: AIChatRecoveryReason;
  /** 1-based attempt within this layer. */
  attempt?: number;
  /** Max attempts for this layer/profile, when applicable. */
  maxAttempts?: number;
  /** Delay before the next retry, when applicable. */
  delayMs?: number;
  /** Elapsed time in persistent retry, when applicable. */
  elapsedMs?: number;
  /** Original model the turn started with. */
  originalModel?: string;
  /** Current model after a fallback. */
  currentModel?: string;
  /** Resolved fallback model, on model_fallback events. */
  fallbackModel?: string;
  /** Human-readable message (i18n key or English fallback). */
  message?: string;
}

export type AIChatQueryEvent =
  | AIChatQueryStartEvent
  | AIChatQueryTokenEvent
  | AIChatQueryReasoningDeltaEvent
  | AIChatQueryRetryEvent
  | AIChatQueryRecoveryStatusEvent
  | AIChatQueryToolCallEvent
  | AIChatQueryToolProgressEvent
  | AIChatQueryToolResultNormalEvent
  | AIChatQueryPlanBlockedToolEvent
  | AIChatQueryAskUserQuestionEvent
  | AIChatQueryPlanSubmittedEvent
  | AIChatQueryPlanStateEvent
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
      images?: OpenAIChatImage[];
      model?: string;
      responseId?: string;
      /** Server-reported token usage from the final model round, if the
       * server supports stream_options.include_usage. Persisted on the
       * assistant message row so the CTX badge can render a meaningful
       * baseline when a conversation is reloaded. */
      totalTokens?: number;
      promptTokens?: number;
      completionTokens?: number;
      /** Final safe-to-show reasoning text accumulated across rounds, if any. */
      reasoningContent?: string;
      /** Final deferred-catalog discovered-tool snapshot, when deferred mode
       * was active, so the engine can persist it across restart (FR-5/AC-8). */
      toolCatalogState?: ToolCatalogStateSnapshot;
      /** Recovery metadata accumulated during the turn, if any recovery
       * layers were activated. Persisted on the assistant row metadata. */
      recoveryMetadata?: ChatV2RecoveryMetadata;
    }
  | {
      type: "cancelled";
      conversationId: string;
      assistantMessageId: string;
      partialContent: string;
      model?: string;
      responseId?: string;
      totalTokens?: number;
      promptTokens?: number;
      completionTokens?: number;
      /** Partial reasoning captured before the cancel, if any. */
      reasoningContent?: string;
      toolCatalogState?: ToolCatalogStateSnapshot;
      /** Recovery metadata for the cancelled turn, if any. */
      recoveryMetadata?: ChatV2RecoveryMetadata;
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
      /** Partial reasoning captured before the failure, if any. */
      reasoningContent?: string;
      toolCatalogState?: ToolCatalogStateSnapshot;
      /** Recovery metadata accumulated before the failure, if any. */
      recoveryMetadata?: ChatV2RecoveryMetadata;
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
  /**
   * Deferred tool catalog snapshot so discovered tools remain exposed after
   * the user grants permission (AC-8). Present only when deferred mode active.
   */
  toolCatalogState?: ToolCatalogStateSnapshot;
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
  /**
   * Deferred tool catalog snapshot so discovered tools remain exposed after
   * the user answers the plan question (AC-8). Present only when deferred
   * mode active.
   */
  toolCatalogState?: ToolCatalogStateSnapshot;
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

/**
 * Configuration that enables model-initiated Plan Mode entry.
 */
export interface AIChatAutoPlanLoopConfig {
  planModule: {
    ensurePlanForConversation(input: {
      conversationId: string;
      title?: string;
      objective?: string;
    }): Promise<AIChatPlanStateView>;
    cancelDraft(input: { planId: string }): Promise<void>;
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
  /** Plan-mode tools to add to the registry after EnterPlanMode is called. */
  planTools: OpenAITool[];
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
  /**
   * When set, the loop registers the EnterPlanMode tool and will transition
   * into Plan Mode mid-turn if the model calls it. Engine populates this
   * only when USER_AI_AUTO_PLAN === 'true' and AI is enabled.
   */
  autoPlan?: AIChatAutoPlanLoopConfig;
  /**
   * Optional skill registry used to look up per-tool timeout class.
   * When absent, the loop falls back to name-based inference.
   */
  readonly skillRegistry?: {
    getSkill(name: string): SkillDefinition | null | undefined;
  };
  startRound: number;
  /**
   * Returns false when this turn is no longer the active turn on the engine
   * (superseded by a newer submitMessage/resume). The loop uses this to
   * suppress stale stream chunks that arrive after the turn was superseded
   * but before the abort signal propagates through the underlying fetch.
   */
  isActiveTurn: () => boolean;
  /**
   * Deferred tool catalog. When present and `toolCatalogModeDecision.mode`
   * is "deferred", the loop filters the exposed tool set per round, adds the
   * `tool_catalog_search` tool, and intercepts discovery calls locally.
   * Omit (or keep mode "standard") to preserve current full-tool behavior.
   */
  toolCatalog?: ToolCatalog;
  toolCatalogState?: ToolCatalogStateSnapshot;
  toolCatalogModeDecision?: ToolCatalogModeDecision;
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
