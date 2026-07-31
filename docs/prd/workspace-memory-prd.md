# Workspace Memory - Product Requirements Document

**Date:** 2026-07-06
**Status:** Draft
**Owner:** AiFetchly AI Chat
**Related areas:** AI Chat V2, workspace-aware file tools, durable user memory, auto-dream, agent runtime
**Technical design:** `docs/prd/workspace-memory-technical-design.md`
**Builds on:**

- `docs/superpowers/specs/2026-06-22-auto-dream-user-memory-prd.md`
- `docs/workspace-aware-file-tools-prd.md`
- `/home/robertzeng/project/github/claude-code/docs/memory-selection.md`

## 1. Summary

AiFetchly already has durable cross-session user memory, conversation session memory, compact summaries, workspace approval, and workspace-aware file tools. It does not yet have a durable memory layer scoped to a specific workspace or project folder.

This feature adds **workspace memory**: a structured, durable memory store keyed by a stable workspace identity. Workspace memory lets AI Chat V2 remember project-specific decisions, workflows, conventions, references, and known warnings across conversations that use the same approved workspace.

Workspace memory is inspired by Claude Code's project memory model, but AiFetchly should not copy Claude Code's file-based memory storage. AiFetchly already has a SQLite/TypeORM architecture, explicit workspace approval, and a strict IPC -> Module -> Model data access pattern. Workspace memory should therefore be stored in the local user database and accessed only through the existing backend layering.

The expected user-visible outcome is:

- Memories from one project do not leak into another project.
- Multiple conversations using the same workspace can reuse project context.
- The assistant can remember project-specific decisions without re-asking.
- Users can inspect, edit, archive, and delete workspace memories.
- Automatic consolidation can create and update workspace memories safely after chat turns and agent tasks.

## 2. Problem

AiFetchly's current durable memory is user-scoped. That is useful for stable user preferences, but it is too broad for project-specific context.

Current risks and limitations:

- A memory learned in one repository or campaign workspace can be retrieved in another unrelated workspace if keywords overlap.
- Conversation-scoped compact memory helps only one conversation; it does not connect multiple conversations working on the same project.
- Workspace-aware file tools know which folder the AI can access, but the memory system does not use that workspace boundary.
- Auto-dream can consolidate useful information, but it cannot currently decide whether a memory belongs globally to the user or locally to one workspace.
- Project-specific decisions, commands, external references, and warnings must be repeated in every new conversation.

AiFetchly needs a memory scope between global user memory and single-conversation memory.

## 3. Goals

1. Add a durable workspace-scoped memory layer for AI Chat V2.
2. Key workspace memory by a stable workspace identity, not by conversation ID alone.
3. Share workspace memories across all conversations using the same approved workspace.
4. Prevent workspace memory retrieval when no workspace is approved.
5. Prevent memory from one workspace from being injected into another workspace.
6. Store workspace memory in SQLite through TypeORM Entity, Model, and Module classes.
7. Keep IPC handlers communication-only.
8. Keep worker and child processes away from direct database access.
9. Inject a small relevant subset of workspace memories into AI Chat V2 context.
10. Support manual create, edit, archive, delete, and search operations.
11. Extend auto-dream consolidation to create/update/archive workspace memories.
12. Give users clear visibility and control over what the assistant remembers for a workspace.
13. Avoid storing secrets, credentials, cookies, private scraped data, or raw transcript chunks.
14. Keep global user memory and workspace memory semantically separate.

## 4. Non-Goals

1. Do not replace existing global user memory.
2. Do not replace conversation compact summaries or session memory.
3. Do not store memory files in the selected workspace in the first release.
4. Do not sync workspace memory to a remote server in the first release.
5. Do not share workspace memory between users or devices in the first release.
6. Do not add team memory or collaborative memory in this release.
7. Do not index all workspace files as memories.
8. Do not use workspace memory as a substitute for file search or RAG.
9. Do not inject every memory into every prompt.
10. Do not let an untrusted project configure where memory is stored.
11. Do not allow workspace memory writes for revoked or unapproved workspaces.
12. Do not use vector search as a launch dependency.

