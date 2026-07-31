# AI Chat @ Mention Context - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-27
- **Owner**: AiFetchly Desktop Engineering
- **Related docs**:
  - `docs/openai-compatible-chat-v2-prd.md`
  - `docs/openai-compatible-chat-v2-technical-design.md`
  - `docs/workspace-aware-file-tools-prd.md`
  - `docs/workspace-aware-file-tools-technical-design.md`
  - `docs/prd/plugin-workspace-slash-commands-prd.md`
  - `docs/prd/plugin-workspace-slash-commands-technical-design.md`
  - `docs/ai-chat-v2-attachment-upload-prd.md`
  - `docs/ai-chat-v2-attachment-upload-technical-design.md`
  - `/home/robertzeng/project/github/claude-code/docs/at-mention-handling.md`
  - `src/views/components/aiChatV2/AiChatV2.vue`
  - `src/views/components/aiChatV2/AiChatV2Composer.vue`
  - `src/entityTypes/aiChatV2Types.ts`
  - `src/service/WorkspaceResolver.ts`
  - `src/service/FileToolService.ts`
  - `src/service/FilePathGuard.ts`
  - `src/service/ToolExecutor.ts`

## 1. Executive Summary

AiFetchly should add Claude-Code-style `@` mentions to AiChatV2 so users can reference files and directories from the active workspace directly in the chat composer.

The first release should support **workspace-scoped file context mentions**:

- `@src/service/FileToolService.ts`
- `@src/service/`
- `@./docs/prd/example.md`
- `@"path with spaces/file.md"`
- `@src/service/FileToolService.ts#L10`
- `@src/service/FileToolService.ts#L10-80`

This feature should not copy Claude Code's entire mention system immediately. Claude's `@` model covers file paths, team member or agent mentions, and IDE-originated references. AiFetchly should ship file and directory references first because those fit the existing Chat V2, workspace approval, and file-tool architecture.

The key product behavior is:

1. The user types `@` in the chat composer.
2. AiFetchly shows autocomplete suggestions from the conversation's approved workspace.
3. The user selects a file or directory.
4. The selected mention remains visible in the message text.
5. On send, the main process re-parses and validates the final message.
6. The model receives a compact, structured context block telling it which workspace files were mentioned and how to read them with existing safe tools.
7. Small explicit references, especially line ranges, may include file content immediately when within configured limits.

The renderer must never read workspace files directly. All suggestion and resolution work must go through main-process IPC, `WorkspaceResolver`, `FilePathGuard`, and the existing file-tool safety model.

## 2. Background

### 2.1 Current AiFetchly Chat Capabilities

AiFetchly already has the right foundation for this feature:

- AiChatV2 has a dedicated composer component.
- The composer already supports slash-command suggestions with debounced IPC calls.
- Chat V2 streams messages through `AI_CHAT_V2_STREAM`.
- Conversations can be bound to an approved workspace.
- `WorkspaceResolver` fails closed when a conversation has no approved workspace.
- `FileToolService` supports `file_read`, `glob_files`, and `grep_files`.
- `FilePathGuard` validates paths against allowed workspace roots.
- Uploaded document attachments are staged in the main process and represented as structured metadata.

The missing piece is a fast way for a user to point the assistant at files that already exist in the active workspace.

### 2.2 Reference Behavior From Claude Code

Claude Code uses `@` for three broad classes of input:

1. File path references, including line ranges and quoted paths.
2. Team member or named-agent direct mentions.
3. IDE-injected references from external integrations.

For file references, Claude separates the interaction into two stages:

- Composer typeahead finds and inserts the textual reference.
- Submission processing extracts, validates, and turns the reference into an attachment or context entry.

AiFetchly should follow this split. Autocomplete helps the user compose the message, but the main process owns final validation and context assembly.

### 2.3 Current Gap

Today users must either:

- upload a local file through the attachment picker, even when the file already lives in the workspace, or
- describe a path manually and hope the assistant chooses the right file tool call.

Both paths are weaker than `@` mentions:

- Uploading duplicates file bytes and breaks the natural workspace context.
- Plain text paths are ambiguous and not discoverable.
- The assistant may read the wrong file or skip the file entirely.
- Users have no autocomplete feedback that the path exists.
- Directory references are awkward.
- Line range references require manual instruction.

## 3. Problem Statement

Users need a direct, discoverable way to reference workspace files and directories in AiChatV2 messages.

Without `@` mentions:

- Users spend extra time describing file paths.
- The assistant needs more turns to find the right context.
- Uploaded attachments and workspace files behave like separate concepts.
- The model may over-search the workspace when the user already knows the relevant file.
- Multi-file tasks such as "compare @a.ts and @b.ts" are clumsy.
- Line-specific questions such as "explain @src/foo.ts#L20-40" require fragile prompt wording.

