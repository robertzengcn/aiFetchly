# Workspace Memory Auto-Remember After Task And Failure - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-26
- **Owner**: AiFetchly AI Chat
- **Related areas**: AI Chat V2, workspace memory, auto-dream, agent runtime
- **Technical design**: `docs/prd/workspace-memory-auto-remember-technical-design.md`
- **Parent features**:
  - `docs/prd/workspace-memory-prd.md` (FR-008, §16)
  - `docs/prd/workspace-memory-technical-design.md` (§15)
- **Sibling features**:
  - `docs/prd/workspace-memory-ai-tools-prd.md` (explicit "remember this now")
  - `docs/prd/portable-workspace-memory-prd.md` (auto-dream stays private by default)
- **Related files**:
  - `src/service/AIWorkspaceAutoDreamService.ts`
  - `src/service/AIAutoDreamSourceCollector.ts`
  - `src/service/AIWorkspaceAutoDreamPromptBuilder.ts`
  - `src/service/AgentRuntime.ts`
  - `src/service/AIChatQueryEngine.ts`
  - `src/model/AgentTask.model.ts`
  - `src/entity/AgentTask.entity.ts`
  - `src/modules/AIWorkspaceMemoryModule.ts`
  - `src/service/MemorySecretFilter.ts`

## 1. Summary

AiFetchly already has a background writer for workspace memory: **workspace auto-dream**. After a chat turn completes, and after an agent task status becomes `completed`, `AIWorkspaceAutoDreamService` can consolidate project facts into `ai_workspace_memories`.

Users still do not get the two behaviors they expect:

1. After the assistant **finishes a task** in an approved workspace, keep durable procedures and decisions for the next conversation.
2. After the assistant **hits a trap that will happen again in this workspace**, keep a short `warning` so the next turn does not repeat it.

Those jobs fail today for mechanical reasons, not because the product idea is missing. Agent tasks are collected and then dropped (no workspace on the packet). Failed tasks are never sources. Chat tool errors are stripped out. The 24-hour / 3-source bar skips a single finished task or a single failure. The consolidator prompt does not ask for warnings from durable failures.

This PRD does **not** replace the explicit chat tools in `workspace-memory-ai-tools-prd.md`. That is Layer A ("remember this now"). This document is Layer B (distill after real work) and Layer C (learn from a durable failure).

The expected user-visible outcome is:

- A completed agent task bound to an approved workspace can become a `workflow` / `decision` after consolidation (or immediately via Run Auto Summary).
- A durable, workspace-specific failure can become one `warning` without waiting 24 hours.
- Transient errors, secrets, contact dumps, and CSVs still never become memories.
- Chat and agent completion are never blocked by this pipeline.

## 2. Problem Statement

The original workspace-memory PRD required auto-dream to group **chat and agent-task** packets by approved `workspaceKey` (FR-008.1). The technical design then deferred agent linking:

> Agent tasks need a conversation link. If an agent task does not have a conversation ID, skip it for workspace memory in phase 1.

The link exists now. `AgentTaskEntity` has `parentConversationId` and `agentConversationId`. The collector comment still says phase 1 has no conversation link, so `groupByWorkspace` skips every agent packet.

Independently:

- `AgentTaskModel.listFinishedAfter` filters `status = "completed"` only.
- `AgentRuntime` calls `evaluateAfterAgentTask` only after success.
- Chat packets keep `messageType === MESSAGE`, so `TOOL_RESULT` errors never reach the consolidator.
- Failed / cancelled chat turns do not trigger evaluation.
- Unless the user clicks Run Auto Summary (`force: true`), a workspace needs 24 hours since the last successful run **and** at least 3 source packets or 6 messages.
- The system prompt prefers explicit user statements and does not instruct extraction of `warning` memories from recurring environment/tool failures.

The result: finishing a campaign agent or failing a workspace-specific tool does not teach the next conversation. Users who say "remember this" still need Layer A (chat tools). Users who do **not** say it still get nothing from auto-dream for agent work.

A second product mistake would be to dump a task result (for example a supplier CSV) into workspace memory just because the task finished. Workspace memory remains a small typed knowledge layer. Datasets stay files; at most a `reference` points at the path.

## 3. Product Rule: Three Writers, Never One

| Layer | User intent | Latency | Writer |
| --- | --- | --- | --- |
| A | "Remember this" | Same turn | Chat tools / UI action (`workspace-memory-ai-tools-prd.md`) |
| B | Distill after real work | Background, conservative | Workspace auto-dream, with agent tasks actually attached |
| C | "Don't make that mistake again here" | Soon after a **durable** failure | Capped failure → `warning` path, same Module/parser, not a transcript dump |