## 5. Users

### 5.1 Primary User

A user who works with AiFetchly across multiple campaigns, projects, repositories, or customer workspaces. This user wants the assistant to remember context for the active workspace without contaminating other workspaces.

Examples:

- "For this campaign workspace, always write outreach in a direct B2B tone."
- "This repo uses `yarn testmain` for main process tests."
- "This customer forbids scraping LinkedIn."
- "Use the local embedding PRD as the reference for RAG model behavior."

### 5.2 Power User / Developer

A user who uses AI Chat V2, file tools, plan mode, and agent tasks inside project folders. This user benefits when the assistant remembers decisions, verification commands, project-specific architecture constraints, and known traps.

### 5.3 Maintainer

A developer maintaining AiFetchly's memory, workspace, and AI chat systems. This user needs a clear scope model, auditable source attribution, deterministic tests, and separation between global and workspace memory.

## 6. Current State

### 6.1 Existing Global User Memory

AiFetchly currently stores durable user memories in `ai_user_memories`.

Relevant files:

- `src/entity/AIUserMemory.entity.ts`
- `src/model/AIUserMemory.model.ts`
- `src/modules/AIUserMemoryModule.ts`
- `src/service/AIUserMemoryRetrievalService.ts`
- `src/service/AIAutoDreamService.ts`

This memory is scoped to the local user database. Retrieval currently selects from a global active-memory pool and uses keyword overlap, memory type, source, recency, and last-used metadata.

### 6.2 Existing Session And Compact Memory

AiFetchly has conversation-local memory:

- `AIChatSessionMemoryModule`
- `AIChatCompactModule`
- `AIChatContextAssembler`

This helps long conversations fit into the model context window. It does not provide project memory across multiple conversations.

### 6.3 Existing Workspace Model

AiFetchly has workspace approval and conversation binding:

- `src/entity/Workspace.entity.ts`
- `src/model/Workspace.model.ts`
- `src/modules/WorkspaceModule.ts`
- `src/service/WorkspaceResolver.ts`
- `src/main-process/communication/ai-workspace-ipc.ts`

Current workspace records are keyed by conversation and include root path, label, and approval state. File tools use approved workspace roots as safety boundaries.

### 6.4 Gap

The workspace boundary exists for file access but not for durable memory. Workspace memory must connect these systems without weakening data access rules or prompt safety.

## 7. Product Principles

### 7.1 Workspace Memory Is Project-Specific

Workspace memory should store context that applies to the active workspace, not to the user everywhere.

### 7.2 Current User Message Wins

If workspace memory conflicts with the current user message, the assistant must follow the current user message.

### 7.3 Workspace Memory Beats Global Memory For Project Context

If workspace memory conflicts with global user memory on a project-specific behavior, workspace memory should win for that workspace.

### 7.4 Store What Cannot Be Reliably Recomputed

Do not memorize obvious code structure, current file contents, git history, or facts that can be read directly from files. Store decisions, preferences, constraints, references, warnings, and durable workflow knowledge.

### 7.5 User Control Is Required

Automatic memory is acceptable only if users can inspect, edit, archive, delete, and disable it.

### 7.6 No Approved Workspace, No Workspace Memory

Workspace memory retrieval and write operations require an approved workspace.

## 8. Workspace Identity

### 8.1 Stable Workspace Key

Workspace memory must be keyed by a stable `workspaceKey`.

Requirements:

1. Resolve the selected workspace root to a canonical real path.
2. Prefer the Git repository root when the selected folder is inside a Git repository.
3. Use the selected real path when no Git root exists.
4. Derive `workspaceKey` from the canonical root path with a deterministic hash.
5. Store `workspaceKey` separately from `workspaceId` and `conversationId`.
6. Allow multiple conversations to share memory when they resolve to the same `workspaceKey`.

Recommended key format:

