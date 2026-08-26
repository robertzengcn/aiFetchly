# Workspace Memory Auto-Remember After Task And Failure - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-08-26 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/workspace-memory-auto-remember-prd.md` |
| Parent designs | `docs/prd/workspace-memory-technical-design.md` (§15), `docs/prd/portable-workspace-memory-technical-design.md` (D-09) |
| Sibling | `docs/prd/workspace-memory-ai-tools-technical-design.md` (Layer A, not this feature) |
| Primary code paths | `src/service/AIAutoDreamSourceCollector.ts`, `src/service/AIWorkspaceAutoDreamService.ts`, `src/service/AIWorkspaceAutoDreamPromptBuilder.ts`, `src/service/AgentRuntime.ts`, `src/model/AgentTask.model.ts`, `src/modules/AIWorkspaceMemoryModule.ts`, `src/entity/AIWorkspaceMemoryConsolidationRun.entity.ts` |

## 1. Purpose

This document translates `docs/prd/workspace-memory-auto-remember-prd.md` into an implementation-facing design.

It closes the gap between "workspace auto-dream exists" and "the assistant actually remembers after a task or a durable failure."

```text
Agent task finishes (completed | failed | timeout)
  -> AgentRuntime triggers workspace auto-dream (non-blocking)
  -> collector attaches workspace from parentConversationId / agentConversationId
  -> Layer B: batch consolidate if 24h + 3 sources / 6 messages (or force)
  -> Layer C (failed/timeout or durable chat tool error only):
       deterministic classifier
         -> skip (no model) OR one warning via same Module
  -> private SQLite write; portable files untouched
```

This feature does **not** add chat tools. Explicit "remember this" remains the tools PRD.

## 2. Current System (What Breaks The Product Goal)

### 2.1 Collector drops agent workspace

`AIAutoDreamSourceCollector` resolves workspace only for chat conversations. Agent packets are pushed without `workspace`. `groupByWorkspace` then excludes them.

`AgentTaskEntity` already has `parentConversationId` and `agentConversationId`. Parent design §15.3 said skip agent tasks in phase 1. That skip is leftover; this design removes it.

### 2.2 Finished-task query is completed-only

```text
AgentTaskModel.listFinishedAfter
  -> WHERE t.status = 'completed'
```

`AIAutoDreamService` (user memory) and `AIWorkspaceAutoDreamService` share `collector.collect()`. Widening the query in place would change global user auto-dream. Workspace collection must pass an explicit status list.

### 2.3 Failed agent path has no trigger

`AgentRuntime` calls `evaluateAfterAgentTask` only after `setStatus(..., "completed")`. Failed / timeout / catch paths persist `errorMessage` and return.

### 2.4 Chat packets omit tool results

Messages are filtered to `MessageType.MESSAGE`. `TOOL_RESULT` rows exist (`AIChatV2Module.saveToolResult` stores `metadata.error`). They never enter the workspace prompt.

### 2.5 Batch gates

```text
MIN_HOURS_BETWEEN_RUNS = 24
MIN_CHANGED_SOURCES_PER_WORKSPACE = 3
MIN_CHANGED_MESSAGES_PER_WORKSPACE = 6
```

`evaluateAfterAgentTask` currently ignores `agentTaskId` except as a log reason; it always runs `maybeRun` over recent packets. After this design, Layer C uses `agentTaskId` (or conversationId) to load **one** packet.

### 2.6 Run table cannot isolate failure writes

`getLatestSuccessfulRun(workspaceKey)` drives `reviewedSince` and the 24h cooldown. A successful Layer C `completeRun` that stamps a new `reviewedThrough` would skip later chats. Add `runKind`.

### 2.7 Lightweight workload

Keep `workload: "workspace_auto_dream"`. Do not add a fifth ID to `AIChatLightweightWorkload`. Layer C uses a different prompt and a one-packet user message on the same profile (`optional_background`, `fallback: never`).

## 3. Target Architecture