The feature should make workspace files feel like first-class chat context while preserving AiFetchly's desktop security boundaries.

## 4. Goals

1. Let users type `@` anywhere in the AiChatV2 composer and see workspace file suggestions.
2. Support file, directory, quoted path, relative path, and line range mention syntax.
3. Scope suggestions and resolution to the conversation's approved workspace.
4. Fail closed when no approved workspace exists.
5. Re-parse and re-validate mentions in the main process on send.
6. Prevent renderer-side filesystem access.
7. Reuse `WorkspaceResolver`, `FilePathGuard`, `FileToolService`, and existing file tools.
8. Add compact context instructions to the model so it can use `file_read`, `glob_files`, and `grep_files` correctly.
9. Include small explicit line ranges immediately when within configured size limits.
10. Represent mentioned context in message metadata so the UI can show what was attached by reference.
11. Keep the UI compact and consistent with existing slash suggestions and attachment chips.
12. Add tests for parsing, suggestion scoping, path safety, context assembly, and renderer boundary enforcement.
13. Update all user-facing UI strings in English, Chinese, Spanish, French, German, and Japanese.

## 5. Non-Goals

The first release will not include:

- Agent or teammate mentions such as `@researcher`.
- MCP resource mentions such as `@server:resource`.
- IDE-originated references from VS Code, JetBrains, or browser extensions.
- Automatically importing references from external editor selections.
- Semantic ranking based on embeddings.
- Full workspace file tree browsing.
- Dragging files from the OS into the composer as `@` references.
- Mentions outside the approved workspace.
- Home-directory expansion that escapes the workspace.
- Persistent file indexing service.
- Automatic file writes or edits triggered by selecting a mention.
- Replacing the existing attachment upload flow.
- Renderer filesystem APIs.
- Worker process filesystem or database access.

## 6. Target Users

### 6.1 Marketing Operator

Uses AiFetchly to build campaigns and wants to ask questions like:

```text
Use @docs/campaign-brief.md and improve this email sequence.
```

The operator should not need to understand file tools.

### 6.2 Developer Or Power User

Uses Chat V2 to inspect and modify workspace code:

```text
Compare @src/service/FileToolService.ts with @src/service/ToolExecutor.ts.
```

The user expects exact path references, line ranges, and predictable file reads.

### 6.3 Workspace User

Works across multiple approved workspaces. A mention suggestion in Workspace A must never expose paths from Workspace B.

### 6.4 Security-Conscious User

Wants assurance that mentioning `@` cannot scan private folders, leak filenames outside the workspace, or bypass tool permissions.

## 7. Product Principles

### 7.1 Workspace First

`@` mentions are workspace references, not machine-wide path references. No approved workspace means no file suggestions and no file context resolution.

### 7.2 Renderer Is A View, Not A Filesystem Client

The renderer may display suggestions returned by IPC. It must not call `fs`, `path`, `fast-glob`, or any local file API directly.

### 7.3 Text Is Not Trust

The typed message is user-controlled text. Even if autocomplete inserted a valid path, the main process must parse and validate the final submitted content again.

### 7.4 Mentioning Is Not Approval For Mutation

Referencing `@src/foo.ts` grants read context only. It must not approve file edits, shell commands, dependency installs, browser automation, or any other mutating tool.

### 7.5 Compact Context Beats Prompt Bloat

Most mentions should become compact references plus instructions for tool use. Full file content should be injected only for small, explicit, bounded references.

### 7.6 UI Should Stay Operational

The feature belongs in a productivity chat panel. Suggestions should be dense, keyboard-friendly, and predictable. Avoid large explanatory panels or decorative UI.

## 8. Scope

### 8.1 Phase 1 Scope

Phase 1 delivers file and directory `@` mentions in AiChatV2.

Required:

- Composer detection for `@` mention queries.
- Main-process IPC for suggestions.
- Main-process mention extraction and parsing on send.
- Workspace-scoped path validation.
- File and directory suggestion list.
- Keyboard navigation and mouse selection.
- Quoted paths for spaces.
- Line range parsing.
- Message metadata for resolved mentions.
- Context block injection in the Chat V2 request path.
- UI chips or inline visual treatment for selected/resolved mentions.
- i18n coverage for new visible copy.
- Unit and integration tests.

Deferred:

- Multi-root workspace mentions.
- Semantic ranking.
- File content preview in autocomplete.
- Agent mentions.
- MCP resource mentions.
- IDE integration.

### 8.2 Phase 2 Scope