The task model that just ran must **not** call `remember_workspace_memory` on every success. That model is biased toward remembering its own work. Auto-dream is a second, constrained pass.

Portable policy is unchanged (portable-memory D-09): auto-dream and Layer C write **private SQLite** by default. They do not auto-edit portable Markdown files.

## 4. Goals

1. Attach agent tasks to the parent conversation's approved workspace so they survive `groupByWorkspace`.
2. Include `failed` and `timeout` agent tasks as workspace auto-dream sources, with clamped `errorMessage` and failed tool summaries.
3. Trigger workspace auto-dream after those terminal agent statuses, not only `completed`.
4. Include a short chat tool-failure slice in chat packets (tool name, status, clamped error).
5. Keep Layer B's 24-hour / 3-source / 6-message bar for ordinary distillation.
6. Add Layer C: at most one auto-`warning` per durable project failure, bypassing the 24-hour bar, with a hard rate cap.
7. Teach the consolidator: durable traps → `warning`; successful procedures → `workflow` / `decision`; never secrets, contacts, raw logs, or file dumps.
8. Failures of this pipeline must not block chat or agent completion.
9. Manual "Run Auto Summary" still forces a full Layer B run.
10. Layer C must not advance the Layer B source watermark (`reviewedThrough`).
11. Reuse `AIWorkspaceMemoryModule`, `MemorySecretFilter`, and the existing auto-dream JSON schema. Do not add a new store.
12. Do not infer workspace from tool paths or `taskPacket` file arguments.

## 5. Non-Goals

1. Do not auto-remember on every chat turn or every tool error.
2. Do not write user-global memory from agent failures in this PRD. Global user auto-dream stays on `AIAutoDreamService` and its completed-task sources unless a later PRD extends it.
3. Do not write `.aifetchly/memory/**` via `file_write`.
4. Do not store CSVs, lead lists, or bulky tool JSON as memory content.
5. Do not auto-update portable Markdown (files stay authoritative).
6. Do not replace the explicit remember tool or the Workspace memory panel.
7. Do not treat cancelled agent tasks as lessons.
8. Do not expand the small-model workload allowlist unless a later design proves a dedicated profile is required. Layer C reuses `workspace_auto_dream`.
9. Do not add a new user-facing toggle in v1. Reuse `ai_workspace_auto_dream_enabled`.
10. Do not let workers or child processes write workspace memory.

## 6. Current Architecture Findings

### 6.1 Auto-dream already runs after success

`AIChatQueryEngine` calls `workspaceAutoDreamService.evaluateAfterChatTurn` on assistant turn completed.

`AgentRuntime` calls `evaluateAfterAgentTask` only after `status: "completed"`. Failed paths call `setStatus(..., "failed")` and return.

Settings:

- AI enabled (`USER_AI_ENABLED`)
- Workspace Auto-Summary (`ai_workspace_auto_dream_enabled`, default on)
- Workspace Memory Injection (separate; memories can be saved and still not injected)

### 6.2 Agent packets are dropped

`AIAutoDreamSourceCollector` builds agent packets **without** `workspace`. `groupByWorkspace` skips packets with no `workspaceKey`. The collector comment documents this as phase 1.

`AgentTaskEntity` already has:

- `parentConversationId`
- `agentConversationId`
- `errorMessage`
- `status`
- `finishedAt`

### 6.3 Failed tasks are not queried

`AgentTaskModel.listFinishedAfter` is `status = "completed"` only. User auto-dream uses the same collector, so this PRD must not silently change the default query for global user memory.

### 6.4 Chat tool failures are invisible

Chat packets filter `messageType === MESSAGE`. Tool call/result rows (`TOOL_CALL`, `TOOL_RESULT`) are excluded. `AIChatV2Module.saveToolResult` already stores `metadata.error` on tool-result rows.

### 6.5 Thresholds skip one-shot work

`AIWorkspaceAutoDreamService`:

- `MIN_HOURS_BETWEEN_RUNS = 24`
- `MIN_CHANGED_SOURCES_PER_WORKSPACE = 3`
- `MIN_CHANGED_MESSAGES_PER_WORKSPACE = 6`

`force: true` (Run Auto Summary) bypasses both.

### 6.6 Prompt is not failure-oriented

`buildWorkspaceAutoDreamSystemPrompt` prefers explicit user statements, forbids secrets and raw files, and does not mention durable `warning` extraction from tool/environment failures.