```text
AgentRuntime / AIChatQueryEngine
  -> AIWorkspaceAutoDreamService.evaluateAfterAgentTask | evaluateAfterChatTurn
       -> maybeRunLayerC? (failed/timeout or durable tool errors)
       -> maybeRun (Layer B batch, existing)

AIAutoDreamSourceCollector
  -> chat packets + TOOL_RESULT failure slice
  -> agent packets + workspace from conversation IDs
  -> collect({ reviewedSince, agentStatuses })

WorkspaceFailureClassifier (pure)
  -> skip | candidate

AIWorkspaceAutoDreamPromptBuilder
  -> batch prompt (extended) OR failure-warning prompt (restricted)

AIWorkspaceMemoryModule.applyPlanAndCompleteRun
  -> same transaction as today
```

Trust boundary is unchanged: conversation id → `WorkspaceResolver.resolveWithKey` in main process.

## 4. File Plan

### 4.1 New files

```text
src/service/WorkspaceFailureClassifier.ts
src/service/AIWorkspaceFailureWarningPromptBuilder.ts

test/vitest/utilitycode/WorkspaceFailureClassifier.test.ts
test/vitest/main/service/AIAutoDreamSourceCollectorWorkspaceAttach.test.ts
  (extend existing AIAutoDreamSourceCollector.test.ts if that file already covers collect(); prefer extending)
test/vitest/main/service/AIWorkspaceAutoDreamFailureWarning.test.ts
test/vitest/main/service/AgentRuntimeWorkspaceAutoDreamTrigger.test.ts
```

`WorkspaceFailureClassifier` must stay free of Electron/DB imports (utilitycode tests).

### 4.2 Modified files

```text
src/service/AIAutoDreamSourceCollector.ts
src/service/AIWorkspaceAutoDreamService.ts
src/service/AIWorkspaceAutoDreamPromptBuilder.ts
src/service/AgentRuntime.ts
src/model/AgentTask.model.ts
src/modules/AgentTaskModule.ts
src/entity/AIWorkspaceMemoryConsolidationRun.entity.ts
src/model/AIWorkspaceMemoryConsolidationRun.model.ts
src/modules/AIWorkspaceMemoryConsolidationRunModule.ts
src/entityTypes/aiWorkspaceMemoryTypes.ts
src/modules/AIWorkspaceMemoryModule.ts   (only if metadata.runKind must be set on create)
```

Do **not** change `AIAutoDreamService` defaults. It keeps `collect({ reviewedSince })` → completed-only.

## 5. Collector Design

### 5.1 Collect options

```typescript
export interface CollectSourcesInput {
  readonly reviewedSince: Date | null;
  readonly agentStatuses?: readonly AgentTaskStatus[];
}

const DEFAULT_AGENT_STATUSES: readonly AgentTaskStatus[] = ["completed"];
const WORKSPACE_AGENT_STATUSES: readonly AgentTaskStatus[] = [
  "completed",
  "failed",
  "timeout",
];
```

`AIWorkspaceAutoDreamService.executeRun` passes `agentStatuses: WORKSPACE_AGENT_STATUSES`.

`AIAutoDreamService` omits the field.

### 5.2 `listTerminalAfter`

Add `AgentTaskModel.listTerminalAfter(since, limit, statuses)`:

```sql
WHERE t.status IN (:...statuses)
  AND (t.finishedAt > :since OR t.updatedAt > :since)  -- if since set
ORDER BY t.finishedAt DESC NULLS LAST
LIMIT :limit
```

Keep `listFinishedAfter` as a wrapper that passes `["completed"]` so existing tests and user auto-dream do not change.

Module exposes both; collector uses `listTerminalAfter`.

### 5.3 Agent workspace resolution

For each agent task:

```text
conversationId = parentConversationId || agentConversationId
if !conversationId -> packet without workspace
else
  try WorkspaceResolver.resolveWithKey(conversationId)
  if approved -> packet.workspace = { workspaceId, workspaceKey, workspaceRoot, displayName }
  else -> packet without workspace
```

Never read workspace from `taskPacket`, tool arguments, or file paths.

Update the collector file comment that currently says "no conversation link in phase 1."

### 5.4 Agent packet fields