Phase 2 improves ranking and ergonomics:

- Recency-aware suggestions using recently opened or modified files.
- Better fuzzy matching across basename and path segments.
- Directory expansion preview counts.
- Mention chips that survive editing more gracefully.
- Paste handling for absolute paths that map inside the workspace.
- Optional immediate context preview before send.

### 8.3 Phase 3 Scope

Phase 3 can add new mention kinds:

- `@agent-name` direct routing if AiFetchly product direction requires multi-agent chat.
- `@document:` references for knowledge-library documents.
- MCP resource references only after a clear trust model exists.
- IDE-originated references from editor integrations.

## 9. User Experience Requirements

### 9.1 Trigger Behavior

The composer must open mention suggestions when the text before the cursor matches a supported `@` query.

Examples that should trigger:

```text
@
@src
look at @src/service
compare @src/foo.ts with @docs/
@"path with
```

Examples that should not trigger:

```text
email@example.com
hello@company.com
@@
`@literal`
```

The implementation may start with a pragmatic parser and improve over time, but it must not trigger on common email addresses.

### 9.2 Suggestion Presentation

Suggestions should appear above the composer, matching the existing slash-command suggestion placement and keyboard behavior.

Each suggestion row should show:

- file or directory icon
- relative path from workspace root
- type badge or subtle suffix, such as `file` or `dir`
- optional small metadata, such as file size for files

The dropdown should:

- cap visible results
- support Arrow Up and Arrow Down
- support Enter or Tab to select
- support Escape to close
- support mouse hover and click
- avoid layout shift in the composer

### 9.3 Selection Behavior

Selecting a suggestion inserts or replaces the active `@` query.

Rules:

- Paths with spaces must be inserted as quoted mentions.
- Directory paths should end with `/`.
- Existing text around the mention must be preserved.
- Cursor should move to after the inserted mention.
- Selecting a mention must not send the message.

### 9.4 No Workspace State

If the user types `@` in a conversation without an approved workspace:

- The dropdown should show a compact "Choose a workspace to mention files" state.
- The state may include an action to open the existing workspace approval card.
- The app must not list files from default roots, home directory, process cwd, or any previous conversation.

### 9.5 Mention Display After Send

When the user sends a message with resolved mentions:

- The message should render the original text.
- Mentioned files should be shown in metadata as compact context chips or an attachment-like row.
- Failed mentions should be visible as warnings if they affected the request.

Examples:

- `src/service/FileToolService.ts`
- `docs/prd/`
- `src/main.ts L10-40`

### 9.6 Error Messages

User-facing errors must be short and actionable.

Examples:

- "Choose a workspace before mentioning files."
- "File not found in this workspace: src/missing.ts"
- "Mention is outside the approved workspace."
- "Line range must start before it ends."
- "Too many mentions. Remove some files and try again."

All new user-facing strings must be translated in:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

## 10. Mention Syntax

### 10.1 Supported Syntax

| Syntax | Example | Meaning |
|---|---|---|
| Basic file | `@src/main.ts` | Reference one file |
| Directory | `@src/service/` | Reference a directory listing or search scope |
| Relative current-style path | `@./src/main.ts` | Reference path relative to workspace root |
| Quoted path | `@"docs/path with spaces.md"` | Reference a path containing spaces |
| Single line | `@src/main.ts#L10` | Reference line 10 |
| Line range | `@src/main.ts#L10-40` | Reference lines 10 through 40 |

### 10.2 Unsupported In Phase 1

Unsupported syntax should remain plain text or produce a clear validation warning only when it looks like a file mention.

| Syntax | Example | Phase 1 behavior |
|---|---|---|
| Agent mention | `@researcher` | Treat as file query or no match |
| MCP resource | `@server:resource` | Not resolved |
| Home path | `@~/notes.md` | Reject unless future design maps inside workspace |
| Parent escape | `@../secrets.txt` | Reject |
| Absolute outside workspace | `@/etc/hosts` | Reject |
| Markdown heading | `@docs/readme.md#Heading` | Ignore heading fragment in Phase 1 |

### 10.3 Parser Rules

The parser should:

- detect mentions preceded by start-of-input or whitespace
- support Unicode path characters where the filesystem supports them
- support `.` `/` `\` `_` `-` `()` `[]` `~` and `:` in raw query text, while still validating the resolved path later
- support quoted paths with spaces
- extract line range fragments after `#L`
- deduplicate identical mentions
- preserve the original display text
- return structured parse errors for invalid line ranges

Suggested initial detection pattern can be adapted from Claude Code's approach, but AiFetchly should keep the final parser in a reusable TypeScript module with tests.