```text
ws_<sha256(canonicalRootPath).slice(0, 32)>
```

### 8.2 Workspace Display Metadata

The app should retain human-readable metadata for UI and audit:

- `workspaceKey`
- `canonicalRootPath`
- `displayName`
- latest approved `workspaceId`
- latest known label
- `createdAt`
- `lastUsedAt`

### 8.3 Worktrees

If a selected folder is a Git worktree, the product should initially key memory by the real Git worktree root. A future release may add an option to share memory across worktrees belonging to the same Git common directory.

Initial behavior must be deterministic and documented in UI/help text.

## 9. Memory Scope Model

AiFetchly should support three memory scopes:

| Scope | Owner | Lifetime | Examples | Injection Condition |
| --- | --- | --- | --- | --- |
| Conversation | `AIChatSessionMemory` / compact summary | One conversation | Current task state, summarized transcript | Same conversation only |
| Workspace | New workspace memory | Same approved workspace | Project decisions, commands, references, warnings | Active approved workspace with matching `workspaceKey` |
| User | `AIUserMemory` | Current local user DB | User preferences, durable profile facts | Any conversation when memory injection is enabled |

Workspace memory must not be implemented as a subtype of conversation compact memory. It is durable and cross-conversation.

## 10. Memory Taxonomy

Workspace memories should use a closed taxonomy.

| Type | Description | Examples |
| --- | --- | --- |
| `project` | Context about product, business, milestone, or project intent that is not obvious from files | "The active milestone is workspace memory for AI Chat V2." |
| `decision` | User-approved product or technical decision | "Store workspace memory in SQLite, not repo files." |
| `workflow` | Workspace-specific command or process | "Run `yarn testmain` for main-process tests." |
| `convention` | Coding, writing, naming, or UX convention for this workspace | "Use TypeORM Model/Module layers for database access." |
| `reference` | Pointer to a local or external resource | "Claude memory-selection reference is at `/home/.../memory-selection.md`." |
| `warning` | Known trap, risk, flaky test, environment issue, or security-sensitive constraint | "Worker processes must not access the database directly." |

The first release must not allow arbitrary memory types.

## 11. What Should Not Be Stored

Workspace memory must not store:

- API keys, tokens, cookies, passwords, private keys, OAuth secrets.
- Browser session data or login cookies.
- Private scraped lead/customer/contact data.
- Full transcripts or bulky tool output.
- Raw file contents that can be read from the workspace.
- Code architecture that is already documented in repository files.
- Git history or current diff summaries.
- Temporary task progress that belongs in conversation/session memory.
- Speculative inferences not confirmed by user behavior or source evidence.
- Sensitive personal data unless the user explicitly asks to remember it and it is necessary.

## 12. Product Scope

### 12.1 Phase 1: Manual Workspace Memory And Retrieval

Add first-class workspace memory storage, manual controls, retrieval, and context injection.

Required:

- Workspace key resolution.
- New workspace memory entity/model/module.
- Workspace memory CRUD APIs.
- Retrieval service filtered by `workspaceKey`.
- Context injection in AI Chat V2.
- User-facing list/edit/archive/delete controls.
- Tests for workspace isolation.

### 12.2 Phase 2: Workspace Auto-Dream

Extend auto-dream to consolidate project-specific memories from AI Chat V2 conversations and agent tasks.

Required:

- Group source packets by resolved approved `workspaceKey`.
- Compare candidate memories only against memories in the same workspace.
- Create/update/archive workspace memories through `AIWorkspaceMemoryModule`.
- Record run metrics and errors.
- Respect AI enablement and memory settings.

### 12.3 Phase 3: Better Retrieval And Surfacing

Improve relevance and observability.

Possible additions:

- Small always-injected workspace memory index.
- Semantic retrieval with sqlite-vec.
- Memory source preview.
- "Why was this memory used?" UI.
- Workspace memory freshness warnings.
- Workspace memory export.

### 12.4 Future: Team Or Repo-Shared Memory

