# Workspace Memory AI Tools - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-08-26 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/workspace-memory-ai-tools-prd.md` |
| Parent designs | `docs/prd/workspace-memory-technical-design.md`, `docs/prd/portable-workspace-memory-technical-design.md` |
| Sibling | `docs/prd/workspace-memory-auto-remember-technical-design.md` (auto-dream after task/failure; not chat tools) |
| Analog | `docs/prd/knowledge-library-management-ai-tools-technical-design.md` |
| Primary code paths | `src/service/WorkspaceMemoryAiTools.ts`, `src/config/skillsRegistry.ts`, `src/service/ToolLoadPolicyService.ts`, `src/service/BuiltInToolCapabilitiesPromptSection.ts`, `src/service/AIWorkspaceMemoryService.ts`, `src/service/PortableWorkspaceMemoryService.ts`, `src/service/FilePathGuard.ts`, `src/views/components/aiChatV2/AiChatV2.vue` |

## 1. Purpose

This document translates `docs/prd/workspace-memory-ai-tools-prd.md` into an implementation-facing technical design.

The feature gives AI Chat V2 a turn-time write surface for workspace memory:

```text
User: "Remember for this workspace that we use yarn testmain"
  -> ToolLoadPolicyService promotes remember_workspace_memory
  -> LLM calls remember_workspace_memory({ type, title, content })
  -> SkillExecutor prompts for permission
  -> WorkspaceMemoryAiTools validates args (Zod + payload filter)
  -> WorkspaceMemoryWriteGateway resolves approved workspace from conversationId
  -> private SQLite create  OR  portable file-first create
  -> tool_result returns compact memory metadata
  -> renderer refreshes Workspace memory panel/badge
```

The design keeps the existing hard boundaries:

```text
AI tool layer
  -> parse LLM args, reject bad payloads, format compact results
  -> never touches TypeORM

Write gateway
  -> conversationId -> approved workspace in main process
  -> routes private vs portable
  -> never trusts workspaceKey / root / file path from the model

Module / Model
  -> existing AIWorkspaceMemoryModule / PortableWorkspaceMemoryModule
```

This feature does **not** replace retrieval, auto-dream, or the memory panel. It only adds model-callable tools, routing so the model does not fall back to `file_write`, a file-tool deny for `.aifetchly/memory/`, and an in-chat Remember action. Unattended learning after a finished task or durable failure is specified in `docs/prd/workspace-memory-auto-remember-technical-design.md`.

## 2. Current System Summary

### 2.1 Storage And Isolation

Workspace memory already exists:

```text
AIWorkspaceMemoryService
  -> WorkspaceMemoryContextResolver.resolveForConversation(conversationId)
  -> AIWorkspaceMemoryModule
  -> AIWorkspaceMemoryModel
  -> ai_workspace_memories
```

`WorkspaceMemoryContextResolver` is the trust boundary. Renderer and LLM inputs may carry only `conversationId`. The resolver calls `WorkspaceResolver.resolveWithKey`, checks approval, derives `workspaceKey`, and maps onto `scopeId`. A planted `workspaceKey` on the payload is ignored today in `AIWorkspaceMemoryService` (destructured and discarded). Tools must keep that rule.

Relevant limits already enforced in `AIWorkspaceMemoryModule`:

- title 1–200 characters
- content 1–8,000 characters
- closed type taxonomy
- `looksSecretlike()` on title and content

### 2.2 Portable Path

When portable memory is enabled for a workspace:

```text
PortableWorkspaceMemoryService.createPortable / updatePortable / archivePortable
  -> resolve conversation -> workspace -> scope
  -> PortableWorkspaceMemoryFormat.buildDocument
  -> coordinator.applyAppWrite (atomic file, then SQLite projection)
  -> rebuild INDEX.md
```

`getStatus(conversationId)` already returns:

- `enabled`
- `defaultStorageMode`: `private-only` | `portable-local` | `portable-team` | `ask-each-time`
- counts and git tracking

`createPortable` currently hardcodes `createdBy: "user"`. Tool-originated writes must pass `createdBy: "aifetchly"`. UI Remember action stays `"user"`.

### 2.3 AI Tool Pipeline

Same as knowledge-library tools:

```text
AIChatQueryLoop
  -> SkillExecutor.execute()
  -> SkillRegistry.getSkill()
  -> skill.execute(args, context)
  -> SkillExecutionContext.conversationId
  -> tool_result streamed to renderer
```

Permission:

- `pure` auto-runs
- `filesystem` always prompts (`SkillPermissionService`)

`SkillExecutionContext` already has `conversationId`. Tool JSON Schema must not include workspace identity fields.

### 2.4 Why The Observed Fallback Happens

