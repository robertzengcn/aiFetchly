import { MessageType } from "@/entityTypes/commonType";
import type {
  AIChatPlanStateView,
  AIChatPlanQuestionView,
  AIChatPlanVersionView,
  ChatV2Mode,
  AIChatPlanStatus,
} from "@/entityTypes/aiChatPlanTypes";

export type {
  ChatV2Mode,
  AIChatPlanStatus,
} from "@/entityTypes/aiChatPlanTypes";

/** Metadata stored on v2 chat rows in the existing ai_chat_messages table. */
export interface ChatV2MessageMetadata {
  source: "chat-v2";
  openaiResponseId?: string;
  finishReason?: string | null;
  cancelled?: boolean;
  error?: string;
  toolCallId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  toolResultStatus?: "success" | "error";
  toolResultSummary?: string;
  success?: boolean;
  executionTimeMs?: number;
  summary?: string;
  // Plan-mode fields (present only on plan-related display rows)
  planEventType?:
    | "ask_user_question"
    | "plan_submitted"
    | "plan_approved"
    | "plan_rejected"
    | "plan_blocked_tool"
    | "plan_changes_requested";
  planId?: string;
  planVersion?: number;
  questionId?: string;
  questionView?: AIChatPlanQuestionView;
  planStateView?: AIChatPlanStateView;
  planBlockedToolName?: string;
  planBlockedReason?: string;
}

/** Renderer request to start a streaming chat turn. */
export interface ChatV2StreamRequest {
  conversationId?: string;
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mode?: ChatV2Mode;
}

export interface ChatV2HistoryRequest {
  conversationId: string;
  limit?: number;
  offset?: number;
}

export interface ChatV2ClearConversationRequest {
  conversationId: string;
}

/** Conversation summary for the sidebar. */
export interface ChatV2ConversationSummary {
  conversationId: string;
  title: string;
  lastMessage: string;
  lastMessageTimestamp: string;
  messageCount: number;
  createdAt: string;
  planStatus?: AIChatPlanStatus;
  activePlanId?: string;
}

/** Single message view rendered by the UI. */
export interface ChatV2MessageView {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
  messageType: MessageType;
  model?: string;
  tokensUsed?: number;
  metadata?: ChatV2MessageMetadata;
}

export interface ChatV2HistoryResponse {
  conversationId: string;
  messages: ChatV2MessageView[];
  totalMessages: number;
}

/** App-level stream chunk sent over IPC to the renderer. */
export type ChatV2StreamEventType =
  | "start"
  | "token"
  | "tool_call_delta"
  | "tool_call"
  | "tool_progress"
  | "tool_result"
  | "plan_state"
  | "ask_user_question"
  | "plan_submitted"
  | "plan_approved"
  | "plan_rejected"
  | "plan_blocked_tool"
  | "plan_changes_requested"
  | "retry_connect"
  | "usage_update"
  | "error"
  | "cancelled"
  | "complete";

export interface ChatV2StreamChunk {
  eventType: ChatV2StreamEventType;
  conversationId: string;
  messageId?: string;
  contentDelta?: string;
  fullContent?: string;
  model?: string;
  finishReason?: string | null;
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  replacesPermissionPromptForToolId?: string;
  /** tool_progress: lifecycle phase of a long-running tool. */
  phase?: "queued" | "running" | "fetching" | "extracting" | "finalizing";
  /** tool_progress: human-readable status message (i18n key or English fallback). */
  progressMessage?: string;
  /** tool_progress: 0..1 progress fraction, or undefined when indeterminate. */
  progressFraction?: number;
  /** tool_progress: count of items processed so far, when known. */
  partialCount?: number;
  /** tool_progress: total items expected, when known. */
  expectedCount?: number;
  /** tool_progress: epoch ms when this progress update was emitted. */
  progressTimestamp?: number;
  planState?: AIChatPlanStateView;
  /** Present on plan_state chunks when transition was auto-initiated by EnterPlanMode. */
  autoEntered?: boolean;
  /** Rationale supplied by the model when calling EnterPlanMode. */
  rationale?: string;
  question?: AIChatPlanQuestionView;
  planVersion?: AIChatPlanVersionView;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryDelayMs?: number;
  // Usage fields — present on usage_update chunks emitted at the end of each
  // model round when the server returns token counts.
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}
