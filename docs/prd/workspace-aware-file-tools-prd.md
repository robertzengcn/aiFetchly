# Workspace-Aware AI File Tools - Product Requirements Document

## 1. Executive Summary

### 1.1 Overview

AiFetchly should introduce a first-class workspace model for AI file tools. Today, tools such as `glob_files`, `grep_files`, `file_read`, `file_write`, and `file_edit` rely on default workspace roots. In production, those roots include the user's home directory. That makes broad tool calls like `glob_files({ "pattern": "**/*" })` scan the home folder and hit protected macOS locations such as `/Users/cengjianze/.Trash`, producing errors like:

```text
EPERM: operation not permitted, scandir '/Users/cengjianze/.Trash'
```

The product problem is not only the error. The deeper issue is that the AI does not know which project folder it is allowed to inspect or modify. AiFetchly needs an explicit workspace selection and approval flow so file tools operate inside a user-approved project boundary.

### 1.1.1 Companion Documents

- Technical design: `docs/workspace-aware-file-tools-technical-design.md`

### 1.2 Goals

- Make workspace selection explicit before AI file tools run.
- Bind each AI chat conversation to a workspace root.
- Resolve all file tool paths relative to the active workspace.
- Prevent broad scans of the user's home directory.
- Keep the current `FilePathGuard` safety model, but feed it the correct workspace root.
- Preserve existing tool permission cards for mutating tools.
- Add clear UI states when no workspace has been selected.
- Provide tests that prove file tools cannot escape or accidentally scan protected folders.

### 1.3 Non-Goals

- Do not allow unrestricted home directory access.
- Do not replace `FilePathGuard`; improve how roots are selected and passed into it.
- Do not build a full IDE file explorer in this phase.
- Do not let worker processes access filesystem tools directly.
- Do not remove per-tool permission approval for `file_write` and `file_edit`.
- Do not solve all project indexing or semantic search needs in this PRD.

### 1.4 Success Criteria

- A fresh AI chat cannot call file tools until a workspace is selected or explicitly granted.
- `glob_files` with no `cwd` searches only the active workspace root.
- `file_write` with a relative path writes under the active workspace root.
- Absolute paths outside the active workspace are rejected.
- The `.Trash` EPERM scenario cannot happen from default `glob_files` behavior.
- Users can see which workspace a chat is using before approving file mutations.

## 2. Background And Current Behavior

### 2.1 Existing File Tool Stack

The file tools are already implemented as built-in skills and are routed through the existing execution path:

- Tool definitions: `src/config/skillsRegistry.ts`
- Execution dispatch: `src/service/ToolExecutor.ts`
- File operations: `src/service/FileToolService.ts`
- Path safety: `src/service/FilePathGuard.ts`
- Default root config: `src/config/fileToolConfig.ts`

`FilePathGuard` already enforces important safety controls:

- path normalization
- traversal rejection
- symlink realpath checks
- allowed-root checks
- deny-list enforcement

The weakness is root selection. `getDefaultWorkspaceRoots()` currently returns Electron's home path and userData path in production. `FileToolService` uses those roots when constructed without explicit roots. `ToolExecutor` owns a cached singleton `FileToolService`, so file tools share one global default root set.

### 2.2 Failure Mode

When the AI calls:

```json
{
  "pattern": "**/*",
  "head_limit": 50
}
```

`glob_files` defaults to `this.guard.getRoots()[0]`. With current production defaults, that can be the user's home directory. `fast-glob` then traverses home and may attempt protected paths like `.Trash`, causing an EPERM result.

The same root ambiguity also affects `grep_files`, `file_read`, `file_write`, and `file_edit`, although the visible symptom may differ.

### 2.3 Why Ignore Patterns Are Not Enough

Adding `.Trash/**` to ignore patterns would reduce one macOS error, but it would not fix the product problem:

- The AI would still scan private home folders.
- New protected folders would produce new errors.
- Users would not know where file writes are going.
- Permission cards would approve a tool action without a clear workspace boundary.

The correct fix is to make workspace context explicit and mandatory.

## 3. Users And Use Cases

### 3.1 Primary Users