1. No SkillRegistry entry for workspace memory.
2. `file_write` is contextual and promoted by save/export/create-file phrasing in `ToolLoadPolicyService`.
3. `BuiltInToolCapabilitiesPromptSection` maps "save data to csv/file" to `file_write` and has no workspace-memory row.
4. Always-loaded tools are `file_read` / `glob_files` / `grep_files`, so the model copies files.

### 2.5 Manual Setting And IPC

`ai_workspace_manual_memory_enabled` (default on) already gates IPC create/update/archive/delete in `ai-workspace-memory-ipc.ts`. List is not gated. Tools and the UI action must reuse the same toggle. Read failure degrades to enabled, matching IPC.

IPC create always calls `createManualMemory` (`sourceKind: "manual"`). The panel already branches to portable APIs when portable is enabled. The new gateway must do the same so chat tools do not create a SQLite-only duplicate of a portable record.

### 2.6 List View Leak

`AIWorkspaceMemoryView` includes `workspaceKey` and `workspaceRoot`. Model-facing tool results must **not** return those fields. Map to a compact summary type in the tool layer.

## 3. Target Architecture

### 3.1 New Files

```text
src/entityTypes/workspaceMemoryAiToolTypes.ts
src/service/WorkspaceMemoryPayloadFilter.ts
src/service/WorkspaceMemoryWriteGateway.ts
src/service/WorkspaceMemoryAiTools.ts
src/service/WorkspaceMemoryChangedNotifier.ts

test/vitest/utilitycode/WorkspaceMemoryPayloadFilter.test.ts
test/vitest/main/service/WorkspaceMemoryAiTools.test.ts
test/vitest/main/service/WorkspaceMemoryWriteGateway.test.ts
test/vitest/main/service/WorkspaceMemoryToolLoadPolicy.test.ts
test/vitest/main/components/AiChatV2RememberWorkspaceMemory.test.ts
```

Payload filter is a pure function with no Electron/DB imports so it can live under `test/vitest/utilitycode/`.

### 3.2 Modified Files

```text
src/config/skillsRegistry.ts
src/service/ToolLoadPolicyService.ts
src/service/BuiltInToolCapabilitiesPromptSection.ts
src/service/ToolCatalogService.ts
src/config/fileToolConfig.ts
src/service/FileToolService.ts          # map deny to a next-step error for memory dir
src/service/AIWorkspaceMemoryService.ts # createFromChat
src/service/PortableWorkspaceMemoryService.ts  # createdBy argument
src/config/channellist.ts
src/preload.ts
src/views/api/aiWorkspaceMemory.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/components/aiChatV2/WorkspaceMemoryEditorDialog.vue
src/views/lang/{en,zh,es,fr,de,ja}.ts
```

Do not add a new IPC create channel for the tools. Tools run in the main process through SkillRegistry and call the gateway directly.

The UI Remember action continues to use existing renderer APIs (`ai:workspace-memory:create` and portable create) **or** a thin wrapper that still goes through the same gateway if we expose one IPC. Recommendation: UI keeps existing panel APIs for create (already tested). Tools use the gateway in-process. Payload filter is shared: UI dialog calls a renderer-safe copy of the heuristic **or** the main process rejects on create. Recommendation: keep the heuristic only in main-process `WorkspaceMemoryPayloadFilter`, and have the UI action create go through a new IPC `ai:workspace-memory:remember-from-chat` that runs the same gateway. That prevents the panel path and the chat path from drifting.

Revised UI path:

```text
Remember action
  -> workspaceMemoryApi.rememberFromChat({ conversationId, type, title, content, confidence })
  -> ai:workspace-memory:remember-from-chat
  -> WorkspaceMemoryWriteGateway.remember(..., origin: "manual")
```

Existing panel Create stays on `ai:workspace-memory:create` / portable create. The new action is the PRD §17.3 path and must run the payload filter. Panel Create may keep current behavior (user is editing structured fields already). If the user pastes a CSV into the panel, Module secret filter still runs; payload filter on the panel is optional v1. PRD requires the filter on the tool and on the Remember action.

### 3.3 Runtime Flow — Remember Tool

```text
User message matches workspace-memory intent
  -> catalog marks remember_* tools contextual
  -> model calls remember_workspace_memory
  -> SkillExecutor filesystem confirmation (title + content in args)
  -> rememberWorkspaceMemoryForAi(args, context)
       1. USER_AI_ENABLED === "true" else AI_DISABLED
       2. strip/forbid workspaceKey, workspaceRoot, scopeId, filePath
       3. Zod parse
       4. payload filter
       5. gateway.remember({ conversationId: context.conversationId, origin: "chat_v2", ... })
  -> notifier.emitChanged
  -> compact result to model
```

### 3.4 Runtime Flow — Dataset Case

