# PRD: Marketing Automation Subagent System

**Version:** 1.0  
**Date:** 2026-06-16  
**Status:** Draft  
**Owner:** aiFetchly Core Team

---

## 1. Executive Summary

aiFetchly should add a subagent system for marketing automation workflows. The system will let the application break a user goal, such as "research these leads and prepare a campaign", into focused AI agent tasks: lead research, contact enrichment, campaign writing, and verification.

The design is inspired by Claude Code's subagent model, but it should be adapted to aiFetchly's product. The goal is not to clone a coding-agent swarm. The goal is to create a reliable marketing operations pipeline where each agent has a narrow responsibility, a scoped tool set, auditable outputs, and a clear handoff to the next stage.

The first release should ship built-in workflow agents only. User-created agents, freeform agent-to-agent messaging, and automatic campaign sending should remain out of scope until the runtime, audit trail, and permission model have proven stable.

---

## 2. Background

aiFetchly already has several foundations needed for an agent runtime:

- AI chat streaming through `AiChatApi`.
- Local AI-callable tools through `SkillRegistry`, `SkillExecutor`, and `ToolExecutionService`.
- Skill permission checks through `SkillPermissionService`.
- Scheduled AI task configuration and run logs through `AiMessageTaskEntity`, `AiMessageTaskRunEntity`, and related modules.
- Contact extraction, yellow pages scraping, email marketing, and AI enrichment workflows.
- Electron main-process IPC architecture, where IPC handlers call Module and Service classes instead of accessing the database directly.

The missing product layer is orchestration. Today, an AI interaction is mostly a single chat or scheduled prompt. A real marketing workflow needs multiple specialists that can work independently, preserve evidence, and produce a verified output that the user can inspect before acting on it.

---

## 3. Problem Statement

Users want to automate multi-step lead workflows, but a single AI prompt is not dependable enough for high-value sales and marketing work.

Common workflow failures:

- Lead research mixes facts, guesses, and writing in one response.
- Contact enrichment lacks source links or confidence scores.
- Campaign copy may invent facts that were not discovered during research.
- The user cannot tell which tool found which contact detail.
- Long-running enrichment across many leads needs progress, cancellation, and run history.
- Scheduled or background AI runs cannot rely on interactive permission prompts.

The result is a gap between "AI can answer a prompt" and "AI can safely run a marketing workflow I can trust."

---

## 4. Product Goals

### 4.1 Primary Goals

- Add a reusable subagent runtime for marketing automation workflows.
- Provide built-in specialist agents for lead research, contact enrichment, campaign writing, and verification.
- Let a coordinator run a complete workflow for one or many leads.
- Persist every agent task, tool call, source URL, final result, failure, and verification outcome.
- Enforce agent-scoped tool permissions so every specialist gets only the tools it needs.
- Support synchronous runs from chat and asynchronous runs from workflow or schedule surfaces.
- Keep generated campaigns as drafts requiring human review in v1.

### 4.2 Non-Goals for v1

- No arbitrary user-created agents.
- No freeform agent-to-agent chat.
- No auto-sending email, social messages, or campaign actions.
- No separate child process for every agent.
- No direct database access from worker or child processes.
- No unrestricted tool access for any agent.
- No remote AI server override of local tool policy.
- No replacement of the existing AI chat feature.

---

## 5. Product Principles

### 5.1 Agents Are Specialists

Each agent should have one job. The lead researcher should not write campaign copy. The campaign writer should not browse the web. The verifier should not mutate records.

### 5.2 Prompts Must Be Self-Contained

Normal subagents should not inherit the full parent chat history. Each agent receives a task packet that includes all relevant lead data, constraints, prior findings, and expected output schema.

This follows the useful part of Claude Code's default subagent model: clean context, focused instructions, and predictable outputs.

### 5.3 Tool Access Is Narrowed at the Agent Boundary

Parent chat permissions must not leak into subagents. Every agent definition declares its allowed tools. Runtime policy rejects tool calls outside that allowlist.

### 5.4 Outputs Must Be Source-Backed

Research and enrichment agents must return source URLs for facts that may affect user action. Campaign agents may only use facts found by earlier agents or provided by the user.

### 5.5 Human Review Comes Before Outreach

The v1 system creates drafts and recommendations. It does not send messages automatically.

---

## 6. Target Users and Use Cases

### 6.1 Target Users