Team memory or repo-stored memory files may be useful later, but they require a separate trust model. They are out of scope for this PRD.

## 13. Functional Requirements

### FR-001: Workspace Key Resolution

The system shall derive a stable workspace key for approved workspaces.

Requirements:

1. The resolver shall canonicalize the workspace root before hashing.
2. The resolver shall prefer Git root detection when available.
3. The resolver shall work when Git is unavailable.
4. The resolver shall not trust paths supplied by the renderer without main-process validation.
5. The resolver shall return null when no approved workspace exists.
6. The resolver shall return null for revoked workspaces.
7. The resolver shall not create memory keys for unapproved pending workspaces.

### FR-002: Workspace Memory Storage

The system shall store workspace memories in SQLite.

Required fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | auto increment |
| `memoryId` | varchar(100) | stable unique id, e.g. `wmem-uuid` |
| `workspaceKey` | varchar(100) | stable workspace scope |
| `workspaceRoot` | varchar(1024) | canonical root path at creation/update time |
| `type` | varchar(30) | closed taxonomy |
| `title` | varchar(200) | short label |
| `content` | text | concise durable memory |
| `status` | varchar(30) | `active`, `archived`, `contradicted` |
| `confidence` | integer | 0-100 |
| `sourceKind` | varchar(30) nullable | `manual`, `chat_v2`, `agent_task`, `auto_dream` |
| `sourceConversationId` | varchar(100) nullable | source conversation |
| `sourceAgentTaskId` | varchar(100) nullable | source agent task |
| `sourceMessageIds` | simple-json nullable | source message ids |
| `lastUsedAt` | datetime nullable | last prompt injection |
| `metadata` | simple-json nullable | small structured details |
| `createdAt` | datetime | inherited auditable timestamp |
| `updatedAt` | datetime | inherited auditable timestamp |

Required indexes:

- unique `memoryId`
- `workspaceKey`
- composite `workspaceKey, status`
- composite `workspaceKey, type`
- `sourceConversationId`
- `sourceAgentTaskId`
- `lastUsedAt`
- `updatedAt`

### FR-003: Model And Module Layering

The system shall follow AiFetchly database architecture.

Requirements:

1. Database access shall live in `AIWorkspaceMemoryModel`.
2. Business logic shall live in `AIWorkspaceMemoryModule`.
3. IPC handlers shall call modules and never use TypeORM repositories directly.
4. Worker processes shall not import or instantiate workspace memory models.
5. Tests shall cover model/module behavior separately from IPC.

### FR-004: Manual Memory Operations

Users shall be able to manage workspace memory manually.

Required operations:

1. List active workspace memories for the active workspace.
2. Search workspace memories by query and type.
3. Create a workspace memory.
4. Edit memory type, title, content, status, confidence, and metadata.
5. Archive a memory.
6. Delete a memory after confirmation.
7. View source attribution where available.
8. Run manual "remember this for this workspace" from AI Chat V2.

Manual create/edit/delete operations do not require an AI call. Natural-language "remember this" may use AI only when transforming text into structured fields.

### FR-005: Retrieval

The system shall retrieve a bounded set of active workspace memories for each AI Chat V2 turn when an approved workspace exists.

Requirements:

1. Retrieve only memories where `workspaceKey` matches the active approved workspace.
2. Exclude archived and contradicted memories.
3. Score candidates by keyword overlap, type weight, confidence, recency, and last-used metadata.
4. Cap selected memories by count.
5. Cap selected memories by estimated token budget.
6. Mark selected memories as used.
7. Return an empty result when no workspace is approved.
8. Return an empty result when workspace memory injection is disabled.
9. Never fall back to global user memory when workspace memory lookup fails.

Recommended defaults:

- maximum workspace memories per prompt: 8
- maximum workspace memory tokens: 1800
- maximum candidates fetched before scoring: 200

### FR-006: Prompt Injection

AI Chat V2 context assembly shall include workspace memory in a defined order.

Recommended order:

1. Base system prompt and mode-specific prompt.
2. User custom context directive.
3. Active workspace block.
4. Workspace memory block.
5. Global user memory block.
6. Conversation compact or session memory.
7. Recent conversation messages.
8. Current user message.

Workspace memory block format:

```text
Workspace memory:
The following memories apply only to the active workspace.
Use them as project-specific context. Do not reveal or quote them unless relevant.
If they conflict with the current user message, follow the current user message.
If they conflict with global user memory, prefer workspace memory for project-specific behavior.

- [decision] Store workspace memory in SQLite: ...
- [workflow] Main process tests: ...
```

### FR-007: Global User Memory Interaction

Workspace memory and global user memory shall remain separate.

Requirements:

1. Workspace memory shall not be saved into `ai_user_memories`.
2. Global user memory shall not include workspace-specific facts unless the user explicitly asks for global scope.
3. Auto-dream shall classify whether a memory candidate is user-scoped or workspace-scoped.
4. Workspace-scoped candidates shall include a `workspaceKey`.
5. If scope is ambiguous, prefer not saving automatically.
6. UI shall make memory scope visible.

### FR-008: Auto-Dream Workspace Consolidation

The system shall extend auto-dream to support workspace memory.

Requirements:

1. Auto-dream shall group chat and agent-task source packets by approved `workspaceKey`.
2. Auto-dream shall skip source packets with no approved workspace when producing workspace memories.
3. Auto-dream shall compare candidates only against active memories from the same workspace.
4. Auto-dream shall create/update/archive workspace memories through `AIWorkspaceMemoryModule`.
5. Auto-dream shall never write workspace memory from a worker process.
6. Auto-dream shall check `USER_AI_ENABLED` before any AI call.
7. Auto-dream shall respect a user-controllable workspace memory setting.
8. Auto-dream shall log source counts, memory changes, model, status, and error messages.
9. Auto-dream failures shall not block visible chat responses or agent task completion.

### FR-009: Source Attribution

Workspace memories shall keep source attribution.

Required source kinds:

- `manual`
- `chat_v2`
- `agent_task`
- `auto_dream`

Attribution should let users answer:

- Which conversation or task produced this memory?
- Was this memory manually created or automatically extracted?
- When was it last updated?
- When was it last used?

### FR-010: Contradiction And Archival

The system shall avoid conflicting active workspace memories.

Requirements:

1. Newer explicit user statements may update or contradict older memories.
2. Contradicted memories shall be marked `contradicted` or archived, not deleted automatically.
3. Manual user edits shall take precedence over automatic updates.
4. Auto-dream shall prefer updating an existing memory over creating a duplicate.
5. Automatic archive/update decisions shall include source metadata and confidence.

### FR-011: Settings

The system shall expose separate settings for workspace memory.

Required settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| workspace memory injection | enabled | whether workspace memories are injected into prompts |
| workspace auto-dream | enabled | whether background consolidation may write workspace memories |
| manual workspace memory | enabled | whether users can create/edit workspace memory |

Disabling injection must not delete stored memories. Disabling auto-dream must not disable manual memory management.

### FR-012: UI Requirements

AI Chat V2 shall expose workspace memory controls.

Required UI:

1. Workspace memory panel or tab reachable from the active workspace area.
2. Memory list grouped or filterable by type.
3. Search field.
4. Create memory action.
5. Edit memory action.
6. Archive action.
7. Delete action with confirmation.
8. Source attribution display.
9. Status display for auto-dream last run.
10. Toggle for workspace memory injection.
11. Toggle for workspace auto-dream.

All new user-facing text must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

### FR-013: Security And Privacy

Workspace memory shall enforce privacy boundaries.

Requirements:

1. Do not retrieve workspace memory without an approved workspace.
2. Do not write workspace memory without an approved workspace.
3. Do not allow renderer-provided `workspaceKey` to bypass main-process resolution.
4. Do not store secrets or secret-like values.
5. Do not store raw cookies, browser sessions, or access tokens.
6. Do not store private scraped customer/contact lists.
7. Do not store large transcript fragments.
8. Do not store raw tool outputs unless manually confirmed and short.
9. Do not let project files configure memory storage paths.
10. Do not store workspace memory inside the project folder in the first release.