```text
User: "please remember those item in workspace member"
  -> memory tools AND possibly file_write are both eligible
  -> model should file_write the CSV if needed
  -> then remember_workspace_memory type=reference with a short pointer
  -> if model stuffs CSV into content -> PAYLOAD_NOT_MEMORY
       nextStep: "Save the dataset with file_write, then call remember_workspace_memory with type reference"
```

Capability table and tool description must state this two-step. The remember tool must not write files.

### 3.5 Data Ownership

| Data | Owner |
| --- | --- |
| Tool definitions / permissions | `skillsRegistry.ts` |
| Zod schemas + model-facing DTOs | `workspaceMemoryAiToolTypes.ts` |
| Dataset/contact heuristics | `WorkspaceMemoryPayloadFilter.ts` |
| Scope + private/portable routing | `WorkspaceMemoryWriteGateway.ts` |
| SQLite CRUD | existing Module/Model |
| Portable files + INDEX | existing `PortableWorkspaceMemoryService` |
| Secret filter | existing `MemorySecretFilter` |
| Path deny for `.aifetchly/memory/` | `fileToolConfig.ts` DEFAULT_DENY_LIST |
| Intent promotion | `ToolLoadPolicyService` |
| Always-injected routing hint | `BuiltInToolCapabilitiesPromptSection` |
| Catalog search tokens | `ToolCatalogService` TOOL_SEARCH_HINTS |

## 4. Shared Types

File: `src/entityTypes/workspaceMemoryAiToolTypes.ts`

Follow `knowledgeLibraryAiToolTypes.ts`: Zod schemas live next to types. Import `z` from `zod`. Export `z.infer` types. No `any`.

### 4.1 Error Envelope

```typescript
export type WorkspaceMemoryAiToolErrorCode =
  | "INVALID_INPUT"
  | "AI_DISABLED"
  | "NO_APPROVED_WORKSPACE"
  | "SECRET_LIKE"
  | "PAYLOAD_TOO_LONG"
  | "PAYLOAD_NOT_MEMORY"
  | "INVALID_TYPE"
  | "MANUAL_MEMORY_DISABLED"
  | "CONFLICT"
  | "NOT_FOUND"
  | "TITLE_MISMATCH"
  | "PERMISSION_DENIED";

export interface WorkspaceMemoryAiToolError {
  readonly success: false;
  readonly code: WorkspaceMemoryAiToolErrorCode;
  readonly error: string;
  readonly nextStep?: string;
}
```

Never put title, content, emails, or absolute paths in `error`. Map Module throws:

| Thrown message (existing) | Code |
| --- | --- |
| `Choose an approved workspace before using workspace memory.` | `NO_APPROVED_WORKSPACE` |
| `Workspace memory content looks like a secret...` | `SECRET_LIKE` |
| `Invalid title length` / content length | `PAYLOAD_TOO_LONG` |
| `Invalid workspace memory type` | `INVALID_TYPE` |
| `Workspace memory not found` | `NOT_FOUND` |
| `concurrent external edit detected...` | `CONFLICT` |

Strip absolute paths from unexpected Error.message before returning to the model (same sanitize idea as knowledge-library tools).

### 4.2 Compact Memory Summary

```typescript
export interface WorkspaceMemoryAiSummary {
  readonly memoryId: string;
  readonly type: AIWorkspaceMemoryType;
  readonly title: string;
  readonly content: string;
  readonly contentTruncated: boolean;
  readonly status: AIWorkspaceMemoryStatus;
  readonly confidence: number;
  readonly storageMode: "private" | "portable-local" | "portable-team";
  readonly relativePath?: string;
  readonly updatedAt: string;
}
```

Rules:

- `content` in list results: max 500 characters; set `contentTruncated` when clipped.
- Remember success: return full content if ≤ 500, else clip. The panel has the full row.
- Never include `workspaceKey`, `workspaceRoot`, numeric DB `id`, `sourceMessageIds`, embeddings.

### 4.3 Zod Schemas

```typescript
const memoryTypeSchema = z.enum([
  "project",
  "decision",
  "workflow",
  "convention",
  "reference",
  "warning",
]);

export const rememberWorkspaceMemoryInputSchema = z
  .object({
    type: memoryTypeSchema,
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(8000),
    confidence: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const listWorkspaceMemoriesInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    type: memoryTypeSchema.optional(),
    includeArchived: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .strict();

export const updateWorkspaceMemoryInputSchema = z
  .object({
    memoryId: z.string().trim().min(1).max(100),
    type: memoryTypeSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(8000).optional(),
    confidence: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const archiveWorkspaceMemoryInputSchema = z
  .object({
    memoryId: z.string().trim().min(1).max(100),
    expected_title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
```

`.strict()` rejects `workspaceKey`, `filePath`, and other extras as `INVALID_INPUT`.

