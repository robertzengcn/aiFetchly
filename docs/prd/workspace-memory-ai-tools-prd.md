# Workspace Memory AI Tools - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-26
- **Owner**: AiFetchly AI Chat
- **Related areas**: AI Chat V2, workspace memory, portable workspace memory, built-in tool catalog, tool load policy
- **Technical design**: `docs/prd/workspace-memory-ai-tools-technical-design.md`
- **Parent features**:
  - `docs/prd/workspace-memory-prd.md`
  - `docs/prd/portable-workspace-memory-prd.md`
- **Related PRDs**:
  - `docs/prd/workspace-memory-auto-remember-prd.md` — background auto-dream after tasks and durable failures (Layers B and C). This tools PRD is Layer A only.
  - `docs/prd/knowledge-library-management-ai-tools-prd.md`
  - `docs/prd/ai-tool-list-management-prd.md`
  - `docs/workspace-aware-file-tools-prd.md`
- **Related files**:
  - `src/config/skillsRegistry.ts`
  - `src/service/ToolLoadPolicyService.ts`
  - `src/service/BuiltInToolCapabilitiesPromptSection.ts`
  - `src/service/AIWorkspaceMemoryService.ts`
  - `src/service/PortableWorkspaceMemoryService.ts`
  - `src/modules/AIWorkspaceMemoryModule.ts`
  - `src/service/WorkspaceMemoryContextResolver.ts`
  - `src/service/MemorySecretFilter.ts`
  - `src/views/components/aiChatV2/AiChatV2.vue`
  - `src/views/components/aiChatV2/WorkspaceMemoryPanel.vue`

## 1. Summary

AiFetchly already stores durable workspace memory, injects a bounded subset into AI Chat V2, exposes a manual memory panel, and can write portable Markdown files under `.aifetchly/memory/`. Users still cannot ask the assistant, in chat, to remember something for the active workspace.

This feature adds a small family of built-in AI tools and an in-chat UI action so the assistant can create, list, update, and archive workspace memories during a turn. The tools reuse the existing Module and Service layer. They never accept a renderer-supplied workspace key, never write portable memory files through `file_write`, and never store bulk datasets, contact lists, secrets, or raw transcripts as memories.

The expected user-visible outcome is:

- "Remember this for this workspace" creates a workspace memory, not a copied CSV or Markdown dump.
- The assistant can list what it already remembers for the active workspace.
- Bulk data still goes to workspace files or the knowledge library.
- A short `reference` memory can point at a saved file.
- Portable memory, when enabled, is written through the existing portable service, not as an ordinary workspace file.

This PRD fills the gap left by the original workspace-memory PRD FR-004.8 and §17.3: a first-class "remember this for this workspace" path from AI Chat V2.

## 2. Problem Statement

A user with an approved workspace said:

```text
please remember those item in workspace member
```

The assistant interpreted "workspace member" as a folder or database, then copied `wholesale_mobile_suppliers.csv` into the workspace and wrote a summary Markdown file. That is the wrong store for workspace memory, and the wrong shape of data even if the store were correct.

This happened because of three stacked gaps:

1. **No model-facing write tool.** Workspace memory exists as SQLite, retrieval, UI, auto-dream, and portable files. It is not registered in `SkillRegistry`. The model cannot call `remember_workspace_memory`.
2. **Prompt routing pushes "save" to files.** `BuiltInToolCapabilitiesPromptSection` maps "save/export data to csv/file" to `file_write`. There is no competing row for workspace memory. `ToolLoadPolicyService` promotes `file_write` on save/export phrasing and never promotes a memory tool.
3. **The original "remember this" chat action was not built.** The workspace-memory PRD required a chat UI command equivalent to "Remember this for this workspace". The panel can create memories, but there is no in-chat action and no natural-language tool.

Auto-dream cannot fix this. It runs after the turn, is conservative, and is not an explicit user confirmation. Users who say "remember this now" expect an immediate, attributable write.

A second, independent product mistake would be to dump the supplier CSV into workspace memory once a tool exists. Workspace memory is a small, typed, project-knowledge layer. Contact lists, lead sheets, and bulky tool output belong in files or the knowledge library. The original PRD already forbids storing private scraped lead/customer/contact data.

## 3. Goals