- Users asking the AI assistant to draft campaign files, templates, notes, or project artifacts.
- Users asking the AI assistant to inspect project files before making edits.
- Users who need confidence that AI file tools will not scan private folders.

### 3.2 Developer Users

- Developers maintaining AI chat, tool execution, and filesystem safety code.
- Developers writing tests for file tools.
- Developers debugging permission-card and plan-mode interactions.

### 3.3 Core Use Cases

1. A user opens AI Chat V2 and asks the AI to create files for a campaign.
2. The app sees the model wants `file_write` but no workspace is active.
3. The app asks the user to choose or approve a workspace folder.
4. The user selects `/Users/cengjianze/project/aiFetchly` or another project folder.
5. The conversation records that workspace.
6. Future file tools in that conversation resolve relative paths under that root.
7. Mutating tools still show a permission card with the workspace and target path.

## 4. Product Principles

### 4.1 Workspace Before Filesystem

The AI should never interact with the filesystem as an abstract machine-wide resource. It interacts with a user-approved workspace.

### 4.2 Relative Paths Are The Default

Model-facing tool descriptions should steer the AI toward relative paths such as `docs/campaign.md`, not absolute paths.

### 4.3 Permission Has Two Layers

Workspace approval and tool approval are separate:

- Workspace approval: "This chat may access this project folder."
- Tool approval: "This specific write/edit may run."

### 4.4 The User Must See The Boundary

Before a write happens, the UI should show both the workspace root and the target relative path. Users should not need to infer where a file will land.

### 4.5 No Silent Home Fallback

If a conversation has no workspace, file tools should fail with a structured workspace-required result. They should not fall back to `os.homedir()`, Electron home, or process cwd.

## 5. Scope

### 5.1 Phase 1 Scope

Phase 1 should add explicit workspace context for AI file tools.

Required:

- Workspace context entity or persisted settings keyed by conversation.
- Workspace selection UI in AI Chat V2.
- Workspace badge in the AI Chat V2 header or composer area.
- File tool execution receives conversation-specific workspace roots.
- File tools return `workspaceRequired: true` when no workspace is active.
- Tool schemas and descriptions explain workspace-relative paths.
- `glob_files`, `grep_files`, `file_read`, `file_write`, and `file_edit` all use the active workspace root.
- Tests for no-workspace, in-workspace, and outside-workspace paths.

Deferred:

- Multi-workspace conversations.
- Workspace file tree UI.
- Semantic file indexing.
- Cross-workspace project search.
- Per-directory granular permissions inside one workspace.
- Workspace sharing between users or devices.

### 5.2 Phase 2 Scope

Phase 2 can improve workspace ergonomics:

- Recently used workspaces.
- Default workspace suggestion from current project or previous chat.
- Workspace switch confirmation when a conversation already has file operations.
- Optional read-only workspace mode.
- Workspace-level audit history.

### 5.3 Phase 3 Scope

Phase 3 can add project intelligence:

- Lightweight file manifest cache.
- Workspace indexing status.
- Semantic search backed by existing RAG/vector architecture.
- Workspace-aware prompt context injection.

## 6. Functional Requirements

### FR-001: Workspace Context Model

The app must represent a workspace as structured data.

Required fields:

- `workspaceId`: stable unique identifier.
- `rootPath`: absolute path selected by the user.
- `displayName`: readable name, defaulting to folder basename.
- `createdAt`: creation timestamp.
- `lastUsedAt`: most recent use timestamp.
- `permissionStatus`: `active`, `revoked`, or `missing`.

Conversation binding fields:

- `conversationId`
- `workspaceId`
- `boundAt`
- `boundBy`: `user` or `system`

Implementation may use a new TypeORM entity or an existing settings table only if it preserves queryability and testability.

### FR-002: Workspace Selection UI

AI Chat V2 must provide a workspace selector.

Required behavior:

- Show current workspace when one is active.
- Show "No workspace selected" when absent.
- Let the user choose a folder through an Electron-safe folder picker.
- Let the user clear or switch the workspace.
- Show a confirmation when switching workspace after file operations exist in the conversation.

Required display:

- Workspace display name.
- Full root path in tooltip or secondary text.
- Status if missing or revoked.