### 6.7 Run records cannot distinguish batch vs failure writes

`ai_workspace_memory_consolidation_runs` has no `reason` / `runKind`. A Layer C success that used `completeRun` with a new `reviewedThrough` would starve later Layer B distillation. This PRD requires those runs to be distinguishable.

## 7. Users And Stories

### 7.1 Campaign operator after an agent run

The user runs a specialist agent against an approved workspace. The agent discovers that Yellow Pages platform X needs a Google tool account with cookies.

**Today:** the next chat does not know. **After this PRD:** Layer B or Layer C stores a `warning` or `workflow` for that workspace.

### 7.2 Developer after a failed command

`yarn testmain` fails because a workspace-specific env is missing. The user retries later in a new conversation.

**Today:** the consolidator never saw the tool error. **After this PRD:** one `warning` if the classifier agrees it is durable.

### 7.3 Researcher after a scrape

The agent writes `wholesale_mobile_suppliers.csv`. The user does not say "remember".

**Today / after this PRD:** the CSV is a file. Auto-remember may create a short `reference` to the path, never the rows.

### 7.4 Operator who said "remember this"

Out of scope here. That is Layer A (`workspace-memory-ai-tools-prd.md`).

## 8. Functional Requirements

### FR-AR-001: Attach agent tasks to an approved workspace

When collecting agent packets for workspace auto-dream, the system shall resolve workspace from:

1. `parentConversationId` if present
2. else `agentConversationId`

using `WorkspaceResolver.resolveWithKey`. If there is no approved workspace, `workspace` stays unset. The packet may still feed **user** auto-dream. The system shall not infer workspace from tool paths or `taskPacket`.

### FR-AR-002: Terminal agent statuses as workspace sources

Workspace auto-dream shall treat these agent statuses as sources:

- Include: `completed`, `failed`, `timeout`
- Exclude: `queued`, `running`, `waiting_policy`, `waiting_user`, `cancelled`

Global user auto-dream shall keep collecting `completed` only unless a later PRD changes it. Implement this with an explicit status argument, not by widening `listFinishedAfter` in place.

### FR-AR-003: Failed-task trigger

After `AgentRuntime` sets an agent task to `failed` or `timeout`, it shall call `evaluateAfterAgentTask` with a distinct reason (`agent_task_failed` / `agent_task_timeout`). Reasons are for logs and run records. They shall not skip the AI-enable or auto-dream toggles.

### FR-AR-004: Clamped task and tool errors on packets

Agent packets shall include:

- `taskStatus`
- clamped `taskError` (300 characters) after `MemorySecretFilter` (omit the field if secret-like)
- existing `toolCalls` with clamped `errorMessage` (secret-like values omitted)

### FR-AR-005: Chat tool-failure slice

Workspace auto-dream chat packets shall still include MESSAGE rows, plus up to 8 recent `TOOL_RESULT` failures:

- tool name
- status
- clamped error (300 characters, secret-filtered)

Full tool output shall not be copied into the packet.

### FR-AR-006: Layer B thresholds unchanged

Ordinary consolidation shall keep:

- 24 hours since the last **successful batch** run for that workspace
- at least 3 source packets **or** 6 messages in the group
- `force: true` bypasses both

Once FR-AR-001 lands, several agent runs in a day can satisfy "3 sources" without extra chat.

### FR-AR-007: Layer B prompt guidance

The consolidator shall additionally:

- Create or update a `workflow` when a completed task established a durable procedure for this workspace.
- Create or update a `decision` when the user or the task recorded a project decision.
- Create a `warning` when a tool/command failed for a **workspace-specific** reason that would recur.
- Prefer `reference` to a path the task already wrote; never paste CSV/JSON payloads.
- Skip transient failures (rate limit, timeout-as-network, cancelled, one-off path typo).
- Prefer updating an existing memory over creating a near-duplicate.

Existing rules remain: JSON only, this `workspaceKey` only, no secrets, no raw files, merge duplicates, archive contradictions from newer explicit user statements.

### FR-AR-008: Layer C failure → warning

The system shall run a second path when all of the following hold:

1. AI enabled and workspace auto-dream enabled.
2. Approved workspace resolved (same resolver as Layer B).
3. Signal is a durable project failure:
   - agent `failed` / `timeout` with a non-empty, non-secret error or failed tool, **or**
   - chat `TOOL_RESULT` failed with the same quality of error.