## 11. Functional Requirements

### FR-001: Mention Suggestion IPC

The app must expose a main-process IPC handler for mention suggestions.

Input:

- `conversationId`
- `query`
- optional `limit`

Output:

- `status`
- `msg`
- `data.suggestions`

Each suggestion must contain renderer-safe data only:

- `id`
- `displayText`
- `insertText`
- `relativePath`
- `kind`: `file` or `directory`
- optional `sizeBytes`
- optional `modifiedAt`

The response must not include file content, absolute paths outside explicit workspace display needs, raw errors with stack traces, or hidden system metadata.

### FR-002: Workspace-Scoped Suggestions

The suggestion handler must resolve the active workspace with `WorkspaceResolver`.

Rules:

- No `conversationId`: return a workspace-required result.
- No active workspace: return a workspace-required result.
- Workspace not approved: return a workspace-required result.
- Approved workspace: search only inside that workspace root.

### FR-003: Suggestion Search

The suggestion search must:

- search by relative path and basename
- ignore `.git`, `node_modules`, build outputs, dependency caches, and configured deny patterns
- not follow symlinked directories that escape the workspace
- cap traversal work
- cap returned suggestions
- return quickly enough for typing

MVP performance target:

- p95 under 200 ms for a typical project under 20,000 files
- hard timeout or capped traversal for larger workspaces

### FR-004: Composer Integration

`AiChatV2Composer.vue` must support `@` suggestions alongside existing slash suggestions.

Rules:

- Slash suggestions keep priority when the draft begins with `/`.
- `@` suggestions work anywhere in the draft.
- Only one suggestion dropdown is open at a time.
- Keyboard behavior is consistent with slash suggestions.
- Switching conversations while suggestions are pending must not flash stale suggestions from the previous workspace.

The existing slash suggestion generation token pattern should be reused for stale result protection.

### FR-005: Send Contract

`ChatV2StreamRequest` must be extended with structured mention references, or the main process must derive mentions from `request.message`.

Recommended contract:

```typescript
export interface ChatV2AtMentionReference {
  rawText: string;
  displayText: string;
  relativePath: string;
  kind?: "file" | "directory";
  lineStart?: number;
  lineEnd?: number;
}
```

The renderer may send selected mention hints for better UI continuity, but the main process must not trust them. The main process must always parse and validate the final message.

### FR-006: Submission Processing

On `AI_CHAT_V2_STREAM`, before saving and assembling the user message, the main process must:

1. Parse `@` mentions from the submitted message.
2. Resolve the conversation workspace.
3. Validate each mentioned path against the workspace root.
4. Stat each resolved path.
5. Classify it as file, directory, missing, unsupported, or rejected.
6. Build mention metadata for persistence.
7. Build a model-facing context block.
8. Save the user message with mention metadata.

### FR-007: Context Block Assembly

The model-facing message should include a compact block after the user's original message.

Example:

```text
Mentioned workspace context:
1. file: src/service/FileToolService.ts
   Use file_read with path="src/service/FileToolService.ts" for exact contents.
2. directory: docs/prd/
   Use glob_files with cwd="docs/prd" to list files or grep_files to search within it.
```

For explicit small line ranges:

```text
Mentioned workspace context:
1. file: src/service/FileToolService.ts#L10-30
   Content:
   10: ...
   11: ...
```

The context block should be hidden from the user's rendered original text if possible, or visually separated as metadata so the chat does not look like the user typed internal instructions.

### FR-008: Content Injection Limits

AiFetchly may inject file content immediately only when safe and bounded.

Default MVP rules:

- inject explicit line ranges up to 200 lines or configured byte limit
- inject full file content only for small text files under a conservative byte limit
- do not inject binary files
- do not inject very large files
- truncate at line boundaries
- tell the model when content is truncated

All other files should be represented as references and loaded by `file_read` if needed.

### FR-009: Directory Mentions

Directory mentions should not inject full recursive listings.

MVP behavior:

- include a shallow listing capped by count
- include total known listed count when available
- instruct the model to use `glob_files` or `grep_files` for deeper inspection
- never recursively walk huge directories inside the send path

### FR-010: Message Metadata

`ChatV2MessageMetadata` should include mention context metadata.

Recommended shape:

```typescript
export interface ChatV2MentionMetadata {
  rawText: string;
  relativePath: string;
  kind: "file" | "directory";
  lineStart?: number;
  lineEnd?: number;
  status: "resolved" | "missing" | "rejected" | "too_large" | "binary";
  sizeBytes?: number;
  truncated?: boolean;
  error?: string;
}
```

This metadata supports:

- rendering context chips
- debugging failed mentions
- preserving chat history meaning
- future resend or retry behavior

### FR-011: Permission Model

Mention resolution is read-only context preparation.

Rules:

- It requires an approved workspace.
- It must not grant mutating permissions.
- It must not bypass file tool approval modes for write/edit/shell tools.
- It may use existing pure read permissions where the current policy already allows read tools.
- If read confirmation is currently required for `file_read`, the product must decide whether mention content injection is covered by workspace approval or requires a read prompt. MVP recommendation: only inject small explicit content after workspace approval and treat it as part of user-selected context, while keeping write/edit confirmations unchanged.

### FR-012: Tool Awareness

When mentions are present, the assistant should be told how to load exact contents with existing tools.

The system or user-context block should prefer:

- `file_read` for exact files and line ranges
- `glob_files` for directory listings
- `grep_files` for searching within mentioned directories

The model should not be told to use absolute paths unless the existing file-tool descriptions require them. Prefer workspace-relative paths.

### FR-013: Attachment Interaction

`@` mentions and uploaded files may be used in the same message.

Rules:

- Uploaded files continue using the existing `uploadedFiles` flow.
- Mentioned workspace files use mention metadata, not `contentBase64`.
- Both sources should appear in user message metadata.
- The assistant context block should distinguish uploaded attachments from workspace mentions.

### FR-014: Slash Command Interaction

Slash commands and `@` mentions must compose cleanly.

Examples:

```text
/review @src/service/FileToolService.ts
/summarize @docs/prd/
```

Rules:

- Slash command expansion should preserve mention text.
- Mention processing should happen after slash command expansion if the slash command returns a prompt to submit.
- Mention suggestions should still work while typing slash command arguments.

### FR-015: Conversation Switching Safety

Pending suggestion responses must be scoped to the active conversation generation.

If the user changes conversation while an IPC suggestion call is in flight:

- stale results must be dropped
- stale suggestions must not render
- the new conversation's workspace must be used for subsequent suggestions

### FR-016: Limits

MVP limits should be configurable constants.

Suggested defaults:

- maximum mentions per message: 10
- maximum suggestion results: 50
- maximum directory shallow listing entries in context: 30
- maximum injected line range lines: 200
- maximum injected content bytes per mention: use or stay below existing `FILE_TOOL_SIZE_LIMITS.maxReadBytes`
- maximum total injected mention bytes per message: conservative cap, for example 64 KB

If limits are exceeded, the request should continue with references where possible and surface concise warnings.

## 12. Technical Architecture Requirements

### 12.1 New Shared Types

Add mention types to `src/entityTypes/aiChatV2Types.ts` or a dedicated `aiChatAtMentionTypes.ts`.

Recommended:

- `ChatV2AtMentionReference`
- `ChatV2MentionSuggestion`
- `ChatV2MentionSuggestionRequest`
- `ChatV2MentionSuggestionResponse`
- `ChatV2MentionMetadata`
- `ChatV2MentionResolution`

### 12.2 New Main-Process Services

Add small services rather than embedding logic in IPC handlers.

Recommended modules:

- `AtMentionParser`
  - pure TypeScript parser
  - no filesystem
  - heavily unit tested

- `AtMentionSuggestionService`
  - resolves workspace
  - searches file paths
  - returns renderer-safe suggestions

- `AtMentionResolutionService`
  - resolves and validates submitted mentions
  - classifies files/directories
  - reads bounded content only when allowed

- `AtMentionContextBuilder`
  - converts resolution results into model-facing context text
  - enforces size limits

These can live under `src/service/aiChatAtMentions/` or similar.

### 12.3 IPC Handlers

Add IPC handlers in `src/main-process/communication/`.

Recommended channels:

- `AI_CHAT_V2_AT_MENTION_SUGGEST`

Optional later:

- `AI_CHAT_V2_AT_MENTION_PREVIEW`

IPC handler rules:

- validate input with explicit schemas or equivalent runtime guards
- call services for business logic
- never access the database directly
- never expose raw stack traces to renderer
- never trust renderer-supplied workspace root
- resolve workspace from `conversationId`

### 12.4 Chat Stream Integration

Integrate mention resolution into the Chat V2 stream path before user message persistence and context assembly.

Required behavior:

- the saved user message preserves the original user-visible text
- metadata records mention resolution status
- the model-facing message receives enriched mention context
- history loading can render mention metadata without re-reading files

If implementation stores enriched internal content today, it should avoid showing internal context blocks as if they were typed by the user.

### 12.5 File Search Implementation

MVP can use `fast-glob` or the existing file-tool search primitives, but it must:

- run only in main process
- use workspace root from `WorkspaceResolver`
- apply default ignore patterns
- avoid following symlinked directories
- cap result count
- cap work
- return relative paths

If performance becomes an issue, Phase 2 can add a lightweight in-memory file index per workspace.

### 12.6 Existing Architecture Boundaries

The implementation must preserve repo rules:

- IPC handlers do not access TypeORM repositories directly.
- Database logic stays in Model and Module classes.
- Renderer does not access filesystem.
- Worker processes do not access database or workspace files directly.
- AI feature IPC handlers keep AI availability gating where applicable.

The suggestion IPC does not call a model, so it does not need hosted AI entitlement gating. The `AI_CHAT_V2_STREAM` handler already owns chat availability gating and must continue to check availability before AI work.

## 13. Security And Privacy Requirements

### SR-001: No Filename Leakage Across Workspaces

Suggestions must never include paths from:

- another conversation's workspace
- a revoked workspace
- a previously active workspace
- default roots
- home directory
- process cwd

### SR-002: Path Escape Rejection

Mentions using traversal, symlink escape, malformed paths, or absolute paths outside the workspace must be rejected.

Examples:

- `@../secret.txt`
- `@../../.ssh/id_rsa`
- `@/etc/passwd`
- symlink inside workspace pointing outside workspace

### SR-003: Deny Pattern Enforcement

Mention suggestions and resolution must honor deny or ignore patterns for sensitive paths.

Examples:

- `.git/**`
- `.env`
- `.env.*`
- dependency directories
- build outputs
- app-specific secrets if configured

The exact deny list should align with `FilePathGuard` and file-tool config.

### SR-004: Prompt Injection Awareness

Mentioned file content may contain prompt injection instructions. This is expected for code and documents.

Mitigation:

- Inject mentioned content inside a clearly labeled context block.
- Tell the model that mentioned file content is data, not higher-priority instruction.
- Keep system/developer instructions higher priority than file content.
- Prefer tool-loaded content for larger files so the tool boundary remains auditable.

### SR-005: Binary And Large File Handling

Binary and large files must not be blindly injected.

Behavior:

- classify binary files
- include metadata only
- tell the model the file is binary or too large
- offer tool-based or user-directed alternatives later if needed

### SR-006: Renderer Boundary Tests

Automated tests must prove `AiChatV2Composer.vue` and related renderer mention code do not import filesystem modules or local path libraries.

## 14. Data And Persistence Requirements

### 14.1 Message Metadata

Mention metadata must be persisted with the user message so chat history remains meaningful after reload.

Persist:

- original mention text
- relative path
- kind
- line range
- resolution status
- size/truncation metadata
- safe error code or user-facing error

Do not persist:

- full file content unless the existing message persistence already stores enriched user content for model context
- absolute paths beyond workspace display conventions
- stack traces
- unbounded directory listings

### 14.2 Conversation History

Reloaded history should render mention chips from metadata without re-resolving files. Files may have changed or disappeared since the original message; history should represent what was referenced at the time.

### 14.3 Context Reuse

If a user retries a message or resends after failure, mention resolution should run again against current workspace state unless the product explicitly implements "use original snapshot" later.

## 15. Performance Requirements

### PR-001: Typing Responsiveness

Typing in the composer must remain smooth.

Targets:

- debounce suggestion calls around 100-150 ms
- p95 suggestion response under 200 ms for typical workspaces
- no blocking renderer filesystem work
- stale suggestion responses dropped

### PR-002: Send Latency

Mention processing during send should add minimal latency.

Targets:

- under 300 ms for up to 5 simple file mentions in typical workspaces
- bounded time for missing or rejected paths
- directory mentions should use shallow listing only

### PR-003: Large Workspace Behavior

Large workspaces must degrade gracefully:

- suggestions may return top capped results
- search may be partial
- no recursive send-time directory walk
- no UI freeze

## 16. Accessibility Requirements

The suggestion dropdown must:

- use `role="listbox"` and option semantics
- keep highlighted item visible
- support keyboard-only operation
- expose file or directory state through accessible text
- close on Escape
- not trap focus after selection

Mention chips or metadata rows must be readable by screen readers and not rely on color alone.

## 17. Internationalization Requirements

Every new user-facing string must be added to all supported language files:

- English: `src/views/lang/en.ts`
- Chinese: `src/views/lang/zh.ts`
- Spanish: `src/views/lang/es.ts`
- French: `src/views/lang/fr.ts`
- German: `src/views/lang/de.ts`
- Japanese: `src/views/lang/ja.ts`

Suggested keys:

- `aiChatV2.atMentions.ariaLabel`
- `aiChatV2.atMentions.noWorkspace`
- `aiChatV2.atMentions.chooseWorkspace`
- `aiChatV2.atMentions.noMatches`
- `aiChatV2.atMentions.file`
- `aiChatV2.atMentions.directory`
- `aiChatV2.atMentions.tooManyMentions`
- `aiChatV2.atMentions.fileNotFound`
- `aiChatV2.atMentions.outsideWorkspace`
- `aiChatV2.atMentions.invalidLineRange`
- `aiChatV2.atMentions.binaryFile`
- `aiChatV2.atMentions.tooLarge`

Vue components must use `t()` with English fallback, following existing project convention.

## 18. Analytics And Diagnostics

MVP does not require product analytics.

Implementation diagnostics should include debug-safe logs for:

- suggestion IPC failures
- no workspace resolution
- mention parse failures
- path rejection code
- context truncation

Logs must not include file content. Logs should avoid absolute paths unless already standard in workspace diagnostics.

## 19. Success Metrics

Product success:

- Users can reference workspace files without uploading them.
- Users can select mentions with keyboard and mouse.
- The assistant reliably reads or reasons about mentioned files.
- No cross-workspace filename leakage occurs.
- No renderer filesystem access is introduced.

Engineering success:

- Unit tests cover parser edge cases.
- IPC tests cover workspace scoping and no-workspace behavior.
- File safety tests cover traversal, symlink escape, and absolute outside paths.
- Chat stream tests prove mention metadata and model context are assembled.
- i18n test or grep gate confirms all language files include new keys.

## 20. Acceptance Criteria

### AC-001: Basic File Mention

Given an approved workspace with `src/main.ts`, when the user types `@src/mai`, the composer shows `src/main.ts`. Selecting it inserts `@src/main.ts`.

### AC-002: Directory Mention

Given an approved workspace with `src/service/`, when the user types `@src/ser`, the composer shows `src/service/` as a directory suggestion. Sending a message with the mention adds directory context instructions, not a recursive full listing.

### AC-003: Line Range Mention

Given `@src/main.ts#L10-20`, the main process parses `lineStart=10` and `lineEnd=20`, validates the file, and includes bounded content or a precise `file_read` instruction.

### AC-004: Quoted Path

Given a file `docs/path with spaces.md`, selecting it inserts `@"docs/path with spaces.md"` and sending resolves it correctly.

### AC-005: No Workspace

Given no approved workspace, typing `@` does not list local files. The UI shows a workspace-required state.

### AC-006: Workspace Isolation

Given Conversation A is bound to Workspace A and Conversation B is bound to Workspace B, typing `@` in Conversation B never shows files only present in Workspace A.

### AC-007: Stale Suggestion Protection

Given a suggestion IPC call is in flight, when the user switches conversations before it returns, the stale suggestions are dropped.

### AC-008: Path Escape Rejection

Given a message containing `@../secret.txt`, send processing rejects the mention and does not read or suggest the file.

### AC-009: Symlink Escape Rejection

Given a symlink inside the workspace points outside the workspace, mentioning the symlink path is rejected or treated according to `FilePathGuard` escape rules.

### AC-010: Renderer Boundary

Renderer mention code has no imports from `fs`, `path`, `os`, `fast-glob`, `isbinaryfile`, or other filesystem libraries.

### AC-011: Attachment Coexistence

Given a message with one uploaded PDF and one `@src/main.ts` mention, both are represented in metadata and the assistant receives distinct instructions for uploaded attachment content and workspace mention context.

### AC-012: Slash Command Coexistence

Given `/review @src/main.ts`, slash command dispatch preserves the mention, and final stream processing resolves the mention before the model request.

### AC-013: i18n Complete

All new user-facing strings exist in all six language files.

## 21. Test Plan

### 21.1 Unit Tests

Add tests for:

- raw mention extraction
- quoted mention extraction
- line range parsing
- invalid line ranges
- email address non-trigger cases
- duplicate mention deduplication
- context block formatting
- content limit truncation

Suggested location:

- `test/vitest/main/service/AtMentionParser.test.ts`
- `test/vitest/main/service/AtMentionContextBuilder.test.ts`

### 21.2 Main Process Tests

Add tests for:

- suggestion handler with no workspace
- suggestion handler with approved workspace
- suggestion handler rejects revoked workspace
- suggestion search applies ignore patterns
- resolution rejects outside workspace
- resolution rejects symlink escape
- resolution handles missing file
- resolution handles directory

Suggested location:

- `test/vitest/main/AtMentionIpc.test.ts`
- `test/vitest/main/service/AtMentionResolutionService.test.ts`

### 21.3 Renderer Tests

