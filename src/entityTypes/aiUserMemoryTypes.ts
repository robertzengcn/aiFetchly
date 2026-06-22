export type AIUserMemoryType =
  | "preference"
  | "fact"
  | "decision"
  | "reference"
  | "workflow";

export type AIUserMemoryStatus = "active" | "archived" | "contradicted";

export type AIUserMemorySourceKind =
  | "manual"
  | "chat_v2"
  | "agent_task"
  | "auto_dream";

export type AIMemoryConsolidationStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export const AI_USER_MEMORY_TYPES: readonly AIUserMemoryType[] = [
  "preference",
  "fact",
  "decision",
  "reference",
  "workflow",
] as const;

export const AI_USER_MEMORY_STATUSES: readonly AIUserMemoryStatus[] = [
  "active",
  "archived",
  "contradicted",
] as const;

export const AI_USER_MEMORY_SOURCE_KINDS: readonly AIUserMemorySourceKind[] = [
  "manual",
  "chat_v2",
  "agent_task",
  "auto_dream",
] as const;

export const MEMORY_RUN_STATUSES: readonly AIMemoryConsolidationStatus[] = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export function isAIUserMemoryType(v: unknown): v is AIUserMemoryType {
  return (
    typeof v === "string" &&
    (AI_USER_MEMORY_TYPES as readonly string[]).includes(v)
  );
}

export function isAIUserMemoryStatus(v: unknown): v is AIUserMemoryStatus {
  return (
    typeof v === "string" &&
    (AI_USER_MEMORY_STATUSES as readonly string[]).includes(v)
  );
}

export function isAIUserMemorySourceKind(
  v: unknown
): v is AIUserMemorySourceKind {
  return (
    typeof v === "string" &&
    (AI_USER_MEMORY_SOURCE_KINDS as readonly string[]).includes(v)
  );
}

export interface AIUserMemoryView {
  id: number;
  memoryId: string;
  type: AIUserMemoryType;
  title: string;
  content: string;
  status: AIUserMemoryStatus;
  confidence: number;
  sourceKind?: AIUserMemorySourceKind;
  sourceConversationId?: string;
  sourceAgentTaskId?: string;
  sourceMessageIds?: string[];
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AIUserMemoryCreateInput {
  type: AIUserMemoryType;
  title: string;
  content: string;
  sourceKind?: AIUserMemorySourceKind;
  sourceConversationId?: string;
  sourceAgentTaskId?: string;
  sourceMessageIds?: string[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AIUserMemoryUpdateInput {
  memoryId: string;
  type?: AIUserMemoryType;
  title?: string;
  content?: string;
  status?: AIUserMemoryStatus;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AIUserMemorySearchInput {
  query?: string;
  type?: AIUserMemoryType;
  status?: AIUserMemoryStatus;
  sourceKind?: AIUserMemorySourceKind;
  limit?: number;
  offset?: number;
}

export interface AIMemoryConsolidationRunView {
  id: number;
  runId: string;
  status: AIMemoryConsolidationStatus;
  startedAt: string;
  finishedAt?: string;
  reviewedSince?: string;
  reviewedThrough?: string;
  chatConversationsReviewed: number;
  agentTasksReviewed: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  memoriesArchived: number;
  model?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIMemoryInjectionResult {
  memories: AIUserMemoryView[];
  tokenEstimate: number;
  contextBlock: string;
}

export interface AIAutoDreamStatusView {
  aiEnabled: boolean;
  autoDreamEnabled: boolean;
  latestRun?: AIMemoryConsolidationRunView;
  runningRun?: AIMemoryConsolidationRunView;
}
