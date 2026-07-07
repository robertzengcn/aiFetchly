export type AIWorkspaceMemoryType =
  | "project"
  | "decision"
  | "workflow"
  | "convention"
  | "reference"
  | "warning";

export type AIWorkspaceMemoryStatus = "active" | "archived" | "contradicted";

export type AIWorkspaceMemorySourceKind =
  | "manual"
  | "chat_v2"
  | "agent_task"
  | "auto_dream";

export type AIWorkspaceMemoryConsolidationStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export const AI_WORKSPACE_MEMORY_TYPES: readonly AIWorkspaceMemoryType[] = [
  "project",
  "decision",
  "workflow",
  "convention",
  "reference",
  "warning",
] as const;

export const AI_WORKSPACE_MEMORY_STATUSES: readonly AIWorkspaceMemoryStatus[] = [
  "active",
  "archived",
  "contradicted",
] as const;

export const AI_WORKSPACE_MEMORY_SOURCE_KINDS: readonly AIWorkspaceMemorySourceKind[] =
  ["manual", "chat_v2", "agent_task", "auto_dream"] as const;

export const WORKSPACE_MEMORY_RUN_STATUSES: readonly AIWorkspaceMemoryConsolidationStatus[] =
  ["running", "completed", "failed", "cancelled"] as const;

export function isAIWorkspaceMemoryType(
  v: unknown
): v is AIWorkspaceMemoryType {
  return (
    typeof v === "string" &&
    (AI_WORKSPACE_MEMORY_TYPES as readonly string[]).includes(v)
  );
}

export function isAIWorkspaceMemoryStatus(
  v: unknown
): v is AIWorkspaceMemoryStatus {
  return (
    typeof v === "string" &&
    (AI_WORKSPACE_MEMORY_STATUSES as readonly string[]).includes(v)
  );
}

export function isAIWorkspaceMemorySourceKind(
  v: unknown
): v is AIWorkspaceMemorySourceKind {
  return (
    typeof v === "string" &&
    (AI_WORKSPACE_MEMORY_SOURCE_KINDS as readonly string[]).includes(v)
  );
}

export interface AIWorkspaceMemoryView {
  id: number;
  memoryId: string;
  workspaceKey: string;
  workspaceRoot: string;
  type: AIWorkspaceMemoryType;
  title: string;
  content: string;
  status: AIWorkspaceMemoryStatus;
  confidence: number;
  sourceKind?: AIWorkspaceMemorySourceKind;
  sourceConversationId?: string;
  sourceAgentTaskId?: string;
  sourceMessageIds?: string[];
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AIWorkspaceMemoryCreateInput {
  conversationId: string;
  type: AIWorkspaceMemoryType;
  title: string;
  content: string;
  sourceKind?: AIWorkspaceMemorySourceKind;
  sourceConversationId?: string;
  sourceAgentTaskId?: string;
  sourceMessageIds?: string[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AIWorkspaceMemoryUpdateInput {
  conversationId: string;
  memoryId: string;
  type?: AIWorkspaceMemoryType;
  title?: string;
  content?: string;
  status?: AIWorkspaceMemoryStatus;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AIWorkspaceMemorySearchInput {
  conversationId: string;
  query?: string;
  type?: AIWorkspaceMemoryType;
  status?: AIWorkspaceMemoryStatus;
  sourceKind?: AIWorkspaceMemorySourceKind;
  limit?: number;
  offset?: number;
}

export interface AIWorkspaceMemoryInjectionResult {
  memories: AIWorkspaceMemoryView[];
  tokenEstimate: number;
  contextBlock: string;
}

export interface AIWorkspaceMemoryConsolidationRunView {
  id: number;
  runId: string;
  status: AIWorkspaceMemoryConsolidationStatus;
  workspaceKey?: string;
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

export interface AIWorkspaceAutoDreamStatusView {
  aiEnabled: boolean;
  autoDreamEnabled: boolean;
  latestRun?: AIWorkspaceMemoryConsolidationRunView;
  runningRun?: AIWorkspaceMemoryConsolidationRunView;
}