### FR-003: Workspace-Required Tool Result

When any file tool runs without an active workspace, it must return a structured result:

```json
{
  "success": false,
  "workspaceRequired": true,
  "error": "Select a workspace before using file tools."
}
```

The renderer should show a workspace selection card, not a generic tool error.

### FR-004: Conversation-Specific FileToolService

`ToolExecutor` must not use a global singleton `FileToolService` for file tools unless that instance is scoped to the active workspace.

Required:

- File tool execution receives `conversationId`.
- `conversationId` resolves to a workspace root before constructing or selecting `FileToolService`.
- The `FilePathGuard` roots are `[activeWorkspace.rootPath]`, not `[home, userData]`.

Acceptable implementation choices:

- Create a new `FileToolWorkspaceResolver` service used by `ToolExecutor`.
- Cache `FileToolService` by workspaceId/rootPath.
- Construct `FileToolService` per execution if performance remains acceptable.

### FR-005: Relative Path Resolution

All relative paths must resolve under the active workspace root.

Examples:

- `docs/campaign.md` resolves to `<workspaceRoot>/docs/campaign.md`.
- `src/views/App.vue` resolves to `<workspaceRoot>/src/views/App.vue`.
- `../outside.txt` is rejected.

### FR-006: Absolute Path Handling

Absolute paths are allowed only when they are inside the active workspace root.

Examples:

- `<workspaceRoot>/docs/file.md` is allowed.
- `/Users/cengjianze/.Trash/foo` is rejected.
- `/etc/passwd` is rejected.

### FR-007: No Home Directory Fallback

Production file tools must never default to the user's home directory when no workspace is active.

`getDefaultWorkspaceRoots()` may remain for tests or legacy service construction, but AI chat file-tool execution must not rely on it as the effective workspace source.

### FR-008: Glob And Grep Error Resilience

`glob_files` and `grep_files` should not fail the whole tool call because an ignored or inaccessible child path exists under the workspace.

Required:

- Maintain default ignore patterns.
- Add protected OS folders to default ignore or deny policy where relevant.
- Use fast-glob options that suppress traversal errors when safe.
- Return structured partial results if a search is truncated or partially skipped.

This is defense-in-depth. The primary protection remains workspace scoping.

### FR-009: Permission Card Context

Permission cards for `file_write` and `file_edit` must show workspace context.

Required display:

- Tool name.
- Workspace name.
- Workspace root path.
- Target relative path.
- Whether the operation creates, overwrites, or edits.

The user should not approve a write without seeing where it will happen.

### FR-010: Tool Prompt Updates

The tool descriptions in `skillsRegistry.ts` must tell the model:

- File paths should normally be relative to the active workspace.
- The tool cannot access files outside the active workspace.
- If workspace is missing, ask the user to select one before retrying.

### FR-011: Workspace Revocation

Users must be able to revoke or clear a workspace from a conversation.

Required behavior:

- Future file tool calls return `workspaceRequired: true`.
- Past file operation records remain visible for audit.
- The app does not delete files when revoking workspace access.

### FR-012: File Operation Audit Compatibility

Existing file operation tracking should remain compatible.

Enhance file operation records to include:

- `workspaceId`
- `workspaceRoot`
- `relativePath`
- `resolvedPath` only in main-process logs or trusted views

The chat summary panel should prefer `relativePath` for readability.

## 7. UX Requirements

### 7.1 Workspace Badge

AI Chat V2 should show a compact workspace badge near the model selector or chat header.

States:

- No workspace selected.
- Active workspace.
- Missing workspace path.
- Workspace access revoked.

Suggested labels:

- `Workspace: aiFetchly`
- `No workspace`
- `Workspace missing`

### 7.2 Workspace Selection Card

When the AI attempts a file tool with no workspace, the chat should show a card with:

- Explanation: "Select a project folder before the AI can read or write files."
- Button: "Choose Workspace"
- Optional secondary action: "Cancel Tool"

This card should be distinct from the write permission card.

### 7.3 Write Permission Card

For mutating tools, the existing permission card should include:

```text
Workspace: aiFetchly
Root: /Users/cengjianze/project/aiFetchly
Operation: Create file
Path: docs/campaign.md
```

