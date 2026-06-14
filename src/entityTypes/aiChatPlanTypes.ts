export type ChatV2Mode = "chat" | "plan";

export type AIChatPlanStatus =
  | "draft"
  | "awaiting_question"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "cancelled";

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
