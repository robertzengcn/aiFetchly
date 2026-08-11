// src/entityTypes/agentTypes.ts
// Shared type definitions for the Marketing Automation Subagent System.
// See docs/marketing-subagent-system-prd.md and
// docs/marketing-subagent-system-technical-design.md for the product context.

import type { OpenAIChatImage } from "@/api/aiChatApi";

/** Agent execution modes. */
export type AgentExecutionMode = "foreground" | "background" | "scheduled";

/** Agent functional role. */
export type AgentMode = "coordinator" | "specialist" | "verifier" | "formatter";

/**
 * The source kind an agent definition was registered under (AGT-01 /
 * tech-design §7.4). Drives the lookup-order rank inside
 * {@link AgentDefinitionRegistry}: built-in (0) > user (1) > workspace (2)
 * > plugin (3).
 *
 * NOTE: this rank DELIBERATELY DIVERGES from CommandRegistry (commands rank
 * workspace above user). See the load-bearing comment on the agent
 * registry's SOURCE_RANK map.
 */
export type AgentSource = "built-in" | "user" | "workspace" | "plugin";

/** Origin of an agent definition row. */
export type AgentDefinitionSource = AgentSource;

/** Runtime health of an agent definition. */
export type AgentDefinitionHealth =
  | "healthy"
  | "disabled"
  | "partial_load"
  | "invalid"
  | "missing_files";

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
  source: AgentDefinitionSource;
  pluginName?: string;
  pluginComponentPath?: string;
  manifest?: Record<string, unknown>;
  health: AgentDefinitionHealth;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
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

/** Self-contained task packet handed to a specialist agent.
 *
 * The lead-researcher family fields are optional so generic agents — e.g.
 * the batch worker, which carries `{ files, instruction }` — can reuse the
 * same packet type without lead-shaped boilerplate. Undefined-valued keys
 * are dropped by JSON.stringify when AgentPromptBuilder forwards the packet. */
export interface AgentTaskPacket {
  workflowRunId?: string;
  lead?: LeadInput;
  userGoal?: string;
  constraints?: AgentWorkflowConstraints;
  priorFindings?: AgentFinding[];
  requiredOutputSchema?: Record<string, unknown>;
  /** Generic artifact-processing family: candidate file paths + instruction.
   * Direct agent-batch-worker calls carry one path; process_artifact_batch owns
   * multi-file concurrency and creates isolated one-path agent requests. */
  files?: string[];
  instruction?: string;
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
  /** Set when the agent's final text failed schema validation and the
   * runtime salvaged it into a low-confidence partial result. Empty/undefined
   * means the output parsed cleanly. Surface this to callers for observability.
   */
  parseWarning?: string;
  /** On-disk paths of artifacts (e.g. edited images) produced by the agent.
   * Paths only — NEVER image bytes (PRD non-goal 8). Populated by
   * AgentRuntime when the sub-agent's loop returns edited images that get
   * persisted to local storage. Undefined for agents that produce no files. */
  outputFilePaths?: string[];
  /** Persisted artifact image descriptors mirroring {@link outputFilePaths}
   * (each carries `local_path` + the `aifetchly-generated-image://` URL, no
   * bytes). Surfaced so the main chat loop can fold them into
   * metadata.generatedImages for rendering. Undefined for agents that
   * produce no images. */
  outputImages?: OpenAIChatImage[];
  /** Set when some generated images could not be persisted locally (storage
   * error, or descriptors with a non-sanctioned URL were dropped). The task
   * still completes, but callers should surface this so the user knows the
   * batch's artifacts may be incomplete. */
  storageWarning?: string;
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

/** Input for creating a user-owned (manual) agent. */
export interface CreateManualAgentDefinitionInput {
  idSlug: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  defaultModel?: string;
  mode: AgentMode;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
  outputSchema?: Record<string, unknown>;
  enabled?: boolean;
}

/** Patch for updating a user-owned (manual) agent. */
export interface UpdateManualAgentDefinitionInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  defaultModel?: string | null;
  mode?: AgentMode;
  maxToolCalls?: number;
  maxRuntimeMs?: number;
  maxContinueCalls?: number;
  outputSchema?: Record<string, unknown>;
  enabled?: boolean;
}

/** One parsed plugin agent plus ownership metadata. */
export interface ParsedPluginAgentDefinition {
  definition: AgentDefinitionView;
  pluginName: string;
  componentPath: string;
  manifest: Record<string, unknown>;
  warnings: ReadonlyArray<import("@/entityTypes/pluginTypes").PluginError>;
}

export type PluginAgentParseResult =
  | {
      ok: true;
      agents: ParsedPluginAgentDefinition[];
      warnings: ReadonlyArray<import("@/entityTypes/pluginTypes").PluginError>;
    }
  | {
      ok: false;
      errors: ReadonlyArray<import("@/entityTypes/pluginTypes").PluginError>;
    };
