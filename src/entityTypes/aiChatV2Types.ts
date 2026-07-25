import { MessageType } from "@/entityTypes/commonType";
import type {
  AIChatPlanStateView,
  AIChatPlanQuestionView,
  AIChatPlanVersionView,
  ChatV2Mode,
  AIChatPlanStatus,
} from "@/entityTypes/aiChatPlanTypes";
import type { AIArtifactToolMetadata } from "@/entityTypes/aiArtifactTypes";
import type {
  AIChatRecoveryLayer,
  AIChatRecoveryReason,
  ChatV2RecoveryMetadata,
} from "@/service/AIChatRecoveryTypes";
import type { OpenAIChatImage } from "@/api/aiChatApi";

export type {
  ChatV2Mode,
  AIChatPlanStatus,
} from "@/entityTypes/aiChatPlanTypes";

/**
 * Tool approval mode for AI Chat V2 conversations.
 * Controls how permission-required tools are handled during a chat turn.
 *
 * - `ask_for_approval`: Show permission prompts for non-pure tools (default).
 * - `approve_for_me`  : Auto-approve non-shell tools; shell still prompts.
 * - `full_access`     : Auto-approve all registered tools after hard safety checks;
 *                        dependency installs still prompt.
 */
export type ChatToolApprovalMode =
  | "ask_for_approval"
  | "approve_for_me"
  | "full_access";

export type ChatV2GeneratedImage = OpenAIChatImage;

// ---------------------------------------------------------------------------
// Attachment types
// ---------------------------------------------------------------------------

export type ChatV2AttachmentKind = "document" | "image";

export interface ChatV2UploadedAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  kind: ChatV2AttachmentKind;
}

export interface ChatV2AttachmentMetadata {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: ChatV2AttachmentKind;
  processingMode?: "staged_markdown" | "rag_ingestion" | "image_url";
  documentId?: number;
}

/** Metadata stored on v2 chat rows in the existing ai_chat_messages table. */
export interface ChatV2MessageMetadata {
  source: "chat-v2" | "slash-command";
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
  attachments?: ChatV2AttachmentMetadata[];
  generatedImages?: ChatV2GeneratedImage[];
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
  // tool_progress: live progress metadata for long-running tools
  toolProgress?: {
    phase?: "queued" | "running" | "fetching" | "extracting" | "finalizing";
    message?: string;
    progress?: number | null;
    partialCount?: number | null;
    expectedCount?: number | null;
    updatedAt: number;
  };
  // AI artifact pointer (metadata only — never the full HTML content).
  // Present on tool_result messages produced by create_html_artifact.
  artifact?: AIArtifactToolMetadata;
  // Slash-command result rows. Present only on assistant messages rendered
  // from a slash-command dispatch's show_result variant.
  slashCommandResult?: boolean;
  slashCommandName?: string;
  /** Recovery metadata persisted on the assistant row when any recovery
   * layer activated during the turn. Technical-design §15.1. */
  recovery?: ChatV2RecoveryMetadata;
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
  toolApprovalMode?: ChatToolApprovalMode;
  uploadedFiles?: ChatV2UploadedAttachment[];
}

export interface ChatV2HistoryRequest {
  conversationId: string;
  limit?: number;
  offset?: number;
}

export interface ChatV2ClearConversationRequest {
  conversationId: string;
}

export type WorkspaceTrustScope = "instructions" | "all";

export interface WorkspaceWatchAcquireRequest {
  readonly conversationId: string;
  readonly workspaceId?: string;
}

export interface WorkspaceWatchReleaseRequest {
  readonly conversationId: string;
  readonly workspaceId?: string;
}

export interface WorkspaceTrustSetRequest {
  readonly workspaceId: string;
  readonly scope: WorkspaceTrustScope;
}

export interface WorkspaceWatchAcquireResponse {
  readonly workspaceId: string;
}

export interface WorkspaceTrustPreviewResponse {
  readonly content: string;
}

export interface WorkspaceTrustSetResponse {
  readonly ok: boolean;
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
  | "recovery_status"
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
  images?: ChatV2GeneratedImage[];
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
  // Recovery fields — present on recovery_status chunks emitted by the
  // seven-layer recovery strategy. See AIChatQueryRecoveryStatusEvent.
  recoveryLayer?: AIChatRecoveryLayer;
  recoveryReason?: AIChatRecoveryReason;
  recoveryAttempt?: number;
  recoveryMaxAttempts?: number;
  recoveryDelayMs?: number;
  recoveryElapsedMs?: number;
  recoveryOriginalModel?: string;
  recoveryCurrentModel?: string;
  recoveryFallbackModel?: string;
  recoveryMessage?: string;
  // Usage fields — present on usage_update chunks emitted at the end of each
  // model round when the server returns token counts.
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}