Extend `AutoDreamSourcePacket` (backward compatible optional fields):

```typescript
taskStatus?: AgentTaskStatus;
taskError?: string; // clamped, omitted if secret-like
```

When mapping tool calls, omit `errorMessage` / `resultSummary` if `looksSecretlike`. Clamp with existing `MAX_TOOL_SUMMARY_CHARS` (300). Clamp `taskError` the same way.

Include `taskError` from `AgentTaskEntity.errorMessage` for failed/timeout tasks.

### 5.5 Chat tool-failure slice

After building MESSAGE rows (unchanged, last 30):

1. Filter rows where `messageType === TOOL_RESULT`.
2. Parse `metadata` JSON. Treat as failure when:
   - `metadata.error` is a non-empty string, or
   - `metadata.status` is `error` / `failed` / `denied` (exact strings used in saveToolResult — implement against live metadata, do not invent a parallel enum).
3. Take the last 8 failures.
4. Push onto `packet.toolCalls`:

```typescript
{
  toolCallId: row.messageId,
  toolName: metadata.toolName ?? "unknown",
  status: "failed",
  errorMessage: clamp(secretSafe(metadata.error ?? row.content), 300),
}
```

If `looksSecretlike(error)`, omit `errorMessage` and skip the row if nothing else remains.

Do not put full `content` (often stringified JSON) on the packet.

### 5.6 `groupByWorkspace`

No signature change. After 5.3, agent packets with an approved parent will group. Update the function comment.

## 6. Layer B (Batch) Changes

### 6.1 Triggers

Keep:

- `evaluateAfterChatTurn({ conversationId, reason: "assistant_turn_completed" })`
- `evaluateAfterAgentTask({ agentTaskId, reason: "agent_task_completed" })`

Add from `AgentRuntime` after `setStatus` failed/timeout (including the catch path):

```typescript
deps.workspaceAutoDreamService.evaluateAfterAgentTask({
  agentTaskId,
  reason: "agent_task_failed" | "agent_task_timeout",
})
```

`evaluateAfterAgentTask` still calls `maybeRun` for Layer B (existing). It **also** calls `maybeRunFailureWarning` when reason is failed/timeout (see §7).

Cancelled: no trigger.

Chat turn `failed` / `cancelled`: no new trigger in v1 (PRD FR-AR-013).

### 6.2 Thresholds

Unchanged. Cooldown and `reviewedSince` must use **batch** runs only (`runKind = 'batch'` or NULL for legacy rows).

### 6.3 Prompt additions

Append to `buildWorkspaceAutoDreamSystemPrompt` (keep existing bullets):

```text
If a completed task established a durable procedure for this workspace, create or update a workflow (commands, order, constraints).
If the user or the task recorded a project decision, use decision.
If a tool or command failed for a workspace-specific reason that would recur, create a warning.
Prefer a short reference memory that points at a file the task already wrote. Never paste CSV, JSON payloads, contact lists, or raw logs.
Skip transient failures: rate limits, network errors, user cancel, one-off typos.
Prefer updating an existing memory over creating a near-duplicate.
```

User prompt: when `taskStatus` / `taskError` / failed `toolCalls` are present, render them explicitly:

```text
    taskStatus=failed taskError=...
    tool name status=failed error=...
```

Parser: if `WorkspaceMemoryPayloadFilter` exists (tools PRD), run it on create/update title+content and reject those items (do not fail the whole parse). Until then, reject content that looks like CSV (header row with commas + many lines) or contact dumps (multiple emails) in addition to `looksSecretlike`.

### 6.4 Portable skip

Keep current skip of portable records for update/archive. New creates stay private SQLite (D-09).

## 7. Layer C (Failure Warning)

### 7.1 Entry

`AIWorkspaceAutoDreamService.maybeRunFailureWarning(input: { agentTaskId?: string; conversationId?: string; reason: string })`

Called:

- from `evaluateAfterAgentTask` when reason is `agent_task_failed` or `agent_task_timeout`
- from `evaluateAfterChatTurn` only if the just-completed conversation packet has at least one durable (classifier-pass) tool failure — cheap pre-check after collect-one-conversation, not a second full collect