1. Let users ask AI Chat V2 to remember a concise project fact, decision, workflow, convention, reference, or warning for the active approved workspace.
2. Let the assistant list existing workspace memories so it can avoid duplicates and answer "what do you remember for this workspace?"
3. Let the assistant update or archive a known memory by ID after listing it.
4. Add an in-chat UI action "Remember this for this workspace" that writes structured memory without requiring the model to pick a tool.
5. Route "remember … workspace memory / for this workspace" to the memory tools instead of `file_write`.
6. Keep bulk datasets, CSVs, contact lists, transcripts, and secrets out of workspace memory.
7. When the user wants a dataset remembered, save the file with `file_write` and optionally create a short `reference` memory that points at that file.
8. Reuse `AIWorkspaceMemoryService` and, when portable memory is enabled, `PortableWorkspaceMemoryService`.
9. Resolve workspace scope in the main process from `SkillExecutionContext.conversationId`. Never trust a tool argument for `workspaceKey`, `workspaceRoot`, `scopeId`, or a memory file path.
10. Reject secret-like content with the existing `MemorySecretFilter`.
11. Keep auto-dream, retrieval, injection, and the memory panel unchanged except for showing memories created by the new tools. Background learning after tasks or failures is `docs/prd/workspace-memory-auto-remember-prd.md`, not this PRD.
12. Add catalog discovery, load-policy promotion, and a capability-table row so deferred tools are still findable.
13. Translate all new UI strings into English, Chinese, Spanish, French, German, and Japanese.
14. Add unit, policy, and component tests for the new tools and the Remember action.

## 4. Non-Goals

1. Do not replace the Workspace memory panel, retrieval, or auto-dream.
2. Do not implement unattended learning after agent tasks or failures in this PRD. That is `docs/prd/workspace-memory-auto-remember-prd.md`.
3. Do not add a user-memory ("remember this globally") tool in this release. Global user memory stays on its existing panel and auto-dream path.
4. Do not expose portable enablement, identity regeneration, conflict resolution, Git ignore, or instruction-bridge tools.
5. Do not let the model author `.aifetchly/memory/*.md` through `file_write` / `file_edit`.
6. Do not store workspace memory inside arbitrary workspace files as a substitute for the memory table or portable contract.
7. Do not inject every newly created memory into the current turn. Injection remains the existing bounded retrieval on later turns.
8. Do not use vector search as a launch dependency for the list/search tool.
9. Do not allow hard-delete from the AI tool in v1. Archive is the mutating removal path. Hard-delete stays in the panel with confirmation.
10. Do not let workers or child processes write workspace memory.
11. Do not accept renderer-supplied workspace keys, portable workspace IDs, or absolute memory paths.
12. Do not treat knowledge-library import as the workspace-memory write path.
13. Do not automatically commit portable memory files to Git.

## 5. Target Users

### 5.1 Campaign / workspace operator

Works in an approved project folder and wants the assistant to keep project-specific decisions without repeating them in every chat.

Example:

```text
Remember for this workspace that outreach must stay in a direct B2B tone.
```

### 5.2 Developer using file tools and plan mode

Wants the assistant to remember verification commands, architecture constraints, and known traps.

Example:

```text
Remember that main-process tests use yarn testmain in this workspace.
```

### 5.3 Researcher who just collected a dataset

Wants the collected rows available later, but should not pollute workspace memory with a contact dump.

Example:

```text
Please remember those items in workspace memory.
```

Expected outcome: save the CSV as a workspace file if it is not already there, then create a short `reference` memory pointing at the file. Do not copy every row into `ai_workspace_memories`.

## 6. Current Architecture Findings

### 6.1 Workspace memory exists, but only behind IPC and UI

Implemented today:

- `AIWorkspaceMemoryEntity` / Model / Module / Service
- `WorkspaceMemoryContextResolver` (approved workspace + `workspaceKey`)
- `AIWorkspaceMemoryRetrievalService` and prompt injection in `AIChatContextAssembler`
- Renderer API `src/views/api/aiWorkspaceMemory.ts` and `WorkspaceMemoryPanel.vue`
- Auto-dream consolidation
- Portable projection and file store when enabled

Create today goes through `AIWorkspaceMemoryService.createManualMemory()`, which resolves scope from `conversationId` and ignores any renderer-supplied `workspaceKey`.

### 6.2 No SkillRegistry entry

`src/config/skillsRegistry.ts` registers file tools, knowledge-library tools, email tools, schedules, and others. There is no `remember_workspace_memory` or similar name.

`AIUserMemoryService.rememberFromAssistant()` exists for global user memory and is unused. This PRD does not ship that tool.

### 6.3 Tool load policy and capability table cause the observed fallback

Always-loaded tools include `file_read`, `glob_files`, `grep_files`, and `knowledge_library_search`. `file_write` is contextual and is promoted by save/export/create-file phrasing.

`BuiltInToolCapabilitiesPromptSection` currently tells the model:

- Save/export data to csv/xlsx/file → `file_write`
- Import documents → knowledge-library tools
- Nothing about workspace memory

That is why "remember those items" became a file copy.

### 6.4 Original PRD already specified the missing chat path

`docs/prd/workspace-memory-prd.md`:

- FR-004.8: Run manual "remember this for this workspace" from AI Chat V2.
- §17.3: The chat UI should support a command or action equivalent to `Remember this for this workspace: ...`
- Natural-language "remember this" may use AI only when transforming text into structured fields.

Those requirements were not implemented as a tool or as a chat action.

### 6.5 Content rules already exist and must be enforced at the new write boundary

From the original PRD §11, workspace memory must not store:

- Secrets, tokens, cookies, passwords, private keys
- Private scraped lead/customer/contact data
- Full transcripts or bulky tool output
- Raw file contents that can be read from the workspace

Existing limits that the tools must keep:

- Title 1–200 characters
- Content 1–8,000 characters
- Closed type taxonomy: `project`, `decision`, `workflow`, `convention`, `reference`, `warning`
- Retrieval caps: 8 memories / 1,800 tokens per prompt

Portable records add a 16 KiB file cap and the same body limit.

### 6.6 Execution context already has conversation identity

`SkillExecutionContext.conversationId` is the correct scope input. Tool arguments must not include `workspaceKey`, `workspaceRoot`, `scopeId`, `portableWorkspaceId`, or a memory file path.

## 7. Product Principles

### 7.1 Memory is project knowledge, not a dataset store

Workspace memory stores decisions, workflows, conventions, references, and warnings. It does not store tables of contacts, scraped leads, or file contents.

### 7.2 Files and knowledge library remain the right stores for bulky content

| User intent | Correct store |
| --- | --- |
| Concise project fact or decision | Workspace memory |
| Dataset, CSV, spreadsheet, contact list | Workspace file (`file_write`) and/or knowledge library |
| Uploaded document to search later | Knowledge library |
| "Remember that the file exists at X" | Workspace memory type `reference` |

### 7.3 Current user message still wins

A newly saved memory is context for later turns. It cannot override the current user message, system/developer instructions, or tool permissions.

### 7.4 Main process owns workspace identity

The tool layer may receive `conversationId` only from execution context. The resolver decides whether an approved workspace exists.

### 7.5 Portable files are a service contract, not a chat file write

If portable memory is enabled, the remember tool must call `PortableWorkspaceMemoryService` (or the existing create path that already writes the record file, rebuilds `INDEX.md`, and updates the SQLite projection). The model must not invent YAML frontmatter files with `file_write`.

### 7.6 Fail closed on the wrong payload

If the content looks like a contact list, CSV dump, secret, or oversized blob, the tool returns a structured error that tells the model which other tool to use. It does not silently truncate and save.

### 7.7 Naming is "workspace memory"

Users may say "workspace member", "project memory", "remember for this workspace", or "workspace memory". Tool descriptions, intent regexes, and aliases must cover those phrases. Product UI continues to say "Workspace memory".

## 8. Proposed Solution

Add two complementary write paths:

1. **AI tools** for natural-language requests during a chat turn.
2. **In-chat UI action** "Remember this for this workspace" for explicit user confirmation of a selected message or the latest assistant output.

MVP tools:

1. `remember_workspace_memory`
2. `list_workspace_memories`
3. `update_workspace_memory`
4. `archive_workspace_memory`

Not in MVP:

- `delete_workspace_memory` (panel only)
- portable enable / rescan / conflict / bridge / identity tools
- global `remember_user_memory`

Implementation pattern: follow `KnowledgeLibraryAiTools.ts`.

```text
SkillRegistry
  -> WorkspaceMemoryAiTools.ts  (validate args, format results)
  -> AIWorkspaceMemoryService / PortableWorkspaceMemoryService
  -> AIWorkspaceMemoryModule / PortableWorkspaceMemoryModule
  -> Model / Entity / SQLite
```

## 9. User Experience

### 9.1 Remember a concise decision

User, with an approved workspace:

```text
Remember for this workspace that outreach must use a direct B2B tone.
```

Expected behavior:

1. Load policy promotes the memory tools.
2. The model calls `remember_workspace_memory` with type `convention` or `decision`.
3. The app shows the existing mutating-tool confirmation prompt with title and content preview.
4. On approve, the service creates the memory with `sourceKind: "chat_v2"`.
5. If portable memory is enabled for that workspace, the portable service writes the record file and rebuilds the index.
6. The assistant confirms that the memory was saved and is visible in the Workspace memory panel.

Example assistant response:

```text
Saved a workspace memory: "Outreach tone" (convention). It applies only to this workspace.
```

### 9.2 Remember a dataset ("those items")

User:

```text
please remember those item in workspace member
```

Context: a supplier/contact CSV was just produced.

Expected behavior:

1. The model must not call `remember_workspace_memory` with the full CSV body.
2. If the file is not already in the workspace, the model may call `file_write` to save it.
3. The model then calls `remember_workspace_memory` with type `reference` and a short pointer, for example:

