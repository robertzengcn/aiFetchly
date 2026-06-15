export type AIChatSessionMemoryStatus =
  | "active"
  | "updating"
  | "failed"
  | "disabled";

export type AIChatCompactSummaryStatus = "active" | "superseded" | "failed";

/** Serializer-friendly view used by modules, services, and IPC. */
export interface AIChatSessionMemoryView {
  conversationId: string;
  summary: string;
  coveredThroughMessageId?: string;
  coveredThroughTimestamp?: string;
  sourceMessageCount: number;
  tokenEstimate?: number;
  model?: string;
  failureCount: number;
  lastError?: string;
  status: AIChatSessionMemoryStatus;
  updatedAt?: string;
}

export interface AIChatCompactSummaryView {
  compactId: string;
  conversationId: string;
  summary: string;
  fromMessageId?: string;
  throughMessageId: string;
  throughTimestamp: string;
  sourceMessageCount: number;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  model?: string;
  status: AIChatCompactSummaryStatus;
  updatedAt?: string;
}

export interface AIChatCompactConversationRequest {
  conversationId: string;
}