### FR-014: Auditability

The system shall make memory behavior observable.

Requirements:

1. Memory records shall expose created and updated timestamps.
2. Memory records shall expose source kind and source IDs where available.
3. Auto-dream runs shall record memory create/update/archive counts.
4. Retrieval shall update `lastUsedAt`.
5. The UI shall show whether a memory is active, archived, or contradicted.
6. Debug logs shall avoid printing sensitive memory content.

## 14. Data Model Recommendation

### 14.1 New Entity

Create a new entity instead of extending `AIUserMemoryEntity`.

Recommended name:

```text
AIWorkspaceMemoryEntity
```

Recommended table:

```text
ai_workspace_memories
```

Reasoning:

- Workspace memory has a different retrieval boundary.
- Workspace memory needs `workspaceKey` as a required field.
- Keeping it separate avoids turning `AIUserMemoryEntity` into a mixed-scope table.
- A separate table makes isolation tests and future migrations clearer.

### 14.2 Supporting Run Metadata

The existing `AIMemoryConsolidationRunEntity` may be extended to track workspace runs, or a new `AIWorkspaceMemoryConsolidationRunEntity` may be created.

Recommendation for first release:

- Extend the existing run model only if it can cleanly distinguish user-memory and workspace-memory counts.
- Otherwise create a separate run table to avoid ambiguous metrics.

Required run fields:

- `runId`
- `status`
- `startedAt`
- `finishedAt`
- `workspaceKey` nullable for grouped/global runs
- `reviewedSince`
- `reviewedThrough`
- `chatConversationsReviewed`
- `agentTasksReviewed`
- `memoriesCreated`
- `memoriesUpdated`
- `memoriesArchived`
- `model`
- `errorMessage`

## 15. Retrieval Algorithm

### 15.1 Initial Deterministic Retrieval

The first version should not require vector search.

Candidate selection:

1. Resolve active workspace.
2. Fetch active memories for `workspaceKey`, newest first, capped at 200.
3. Tokenize current user message.
4. Score each candidate.
5. Select within count and token caps.
6. Mark selected memories as used.

Recommended scoring inputs:

| Signal | Weight Purpose |
| --- | --- |
| title keyword overlap | strong relevance |
| content keyword overlap | medium relevance |
| memory type | decisions and warnings are often high-value |
| confidence | prefer high-confidence memories |
| recency | prefer recently updated memories |
| last-used | slight preference for previously useful memories |

Recommended type priority:

1. `warning`
2. `decision`
3. `workflow`
4. `convention`
5. `reference`
6. `project`

### 15.2 Future Semantic Retrieval

After deterministic retrieval is stable, workspace memories may be embedded and searched through sqlite-vec.

Semantic retrieval must still filter by `workspaceKey` before ranking.

## 16. Auto-Dream Behavior

### 16.1 Candidate Classification

Auto-dream should classify each candidate into one of:

- user memory
- workspace memory
- conversation/session-only memory
- do not store

Workspace memory candidates require:

- an approved workspace for the source conversation or task
- useful future value for that workspace
- no secret-like content
- concise project-specific content

### 16.2 Prompt Guidance

The consolidation prompt must instruct the model:

- Only create workspace memories for the provided `workspaceKey`.
- Do not store secrets.
- Do not store raw transcript text.
- Do not store code facts that are obvious from files.
- Prefer explicit user statements over inferred facts.
- Merge duplicates.
- Archive contradictions.
- Return JSON only.

### 16.3 Output Schema

Auto-dream output should include scope explicitly.

Example:

```json
{
  "create": [
    {
      "scope": "workspace",
      "workspaceKey": "ws_abc123",
      "type": "decision",
      "title": "Workspace memory storage",
      "content": "Store workspace memory in SQLite rather than project files.",
      "confidence": 95,
      "sourceKind": "chat_v2",
      "sourceId": "v2-...",
      "sourceMessageIds": ["msg-..."],
      "reason": "User approved this architecture."
    }
  ],
  "update": [],
  "archive": []
}
```