- Sales operators building lead lists.
- Marketing users preparing outbound campaigns.
- Small businesses enriching contacts before outreach.
- aiFetchly power users who run scheduled scraping and email workflows.

### 6.2 Core Use Cases

1. Research selected leads and summarize business context.
2. Enrich selected leads with public contact data.
3. Generate personalized campaign drafts using verified research.
4. Verify campaign quality before a user exports or sends.
5. Run the same workflow across a batch of leads with progress tracking.

---

## 7. User Experience

### 7.1 Entry Points

The first release should expose the workflow from two places:

1. Lead/contact result screens:
   - User selects one or more leads.
   - User clicks "Run AI workflow" or equivalent localized text.
   - User chooses the workflow recipe.

2. AI chat:
   - User asks for lead research or campaign preparation.
   - The AI can call a local `run_subagent_workflow` tool.
   - The workflow result is returned into chat with a link to the run detail.

Scheduled execution can be added after the runtime supports async runs and policy-bound tool calls.

### 7.2 Workflow Selection

Initial built-in recipes:

| Recipe | Description | Default Agents |
| --- | --- | --- |
| Lead research only | Find and summarize business context | Coordinator, lead researcher, verifier |
| Contact enrichment | Find public contact channels and confidence | Coordinator, contact enricher, verifier |
| Campaign preparation | Research, enrich, draft, and verify campaign copy | Coordinator, lead researcher, contact enricher, campaign writer, verifier |

### 7.3 Run Progress UI

For async runs, users should see:

- Overall status: queued, running, waiting for policy, completed, failed, cancelled.
- Per-agent status.
- Current lead being processed.
- Tool calls in progress.
- Blocked tool calls and reasons.
- Cancel button.
- Final result preview.

### 7.4 Run Detail UI

Each workflow run should show:

- Input leads.
- Agent timeline.
- Agent outputs.
- Source URLs.
- Tool calls and durations.
- Verification score.
- Missing fields.
- Risks and warnings.
- Final structured result.

### 7.5 Draft Review UX

Campaign drafts should appear as editable drafts, not final actions. The user can copy, export, or manually attach them to an existing campaign flow after review.

---

## 8. Agent Catalog

### 8.1 Coordinator Agent

**Purpose:** Plan the workflow, create task packets for specialist agents, merge results, and decide whether the workflow can proceed.

**Allowed tools in v1:**

- `run_subagent`
- `start_subagent`
- `get_subagent_task`
- `cancel_subagent_task`

The coordinator should not scrape, enrich, or write campaign copy directly.

### 8.2 Lead Researcher

**Purpose:** Gather public business context for a lead.

**Inputs:**

- Company name.
- Website URL if available.
- Existing description.
- Location if available.
- User's campaign goal.

**Allowed tools:**

- Search tools.
- Website/content scraping tools.
- Read-only attachment tools when needed.

**Outputs:**

- Industry.
- Business summary.
- Products or services.
- Target customer hints.
- Recent or visible market signals.
- Source URLs.
- Confidence score.

### 8.3 Contact Enricher

**Purpose:** Find public contact channels for a lead.

**Allowed tools:**

- Contact extraction tools.
- Website/contact page scraping tools.
- Search tools limited to contact discovery.

**Outputs:**

- Emails.
- Phone numbers.
- Contact page URLs.
- Social links.
- Person or role if discovered.
- Source URL for each contact value.
- Confidence score per contact value.

### 8.4 Campaign Writer

**Purpose:** Generate campaign draft copy from verified research.

**Allowed tools:**

- No external scraping tools in v1.
- Optional read-only template tools if already available.

**Outputs:**

- Cold email subject.
- Cold email body.
- Follow-up email body.
- Optional social message.
- Personalization notes.
- Claims used from research.

The campaign writer must not invent facts. If a useful fact is missing, it should write more general copy or flag the missing information.

### 8.5 Verifier

**Purpose:** Check whether outputs are source-backed, complete, and safe for user review.

**Allowed tools:**

- Read-only inspection tools.
- Validation tools.

**Outputs:**

- Verification status: pass, warning, fail.
- Overall confidence score.
- Unsupported claims.
- Missing required fields.
- Source quality warnings.
- Suggested user action.

### 8.6 Formatter

**Purpose:** Convert the final workflow result into a stable structured output for UI, export, and downstream workflows.