`memoryId` pattern for app-generated ids is `wmem-` + UUID. Do not require a regex so imported/legacy ids still archive. Gateway lookup is scoped by resolved workspace, so a foreign id becomes `NOT_FOUND`.

## 5. Payload Filter

File: `src/service/WorkspaceMemoryPayloadFilter.ts`

Pure functions. No Token, no DB, no path I/O.

```typescript
export type PayloadFilterResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "SECRET_LIKE" | "PAYLOAD_TOO_LONG" | "PAYLOAD_NOT_MEMORY";
      readonly nextStep?: string;
    };

export function filterWorkspaceMemoryPayload(input: {
  readonly title: string;
  readonly content: string;
}): PayloadFilterResult;
```

Order:

1. Length (title 1–200, content 1–8000) → `PAYLOAD_TOO_LONG`
2. `looksSecretlike(title) || looksSecretlike(content)` → `SECRET_LIKE`
3. Dataset heuristics → `PAYLOAD_NOT_MEMORY`

### 5.1 Dataset Heuristics (deterministic)

Implement as named helpers so tests target each rule.

**H1 — emails:** count matches of a conservative email regex in `content`. If count ≥ 8 → reject.

**H2 — phones:** count tokens matching `/\+?\d[\d\s\-()]{7,}\d/` after stripping emails. If count ≥ 8 → reject.

**H3 — CSV/TSV table:**

- Split on newlines, ignore empty lines.
- If ≥ 6 lines, and ≥ 5 lines contain at least 2 commas or 2 tabs.
- And the first non-empty line looks like a header (`name`, `email`, `phone`, `mobile`, `whatsapp`, `company`, `contact` case-insensitive).

**H4 — contact columns:** header line contains 2+ of `{email, phone, mobile, whatsapp, tel}` and body has ≥ 5 data rows.