The parser must validate that every returned `workspaceKey` matches a workspace key from the source packet set.

## 17. User Experience

### 17.1 Workspace Memory Panel

The user should be able to open a workspace memory panel from the AI Chat V2 workspace badge or sidebar.

Minimum fields shown:

- title
- type
- content preview
- status
- confidence
- source
- updated date
- last used date

### 17.2 Empty State

When no workspace memory exists:

```text
No workspace memories yet.
Memories saved here apply only to this workspace.
```

When no workspace is approved:

```text
Choose a workspace before using workspace memory.
```

### 17.3 Manual Save

The chat UI should support a command or action equivalent to:

```text
Remember this for this workspace: ...
```

The assistant should create a workspace-scoped memory only if an approved workspace exists.

### 17.4 Conflict Handling

If the user edits or archives a memory, automatic consolidation should not immediately recreate the same memory unless newer source evidence clearly justifies it.

## 18. IPC And API Requirements

Renderer APIs should be added under a dedicated workspace memory API module.

Suggested channels:

- `ai:workspace-memory:list`
- `ai:workspace-memory:create`
- `ai:workspace-memory:update`
- `ai:workspace-memory:archive`
- `ai:workspace-memory:delete`
- `ai:workspace-memory:auto-dream:run`
- `ai:workspace-memory:auto-dream:status`
- `ai:workspace-memory:settings:get`
- `ai:workspace-memory:settings:update`

IPC handler requirements:

1. Check AI enablement first for AI-powered operations.
2. Validate input before calling modules.
3. Resolve active workspace in the main process.
4. Never accept renderer-supplied `workspaceKey` for privileged operations without verifying it against the active approved workspace.
5. Return structured errors that the UI can display.

## 19. Acceptance Criteria

### 19.1 Workspace Isolation

- Given conversation A uses workspace X and conversation B uses workspace Y, memories created in X are not injected into B.
- Given two conversations use the same canonical workspace root, both can retrieve the same workspace memories.
- Given a workspace is revoked, its memories are not injected into that conversation.
- Given no workspace is approved, workspace memory retrieval returns no context block.

### 19.2 Manual Memory

- Given an approved workspace, the user can create a workspace memory.
- Given an active workspace memory exists, the user can edit it.
- Given an active workspace memory exists, the user can archive it.
- Given an archived memory exists, it is not injected into prompts.
- Given the user deletes a memory, it is permanently removed after confirmation.

### 19.3 Prompt Injection

- Given relevant active workspace memories exist, AI Chat V2 injects a bounded workspace memory block.
- Given both workspace and user memories exist, workspace memories appear before global user memories.
- Given the current user message conflicts with memory, the system prompt instructs the model to follow the current user message.
- Given memory injection is disabled, no workspace memory block is injected.

### 19.4 Auto-Dream

- Given auto-dream is enabled and enough new workspace-bound sources exist, the system creates/update/archive workspace memories.
- Given source packets contain multiple workspaces, auto-dream does not mix memories across workspace keys.
- Given an auto-dream output references an invalid workspace key, the parser rejects that item.
- Given `USER_AI_ENABLED` is not `"true"`, auto-dream does not run.
- Given auto-dream fails, chat still completes and the run record stores the error.

### 19.5 Security

- Given memory content looks like an API key, token, cookie, password, or private key, automatic extraction rejects it.
- Given a renderer request supplies a forged workspace key, the main process ignores it and resolves the approved workspace itself.
- Given a worker process tries to access workspace memory storage directly, tests or runtime checks fail.

## 20. Testing Requirements

### 20.1 Unit Tests

Add tests for:

- workspace key derivation
- Git root fallback behavior
- workspace memory create/update/archive/delete
- retrieval filters by `workspaceKey`
- retrieval excludes archived and contradicted memories
- token and count caps
- scoring order
- secret-like content rejection
- auto-dream output validation
- invalid workspace key rejection

### 20.2 IPC Tests

Add tests for:

- list/create/update/archive/delete handlers
- AI enablement checks for AI-powered operations
- workspace approval enforcement
- forged workspace key rejection
- structured error responses

### 20.3 Context Assembly Tests

Add tests for:

- workspace memory injection order
- disabled workspace memory injection
- no approved workspace behavior
- same-workspace retrieval across multiple conversations
- no cross-workspace retrieval

### 20.4 Auto-Dream Tests

Add tests for:

- grouping sources by workspace key
- skipping no-workspace sources
- create/update/archive application
- failed model output parsing
- invalid workspace references
- run status persistence

### 20.5 Manual Smoke Tests

Manual checks:

1. Create two conversations bound to the same workspace and confirm memory is shared.
2. Create a different workspace and confirm memory is not shared.
3. Archive a memory and confirm it disappears from prompt context.
4. Disable injection and confirm no workspace memory is injected.
5. Run auto-dream manually and inspect created memories.
6. Try to remember a secret-like value and confirm automatic extraction rejects it.

## 21. Metrics

Track locally where possible:

- workspace memory count by workspace
- active/archived/contradicted counts
- retrieval count
- average memories injected per turn
- average token estimate for workspace memory block
- auto-dream runs completed/failed
- auto-dream memories created/updated/archived
- manual create/edit/archive/delete actions

Do not send memory content in telemetry.

## 22. Rollout Plan

### Step 1: Schema And Manual Controls

- Add `AIWorkspaceMemoryEntity`.
- Add model/module/types.
- Add IPC and renderer API.
- Add manual memory UI.
- Add tests.

### Step 2: Retrieval And Prompt Injection

- Add `AIWorkspaceMemoryRetrievalService`.
- Update `AIChatContextAssembler`.
- Add injection setting.
- Add context assembly tests.

### Step 3: Auto-Dream Integration

- Extend source collection to include workspace resolution.
- Add workspace-memory consolidation.
- Add run records and status UI.
- Add parser validation tests.

### Step 4: Polish And Hardening

- Add source attribution UI.
- Add delete confirmation and archive affordances.
- Add prompt wording refinements.
- Add security regression tests.

## 23. Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Cross-workspace leakage | High | Always filter by resolved main-process `workspaceKey`; add isolation tests |
| Prompt bloat | Medium | Count and token caps; deterministic scoring |
| Stale or wrong memories | Medium | Source attribution, archive/edit controls, contradiction status |
| Secret capture | High | Secret filters, prompt rules, parser rejection, no raw transcript storage |
| User confusion between global and workspace memory | Medium | Scope labels and separate UI sections |
| Auto-dream creates noisy memories | Medium | Conservative prompts, confidence, manual controls, source thresholds |
| Workspace key instability | Medium | Canonical real path plus Git root rules; tests |
| Database migration complexity | Medium | Separate entity/table; focused migration tests |

## 24. Open Questions

1. Should worktrees share memory by Git common directory or remain separate by worktree root in the first implementation?
2. Should manual "remember this" default to workspace scope when a workspace is active, or ask the user to choose user vs. workspace scope?
3. Should workspace memory be visible only inside AI Chat V2, or also in a system settings memory page?
4. Should there be a per-workspace maximum memory count before auto-dream starts archiving or asking for review?
5. Should archived memories be searchable by default or hidden behind a status filter?

## 25. Recommended Decisions

1. Use a separate `AIWorkspaceMemoryEntity` table.
2. Store workspace memory in the local SQLite database, not in project files.
3. Resolve `workspaceKey` in the main process only.
4. Require approved workspace for retrieval and writes.
5. Start with deterministic retrieval before vector search.
6. Inject workspace memory before global user memory.
7. Keep auto-dream conservative and scope-aware.
8. Expose manual controls before enabling broad automatic extraction.
