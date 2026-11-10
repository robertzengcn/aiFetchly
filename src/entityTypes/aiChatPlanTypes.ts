export type ChatV2Mode = "chat" | "plan";

export type AIChatPlanStatus =
  | "draft"
  | "awaiting_question"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "rejected"
  | "completed"
  | "cancelled";

/**
 * Statuses where the plan has left the planning conversation and the chat
 * should behave as plain chat again: the lifecycle ended (completed /
 * cancelled / rejected), or the user already approved the plan so execution
 * runs with the normal chat prompt and full tool access.
 *
 * Single source of truth shared by the renderer (mode selector via
 * planStateUtil.ts) and the main process (AIChatQueryEngine) so the two
 * processes can never disagree about which prompt/toolset a round uses.
 */
export const PLAN_LIFECYCLE_ENDED_STATUSES: ReadonlySet<AIChatPlanStatus> =
  new Set<AIChatPlanStatus>([
    "approved",
    "executing",
    "completed",
    "cancelled",
    "rejected",
  ]);

/**
 * True when the given status represents an active, in-progress plan
 * (draft / awaiting_question / awaiting_approval) — i.e. the planning
 * conversation is still open and the chat should stay in plan mode.
 * False for a plan that ended or was approved (approval hands control
 * back to execution in chat mode) and for null (no plan).
 */
export function isPlanStatusPlanningActive(
  status: AIChatPlanStatus | null | undefined
): boolean {
  if (!status) return false;
  return !PLAN_LIFECYCLE_ENDED_STATUSES.has(status);
}

export type AIChatPlanQuestionStatus = "pending" | "answered" | "cancelled";

export type AIChatPlanApprovalDecision =
  | "approved"
  | "rejected"
  | "changes_requested";

export type AIChatPlanVersionAuthor = "assistant" | "user" | "system";

export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionItem {
  header: string;
  question: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionPayload {
  questions: AskUserQuestionItem[];
}

export interface AskUserQuestionAnswer {
  question: string;
  answer: string | string[];
  customText?: string;
}

export interface SubmitPlanForApprovalPayload {
  title: string;
  objective: string;
  planMarkdown: string;
  planJson?: Record<string, unknown>;
}

export interface AIChatPlanVersionView {
  planId: string;
  version: number;
  planMarkdown: string;
  planJson?: Record<string, unknown>;
  changeReason?: string;
  createdAt: string;
  createdBy: AIChatPlanVersionAuthor;
}

export interface AIChatPlanQuestionView {
  questionId: string;
  planId: string;
  conversationId: string;
  status: AIChatPlanQuestionStatus;
  questions: AskUserQuestionItem[];
  answers?: AskUserQuestionAnswer[];
  createdAt: string;
  answeredAt?: string;
}

export interface AIChatPlanStateView {
  planId: string;
  conversationId: string;
  status: AIChatPlanStatus;
  title: string;
  objective: string;
  currentVersion: number;
  latestVersion?: AIChatPlanVersionView;
  pendingQuestion?: AIChatPlanQuestionView;
  approvedAt?: string;
  rejectedAt?: string;
}

/**
 * Continuation action encoded in a deterministic pending-message id
 * (plan-cont-<sha256(planId:version:action)>). Must stay in sync with the
 * renderer's PlanContinuationAction in planContinuationStore.ts and the
 * decision→action mapping in AIChatPlanModule so the same id is derived in
 * both processes (cross-process identity parity).
 */
export type AIChatPlanContinuationAction =
  | "approve-plan"
  | "reject-plan"
  | "request-plan-changes";

/**
 * A plan continuation intent reconstructed by main from the persisted
 * decision transition (R12 FR-PLN-005..008): the decision committed durably
 * but its follow-up turn was never accepted. Rendered by the existing
 * continuation banner; the retry reuses the deterministic clientRequestId so
 * an accepted continuation can never be duplicated.
 */
export interface AIChatPlanContinuationRecoveryView {
  conversationId: string;
  planId: string;
  version: number;
  action: AIChatPlanContinuationAction;
  feedback: string;
  clientRequestId: string;
  decidedAt: string;
}