```text
title: Wholesale mobile suppliers list
content: The current supplier contact list is saved at wholesale_mobile_suppliers.csv in this workspace. Do not re-scrape unless asked. Do not paste the rows into memory.
```

4. If the model tries to pass the CSV as `content`, the tool rejects it with `PAYLOAD_NOT_MEMORY` and the next-step hint above.

### 9.3 List memories

User:

```text
What do you remember for this workspace?
```

Expected behavior:

1. The model calls `list_workspace_memories`.
2. The tool returns a bounded list of active memories (id, type, title, content preview, updatedAt).
3. The assistant summarizes them. It does not dump secrets or quote memories unless relevant.

### 9.4 Update or archive

User:

```text
We no longer use yarn test. Archive that workflow memory.
```

Expected behavior:

1. The model lists memories, finds the matching `memoryId`, and calls `archive_workspace_memory`.
2. Confirmation is required.
3. Archived memories are not injected on later turns.

### 9.5 No approved workspace

User asks to remember something, but no workspace is approved.

Expected behavior:

1. The tool returns `NO_APPROVED_WORKSPACE`.
2. The assistant asks the user to choose and approve a workspace. It does not write a file as a substitute unless the user asked to save a file.

### 9.6 In-chat Remember action

On an assistant message (and optionally a user message), the UI shows:

```text
Remember this for this workspace
```

Expected behavior:

1. Disabled when no approved workspace exists, with the existing empty-state hint.
2. Opens a compact editor prefilled with a proposed type, title, and content extracted from the message. The user can edit before save.
3. Save calls the same service path as the create tool, with `sourceKind: "manual"` because the user clicked the action. If a small AI extraction is used to propose fields, it runs only after `USER_AI_ENABLED` is true, and the user still confirms the fields.
4. Success refreshes the Workspace memory panel count/badge.

This action is the original PRD §17.3 requirement. It must work even if the model fails to call the tool.

### 9.7 Ambiguous scope

User:

```text
Remember this.
```

No workspace wording, and an approved workspace is active.

v1 behavior:

1. Do not auto-write global user memory.
2. Do not auto-write workspace memory unless the capability table/intent regex matched, or the user used the Remember action.
3. The assistant should ask: save as workspace memory for this project, or keep it only in this conversation?

Rationale: the workspace-memory technical design already recommended that plain "remember this" stay global unless the user chooses scope. This PRD does not ship a global memory tool, so the assistant must ask rather than guess.

## 10. Tool Contracts

All tools:

- `tier: "main"`
- `source: "built-in"`
- Resolve workspace from `context.conversationId`
- Check `USER_AI_ENABLED` first for any path that calls a model. Pure CRUD does not need an AI call, but handlers on the AI Chat surface should still fail closed when AI is disabled if that is the local convention for nearby built-in tools. Recommendation: require AI enabled because these tools are only reachable from AI Chat V2.
- Validate args with Zod. Export `z.infer` types. Never `as`-cast untrusted args.

### 10.1 `remember_workspace_memory`

Purpose: Create one durable workspace memory from a concise structured payload.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "filesystem"` because portable mode may write a workspace file through the portable service. The confirmation preview must show title, type, and content, not a raw path.

Schema:

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": ["project", "decision", "workflow", "convention", "reference", "warning"],
      "description": "Closed workspace-memory taxonomy."
    },
    "title": {
      "type": "string",
      "description": "Short label, 1 to 200 characters."
    },
    "content": {
      "type": "string",
      "description": "Concise durable memory, 1 to 8000 characters. Do not pass CSVs, contact lists, transcripts, secrets, or raw file contents."
    },
    "confidence": {
      "type": "number",
      "description": "Optional 0-100. Defaults to 100 for explicit user requests."
    }
  },
  "required": ["type", "title", "content"]
}
```

Forbidden arguments: `workspaceKey`, `workspaceRoot`, `scopeId`, `memoryId`, `filePath`, `relativePath`, `sourceConversationId` (filled by the service from context).

Success result:

```json
{
  "success": true,
  "memoryId": "wmem-…",
  "type": "convention",
  "title": "Outreach tone",
  "status": "active",
  "storageMode": "private",
  "summary": "Saved workspace memory \"Outreach tone\" for the active workspace."
}
```

`storageMode` is `private`, `portable-local`, or `portable-team` according to the workspace policy already implemented by portable memory. The tool does not let the model choose a path. It may accept an optional `visibility` only if portable memory is enabled and the workspace setting is `ask-each-time`. Default: omit `visibility` and use the workspace default.

Failure result:

```json
{
  "success": false,
  "code": "PAYLOAD_NOT_MEMORY",
  "error": "Workspace memory cannot store contact lists, CSVs, or bulky datasets.",
  "nextStep": "Save the dataset with file_write, then call remember_workspace_memory with type reference and a short pointer to the file."
}
```