### 7.4 Error Messages

Error messages should be specific:

- No workspace: "Select a workspace before using file tools."
- Outside workspace: "This path is outside the active workspace."
- Deny-listed path: "Access denied by security policy: <reason>."
- Missing workspace folder: "The selected workspace folder no longer exists."

### 7.5 Internationalization

All new user-facing strings must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

## 8. Technical Requirements

### 8.1 Main Process Ownership

Workspace resolution and file execution must happen in the Electron main process.

Renderer responsibilities:

- Request workspace selection.
- Display workspace state.
- Send user actions through IPC.

Main process responsibilities:

- Persist workspace bindings.
- Validate root paths.
- Resolve workspace for tool execution.
- Run file tools.

### 8.2 Database Architecture

Follow the existing three-layer architecture:

- Entity: TypeORM workspace entities.
- Model: database access.
- Module: business logic.
- IPC: communication only.

IPC handlers must not directly access TypeORM repositories.

Suggested files:

- `src/entity/AIWorkspace.entity.ts`
- `src/entity/AIConversationWorkspace.entity.ts`
- `src/model/AIWorkspace.model.ts`
- `src/model/AIConversationWorkspace.model.ts`
- `src/modules/AIWorkspaceModule.ts`
- `src/main-process/communication/ai-workspace-ipc.ts`

### 8.3 Workspace Resolver Service

Add a service responsible for resolving workspace context for tool execution.

Suggested file:

- `src/service/FileToolWorkspaceResolver.ts`

Responsibilities:

- Accept `conversationId`.
- Return active workspace root.
- Detect missing or revoked workspace.
- Normalize and validate root existence.
- Produce structured errors for tool results.

### 8.4 ToolExecutor Integration

`ToolExecutor.executeFileTool()` should resolve workspace before calling `FileToolService`.

Current behavior:

- Uses cached global `new FileToolService()`.

Target behavior:

- Resolve workspace by `conversationId`.
- Construct or fetch `FileToolService([workspaceRoot])`.
- Execute tool with workspace-scoped guard.

### 8.5 FileToolService Changes

`FileToolService` should support strict workspace mode.

Required:

- Constructed with exactly one active workspace root for AI chat use.
- Return workspace metadata in tool results.
- Avoid `process.cwd()` fallback for AI chat execution.

Possible constructor:

```ts
new FileToolService({
  roots: [workspaceRoot],
  requireWorkspace: true,
  workspaceId,
});
```

### 8.6 FilePathGuard Changes

`FilePathGuard` can remain the core guard, but it should expose enough metadata for UI and audit.

Useful additions:

- matching root path
- relative path from matching root
- denial code enum

Suggested result extension:

```ts
{
  safe: true,
  resolvedPath,
  rootPath,
  relativePath
}
```

### 8.7 IPC Channels

Suggested channels:

- `AI_WORKSPACE_LIST`
- `AI_WORKSPACE_SELECT_FOLDER`
- `AI_WORKSPACE_BIND_CONVERSATION`
- `AI_WORKSPACE_GET_CONVERSATION`
- `AI_WORKSPACE_CLEAR_CONVERSATION`

All IPC handlers must check AI enable status before work if they serve AI-chat workflow.

### 8.8 Security Requirements

Security controls:

- No home fallback for AI file tools.
- Root path must exist and be a directory.
- Symlink roots must resolve to their real path before storage or use.
- Path validation must happen before every filesystem operation.
- Deny-list remains active inside workspace.
- Workspace selection must be initiated by user action, not by model output alone.

Prompt injection consideration:

- A file inside the workspace cannot grant a broader workspace.
- Tool results and file contents cannot instruct the app to bypass workspace approval.
- Model requests for absolute paths outside workspace must fail.

## 9. Data Model

### 9.1 AIWorkspace

| Field | Type | Required | Notes |
|---|---|---|---|
| id | number | yes | TypeORM primary key |
| workspaceId | string | yes | UUID |
| rootPath | text | yes | Real absolute path |
| displayName | varchar | yes | Folder basename by default |
| permissionStatus | varchar | yes | `active`, `revoked`, `missing` |
| createdAt | datetime | yes | Auditable entity |
| updatedAt | datetime | yes | Auditable entity |
| lastUsedAt | datetime | no | Updated on use |