4. A deterministic classifier says "workspace-specific / environment / procedure", not "transient".
5. No duplicate active `warning` (title/content overlap against that workspace's active warnings).
6. Rate caps not exceeded.

If the classifier is unsure, skip. Fail closed. Do not call the model.

### FR-AR-009: Transient classifier (before any model call)

Skip Layer C with no model call when the clamped error matches:

- rate limit / 429 / quota / insufficient credits
- network / ECONNRESET / fetch failed / DNS
- user cancelled / aborted
- auth expired / 401
- secret-like (`MemorySecretFilter`)
- generic file-not-found / ENOENT when the path appears only once and was user-typed; if unsure, skip

Allow through examples:

- missing workspace config, wrong cwd, required env for **this repo**
- tool denied by workspace policy in a way that will recur (for example `file_write` under `.aifetchly/memory/`)
- platform/login prerequisite for a named scraper
- test/build command that fails for a documented project reason

### FR-AR-010: Layer C write shape

Layer C shall write at most one create, or one update of an existing warning, through `AIWorkspaceMemoryModule.applyPlanAndCompleteRun` (or an equivalent Module transaction).

- `type` must be `warning`, or `workflow` only if the failure implied "always do X instead"
- title and content within existing caps; content one or two sentences
- `sourceKind` on the plan entry is `agent_task` or `chat_v2`; persisted `sourceKind` on the row remains `auto_dream` (existing Module behavior) with `sourceAgentTaskId` / `sourceConversationId` set
- confidence modest (default 70, never 95+ for inferred warnings)
- no stack traces, request bodies, cookies, or contact data
- same parser checks as Layer B (workspace key, secret filter, length caps)

The acting agent that just failed shall not be the writer.

### FR-AR-011: Layer C caps and watermark isolation

- At most **one** auto-warning per workspace per hour
- At most **8** active auto-created warnings (`type=warning` and `sourceKind=auto_dream`) per workspace; at cap, update/merge or skip, never unbounded create
- Layer C **does not** require 3 sources / 6 messages
- Layer C **does** bypass the 24-hour cooldown
- Layer C **does not** advance Layer B `reviewedThrough`
- Layer C runs shall be stored with a distinct `runKind` (`failure_warning` vs `batch`) so `getLatestSuccessfulRun` used for cooldown and `reviewedSince` counts **batch** only

### FR-AR-012: Payload reject (shared with tools PRD)

Automatic writes shall reject:

- contact lists / CSVs / lead sheets
- secrets
- bulky tool JSON
- full transcripts

Prefer a `reference` memory pointing at a file the task already wrote.

If `WorkspaceMemoryPayloadFilter` from the tools PRD exists, reuse it. Otherwise apply the same rules in the auto-dream parser until that filter ships.

### FR-AR-013: Trigger map

| Event | Layer B | Layer C |
| --- | --- | --- |
| Chat turn completed | existing `evaluateAfterChatTurn` | only if the packet contains a durable tool failure and the classifier passes |
| Chat turn failed | not required in v1 | not required in v1 |
| Agent `completed` | existing `evaluateAfterAgentTask` (useful after FR-AR-001) | no |
| Agent `failed` / `timeout` | new trigger; still subject to 24h / 3-source | yes, if classifier + caps pass |
| Agent `cancelled` | no | no |
| Panel Run Auto Summary | `runNow({ force: true })` | no |

### FR-AR-014: Settings

v1 shall not add a new toggle. Disabling workspace auto-dream disables Layer B and Layer C. Manual panel create still works. A later child toggle "Learn warnings from failures" may default on when auto-dream is on.

### FR-AR-015: Non-blocking

Layer B and Layer C failures shall be logged and recorded on the run row. They shall not change the user-visible chat or agent result.

### FR-AR-016: Main process only

All resolution, classification, model calls, and writes happen in the main process. Workers shall not instantiate workspace memory models.

## 9. User Experience

No new panel is required.

Users already have:

- Workspace Auto-Summary toggle
- Run Auto Summary
- Workspace memory list (will show auto-created warnings)

Optional later (not v1): a source badge "from failed task" on auto-warnings. Existing source attribution (`sourceAgentTaskId`) is enough for v1.

## 10. Security And Scope

1. Scope only from conversation IDs already on the task, via `WorkspaceResolver`. Never from the model, renderer, tool paths, or `taskPacket`.
2. Check `USER_AI_ENABLED` before any model call.
3. Run `MemorySecretFilter` on titles, content, and error slices.
4. Apply the payload reject list.
5. Auto-dream / Layer C failures never change the visible task result.
6. New auto memories remain private SQLite when portable memory is enabled.

## 11. Acceptance Criteria

1. Given an agent task with `parentConversationId` bound to an approved workspace, when auto-dream groups packets, that task appears in that workspace's group.
2. Given the same task with no resolvable conversation or no approved workspace, it does not create workspace memory.
3. Given an agent task that `failed` with a workspace-specific error, Layer C may create one `warning` in that workspace, attributed via `sourceAgentTaskId`.
4. Given a 429 / cancelled / secret-like error, no warning is created and no model call is made.
5. Given a completed agent task that established a procedure, after enough sources or a forced run, Layer B can create/update a `workflow` (not the CSV output).
6. Given a failed agent task, chat still shows the failure; memory write is background and non-blocking.
7. Given Layer C just wrote a warning, Layer B's `reviewedThrough` watermark for chats is unchanged.
8. Given 8 active auto-warnings, a ninth distinct failure does not unbounded-create; it merges, updates, or skips.
9. Given portable memory enabled, new auto memories remain private SQLite.
10. User auto-dream still collects only `completed` agent tasks by default.
11. Existing panel, retrieval, injection, and (if present) tools-PRD tests still pass.

## 12. Test Plan

- Collector: parent conversation → workspace; agent conversation fallback; skip when unresolved; do not infer from paths.
- `listTerminalAfter` (or status argument): includes failed+timeout, excludes cancelled and running.
- User auto-dream collector path still uses completed-only.
- AgentRuntime: failed/timeout invoke `evaluateAfterAgentTask`.
- Chat packet includes clamped tool errors; secrets stripped; MESSAGE rows unchanged.
- Transient classifier: 429 skip, policy-deny allow, ENOENT skip-when-unsure, no model call on skip.
- Layer C: one warning, dedup, hourly cap, 8-warning cap, does not move Layer B cursor.
- Prompt parser still rejects wrong `workspaceKey` and secret-like content.
- Payload reject: agent result that is a contact CSV does not become memory content.
- Layer C parse failure marks that run failed and does not write memories.

## 13. Implementation Order

1. **Collector workspace attach** — unblocks all agent memory. Smallest, highest leverage.
2. **Include failed/timeout sources + trigger on those statuses** — without this, "learn from failure" has no input.
3. **Chat tool-failure slice** — chat-side traps.
4. **Prompt guidance** for `warning` / `workflow`.
5. **Run kind + Layer C** (classifier, caps, watermark isolation).

Do not start Layer C if packets still have no workspace.

## 14. Interaction With The Tools PRD

- User says "remember this" → Layer A, immediate.
- Agent finishes a campaign run quietly → Layer B, after thresholds (or Run Auto Summary).
- Agent hits a recurring workspace trap → Layer C, one warning.
- User says "remember those suppliers" → still file + optional `reference`. Layer B/C must obey the same rule.

These three should coexist. Auto-dream without the agent/failure wiring cannot do what users ask. The remember tool without auto-dream cannot learn unattended.

## 15. Success Metrics

1. Agent tasks with a parent approved workspace appear in workspace auto-dream groups (count > 0 in tests and a manual Run Auto Summary).
2. At least one durable failed-task fixture produces a `warning` via Layer C.
3. Transient fixtures produce zero model calls.
4. Layer C runs do not change the next Layer B `reviewedSince`.
5. No increase in portable file writes from auto-dream.
6. Chat/agent tests still complete when auto-dream throws.

## 16. Open Questions

1. Should Layer C also fire from a failed **chat** turn (not only tool_result on a completed turn)?
   - Recommendation: not in v1. Chat-turn `failed` is often context-window or network. Tool-result failures on completed turns are the higher-signal path.

2. Should user auto-dream also ingest failed agent tasks?
   - Recommendation: no in this PRD. Keep global memory conservative.

3. Should Layer C get its own small-model workload ID?
   - Recommendation: no. Reuse `workspace_auto_dream` with a tighter prompt and smaller packet.

4. Should auto-warnings be editable/archivable like any other memory?
   - Recommendation: yes. Manual edits still take precedence (parent FR-010.3).

## 17. Recommended Decisions

1. Sibling PRD, not a rewrite of workspace-memory-prd FR-008.
2. Resolve agent workspace from `parentConversationId` then `agentConversationId`.
3. Add a status-filtered list for workspace sources; do not widen user auto-dream by accident.
4. Layer C is a capped second path, not a lowering of Layer B thresholds.
5. Distinguish `runKind` so failure writes cannot starve batch distillation.
6. Fail closed on ambiguous errors.
7. Keep portable auto-writes private.