Source metadata:

- `sourceKind: "chat_v2"`
- `sourceConversationId: context.conversationId`

### 10.2 `list_workspace_memories`

Purpose: Inspect active memories for the approved workspace.

Permission:

- `requiresConfirmation: false`
- `permissionCategory: "pure"`

Schema:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Optional case-insensitive title/content search."
    },
    "type": {
      "type": "string",
      "enum": ["project", "decision", "workflow", "convention", "reference", "warning"]
    },
    "includeArchived": {
      "type": "boolean",
      "default": false
    },
    "limit": {
      "type": "number",
      "default": 20,
      "description": "Maximum memories to return. Clamp to 50."
    }
  },
  "required": []
}
```

Result items include `memoryId`, `type`, `title`, `content` (full if under a preview cap, otherwise truncated with `truncated: true`), `status`, `confidence`, `updatedAt`. Do not return `workspaceRoot`, absolute paths, source message IDs, or embeddings.

### 10.3 `update_workspace_memory`

Purpose: Edit an existing memory by `memoryId` after listing.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "filesystem"`

Required: `memoryId`. Optional patches: `type`, `title`, `content`, `confidence`. The service must re-run secret and payload filters on any new title/content.

If portable memory is enabled and the record is portable, update through the portable service so the file and projection stay in sync. If the on-disk hash changed, return `CONFLICT` and do not overwrite.

### 10.4 `archive_workspace_memory`