Layer C has its own in-flight lock **or** shares `inFlight` so B and C never interleave writes to the same workspace. Recommendation: share `inFlight`. If B is running, C returns null (try next failure). If C is running, B returns null for that evaluation (existing inFlight behavior).

### 7.2 Load one packet

Do not reuse the full `collect({ reviewedSince })` window.

- Agent: `AgentTaskModule.getSnapshot` / get by id → map one packet via the same mapping helpers as collect → resolve workspace.
- Chat: load that conversation's messages → map one packet including the failure slice.

If workspace unresolved, return.

### 7.3 Classifier (before AI enable is not enough — still check AI + setting first)

Order:

1. `isAIEnabled()` else return
2. `isAutoDreamEnabled()` else return (no force for Layer C)
3. Resolve workspace; else return
4. `classifyWorkspaceFailure(clampedError, { toolName, taskStatus })`
5. Dedup against active warnings
6. Caps
7. Model

`classifyWorkspaceFailure` returns `{ action: "skip" | "candidate"; reason: string }`.

Skip regexes (case-insensitive, applied to clamped error + toolName):

- `\b429\b`, `rate limit`, `quota`, `insufficient credits`
- `econnreset`, `enotfound`, `etimedout`, `fetch failed`, `network`, `dns`
- `cancelled`, `aborted`
- `401`, `unauthorized`, `auth expired`
- `looksSecretlike` → skip

Skip ENOENT / `no such file` unless `toolName` is a known project command tool **and** the path is under the resolved workspace root. If workspace root is unknown or path is outside, skip.

Allow if not skipped. Do not try to NLP-classify durability in v1.

### 7.4 Dedup and caps

Load `listActiveForRetrieval(scope, 200)`.

Duplicate: an active `type=warning` whose title or content shares ≥ 3 consecutive significant tokens with the clamped error, or whose title includes the toolName and a 32-char prefix of the error. If duplicate, skip (do not update in the classifier stage; the model path may still update if we pass existing warnings into the prompt — v1 skip is simpler and fail-closed).

Hourly cap: count consolidation runs where `workspaceKey` matches, `runKind = 'failure_warning'`, `status = completed`, `finishedAt > now - 1h`. If ≥ 1, skip.

Active warning cap: count active memories with `type=warning` and `sourceKind=auto_dream`. If ≥ 8, skip create; the prompt may only `update` an existing warning id. If the model returns create, parser drops creates when cap is hit.

### 7.5 Failure prompt

Separate builder `buildWorkspaceFailureWarningSystemPrompt`:

```text
You extract at most one workspace warning for AiFetchly.
Allowed JSON: create (0 or 1 item, type must be warning) or update (0 or 1 existing warning id).
Do not archive.
Content: one or two sentences. No stack traces, secrets, cookies, contact data, CSV, or raw logs.
Confidence must be 50-75.
workspaceKey must match the provided key.
If the failure is transient or not useful later, return {"create":[],"update":[],"archive":[]}.
Return JSON only.
```

User prompt: workspace key, existing active warnings (id/type/title/content), the single source packet.

Parse with `parseWorkspaceAutoDreamModelOutput` then extra checks:

- `archive.length === 0` or drop archives
- every create `type === "warning"` (or `workflow` only if title/content clearly "always do X"; v1: reject non-warning creates)
- `confidence <= 75` (clamp down, do not fail parse)
- payload filter

JSON repair: same `attemptAutoDreamJsonRepair` with `workload: "workspace_auto_dream"`.

### 7.6 Run record

Add column:

```typescript
runKind?: string | null; // 'batch' | 'failure_warning'
```

- Layer B `startRun` sets `runKind: "batch"` (legacy NULL treated as batch in queries)
- Layer C `startRun` sets `runKind: "failure_warning"`
- `reviewedThrough` for Layer C: copy the last **batch** successful `reviewedThrough` for that workspace, or null. Never `maxPacketUpdatedAt` of the failure packet.
- `getLatestSuccessfulRun(workspaceKey)` filters `runKind IS NULL OR runKind = 'batch'`
- Add `countRecentRuns({ workspaceKey, runKind, since })` for the hourly cap