**H5 — JSON contact array:** parse content (or a fenced ```json block). If it is an array of objects with length > 5, and objects have `email` or `phone` keys → reject.

A short `reference` memory that mentions "CSV" once must pass. Tests must include:

- 3 emails inside a warning → allow
- 8 emails → reject
- `The supplier list is at wholesale_mobile_suppliers.csv` → allow
- 20-row CSV with `name,email,phone` header → reject
- JSON array of 10 `{name,email}` objects → reject

`nextStep` for `PAYLOAD_NOT_MEMORY`:

```text
Save the dataset with file_write (or knowledge library import), then call remember_workspace_memory with type "reference" and a short pointer to the file. Do not paste rows into workspace memory.
```

The Module secret filter still runs as a second line of defense.

## 6. Write Gateway

File: `src/service/WorkspaceMemoryWriteGateway.ts`

This is the only place tools decide private vs portable.

```typescript
export type WorkspaceMemoryWriteOrigin = "manual" | "chat_v2";

export class WorkspaceMemoryWriteGateway {
  remember(input: {
    conversationId: string;
    type: AIWorkspaceMemoryType;
    title: string;
    content: string;
    confidence?: number;
    origin: WorkspaceMemoryWriteOrigin;
  }): Promise<WorkspaceMemoryAiSummary>;

  list(input: {
    conversationId: string;
    query?: string;
    type?: AIWorkspaceMemoryType;
    includeArchived?: boolean;
    limit: number;
  }): Promise<{
    memories: WorkspaceMemoryAiSummary[];
    returned: number;
    limit: number;
  }>;

  update(...): Promise<WorkspaceMemoryAiSummary>;
  archive(input: {
    conversationId: string;
    memoryId: string;
    expectedTitle?: string;
  }): Promise<{ success: true; memoryId: string }>;
}
```

### 6.1 Common Preconditions

Every mutating method:

1. Resolve `WorkspaceMemoryContextResolver.resolveForConversation`. Null → throw mapped to `NO_APPROVED_WORKSPACE`.
2. Read `ai_workspace_manual_memory_enabled`. `"false"` → `MANUAL_MEMORY_DISABLED`.
3. Ignore any extra identity fields. `conversationId` is the only scope input.

List skips step 2 (same as IPC).

### 6.2 Remember Routing

```text
status = PortableWorkspaceMemoryService.getStatus(conversationId)

if !status.enabled OR status.defaultStorageMode === "private-only":
  AIWorkspaceMemoryService.createFromChat / createManualMemory
    sourceKind = origin === "chat_v2" ? "chat_v2" : "manual"
    sourceConversationId = conversationId when origin is chat_v2

else if defaultStorageMode === "portable-local":
  createPortable({ visibility: "local", createdBy: origin === "chat_v2" ? "aifetchly" : "user" })

else if defaultStorageMode === "portable-team":
  createPortable({ visibility: "team", createdBy: ... })

else if defaultStorageMode === "ask-each-time":
  v1: createPortable visibility "local"  (do not add a tool arg)
```

`createFromChat` is a new method on `AIWorkspaceMemoryService` identical to `createManualMemory` except `sourceKind` / `sourceConversationId`. Do not overload `createManualMemory` with a silent source switch.

Extend `PortableWorkspaceMemoryService.createPortable` with:

```typescript
readonly createdBy?: PortableMemoryCreatedBy; // default "user"
```

Do not change file-first write order.

After success, `WorkspaceMemoryChangedNotifier.notify({ conversationId, memoryId, action: "created" })`.

### 6.3 Update / Archive Routing

Load the row in the resolved scope.

If the memory has a portable state (`storageMode` not private / has relativePath):

- update → `updatePortable` with current visibility, `expectedHash` from portable state
- archive → `archivePortable`

If private:

- `AIWorkspaceMemoryService.update` / `archive`

Hash mismatch → `CONFLICT`. Do not overwrite.

`expected_title` on archive: trim + case-insensitive compare to current title. Mismatch → `TITLE_MISMATCH` and do not archive.

### 6.4 List Mapping

Call `AIWorkspaceMemoryService.list` with:

- `status: includeArchived ? "all" : "active"`
- `limit` clamped 1–50
- `query`, `type`

If portable is enabled, prefer `listWithPortableState` so `storageMode` and `relativePath` are accurate. Relative path only, never absolute.

Filter out rejected/conflicted portable rows from the default list (they must not enter prompt context; they also should not be offered as update targets). Include them only if a later `includeDiagnostics` flag is added. v1: omit rejected/conflicted.

## 7. Tool Layer

File: `src/service/WorkspaceMemoryAiTools.ts`

Pattern: `KnowledgeLibraryAiTools.ts`.

Exported functions:

```typescript
rememberWorkspaceMemoryForAi(args, context): Promise<RememberOutcome>
listWorkspaceMemoriesForAi(args, context): Promise<ListOutcome>
updateWorkspaceMemoryForAi(args, context): Promise<UpdateOutcome>
archiveWorkspaceMemoryForAi(args, context): Promise<ArchiveOutcome>
```

Each function:

1. `isAIEnabled()` via `Token` + `USER_AI_ENABLED`. False → `{ success: false, code: "AI_DISABLED", error: "AI is not enabled" }`.
2. Zod `safeParse`. Failure → `INVALID_INPUT` with issue messages. No payload body.
3. Remember/update: `filterWorkspaceMemoryPayload`.
4. Gateway call.
5. Catch → mapError.

Do not instantiate Models. Do not import TypeORM.

AI enable is required even though CRUD needs no model call, because these functions are only reachable from AI Chat V2. Matches knowledge-library import gating style.

## 8. SkillRegistry

Register next to other built-in mutating tools in `src/config/skillsRegistry.ts`. Static imports only (project rule: no `import()`).

Timeout class: `fast` (local SQLite / small Markdown write).

### 8.1 `remember_workspace_memory`

- `tier: "main"`
- `requiresConfirmation: true`
- `permissionCategory: "filesystem"`
- `source: "built-in"`

Description (must include these constraints verbatim in spirit):

```text
Save one concise project memory for the active approved workspace
(workspace memory / project memory / "workspace member").
Use for decisions, workflows, conventions, warnings, or a short file pointer.
Do NOT store CSVs, contact lists, lead dumps, transcripts, secrets, or raw file contents.
For datasets: file_write (or knowledge library), then call this tool with type "reference".
Do NOT write files under .aifetchly/memory/ with file_write.
Requires an approved workspace. Requires user confirmation.
```

`execute`:

```typescript
execute: async (args, context) => {
  const result = await rememberWorkspaceMemoryForAi(args, context);
  return {
    success: result.success,
    result: result as unknown as Record<string, unknown>,
  };
}
```

Optional `buildPermissionPreview`: title, type, first 200 chars of content. If `SkillDefinition.buildPermissionPreview` exists on neighboring tools, use it so the confirm dialog is readable.

### 8.2 `list_workspace_memories`

- `requiresConfirmation: false`
- `permissionCategory: "pure"`

Description: list active memories for this workspace; use before update/archive; not a substitute for file search.

### 8.3 `update_workspace_memory` / `archive_workspace_memory`

Same permission as remember. Archive description: does not hard-delete; panel delete remains the only hard-delete path.

## 9. Load Policy And Prompt Routing

### 9.1 ToolLoadPolicyService

Add:

```typescript
const CONTEXTUAL_WORKSPACE_MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "remember_workspace_memory",
  "list_workspace_memories",
  "update_workspace_memory",
  "archive_workspace_memory",
]);
```

Intent regex (export a tester for unit tests, same style as `hasBatchImageEditIntent`):

```typescript
const WORKSPACE_MEMORY_INTENT_RE =
  /\bworkspace\s+memor(?:y|ies)\b|\bproject\s+memor(?:y|ies)\b|\bworkspace\s+members?\b|\b(?:remember|save|store|memorize|memorise)\b[^.!?\n]{0,80}?\b(?:this\s+workspace|the\s+workspace|this\s+project|workspace\s+memory|project\s+memory|workspace\s+members?)\b|\bwhat\s+do\s+you\s+remember\b[^.!?\n]{0,40}?\b(?:workspace|project)\b/i;
