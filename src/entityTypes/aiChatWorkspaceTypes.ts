/**
 * Shared typed contracts for the AI Chat Workspace redesign
 * (PRD §16–§18, technical-design §8/§11).
 *
 * These types are used by BOTH the main process (coordinator, router, IPC
 * handlers) and the renderer (stores, components). They must stay
 * renderer-safe: no Electron objects, no database entities, no secrets.
 */
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

// ---------------------------------------------------------------------------
// Run lifecycle (PRD §16.1 / design §8.3)
// ---------------------------------------------------------------------------

/** Who owns a chat run. */
export type ChatRunOwner = "interactive" | "scheduled" | "goal" | "agent";

/** Durable lifecycle status shared by runs and the sidebar projection. */
export type ChatRunStatus =
  | "queued"
  | "running"
  | "awaiting_permission"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

/** Sidebar/runtime status: run status plus the idle resting state. */
export type ConversationRuntimeStatus = ChatRunStatus | "idle";

/** Attention flags derived from run state + acknowledgement markers. */
export type ConversationAttention =
  | "none"
  | "permission"
  | "user_input"
  | "failure";

/** Resource class used by the bounded scheduler (design §10.1). */
export type ChatRunResourceClass = "general" | "browser" | "cpu" | "artifact_batch";

/** Terminal statuses — immutable once written (design §9.1). */
export const CHAT_RUN_TERMINAL_STATUSES: readonly ChatRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

export function isChatRunTerminal(status: ChatRunStatus): boolean {
  return CHAT_RUN_TERMINAL_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Workspace + conversation sidebar projection (PRD §9–§10 / design §8.1, §8.6)
// ---------------------------------------------------------------------------

/** One conversation row in the workspace sidebar. */
export interface WorkspaceConversationSummary {
  readonly conversationId: string;
  readonly workspaceKey: string | null;
  readonly title: string;
  readonly preview: string;
  readonly lastActivityAt: string;
  readonly unread: boolean;
  readonly attention: ConversationAttention;
  readonly runtimeStatus: ConversationRuntimeStatus;
  readonly activeRunId: string | null;
}

/** One workspace group in the sidebar. */
export interface WorkspaceGroupSummary {
  readonly workspaceKey: string;
  readonly displayName: string;
  readonly canonicalRootPath: string | null;
  readonly approvalState: string;
  readonly conversations: readonly WorkspaceConversationSummary[];
}

/** Bootstrap response for the workspace shell (design §11.2). */
export interface WorkspaceSidebarResponse {
  readonly workspaces: readonly WorkspaceGroupSummary[];
  readonly unassigned: readonly WorkspaceConversationSummary[];
  readonly selectedConversationId: string | null;
}

// ---------------------------------------------------------------------------
// Event contracts (PRD §18 / design §11.4–§11.5)
// ---------------------------------------------------------------------------

/** Redacted summary event for inactive conversations — no content bodies. */
export interface ConversationSummaryEvent {
  readonly conversationId: string;
  readonly workspaceKey: string | null;
  readonly runtimeStatus: ConversationRuntimeStatus;
  readonly attention: ConversationAttention;
  readonly unread: boolean;
  readonly lastActivityAt: string;
  readonly runId?: string;
  readonly title?: string;
  readonly reason:
    | "run_queued"
    | "run_started"
    | "permission_required"
    | "user_input_required"
    | "run_completed"
    | "run_failed"
    | "run_cancelled"
    | "run_interrupted"
    | "artifact_created"
    | "conversation_updated";
}

/** Event types carried by the detail-event envelope. */
export type ChatRunDetailEventType =
  | "queued"
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
  | "goal_state"
  | "goal_iteration"
  | "goal_evidence"
  | "goal_verification"
  | "attention_cleared"
  | "error"
  | "cancelled"
  | "complete";

/** Run-aware detail event envelope routed only to the selected conversation. */
export interface ChatRunDetailEvent {
  readonly conversationId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly emittedAt: string;
  readonly eventType: ChatRunDetailEventType;
  readonly payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Commands (design §11.2–§11.3)
// ---------------------------------------------------------------------------

export interface StartChatRunRequest {
  readonly conversationId: string;
  readonly clientRequestId: string;
  readonly message: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  readonly mode?: string;
  readonly showReasoning?: boolean;
  readonly reasoning?: {
    enabled: boolean;
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
  readonly toolApprovalMode?: string;
  readonly resourceClass?: "general";
}

export interface StartChatRunResponse {
  readonly conversationId: string;
  readonly runId: string;
  readonly status: "queued" | "running";
  readonly acceptedAt: string;
}

export interface CancelChatRunRequest {
  readonly conversationId: string;
  readonly runId?: string;
}

export interface SelectConversationRequest {
  readonly conversationId: string | null;
  readonly generation: number;
}

export interface SelectConversationResponse {
  readonly acceptedGeneration: number;
  readonly conversationId: string | null;
  readonly messages: readonly ChatV2MessageView[];
  readonly nextBefore: HistoryCursor | null;
  readonly hasOlder: boolean;
  /** Live run status when known; the engine status as fallback. */
  readonly runtimeStatus: ConversationRuntimeStatus;
  readonly activeRunId: string | null;
  readonly title: string | null;
}

export interface HistoryCursor {
  readonly timestamp: string;
  readonly messageId: string;
}

export interface ChatHistoryPageRequest {
  readonly conversationId: string;
  readonly limit: number;
  readonly before?: HistoryCursor;
}

export interface ChatHistoryPageResponse {
  readonly conversationId: string;
  readonly messages: readonly ChatV2MessageView[];
  readonly nextBefore: HistoryCursor | null;
  readonly hasOlder: boolean;
}

export interface MarkConversationReadRequest {
  readonly conversationId: string;
  /** ISO timestamp of the newest persisted result the renderer has displayed. */
  readonly observedThrough: string;
}

export interface RenameConversationRequest {
  readonly conversationId: string;
  readonly title: string;
}