`applyPlanAndCompleteRun` stays the same. Layer C still uses it so creates/updates and run completion are one transaction. Pass `reviewedThrough` as the copied batch cursor.

Optional metadata on created entities: `{ autoRememberKind: "failure_warning" }`. Nice-to-have; sourceAgentTaskId is enough for v1.

### 7.7 The acting model is not the writer

Do not call `remember_workspace_memory` from AgentRuntime. Layer C is a second lightweight completion with the restricted prompt.

## 8. AgentRuntime Hook Sites

After every `setStatus(agentTaskId, "failed"|"timeout", { finishedAt, errorMessage })` that is about to return, fire-and-forget:

```typescript
deps?.workspaceAutoDreamService
  ?.evaluateAfterAgentTask({
    agentTaskId,
    reason: status === "timeout" ? "agent_task_timeout" : "agent_task_failed",
  })
  .catch((err) =>
    log.error("[workspace-auto-dream] agent trigger failed:", err)
  );
```

Cover:

- `result.type === "failed"`
- paused-for-permission rewritten as failed
- outer `catch`
- timeout path if it sets `timeout` rather than `failed` (match live `AgentTaskStatus` usage)

Do not hook `cancelled`.

Completed path stays as today (Layer B only; Layer C not invoked).

Extract a tiny `notifyWorkspaceAutoDream(agentTaskId, reason)` helper on AgentRuntime to avoid duplicating the catch logger at each site.

## 9. Chat Trigger For Layer C

`evaluateAfterChatTurn` today always `maybeRun` (Layer B). After mapping the conversation packet (or a cheap message fetch), if classifier-pass tool failures exist, also `maybeRunFailureWarning({ conversationId, reason: "chat_tool_failure" })`.

Do not wait for 3 sources. Do apply hourly and 8-warning caps.

If this extra fetch is expensive, it is acceptable in v1 to only run Layer C from agent failed/timeout and rely on Layer B plus the tool-failure **slice** for chat. PRD allows Layer C from chat tool failures; implementation may land agent-only in phase 5a and chat in 5b.

Recommended ship: agent Layer C in the same release as collector attach; chat Layer C immediately after the slice exists.

## 10. Types

`AIWorkspaceMemoryConsolidationRunView` gains `runKind?: "batch" | "failure_warning"`.

`evaluateAfterAgentTask` reason union:

```typescript
reason:
  | "agent_task_completed"
  | "agent_task_failed"
  | "agent_task_timeout";
```

Packet optional fields: `taskStatus`, `taskError`.

## 11. Security

```text
conversationId on the task
  -> WorkspaceResolver.resolveWithKey
  -> null means no workspace memory
  -> Module WHERE workspaceKey
```

Never trust renderer/model `workspaceKey`.

`USER_AI_ENABLED` before `completeLightweight`.

`looksSecretlike` on title, content, taskError, tool error slices.

Workers: unchanged ban.

Layer C is `optional_background`: never fall back to the normal model; never enter the general chat recovery chain.

## 12. Tests

### 12.1 Collector

- Parent conversation approved → agent packet has that workspaceKey
- Missing parent, agent conversation approved → fallback
- Neither approved → no workspace, `groupByWorkspace` excludes it
- Path in taskPacket is not used
- `collect({ agentStatuses: ["failed"] })` returns failed tasks
- Default collect still completed-only
- TOOL_RESULT with metadata.error appears on chat packet.toolCalls
- Secret-like error omitted
- MESSAGE filter still excludes tool rows from `messages[]`

### 12.2 Classifier

- 429 / rate limit / cancelled / 401 / secret → skip
- Policy deny for `.aifetchly/memory` → candidate
- ENOENT outside workspace → skip
- ENOENT with no path → skip

### 12.3 Layer C service

- Creates one warning; runKind failure_warning
- Second call within an hour skipped, no lightweight call
- 8 active auto-warnings: create dropped
- `reviewedThrough` equals previous batch cursor
- Subsequent Layer B `reviewedSince` still the batch cursor
- Parse error: run failed, zero memories
- Unapproved workspace: no run