### 9.2 AIConversationWorkspace

| Field | Type | Required | Notes |
|---|---|---|---|
| id | number | yes | TypeORM primary key |
| conversationId | string | yes | AI Chat V2 conversation |
| workspaceId | string | yes | Linked workspace |
| boundAt | datetime | yes | When selected |
| boundBy | varchar | yes | `user` or `system` |
| active | boolean | yes | Current binding flag |

Constraint:

- One active workspace binding per conversation in Phase 1.

## 10. Tool Result Contracts

### 10.1 Workspace Required

```json
{
  "success": false,
  "workspaceRequired": true,
  "error": "Select a workspace before using file tools.",
  "toolName": "glob_files"
}
```

### 10.2 Successful File Write

```json
{
  "success": true,
  "path": "docs/campaign.md",
  "relativePath": "docs/campaign.md",
  "workspaceId": "workspace-123",
  "workspaceName": "aiFetchly",
  "bytesWritten": 1200,
  "mode": "created"
}
```

### 10.3 Outside Workspace

```json
{
  "success": false,
  "error": "Path is outside the active workspace.",
  "path": "/Users/cengjianze/.Trash/file.txt",
  "workspaceId": "workspace-123"
}
```

## 11. Acceptance Criteria

### AC-001: No Workspace Blocks File Tools

Given a conversation has no workspace, when the AI calls `glob_files`, then the tool returns `workspaceRequired: true` and no filesystem traversal occurs.

### AC-002: Default Glob Uses Workspace Root

Given a conversation is bound to `/Users/cengjianze/project/aiFetchly`, when the AI calls `glob_files` with `pattern: "**/*"` and no `cwd`, then the search runs under `/Users/cengjianze/project/aiFetchly` only.

### AC-003: `.Trash` Is Never Scanned By Default

Given the user's home contains `.Trash`, when AI chat file tools run in a project workspace, then no tool attempts to scan `/Users/cengjianze/.Trash`.

### AC-004: Relative Write Lands In Workspace

Given workspace `/tmp/project`, when `file_write` writes `docs/a.md`, then the file appears at `/tmp/project/docs/a.md`.

### AC-005: Absolute Outside Path Is Rejected

Given workspace `/tmp/project`, when `file_write` targets `/tmp/other/a.md`, then the tool returns an outside-workspace error and writes nothing.

### AC-006: Permission Card Shows Workspace

Given the AI calls `file_write`, when the permission card is shown, then it displays workspace name, workspace root, operation, and target relative path.

### AC-007: Workspace Switch Is Explicit

Given a conversation already has file operations, when the user selects a different workspace, then the UI asks for confirmation before switching.

### AC-008: Revoked Workspace Blocks Future Tools

Given a workspace is revoked, when the AI calls a file tool in that conversation, then the tool returns `workspaceRequired: true`.

## 12. Testing Requirements

### 12.1 Unit Tests

Add or update tests for:

- `FileToolWorkspaceResolver`
- `AIWorkspaceModule`
- `FilePathGuard` extended result metadata
- `FileToolService` strict workspace mode
- `ToolExecutor` conversation-scoped file service resolution

Required cases:

- no workspace selected
- workspace root missing
- workspace root is not a directory
- relative path inside workspace
- traversal outside workspace
- absolute path inside workspace
- absolute path outside workspace
- symlink escape inside workspace
- deny-list remains active inside workspace

### 12.2 Integration Tests

Add tests under `test/vitest/main/` for:

- AI tool call to `glob_files` with active workspace.
- AI tool call to `file_write` with active workspace.
- AI tool call to `file_write` without active workspace.
- file operation tracking includes workspace metadata.

### 12.3 Renderer Tests Or Manual QA

Manual QA should cover:

- workspace badge appears.
- choose workspace flow works.
- missing workspace card appears when tool needs workspace.
- permission card includes workspace fields.
- switching workspace updates future tool behavior.

### 12.4 Regression Tests