Purpose: Stop injecting a memory without hard-deleting it.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "filesystem"`

Required: `memoryId`. Optional `expected_title` as a safety check when the model inferred the ID from a list result, matching the knowledge-library delete pattern.

Hard-delete remains panel-only.

## 11. Discovery, Load Policy, And Prompt Routing

This is a launch requirement, not polish. Without it the model will keep using `file_write`.

### 11.1 Skill descriptions

The `remember_workspace_memory` description must state:

- Use for concise project knowledge that should apply to later chats in this workspace.
- Phrases: "remember for this workspace", "workspace memory", "project memory", "workspace member" (treat as workspace memory).
- Do not use for CSVs, spreadsheets, contact lists, lead dumps, transcripts, secrets, or copying files into the workspace.
- For datasets: `file_write` or knowledge-library import, then optionally a `reference` memory.
- Do not write `.aifetchly/memory/` files with `file_write`.

### 11.2 Contextual load policy

Add a contextual tool set in `ToolLoadPolicyService`:

```text
remember_workspace_memory
list_workspace_memories
update_workspace_memory
archive_workspace_memory
```

Promote when the current user message (or inherited continuation / plan-execution intent) matches a workspace-memory intent regex. The regex must catch at least:

- `workspace memory` / `project memory`
- `remember` / `save` / `store` / `memorize` near `workspace` / `this workspace` / `this project`
- `workspace member` (observed user phrasing)
- `what do you remember` near `workspace` / `this project`

It must not fire on every "remember this website for the knowledge library" (that path already has `WEBSITE_IMPORT_INTENT_RE`). Knowledge-library intent wins when both "remember" and "knowledge library" are present.

"Export those data to a csv" must continue to promote `file_write`, not the memory tools.

### 11.3 Built-in capability table

Add a row to `BuiltInToolCapabilitiesPromptSection`:

| Capability (user phrasing) | Tools | Search query |
| --- | --- | --- |
| Remember/save a concise project fact, decision, convention, workflow, warning, or file pointer for this workspace ("workspace memory", "project memory", "remember for this workspace"). Not for CSVs, contact lists, or bulk data. | `remember_workspace_memory`, `list_workspace_memories`, `update_workspace_memory`, `archive_workspace_memory` | `workspace memory remember` |

Also tighten the existing file-write row so it does not claim every "remember" phrasing:

- File write remains the path for "save/export/download to a csv/xlsx/file".
- Explicitly: do not use `file_write` as a substitute for workspace memory.

### 11.4 Catalog search

The tools must be discoverable via `tool_catalog_search` with queries such as `workspace memory`, `remember`, `project memory`.

### 11.5 Tool-result rendering

Use the existing generic AiChatV2 tool call/result cards. No custom memory-result card is required for MVP. The Workspace memory panel and badge must refresh after a successful create/update/archive.

If a `ai:workspace-memory:changed` (or portable changed) event already exists, reuse it. Otherwise add a renderer notification from the service after tool success.

## 12. Payload Rejection Policy

The remember and update tools must reject a payload before any database or file write when any of the following is true.

| Code | Condition | Next step in the error |
| --- | --- | --- |
| `NO_APPROVED_WORKSPACE` | Resolver returns no approved workspace | Ask the user to choose a workspace |
| `AI_DISABLED` | `USER_AI_ENABLED` is not `"true"` | Explain that AI features are disabled |
| `SECRET_LIKE` | `MemorySecretFilter` / `looksSecretlike` matches title or content | Do not store. Ask the user to redact |
| `PAYLOAD_TOO_LONG` | Title or content exceeds existing limits | Shorten to a decision/pointer |
| `PAYLOAD_NOT_MEMORY` | Heuristic detects a dataset rather than a memory | `file_write` or knowledge library, then optional `reference` memory |
| `INVALID_TYPE` | Type not in the closed taxonomy | Use one of the six types |
| `MANUAL_MEMORY_DISABLED` | Manual workspace memory setting is off | Tell the user to enable it in settings |
| `CONFLICT` | Portable file hash changed since last projection | Tell the user to resolve the conflict in the panel |
| `NOT_FOUND` | Update/archive target does not exist in this workspace | List memories and retry |
| `TITLE_MISMATCH` | `expected_title` does not match | Relist and confirm |

`PAYLOAD_NOT_MEMORY` heuristics for v1 (deterministic, no extra model call):

1. Content contains 8 or more email addresses, or 8 or more phone-like tokens.
2. Content looks like CSV/TSV: a header row plus 5 or more delimited data rows.
3. Content contains a high density of `name,email` / `phone` / `mobile` / `whatsapp` columns.
4. Content is mostly a fenced code block of tabular data.
5. Content includes a full tool-result dump (for example a JSON array of contact objects with more than 5 items).

These heuristics must have unit tests for both rejection and false-negative avoidance. A short `reference` memory that mentions "CSV" once must still be allowed.

Do not store the rejected body in logs.

## 13. Portable Memory Interaction

When portable memory is disabled (current default for existing workspaces):

- `remember_workspace_memory` creates a SQLite-only private record through `AIWorkspaceMemoryService`.
- No `.aifetchly/memory` file is created.

When portable memory is enabled:

- Create/update/archive go through `PortableWorkspaceMemoryService` so record files, `INDEX.md`, and the SQLite projection stay consistent.
- Tool results may include `storageMode` and a relative path such as `.aifetchly/memory/wmem-….md`. They must not include the absolute workspace root.

The model is forbidden from using `file_write` to create or edit files under `.aifetchly/memory/`. If it tries, `FileToolService` should reject that relative prefix with a clear error: use `remember_workspace_memory`. This is defense in depth for the portable contract (schema, ID, secret filter, index rebuild, watcher loop prevention).

## 14. In-Chat UI Action

### 14.1 Placement

Add a message action on AI Chat V2 assistant messages, and on user messages when the message contains rememberable content. Reuse existing message-action patterns in `AiChatV2.vue` / message components. Do not add a new page.

Label:

```text
Remember this for this workspace
```

Disabled tooltip when no workspace is approved:

```text
Choose a workspace before using workspace memory.
```

### 14.2 Editor

Reuse `WorkspaceMemoryEditorDialog.vue` if it can be opened from a message action. Prefill:

- `type`: default `project`, or a conservative guess if a tiny extractor is used
- `title`: first line or a truncated summary
- `content`: selected text, or the message text clipped to 8,000 characters

If the clipped content would trip `PAYLOAD_NOT_MEMORY`, the dialog must show that error before save and offer "Save as a file pointer instead" (user supplies or confirms a relative path).

### 14.3 Tests

Add or extend component tests in `test/vitest/main/components/` for:

- Action visible on assistant messages
- Action disabled without an approved workspace
- Save calls the workspace memory API with `conversationId`
- Payload-not-memory error shown in the dialog

All new strings go into `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`.

## 15. Functional Requirements

### Tools and registry

- **FR-001:** The system MUST register `remember_workspace_memory`, `list_workspace_memories`, `update_workspace_memory`, and `archive_workspace_memory` as built-in SkillRegistry tools.
- **FR-002:** Tool execution MUST use `SkillExecutionContext.conversationId` and resolve the approved workspace in the main process.
- **FR-003:** Tool arguments MUST NOT include `workspaceKey`, `workspaceRoot`, `scopeId`, `portableWorkspaceId`, or a memory file path.
- **FR-004:** Create/update/archive MUST go through Service → Module → Model. IPC and tool wrappers MUST NOT use TypeORM repositories.
- **FR-005:** List MUST be a pure, auto-running tool. Remember, update, and archive MUST require confirmation.
- **FR-006:** Create from the tool MUST set `sourceKind` to `chat_v2`. Create from the UI action MUST set `sourceKind` to `manual`.

### Routing

- **FR-007:** `ToolLoadPolicyService` MUST promote the memory tools on workspace-memory intent, including "workspace member".
- **FR-008:** `BuiltInToolCapabilitiesPromptSection` MUST include a workspace-memory row and MUST tell the model not to substitute `file_write` for workspace memory.
- **FR-009:** The tools MUST be discoverable through `tool_catalog_search`.
- **FR-010:** Knowledge-library "remember this website" phrasing MUST continue to promote knowledge-library import, not workspace memory.
- **FR-011:** "Export to csv" phrasing MUST continue to promote `file_write`.

### Content safety

- **FR-012:** Remember and update MUST apply `MemorySecretFilter` before write.
- **FR-013:** Remember and update MUST reject dataset/contact-list/transcript payloads with `PAYLOAD_NOT_MEMORY`.
- **FR-014:** Existing title and content length limits MUST be enforced.
- **FR-015:** The closed type taxonomy MUST be enforced.
- **FR-016:** Manual workspace-memory setting off MUST block create/update/archive from both the tool and the UI action.

### Portable and files

- **FR-017:** When portable memory is enabled, remember/update/archive MUST use the portable service write path.
- **FR-018:** `file_write` / `file_edit` MUST refuse writes under `.aifetchly/memory/`.
- **FR-019:** Tool results MUST NOT expose absolute workspace paths.

### UI

- **FR-020:** AI Chat V2 MUST expose "Remember this for this workspace" on assistant messages.
- **FR-021:** The action MUST be disabled without an approved workspace.
- **FR-022:** Successful tool or UI writes MUST refresh the Workspace memory panel/badge.
- **FR-023:** All new user-facing strings MUST be translated into all six supported languages.
- **FR-024:** New or changed Vue UI MUST have component tests.

### Isolation and gating

- **FR-025:** No approved or revoked workspace MUST return `NO_APPROVED_WORKSPACE` and MUST NOT write memory.
- **FR-026:** Memories created in workspace A MUST NOT be listed, updated, archived, or injected in workspace B.
- **FR-027:** Worker processes MUST NOT import workspace-memory models.
- **FR-028:** AI-disabled MUST fail before any optional extraction model call.

## 16. Security And Privacy

1. Memory content is untrusted project context. The existing injection header remains authoritative: memory cannot grant tools, credentials, or policy exceptions.
2. Confirmation prompts for remember/update/archive must show the exact title and content the user is about to persist.
3. Do not log full memory content, emails, or phone numbers.
4. Secret-like values are rejected, not stored in truncated form.
5. Contact-list rejection is a privacy requirement, not only a token-budget requirement.
6. Forged conversation IDs cannot be supplied by the model as a way to write into another conversation's workspace; `conversationId` comes from the executing chat session, not from tool args.
7. Portable relative paths in tool results are informational. They do not grant extra file-tool permissions.

## 17. Error Handling

Structured tool errors:

```ts
{
  success: false;
  code:
    | "NO_APPROVED_WORKSPACE"
    | "AI_DISABLED"
    | "SECRET_LIKE"
    | "PAYLOAD_TOO_LONG"
    | "PAYLOAD_NOT_MEMORY"
    | "INVALID_TYPE"
    | "INVALID_INPUT"
    | "MANUAL_MEMORY_DISABLED"
    | "CONFLICT"
    | "NOT_FOUND"
    | "TITLE_MISMATCH"
    | "PERMISSION_DENIED";
  error: string;
  nextStep?: string;
}
```

The assistant must explain the error in plain language and follow `nextStep` when present.

Permission denied must not write a record.

## 18. Observability

Log:

- Tool name and tool call ID
- Conversation ID
- Memory ID created/updated/archived
- Memory type
- Storage mode
- Error code
- Whether payload rejection fired

Do not log title or content by default.

## 19. Testing Requirements

### 19.1 Unit tests

- Zod schema accept/reject cases
- `PAYLOAD_NOT_MEMORY` heuristics: supplier CSV rejected; short reference mentioning a CSV allowed; 8+ emails rejected; 3 emails in a warning allowed
- Secret-like rejection
- Length and type validation
- Service uses conversation-resolved scope and ignores a planted `workspaceKey` argument
- Portable-enabled create calls the portable service; portable-disabled create does not write files
- `file_write` rejects `.aifetchly/memory/` paths

### 19.2 Load-policy and prompt tests

- "remember for this workspace" promotes memory tools
- "workspace member" promotes memory tools
- "export those data to a csv" promotes `file_write`, not memory tools
- "remember this website in the knowledge library" promotes knowledge-library tools
- Capability section contains the workspace-memory row and the anti-`file_write` substitution line

### 19.3 Permission tests

- List auto-executes
- Remember/update/archive prompt
- Denied remember does not insert a row

### 19.4 Isolation tests

- Two workspaces: list/create in A cannot see or mutate B
- No approved workspace: remember fails with `NO_APPROVED_WORKSPACE`

### 19.5 Component tests

- Remember action visibility and disabled state
- Editor save and payload-not-memory display
- Translation keys present in all six language files

### 19.6 Manual QA prompts

```text
Remember for this workspace that we use yarn testmain for main-process tests.
```

Expect: one `workflow` memory in the panel; later turn can recall it without the file being copied.

```text
please remember those item in workspace member
```

Expect, when the current context is a contact CSV: file saved if needed; `reference` memory only; no row-level memory content.

```text
What do you remember for this workspace?
```

Expect: `list_workspace_memories` is called.

```text
Remember this API key: sk-test-123
```

Expect: `SECRET_LIKE` rejection.

```text
Remember this.
```

Expect: assistant asks workspace vs conversation; no silent global write.

## 20. Phased Delivery

### Phase 1: Remember and list tools

- Add `WorkspaceMemoryAiTools.ts` and Zod schemas
- Register `remember_workspace_memory` and `list_workspace_memories`
- Payload/secret/workspace rejection
- Load policy, capability table, catalog keywords
- Unit and permission tests

Exit: the supplier-list prompt no longer dumps rows into memory; a concise decision prompt creates a panel-visible memory.

### Phase 2: Update, archive, portable, file-prefix guard

- `update_workspace_memory` and `archive_workspace_memory`
- Portable service path when enabled
- `file_write` refusal for `.aifetchly/memory/`
- Conflict error when the portable hash changed

### Phase 3: In-chat Remember action

- Message action, editor reuse, i18n, component tests
- Panel/badge refresh on tool and UI success

### Phase 4: Follow-ups (not required to close the original incident)

- Optional global user-memory tool with an explicit scope picker
- "Why was this memory used?" UI
- Semantic list/search
- Hard-delete tool with a stronger confirmation than archive

## 21. Open Questions

1. Should remember require the filesystem confirmation prompt, or a lighter memory-specific prompt?
   - Recommendation: keep `requiresConfirmation: true` and `permissionCategory: "filesystem"` so users see title and content before persist. The UI action is the low-friction path.

2. Should `visibility` be a tool argument?
   - Recommendation: omit in v1. Use the workspace portable default. Add `visibility` only if the workspace policy is `ask-each-time`.

3. Should plain "remember this" write workspace memory when a workspace is approved?
   - Recommendation: no. Ask the user. Ship the UI action for explicit scope.

4. Should the remember tool be always-loaded?
   - Recommendation: no. Contextual promotion plus the capability table is enough and keeps the default tool list small.

5. Should `PAYLOAD_NOT_MEMORY` be allowed to auto-create a `reference` memory after `file_write` in the same turn?
   - Recommendation: yes, as a model-led two-step (file then reference). The remember tool itself must not write the file.

## 22. Success Metrics

1. Natural-language "remember for this workspace" creates a workspace memory without copying a dataset into SQLite.
2. The observed "workspace member" phrasing promotes the memory tools.
3. Contact/CSV payloads are rejected with a next step that uses `file_write` plus optional `reference`.
4. List returns only the active workspace's memories.
5. No `.aifetchly/memory` files are created through `file_write`.
6. The in-chat Remember action works without a tool call.
7. Existing retrieval, auto-dream, panel CRUD, and portable sync tests still pass.
8. New UI strings exist in all six languages.
9. Component and unit tests for the new tools and action pass in CI.

## 23. Acceptance Checklist

- [ ] `remember_workspace_memory` registered and confirmation-gated
- [ ] `list_workspace_memories` registered as pure
- [ ] `update_workspace_memory` and `archive_workspace_memory` registered and confirmation-gated
- [ ] Tool wrappers call Service/Module only
- [ ] Conversation-scoped workspace resolution; planted `workspaceKey` ignored
- [ ] Secret filter applied
- [ ] `PAYLOAD_NOT_MEMORY` rejects contact/CSV dumps
- [ ] Load-policy regex covers workspace memory / this workspace / workspace member
- [ ] Capability table row present; file-write substitution forbidden
- [ ] `file_write` blocked under `.aifetchly/memory/`
- [ ] Portable-enabled writes go through `PortableWorkspaceMemoryService`
- [ ] In-chat "Remember this for this workspace" action implemented
- [ ] Panel/badge refresh after writes
- [ ] i18n complete
- [ ] Component, unit, policy, isolation, and permission tests pass

## 24. Relationship To Existing PRDs

This document does not replace `docs/prd/workspace-memory-prd.md` or `docs/prd/portable-workspace-memory-prd.md`. It implements the missing chat-facing write surface those PRDs assumed:

- Original FR-004.8 and §17.3 (manual remember from AI Chat V2)
- Original §11 (what must not be stored), now enforced at the tool boundary
- Portable PRD file-authority rules, now protected from generic file tools

Where this PRD and the original first-release non-goals interact: adding AI tools is additive. Storage, isolation, retrieval, and portable authority remain as already specified.