```

Classify branch: after knowledge-library promotion, before the generic deferred return.

**Priority when both match:**

1. If `hasKnowledgeLibraryIntent(msg)` → do **not** promote memory tools from this regex. Knowledge-library "remember this website" stays on import tools.
2. Else if workspace-memory regex matches → promote memory tools.
3. File-write regex stays independent. "export to csv" still promotes `file_write`. A message can promote both; the capability table tells the model which to use for which payload.

Continuation / plan-execution inheritance already works via `messageMatchesIntent`. Do not add a special case.

Tests in `test/vitest/main/service/ToolLoadPolicyService.test.ts` (or a focused sibling file):

| Message | Memory tools | file_write | knowledge import |
| --- | --- | --- | --- |
| `Remember for this workspace that we use yarn testmain` | contextual | deferred* | deferred |
| `please remember those item in workspace member` | contextual | deferred* unless export/csv phrasing | deferred |
| `export those data to a csv file` | deferred | contextual | deferred |
| `remember this website in the knowledge library` | deferred | deferred | contextual |
| `What do you remember for this workspace?` | contextual | deferred | deferred |

\* `file_write` only if `FILE_WRITE_INTENT_RE` also matches. "remember those items in workspace member" must **not** match file-write regex.

### 9.2 BuiltInToolCapabilitiesPromptSection

Insert a row **above** the file-write row so "remember" is not first claimed by files:

| Capability | Tools | Search query |
| --- | --- | --- |
| Remember/save a concise project fact, decision, convention, workflow, warning, or file pointer for this workspace ("workspace memory", "project memory", "workspace member"). Not for CSVs, contact lists, or bulk data. | `remember_workspace_memory`, `list_workspace_memories`, `update_workspace_memory`, `archive_workspace_memory` | `workspace memory remember` |

Edit the existing file-write row to add: do not use `file_write` as a substitute for workspace memory; do not write `.aifetchly/memory/`.

Keep the block small. Do not add a second paragraph per tool.

### 9.3 TOOL_SEARCH_HINTS

In `ToolCatalogService.ts` add hints for all four names:

```text
workspace memory, project memory, remember, workspace member,
workspace, convention, decision, archive memory
```

`tool_catalog_search` with `workspace memory remember` must rank `remember_workspace_memory` in the top results. Add a catalog search unit test if one already exists for other hints; otherwise add a focused test.

## 10. File Tool Deny For Portable Memory Directory

Add to `DEFAULT_DENY_LIST` in `src/config/fileToolConfig.ts`:

```typescript
{
  patterns: [
    ".aifetchly/memory/**",
    "**/.aifetchly/memory/**",
    ".aifetchly/memory",
    "**/.aifetchly/memory",
  ],
  description:
    "Portable workspace memory is owned by remember_workspace_memory; do not use file_write",
}
```

`FilePathGuard.validate` already returns:

```text
Access denied by security policy: <description>
code: DENY_LISTED
```

That description is enough for the model if `file_write` forwards `verdict.error`. Verify `FileToolService` write/edit returns the guard error string unchanged. If it swallows the description, map `DENY_LISTED` + memory-dir relative path to:

```text
Cannot write .aifetchly/memory files with file_write. Use remember_workspace_memory.
```

Applies to `file_write` and `file_edit`. `file_read` of those files may remain allowed so agents can inspect portable files; PRD only forbids write/edit. Glob/grep of the directory can stay allowed.

Tests: write `/.aifetchly/memory/wmem-fake.md` and `memory/foo.md` under a fake workspace root → denied. Write `notes.md` → allowed.

Do not deny the whole `.aifetchly/` tree. `AGENTS.md`, `settings.json`, skills, and hooks must remain writable through existing extensibility flows.

## 11. Changed Event

Add channel in `channellist.ts`:

```text
AI_WORKSPACE_MEMORY_CHANGED = "ai:workspace-memory:changed"
```

Payload:

```typescript
{
  conversationId: string;
  memoryId: string;
  action: "created" | "updated" | "archived";
}
```

Main process: `webContents.send` to the focused AI Chat window (follow portable `ai:portable-workspace-memory:changed` wiring in preload).

Renderer: `AiChatV2.vue` already loads `workspaceMemoryCount` via `workspaceMemoryApi.list`. Subscribe and refresh count + `WorkspaceMemoryPanel` if mounted.

Tools run in main, so the notifier is required. UI Remember via IPC can emit from the same gateway so one subscription covers both.

Do not log title or content.

## 12. In-Chat Remember Action (Phase 3)

### 12.1 Placement

`AiChatV2Message.vue`: for `role === "assistant"` and normal text messages (not tool_call / tool_result / plan cards), show a text button:

```text
t("workspaceMemory.rememberForWorkspace") || "Remember this for this workspace"
```

Disabled when the parent reports no approved workspace. Tooltip: existing `workspaceMemory.noWorkspace`.

Hover or always-visible row under the bubble is fine; match existing compact tool-header density. Add `data-testid="workspace-memory-remember-action"`.

### 12.2 Dialog

Reuse `WorkspaceMemoryEditorDialog.vue`. Add optional create prefills:

```typescript
initialTitle?: string;
initialContent?: string;
initialType?: AIWorkspaceMemoryType;
```

When `memory` is absent, `resetFromMemory` uses initials instead of empty strings. Clip content to 8000 in the parent before passing.

Prefill algorithm (renderer, no AI call in v1):

- `initialType`: `"project"`
- `initialTitle`: first non-empty line of the message, clipped to 200
- `initialContent`: full message text clipped to 8000

Do not call a model to extract fields in v1. The original PRD allowed AI only when transforming text; skipping it keeps the action working when AI extraction would be overkill and avoids a second gate.

Parent save handler:

```text
workspaceMemoryApi.rememberFromChat({
  conversationId,
  type, title, content, confidence
})
```

If the IPC returns `PAYLOAD_NOT_MEMORY`, show `resp.msg` on the dialog and do not close. Offer helper copy: save as a file pointer (user edits type to `reference` and shortens content).

### 12.3 IPC

New channel `ai:workspace-memory:remember-from-chat`:

- Check `USER_AI_ENABLED` first if this is considered an AI Chat surface operation. Recommendation: **do** check AI enable, because the action lives only on AI Chat V2.
- Check manual memory setting.
- Run payload filter.
- Call gateway `origin: "manual"`.
- Return `CommonMessage<WorkspaceMemoryAiSummary>`.

Do not accept `workspaceKey` from the renderer.

### 12.4 i18n

Add keys under `workspaceMemory` in all six language files:

- `rememberForWorkspace`
- `rememberSuccess`
- `rememberPayloadNotMemory`
- `rememberNoWorkspace`

Component tests must assert the English key path exists; translation completeness is a file-level check like other UI work.

## 13. Security

1. Scope is only `context.conversationId` / IPC `conversationId`. Extra identity keys fail Zod `.strict()` or are discarded.
2. Confirmation shows the exact title and content about to persist.
3. Secret filter + payload filter run before any write.
4. Portable writes stay file-first through the coordinator. Tools never call `fs.writeFile` on memory files.
5. `.aifetchly/memory` is deny-listed for file write/edit.
6. List/tool results omit absolute paths and `workspaceKey`.
7. Logs: tool name, toolCallId, conversationId, memoryId, type, storageMode, error code. No title/content.
8. Injection header in `AIWorkspaceMemoryRetrievalService` stays unchanged. New memories are untrusted project context on later turns.
9. Workers still must not import memory models. Tool code is main-process only.
10. Archive is the only mutating removal from the model. No delete tool.

## 14. Error Mapping Implementation

```typescript
function mapGatewayError(error: unknown): WorkspaceMemoryAiToolError {
  if (error instanceof ZodError) { ... }
  const message = error instanceof Error ? error.message : String(error);
  const sanitized = stripAbsolutePaths(message);
  if (sanitized.includes("approved workspace")) return code NO_APPROVED_WORKSPACE;
  if (sanitized.includes("secret")) return SECRET_LIKE;
  if (sanitized.includes("not found")) return NOT_FOUND;
  if (sanitized.includes("concurrent external edit")) return CONFLICT;
  if (sanitized.includes("Manual workspace memory is disabled")) return MANUAL_MEMORY_DISABLED;
  return { success: false, code: "INVALID_INPUT", error: sanitized };
}
```

Prefer throwing typed errors from the gateway (`class WorkspaceMemoryWriteError extends Error { code }`) so mapping does not depend on English substrings. Recommendation: typed error with `code` field. Tests assert on `code`.

## 15. Testing

### 15.1 Payload filter (`test/vitest/utilitycode/`)

- allow: decision prose, reference to a csv path, 3 emails in a warning
- reject: 8 emails, 8 phones, 6+ row contact CSV, JSON contact array > 5
- secret-like still rejected (delegate to `looksSecretlike` samples)
- length boundaries 200 / 8000

### 15.2 Gateway

- no conversation / revoked workspace → `NO_APPROVED_WORKSPACE`
- planted `workspaceKey` in a wrapper object is ignored (if any passthrough)
- private-only → `createFromChat` / `createManualMemory`, no portable file
- portable-local → `createPortable` visibility local, `createdBy` aifetchly for chat origin
- update private vs portable dispatches correctly
- archive expected_title mismatch
- portable hash conflict
- two workspaces: list/create in A cannot see B (reuse existing isolation fixtures if present)

### 15.3 Tool layer

- Zod extra key `workspaceKey` → `INVALID_INPUT`
- AI disabled → `AI_DISABLED` and gateway not called
- payload reject before gateway
- list strips `workspaceRoot`

### 15.4 Load policy and capability section

See table in §9.1. Also assert `buildBuiltInToolCapabilitiesSection()` contains `remember_workspace_memory` and the anti-file_write substitution clause.

### 15.5 File deny

`FilePathGuard` with a temp workspace: write `.aifetchly/memory/x.md` denied; write `hello.txt` allowed; write `.aifetchly/settings.json` allowed.

### 15.6 Permissions

- list auto-executes (pure)
- remember/update/archive require confirmation
- denied remember → no DB insert (mock SkillPermissionService or call gateway only from execute after grant)

### 15.7 Component

- action visible on assistant text messages
- hidden or disabled without workspace
- dialog prefills title/content
- save calls rememberFromChat
- PAYLOAD_NOT_MEMORY stays open with error

### 15.8 Regression

Existing workspace-memory module tests, retrieval/context assembler tests, portable CRUD tests, and `file_write` tests must still pass.

## 16. Implementation Sequence

Aligns with PRD phases.

### Phase 1 — Remember and list

1. Types + Zod + payload filter + tests
2. `createFromChat` on `AIWorkspaceMemoryService`
3. `createdBy` on `createPortable`
4. Write gateway + notifier
5. `WorkspaceMemoryAiTools` remember + list
6. SkillRegistry + load policy + capability row + search hints
7. IPC `remember-from-chat` can wait for Phase 3; tools do not need it
8. Unit tests for the supplier CSV reject and the yarn testmain allow

Exit: natural-language remember creates a panel-visible memory; CSV body is rejected.

### Phase 2 — Update, archive, portable, file deny

1. Gateway update/archive + portable dispatch
2. Tools update/archive
3. Deny-list + FileToolService error mapping
4. Conflict / expected_title tests

### Phase 3 — UI action

1. Channel, preload, renderer API
2. Message button + dialog prefills
3. i18n + component tests
4. Subscribe to changed event for badge refresh (also wire Phase 1 notifier so tool creates refresh the badge)

### Phase 4 — Out of scope here

Global user-memory tool, semantic list, hard-delete tool.

## 17. Open Engineering Decisions

1. **Typed gateway errors vs string matching.** Use a small `WorkspaceMemoryWriteError` with `code`. Do not parse English `Error.message` in production mapping.

2. **`ask-each-time` visibility.** v1 writes `portable-local`. Do not add a tool argument.

3. **List content cap 500.** Retrieval still injects full content for selected memories on later turns. Tool list is only for the model to pick ids.

4. **file_read of `.aifetchly/memory`.** Allowed. Write/edit denied.

5. **UI action AI extraction.** v1 prefills from raw message text. No extra model call.

6. **Whether remember requires filesystem confirmation.** Yes, per PRD. Preview should show type/title/content. The UI action is the low-friction path and still uses a dialog.

7. **Badge refresh for tool writes.** Required in Phase 1 notifier even if the Remember button ships in Phase 3. Otherwise the user saves via chat and the panel looks empty until reload.

## 18. Non-Goals Recap For Implementers

- Do not put database access in `WorkspaceMemoryAiTools` or IPC handlers.
- Do not register portable enable/rescan/conflict/bridge/identity as AI tools.
- Do not add `delete_workspace_memory`.
- Do not inject the new memory into the current turn's existing prompt (too late). Next turn retrieval picks it up.
- Do not use vector search for list.
- Do not let the model pass a path to remember; relative path is output-only from portable state.

## 19. Definition Of Done

1. Four tools registered; list is pure; the other three confirm.
2. Scope is conversation-resolved; extra identity keys rejected.
3. Payload filter rejects contact/CSV dumps; allows short references.
4. Intent regex covers workspace memory / this workspace / workspace member.
5. Capability table row exists; file-write is not the remember substitute.
6. `file_write`/`file_edit` cannot mutate `.aifetchly/memory/`.
7. Portable-enabled remember goes through `createPortable` with `createdBy: "aifetchly"`.
8. Changed event refreshes the panel badge.
9. In-chat Remember action works without a tool call.
10. Isolation, permission, policy, filter, and component tests pass.
11. Six-language strings for new UI.
12. Existing workspace-memory and portable tests still pass.