Add a regression test for the `.Trash` symptom:

- Create a fake home-like directory with an inaccessible child folder if feasible.
- Verify `glob_files` does not use that home root when a workspace is active.
- Verify no-workspace execution stops before scanning.

## 13. Migration Plan

### Step 1: Introduce Workspace Persistence

Add workspace entities, models, module methods, and IPC channels.

### Step 2: Add Workspace UI

Add selector and badge to AI Chat V2.

### Step 3: Gate File Tools Without Workspace

Change `ToolExecutor` file-tool path to require workspace context. Return `workspaceRequired` instead of using global defaults.

### Step 4: Scope FileToolService

Construct `FileToolService` with active workspace root. Remove global singleton usage for conversation-based file tools or cache by workspace.

### Step 5: Update Tool Descriptions And Permission Cards

Update `skillsRegistry.ts` descriptions and renderer permission metadata.

### Step 6: Harden Glob/Grep

Add protected OS paths to ignore/deny behavior and configure glob traversal to avoid fatal protected-folder errors inside the workspace.

### Step 7: Backfill Tests

Add unit and integration tests for all acceptance criteria.

## 14. Rollout Plan

### 14.1 Feature Flag

Gate workspace-required behavior behind a feature flag for internal builds if needed:

- `USER_AI_WORKSPACE_REQUIRED`

Recommended default:

- enabled for development and new installs
- optional compatibility toggle only during migration

### 14.2 User-Facing Rollout

1. Ship workspace selector.
2. Keep existing file tools available, but require workspace.
3. Show clear guidance the first time a file tool needs workspace.
4. Monitor tool errors for `workspaceRequired`, outside-workspace, and deny-list counts.

### 14.3 Backward Compatibility

Existing conversations without workspace should not break chat. They should only block file tools until the user selects a workspace.

Existing file operation records remain readable.

## 15. Risks And Mitigations

### Risk: Users Are Annoyed By Workspace Selection

Mitigation:

- Remember recent workspaces.
- Bind workspace per conversation.
- Show a compact, low-friction selection card only when needed.

### Risk: AI Keeps Asking For Absolute Paths

Mitigation:

- Update tool descriptions.
- Add system prompt guidance for workspace-relative file tools.
- Return clear outside-workspace errors.

### Risk: Existing Tests Depend On Home Defaults

Mitigation:

- Keep explicit test-only constructors with temp roots.
- Update AI chat integration tests to provide workspace context.
- Avoid changing `FilePathGuard` behavior unnecessarily.

### Risk: Permission UX Becomes Confusing

Mitigation:

- Separate workspace selection from write approval.
- Show workspace context in permission cards.
- Use consistent labels and status badges.

### Risk: Workspace Root Is Deleted Or Moved

Mitigation:

- Check root existence before tool execution.
- Mark workspace as `missing`.
- Prompt user to select a replacement.

## 16. Open Questions

1. Should workspace approval be per conversation only, or can users set a default workspace for all new chats?
2. Should read-only tools require explicit workspace approval, or can the workspace selector itself imply read access?
3. Should `userData` remain an allowed root for any AI file tools, or only for internal app operations?
4. Should the app allow multiple workspace roots in one conversation in Phase 2?
5. Should file operation history store full resolved paths, or only workspace-relative paths plus workspaceId?

## 17. Recommended Implementation Sequence

Recommended order:

1. Workspace data model and module.
2. Workspace IPC and renderer API.
3. Workspace badge and selector in AI Chat V2.
4. ToolExecutor workspace resolver.
5. FileToolService strict workspace mode.
6. Permission-card workspace metadata.
7. Tool prompt/schema updates.
8. Tests and `.Trash` regression.

This order keeps the product boundary visible before changing file execution behavior.

## 18. Definition Of Done

- Workspace can be selected and shown in AI Chat V2.
- File tools require active workspace in AI chat.
- File tools execute only inside the active workspace.
- Mutating permission cards show workspace and relative path.
- `.Trash` EPERM reproduction no longer occurs from default file search.
- All new UI strings are translated across supported languages.
- Unit and integration tests cover the acceptance criteria.
- Existing file tool behavior remains available in tests through explicit roots.
