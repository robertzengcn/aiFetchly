import { MessageType } from "@/entityTypes/commonType";
import type {
  AIChatPlanStateView,
  AIChatPlanQuestionView,
  AIChatPlanVersionView,
  ChatV2Mode,
  AIChatPlanStatus,
} from "@/entityTypes/aiChatPlanTypes";
import type { ChatV2AtMentionMetadata } from "@/entityTypes/aiChatAtMentionTypes";
import type { ChatV2PastedBlockMetadata } from "@/entityTypes/pastedTextTypes";
import type {
  ChatV2GoalStateEvent,
  ChatV2GoalIterationEvent,
  ChatV2GoalEvidenceEvent,
  ChatV2GoalVerificationEvent,
} from "@/entityTypes/aiChatGoalTypes";
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

/** Persisted reasoning metadata for an assistant message. Local user data. */
export interface ChatV2ReasoningMetadata {
  content: string;
  format: "plain_text";
  source: "server" | "local_provider" | "unknown";
  model?: string;
  truncated?: boolean;
}

export type ChatV2GeneratedImage = OpenAIChatImage;

/** Authoritative main-process lifecycle state for a conversation turn. */
export type ChatV2RuntimeStatus =
  | "idle"
  | "running"
  | "awaiting_permission"
  | "awaiting_user";

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
  /**
   * Inline `data:` URL for an image attachment preview. Only present for
   * `kind === "image"`. Carries the same downscaled base64 bytes sent to the
   * model, so the user's own message bubble can render the image they sent
   * without a separate fetch. Persisted on the user row so previews survive
   * history reloads.
   */
  previewDataUrl?: string;
}

/** Scheduled-loop metadata attached to user/assistant rows produced by a
 * scheduled occurrence (technical-design §9.5). Bounded and renderer-safe. */
export interface ChatV2ScheduledLoopMetadata {
  readonly scheduleId: number;
  readonly taskId: number;
  readonly runId: number;
  readonly occurrence: number;
  readonly scheduledFor?: string;
  readonly catchUp: boolean;
  readonly status?: "running" | "completed" | "failed" | "cancelled";
}

/** Metadata stored on v2 chat rows in the existing ai_chat_messages table. */
export interface ChatV2MessageMetadata {
  source: "chat-v2" | "slash-command" | "scheduled-loop";
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
  /** Persisted reasoning metadata for an assistant message. Local user data. */
  reasoning?: ChatV2ReasoningMetadata;
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
  // @-mention context resolved at send time for user messages.
  atMentions?: readonly ChatV2AtMentionMetadata[];
  /**
   * Pasted-text placeholders resolved at send time.
   * Visible in UI, excluded from compact/memory/model context unless the
   * resolution service expands it.
   */
  pastedBlocks?: readonly ChatV2PastedBlockMetadata[];
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
  /** Scheduled-loop metadata for rows produced by a scheduled occurrence. */
  scheduledLoop?: ChatV2ScheduledLoopMetadata;
  /** Visible in history but excluded from model, compact, and memory context.
   * Used for the raw `/loop` command and its local confirmation row so the
   * model does not interpret schedule-management text as a new instruction. */
  localOnly?: boolean;
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
  /** UI preference: render the reasoning panel when reasoning data exists. */
  showReasoning?: boolean;
  /** Provider/server reasoning request option; derived from showReasoning when omitted. */
  reasoning?: {
    enabled: boolean;
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
  toolApprovalMode?: ChatToolApprovalMode;
  uploadedFiles?: ChatV2UploadedAttachment[];
  /**
   * Send-time only: pasteId -> full cleaned paste body. Expanded into the
   * model-facing message right before mention resolution.
   */
  pastedContents?: Record<string, string>;
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
  runtimeStatus?: ChatV2RuntimeStatus;
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
  runtimeStatus: ChatV2RuntimeStatus;
}

/** App-level stream chunk sent over IPC to the renderer. */
export type ChatV2StreamEventType =
  | "start"
  | "token"
  | "reasoning_delta"
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
  | "complete"
  | "goal_state"
  | "goal_iteration"
  | "goal_evidence"
  | "goal_verification";

export interface ChatV2StreamChunk {
  eventType: ChatV2StreamEventType;
  conversationId: string;
  messageId?: string;
  contentDelta?: string;
  /** reasoning_delta: incremental safe-to-show reasoning text. */
  reasoningDelta?: string;
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
  // Goal/loop event payloads (present only on goal_* chunks).
  goalState?: ChatV2GoalStateEvent;
  goalIteration?: ChatV2GoalIterationEvent;
  goalEvidence?: ChatV2GoalEvidenceEvent;
  goalVerification?: ChatV2GoalVerificationEvent;
}

/**
 * Main->renderer broadcast emitted after an automatic full compact completes
 * (context reached the threshold fraction of the model's window). The
 * renderer drops the context badge to the summary's token estimate — same
 * behavior as the manual compact button.
 */
export interface ChatV2AutoCompactedEvent {
  readonly conversationId: string;
  /** Estimated tokens of the compact summary — the new context baseline. */
  readonly outputTokenEstimate: number;
  /** Model that produced the summary, when known. */
  readonly model?: string;
  readonly occurredAt: string;
}