**Allowed tools:**

- No external tools.

---

## 9. Core Workflow

### 9.1 Campaign Preparation Flow

```text
User selects leads and workflow
  -> Coordinator validates input and creates workflow run
  -> Lead researcher gathers context
  -> Contact enricher finds public contact data
  -> Verifier checks research and enrichment
  -> Campaign writer drafts outreach copy
  -> Verifier checks draft claims and risk
  -> Formatter creates final structured result
  -> User reviews result
```

### 9.2 Self-Contained Task Packet

Every specialist agent receives a packet like:

```ts
interface AgentTaskPacket {
  workflowRunId: string;
  lead: LeadInput;
  userGoal: string;
  constraints: WorkflowConstraints;
  priorFindings: AgentFinding[];
  requiredOutputSchema: string;
}
```

The packet must contain everything the agent needs. It should not rely on hidden chat history.

### 9.3 Final Result Shape

```ts
interface LeadAutomationResult {
  lead: {
    companyName: string;
    website?: string;
    industry?: string;
    location?: string;
    contacts: Array<{
      name?: string;
      role?: string;
      email?: string;
      phone?: string;
      sourceUrl: string;
      confidence: number;
    }>;
  };
  researchSummary: string;
  campaignDrafts: {
    coldEmailSubject: string;
    coldEmailBody: string;
    followUpBody: string;
    socialMessage?: string;
  };
  verification: {
    status: "pass" | "warning" | "fail";
    confidence: number;
    missingFields: string[];
    risks: string[];
    sourceUrls: string[];
  };
}
```

---

## 10. Functional Requirements

### FR-1: Agent Definitions

The system must support built-in agent definitions.

Required definition fields:

- `id`
- `name`
- `description`
- `systemPrompt`
- `allowedTools`
- `model`
- `mode`
- `maxToolCalls`
- `maxRuntimeMs`
- `maxContinueCalls`
- `outputSchema`
- `status`

Acceptance criteria:

- Built-in definitions are loaded at app startup.
- Definitions can be listed by the renderer.
- Disabled or unknown definitions cannot be executed.
- Agent prompts are versioned so future updates can be audited.

### FR-2: Agent Runtime

Create a main-process service that runs individual agent tasks.

Recommended service:

```ts
class AgentRuntime {
  runSync(request: RunAgentRequest): Promise<AgentResult>;
  startAsync(request: RunAgentRequest): Promise<AgentTaskRef>;
  cancel(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<AgentTaskSnapshot>;
}
```

Acceptance criteria:

- Runtime checks `USER_AI_ENABLED` before remote AI calls.
- Runtime creates a fresh agent conversation or thread for each task.
- Runtime applies agent-scoped tool policy before exposing tools to the remote AI server.
- Runtime rejects any tool call outside the agent's allowed tools.
- Runtime enforces max runtime, max tool calls, and max continue calls.
- Runtime supports cancellation through `AbortController`.

### FR-3: Workflow Runtime

Create a coordinator service for multi-agent workflows.

Recommended service:

```ts
class AgentWorkflowRuntime {
  startWorkflow(request: StartWorkflowRequest): Promise<WorkflowRunRef>;
  runWorkflowSync(request: StartWorkflowRequest): Promise<WorkflowResult>;
  cancelWorkflow(runId: string): Promise<void>;
  getWorkflowRun(runId: string): Promise<WorkflowRunSnapshot>;
}
```

Acceptance criteria:

- Workflow runtime creates one workflow run record.
- Workflow runtime creates one or more agent task records.
- Workflow runtime can process a batch of leads with bounded concurrency.
- Workflow runtime stores partial results when one lead fails.
- Workflow runtime produces final structured output per lead.

### FR-4: Synchronous Subagent Tool

Expose a local AI-callable tool for blocking subagent execution.

Suggested tool name:

- `run_subagent`

Use cases:

- Parent AI asks a specialist to research one lead.
- Result returns into the same AI chat turn.

Acceptance criteria:

- Tool accepts `agentId`, `prompt`, `taskPacket`, and `outputSchema`.
- Tool only allows built-in agent IDs.
- Tool returns a structured agent result.
- Tool result includes `agentTaskId` for audit lookup.

### FR-5: Async Subagent Tools

Expose local AI-callable tools for background agent execution.

Suggested tools:

- `start_subagent`
- `get_subagent_task`
- `cancel_subagent_task`

