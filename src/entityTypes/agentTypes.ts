// src/entityTypes/agentTypes.ts
// Shared type definitions for the Marketing Automation Subagent System.
// See docs/marketing-subagent-system-prd.md and
// docs/marketing-subagent-system-technical-design.md for the product context.

/** Agent execution modes. */
export type AgentExecutionMode = "foreground" | "background" | "scheduled";

/** Agent functional role. */
export type AgentMode = "coordinator" | "specialist" | "verifier" | "formatter";

/** Agent task lifecycle status. */
export type AgentTaskStatus =
  | "queued"
  | "running"
  | "waiting_policy"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

/** Workflow run lifecycle status (used in later milestones). */
export type AgentWorkflowStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Built-in agent definition view (DTO). */
export interface AgentDefinitionView {
  id: string;
  name: string;
  description: string;
  version: number;
  systemPrompt: string;
  allowedTools: string[];
  defaultModel?: string;
  mode: AgentMode;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
  outputSchema: Record<string, unknown>;
  status: "active" | "disabled";
}

/** Lead input packet. */
export interface LeadInput {
  id?: string;
  companyName: string;
  website?: string;
  description?: string;
  location?: string;
  existingContacts?: LeadContactInput[];
  metadata?: Record<string, unknown>;
}

export interface LeadContactInput {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  sourceUrl?: string;
}

/** Self-contained task packet handed to a specialist agent. */
export interface AgentTaskPacket {
  workflowRunId?: string;
  lead: LeadInput;
  userGoal: string;
  constraints: AgentWorkflowConstraints;
  priorFindings: AgentFinding[];
  requiredOutputSchema: Record<string, unknown>;
}

export interface AgentWorkflowConstraints {
  maxLeads?: number;
  maxConcurrency?: number;
  requireSourceUrls?: boolean;
  allowInteractivePermissionPrompts?: boolean;
  language?: string;
  tone?: string;
  blockedTools?: string[];
}

export interface AgentFinding {
  agentTaskId: string;
  agentId: string;
  findingType: "research" | "contact" | "draft" | "verification";
  summary: string;
  data: Record<string, unknown>;
  sourceUrls: string[];
  confidence: number;
}

/** Request to run one specialist agent. */
export interface RunAgentRequest {
  agentId: string;
  prompt: string;
  taskPacket: AgentTaskPacket;
  parentConversationId?: string;
  parentTaskId?: string;
  workflowRunId?: string;
  model?: string;
  executionMode: AgentExecutionMode;
  outputSchemaOverride?: Record<string, unknown>;
}

/** Result of one specialist agent run. */
export interface AgentResult {
  agentTaskId: string;
  agentId: string;
  agentVersion: number;
  status: "completed" | "failed" | "cancelled" | "timeout" | "blocked";
  output?: Record<string, unknown>;
  text?: string;
  toolCallsCount: number;
  sourceUrls: string[];
  confidence?: number;
  errorMessage?: string;
}

/** Snapshot returned by getTask / tool polling. */
export interface AgentTaskSnapshot {
  agentTaskId: string;
  agentId: string;
  agentVersion: number;
  workflowRunId?: string;
  parentConversationId?: string;
  status: AgentTaskStatus;
  startedAt?: string;
  finishedAt?: string;
  toolCallsCount: number;
  errorMessage?: string;
  result?: AgentResult;
}

/** Tool-policy decision returned by AgentToolPolicyService. */
export interface ToolPolicyDecision {
  allowed: boolean;
  reason?: string;
  /** Event type to emit when blocked. */
  blockedEventType?: "agent_blocked_tool";
}

/** Persisted tool-call audit row. */
export interface AgentToolCallRecord {
  agentTaskId: string;
  toolCallId: string;
  toolName: string;
  argumentsSummary: Record<string, unknown>;
  status: "running" | "completed" | "failed" | "blocked";
  resultSummary?: string;
  errorMessage?: string;
  durationMs?: number;
}

/** Persisted transcript message row. */
export interface AgentTaskMessageRecord {
  agentTaskId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}