### 12.4 AgentRuntime

- Failed status invokes evaluateAfterAgentTask with `agent_task_failed`
- Cancelled does not
- Completed still invokes with `agent_task_completed`
- Thrown auto-dream does not change AgentResult.status

### 12.5 Prompt / parser

- Existing invalid workspaceKey still rejected
- Failure prompt: archive entries dropped
- Non-warning create dropped
- Confidence 90 clamped to 75
- CSV-like content rejected

### 12.6 Regression

Existing `AIWorkspaceAutoDreamService` batch tests, user auto-dream tests, portable skip tests.

## 13. Implementation Phases

### Phase 1 — Collector workspace attach

Files: `AIAutoDreamSourceCollector.ts`, collector tests.

Acceptance: agent task with parentConversationId groups into that workspace. Manual Run Auto Summary can see agent sources.

### Phase 2 — Failed sources + triggers

Files: `AgentTask.model.ts`, `AgentTaskModule.ts`, collector status argument, `AgentRuntime.ts`.

Acceptance: failed/timeout tasks appear when workspace collect asks for them; user collect unchanged; failed runtime path triggers evaluateAfterAgentTask.

### Phase 3 — Chat tool-failure slice

Files: collector + prompt user rendering.

Acceptance: a conversation with a failed tool_result shows clamped error in the batch prompt fixture.

### Phase 4 — Layer B prompt

Files: `AIWorkspaceAutoDreamPromptBuilder.ts` + parser payload reject.

Acceptance: fixture with a durable failure can emit type warning; CSV content rejected.

### Phase 5 — Layer C

Files: classifier, failure prompt builder, runKind column + queries, `maybeRunFailureWarning`, caps.

Acceptance: PRD AC 3, 4, 7, 8.

Do not start Phase 5 before Phase 1.

## 14. Migration

Add nullable `run_kind` varchar(32) on `ai_workspace_memory_consolidation_runs`. Existing rows NULL = batch. No backfill required. Index `(workspaceKey, runKind, status, finishedAt)` for hourly cap and latest-batch queries.

Follow the project's TypeORM / `yarn init` convention used by other entity column additions.

## 15. Observability

Log (existing logger, no secrets):

```text
[workspace-auto-dream] skip no-workspace task=...
[workspace-auto-dream] layer-c skip reason=transient|cap|dedup|disabled
[workspace-auto-dream] layer-c wrote warning workspace=... run=...
[workspace-auto-dream] agent trigger failed: ...
```

Run row already stores model, counts, errorMessage.

## 16. Manual QA

1. Approve a workspace on a V2 conversation.
2. Run an agent from that chat so `parentConversationId` is set.
3. Click Run Auto Summary. Confirm an agent source can produce a workflow/decision (or empty create if the task was noise — that is valid).
4. Force an agent failure with a workspace-specific message (not 429). Confirm one warning appears, chat still shows the failure.
5. Repeat the same failure within an hour. Confirm no second warning.
6. Confirm portable `.aifetchly/memory` files are unchanged.
7. Confirm a CSV-producing task does not paste rows into memory.

## 17. Open Engineering Decisions

### 17.1 Shared vs separate inFlight

Recommendation: share one `inFlight` on `AIWorkspaceAutoDreamService`. Simpler serialization. A skipped Layer C retries on the next failure.

### 17.2 Chat Layer C in the same release

Recommendation: ship with agent Layer C; add chat Layer C in the same PR if the slice is already done, otherwise immediately after.

### 17.3 Widening user auto-dream

Recommendation: do not. Separate collect options.

### 17.4 New lightweight workload

Recommendation: reuse `workspace_auto_dream`. A dedicated `workspace_failure_warning` profile would need a small-model routing PRD amendment.

## 18. Out Of Scope (Pointer)

Layer A tools, UI Remember action, load-policy routing, and `.aifetchly/memory` file-tool deny: `docs/prd/workspace-memory-ai-tools-technical-design.md`.