Acceptance criteria:

- `start_subagent` returns immediately with a task ID.
- `get_subagent_task` returns status and latest snapshot.
- `cancel_subagent_task` aborts running remote streams and marks task cancelled.
- Async task completion can notify the chat UI or workflow UI.

### FR-6: Built-In Workflow Tool

Expose a workflow-level tool.

Suggested tool name:

- `run_subagent_workflow`

Acceptance criteria:

- Tool accepts workflow recipe, lead inputs, campaign goal, and safety options.
- Tool creates a workflow run.
- Tool returns final output for sync mode or run ID for async mode.
- Tool does not allow the AI to create arbitrary workflow definitions in v1.

### FR-7: Persistence

Add durable storage for agent definitions, workflow runs, agent tasks, and tool calls.

Recommended entities:

- `AgentDefinitionEntity`
- `AgentWorkflowRunEntity`
- `AgentTaskEntity`
- `AgentTaskMessageEntity`
- `AgentToolCallEntity`

Acceptance criteria:

- All database operations go through Model and Module classes.
- IPC handlers never access TypeORM repositories directly.
- Agent task records include status, input, result, error, timestamps, and parent IDs.
- Tool call records include tool name, arguments summary, duration, status, and error.
- Sensitive tool arguments are sanitized before persistence.

### FR-8: Permission and Policy

Every agent must run under a scoped policy.

Policy fields:

- allowed tool names.
- max tool calls.
- max runtime.
- max output length.
- allow async execution.
- allow workflow spawning.

Acceptance criteria:

- Parent chat permissions do not grant extra subagent permissions.
- Tool calls outside policy are blocked and logged.
- Scheduled or background runs cannot show interactive permission prompts.
- Headless runs only execute tools that are pre-approved by the workflow policy.

### FR-9: Verification

The verifier agent must run before final workflow completion for campaign preparation.

Acceptance criteria:

- Final result includes verification status.
- Final result flags unsupported claims.
- Final result flags missing source URLs for contact facts.
- Campaign drafts with unsupported claims receive warning or fail status.
- User can still inspect partial results when verification fails.

### FR-10: User Review Before Outreach

The system must not send outreach automatically in v1.

Acceptance criteria:

- Campaign output is saved as draft content.
- UI labels make clear that content requires review.
- No email/social send action is triggered by the workflow runtime.

---

## 11. Data Model

### 11.1 AgentDefinitionEntity

```ts
interface AgentDefinitionRecord {
  id: string;
  name: string;
  description: string;
  version: number;
  systemPrompt: string;
  allowedToolsJson: string;
  defaultModel?: string;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
  outputSchemaJson: string;
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}
```

### 11.2 AgentWorkflowRunEntity