Add tests for:

- dropdown opens on `@`
- dropdown does not open on email addresses
- keyboard navigation
- insertion behavior
- quoted insertion for paths with spaces
- stale generation guard
- slash and mention dropdown mutual exclusion

Suggested location:

- `test/vitest/main/components/AiChatV2ComposerAtMentions.test.ts`

### 21.4 Boundary Tests

Add grep-style tests to prove renderer code does not import filesystem APIs.

Suggested checks:

- no `from "fs"` in `src/views/components/aiChatV2/*AtMention*`
- no `from "path"` in renderer mention components
- no `fast-glob` in renderer files

### 21.5 Manual QA

Manual cases:

1. New chat with no workspace, type `@`.
2. Approve workspace, type `@`.
3. Select file by mouse.
4. Select file by keyboard.
5. Mention a file with spaces.
6. Mention a line range.
7. Mention a missing file manually.
8. Mention a directory.
9. Use `/review @file`.
10. Upload a file and mention a workspace file in the same message.
11. Switch conversations while suggestions are open.
12. Change UI language and verify new strings.

## 22. Rollout Plan

### Phase 1: Internal MVP

- Parser and context builder.
- Suggestion IPC.
- Composer dropdown.
- Stream integration.
- Metadata rendering.
- Unit and integration tests.

### Phase 2: Dogfood

- Use on AiFetchly repo itself.
- Validate large workspace behavior.
- Validate prompt quality with common tasks:
  - explain a file
  - compare two files
  - summarize a directory
  - review slash command plus mention

### Phase 3: Default Enable

- Enable for Chat V2 users with approved workspaces.
- Keep no-workspace state visible but non-blocking.
- Track support issues and missing syntax requests.

### Phase 4: Extension

- Consider agent mentions only if multi-agent user workflows need direct routing.
- Consider knowledge-library mentions if document references become common.
- Consider IDE mentions only after product scope includes editor integration.

## 23. Risks And Mitigations

### Risk: Cross-Workspace Filename Leak

Mitigation:

- Resolve workspace on every suggestion request.
- Use generation guards in renderer.
- Add tests for workspace switching and stale result dropping.

### Risk: Prompt Bloat

Mitigation:

- Use compact references by default.
- Inject only bounded line ranges or small files.
- Enforce total mention context size.

### Risk: Path Safety Regression

Mitigation:

- Reuse `FilePathGuard`.
- Keep all filesystem work in main process.
- Add traversal and symlink tests.

### Risk: Poor Suggestion Performance

Mitigation:

- Debounce requests.
- Cap traversal and results.
- Use ignore patterns.
- Add in-memory index only after MVP measurements show need.

### Risk: Confusing Relationship With Attachments

Mitigation:

- Render uploaded files and workspace mentions as separate metadata groups.
- Use clear labels: "Uploaded files" and "Mentioned workspace files".

### Risk: Ambiguous `@name` Behavior

Mitigation:

- Document that Phase 1 treats `@` as file context only.
- Do not silently route messages to agents.
- Later agent mentions should use a distinct suggestion type and clear labels.

## 24. Open Questions

1. Should full small files be injected automatically, or only explicit line ranges?
   - Recommendation: inject explicit line ranges first; add full small-file injection only after token usage is measured.

2. Should read content injection require a permission card?
   - Recommendation: workspace approval plus explicit user mention is enough for small read-only context. Mutating tools still require their normal approval.

3. Should missing mentions block the send?
   - Recommendation: do not block if at least one part of the message is valid. Save warning metadata and let the assistant respond.

4. Should suggestions include hidden dotfiles?
   - Recommendation: hide sensitive dotfiles by default, especially `.env*` and `.git/**`. Revisit if users need explicit dotfile support.

5. Should absolute paths inside the workspace be accepted?
   - Recommendation: accept on send only if they resolve inside the approved workspace, but insert relative paths from autocomplete.

6. Should directory mention context include shallow listing immediately?
   - Recommendation: yes, capped. It helps the model choose the next file tool call without recursive prompt bloat.

## 25. Implementation Notes

Recommended implementation order:

1. Add pure parser and tests.
2. Add shared mention types.
3. Add main-process suggestion service and IPC.
4. Add composer suggestion dropdown by reusing slash suggestion patterns.
5. Add main-process resolution service.
6. Add context builder.
7. Integrate resolution into Chat V2 stream before user message persistence.
8. Add mention metadata rendering.
9. Add i18n keys in all language files.
10. Add boundary and integration tests.

Do not start with a persistent file index. The existing workspace and file-tool stack should be enough for an MVP. Add indexing only if measured suggestion latency requires it.