```ts
interface AgentWorkflowRunRecord {
  id: string;
  recipeId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  inputJson: string;
  resultJson?: string;
  errorMessage?: string;
  totalLeads: number;
  completedLeads: number;
  failedLeads: number;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 11.3 AgentTaskEntity

```ts
interface AgentTaskRecord {
  id: string;
  workflowRunId?: string;
  parentTaskId?: string;
  parentConversationId?: string;
  agentConversationId: string;
  agentId: string;
  status:
    | "queued"
    | "running"
    | "waiting_policy"
    | "completed"
    | "failed"
    | "cancelled"
    | "timeout";
  prompt: string;
  taskPacketJson: string;
  resultJson?: string;
  errorMessage?: string;
  toolCallsCount: number;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 11.4 AgentToolCallEntity

```ts
interface AgentToolCallRecord {
  id: string;
  agentTaskId: string;
  toolCallId: string;
  toolName: string;
  argumentsSummaryJson: string;
  status: "running" | "completed" | "failed" | "blocked";
  resultSummary?: string;
  errorMessage?: string;
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 12. Technical Architecture

### 12.1 Recommended Process Model

Run agents in the Electron main process through async services. Do not create a child process per agent in v1.

Rationale:

- AI work is mostly network and tool I/O.
- Existing `AiChatApi`, `SkillExecutor`, and permission logic already live in the main process.
- Child processes cannot access the database directly under project rules.
- Process isolation can be added later for CPU-heavy or untrusted execution.

### 12.2 Main Components

```text
Renderer UI
  -> Agent IPC handlers
  -> AgentWorkflowModule / AgentTaskModule
  -> AgentWorkflowRuntime
  -> AgentRuntime
  -> AiChatApi
  -> AgentToolPolicyService
  -> SkillExecutor / ToolExecutor
  -> Agent transcript persistence
```

### 12.3 IPC Handlers

Suggested channels:

- `AGENT_DEFINITION_LIST`
- `AGENT_WORKFLOW_START`
- `AGENT_WORKFLOW_CANCEL`
- `AGENT_WORKFLOW_DETAIL`
- `AGENT_WORKFLOW_LIST`
- `AGENT_TASK_DETAIL`
- `AGENT_TASK_TRANSCRIPT`

Requirements:

- Check `USER_AI_ENABLED` first for all AI execution channels.
- Validate and sanitize request payloads.
- Call Module or Service classes.
- Never access database repositories directly.

### 12.4 Tool Execution Path

```text
Remote AI tool_call event
  -> AgentRuntime
  -> AgentToolPolicyService checks agent allowlist
  -> SkillExecutor executes allowed tool
  -> AgentToolCallEntity records result
  -> AiChatApi continue request sends tool result
```

Blocked tool calls should be returned to the remote AI server as failed tool results so the model can continue with available data.

### 12.5 Transcript Strategy

Persist agent transcripts separately from normal chat messages.

Minimum v1 transcript data:

- User/task packet sent to the agent.
- Assistant tokens or final message.
- Tool call events.
- Tool results.
- Errors and cancellation.

The UI can render a summarized timeline first, then expose raw transcript details behind an expand action.

---

## 13. Tool Policy

### 13.1 Default Agent Tool Sets

| Agent | Allowed Tools |
| --- | --- |
| Coordinator | `run_subagent`, `start_subagent`, `get_subagent_task`, `cancel_subagent_task` |
| Lead researcher | search tools, scrape/read-only tools |
| Contact enricher | contact extraction, search, scrape/read-only tools |
| Campaign writer | no web tools in v1, optional template read tools |
| Verifier | read-only validation tools |
| Formatter | no external tools |

### 13.2 Explicitly Blocked in v1

- Shell execution.
- File write/edit.
- Sending email.
- Posting to social platforms.
- Creating or deleting campaigns.
- Installing dependencies.
- Any MCP tool not explicitly approved for the agent.

### 13.3 Headless Runs

Scheduled and background workflows cannot pause for user prompts. They must use pre-approved workflow policy. If a tool needs interactive approval, the tool is blocked and logged.

---

## 14. Security and Compliance

### 14.1 Prompt Injection Defense

Web content must be treated as untrusted input. Agent prompts should include rules that external page text cannot override system instructions, tool policy, or output schema.

### 14.2 Sensitive Data Handling

- Sanitize tool arguments before logging.
- Avoid storing secrets in task packets.
- Do not include raw cookies, tokens, or credentials in agent transcripts.
- Use existing `SkillExecutor` sensitive pattern checks where possible.

### 14.3 Outreach Safety

Generated outreach must be draft-only in v1. This prevents an agent from sending incorrect or non-compliant content without review.

### 14.4 Source Requirements

Contact values and factual claims used for personalization must include source URLs. Verification should warn or fail when source coverage is weak.

---

## 15. Internationalization

Any user-facing UI added for this feature must update all supported language files:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Required translation groups:

- Agent workflow entry points.
- Workflow recipe labels.
- Agent status labels.
- Tool call status labels.
- Verification messages.
- Error and cancellation messages.
- Draft review labels.

---

## 16. Milestones

### Milestone 1: Runtime Foundation

Build:

- Agent definition registry.
- Agent task persistence.
- `AgentRuntime.runSync`.
- Agent-scoped tool policy.
- `run_subagent` tool.
- Basic transcript persistence.

Success criteria:

- AI chat can call one built-in specialist agent.
- The specialist runs with narrowed tools.
- Tool calls and final result are persisted.

### Milestone 2: Workflow Foundation

Build:

- Workflow run persistence.
- `AgentWorkflowRuntime`.
- Built-in campaign preparation recipe.
- Lead researcher, contact enricher, campaign writer, verifier definitions.
- Workflow detail UI.

Success criteria:

- User can run campaign preparation for one lead.
- Final output includes research, contact data, draft copy, and verification.

### Milestone 3: Batch and Async Runs

Build:

- `start_subagent` and workflow async mode.
- Bounded batch concurrency.
- Progress UI.
- Cancellation.
- Partial result handling.

Success criteria:

- User can run a workflow across multiple leads.
- Failures for one lead do not discard successful results for others.

### Milestone 4: Scheduled Workflow Integration

Build:

- Schedule support for selected workflow recipes.
- Headless policy enforcement.
- Run history linked to schedule detail.

Success criteria:

- A scheduled workflow can run without renderer IPC.
- Unapproved tools are blocked and logged.

### Milestone 5: Configurable Recipes

Build:

- Admin or advanced-user recipe configuration.
- Agent prompt versioning.
- Read-only preview of tool policy before saving.

Success criteria:

- Users can customize workflow recipes without creating arbitrary unsafe agents.

---

## 17. Acceptance Criteria

The feature is acceptable when:

- A user can run a built-in campaign preparation workflow for a selected lead.
- The workflow uses at least lead researcher, contact enricher, campaign writer, and verifier agents.
- Each agent runs with its own scoped tool policy.
- Final output is structured and source-backed.
- Campaign drafts are not sent automatically.
- The verifier flags unsupported claims and missing sources.
- The user can inspect the agent timeline and tool calls.
- The runtime persists completed, failed, cancelled, and timed-out runs.
- AI-disabled accounts cannot execute agent workflows.
- IPC handlers follow the project's Module/Service architecture.

---

## 18. Testing Strategy

### 18.1 Unit Tests

Add tests for:

- Agent definition validation.
- Agent tool policy filtering.
- Blocked tool call behavior.
- Agent task status transitions.
- Workflow result merging.
- Verifier output parsing.

### 18.2 Main Process Tests

Add Vitest tests under `test/vitest/main/` for:

- Agent IPC AI-enabled gating.
- Workflow start/cancel/detail handlers.
- Persistence through modules, not direct repositories.
- Async cancellation behavior.

### 18.3 Service Tests

Add tests under `test/modules/` or suitable existing service test paths for:

- `AgentRuntime`.
- `AgentWorkflowRuntime`.
- `AgentToolPolicyService`.
- `AgentTranscriptService`.

### 18.4 Integration Tests

Use mocked AI streams to test:

- Token streaming.
- Tool call execution.
- Tool call blocking.
- Continue requests after tool results.
- Timeout and cancellation.
- Batch partial failure.

### 18.5 UI Verification

Verify:

- Text is translated in all supported languages.
- Status labels do not overflow on narrow screens.
- Run detail can display long tool results without breaking layout.
- Cancel action updates UI state.

---

## 19. Metrics

Track locally or through existing analytics where appropriate:

- Workflow runs started.
- Workflow runs completed.
- Workflow runs failed or cancelled.
- Average runtime per lead.
- Average tool calls per lead.
- Verification pass/warning/fail rate.
- Percentage of results with at least one source-backed contact.
- Draft acceptance or export rate if such actions exist.

---

## 20. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Agent invents facts | Bad outreach copy and loss of trust | Verifier checks unsupported claims and source coverage |
| Tool permissions are too broad | Unsafe unattended actions | Agent-scoped allowlists and headless policy blocks |
| Long batch runs consume too much time or cost | Poor user experience and high AI spend | Runtime limits, bounded concurrency, cancellation |
| Web content prompt injection | Model follows malicious page instructions | Treat web content as untrusted and preserve system policy |
| UI hides important evidence | User cannot audit result quality | Timeline, sources, tool call detail, verification summary |
| Reusing chat persistence becomes confusing | Hard to inspect agent work | Separate agent task and transcript records |

---

## 21. Future Enhancements

After v1 is stable:

- User-configurable recipes.
- Agent prompt editor with validation.
- Workflow templates by campaign type.
- CRM/export integration.
- Human approval checkpoints between stages.
- Cost estimates before batch runs.
- Remote worker execution for heavy or isolated tasks.
- Controlled send automation after explicit user approval and compliance checks.

---

## 22. Product Decisions Made

- The feature is for marketing automation workflows, not general coding agents.
- v1 uses built-in agents only.
- Normal subagents receive self-contained task packets, not full parent chat history.
- Agents run in the main process initially.
- Tool permissions are narrowed per agent.
- Campaign output is draft-only.
- Verification is required for campaign preparation.
- Async and scheduled workflows come after the synchronous runtime is proven.

