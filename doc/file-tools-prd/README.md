# PRD: AI File Tools Integration

## 1. Overview

This PRD defines how to add the following AI-callable file tools to aiFetchly:

- `file_read`
- `file_write`
- `file_edit`
- `glob_files`
- `grep_files`

The goal is to let AI safely inspect and modify files while reusing the existing tool execution, permission, and streaming continuation architecture already implemented in the app.

## 2. Problem Statement

The AI currently has strong web/search and skill execution capabilities, but it does not have first-class local file tooling similar to Cursor-style file operations. This limits AI-assisted coding workflows such as:

- locating files by pattern
- searching code by regex/text
- reading file sections
- writing new files
- making targeted edits

The implementation must be secure by default and consistent with existing skill permission UX.

## 3. Objectives

- Add five local file tools that are discoverable by the LLM.
- Integrate with existing `SkillRegistry` + `ToolExecutor` runtime path.
- Enforce strict filesystem safety boundaries.
- Reuse existing in-chat permission/defer/resume flow for risky operations.
- Keep tool result format stable with current `StreamEventProcessor` and `ToolExecutionService`.

## 4. Non-Goals

- Replacing the full skill marketplace framework.
- Implementing arbitrary shell execution from AI.
- Supporting unrestricted absolute path access outside approved workspace roots.
- Building a new permission framework from scratch.

## 5. Current Architecture (Key Findings)

### 5.1 Active tool list source

The active stream continuation path uses `SkillRegistry.getAllToolFunctions()` to provide tool definitions to the AI stream continuation request.

Implication: New tools should be added as built-in skills in `skillsRegistry`, not only in legacy static config.

### 5.2 Execution path

`StreamEventProcessor.executeTool()` routes:

- Registered skills -> `SkillExecutor`
- Non-registered tools -> `ToolExecutor`

Recommended pattern: define file tools as registered built-in skills and call `ToolExecutor` internally for execution logic.

### 5.3 Permission flow already exists

`SkillExecutor` already checks permissions via `SkillPermissionService`.
When permission is needed, it returns `needsPermissionPrompt: true`, and `StreamEventProcessor` handles defer + resume via existing IPC flow.

Implication: File write/edit operations should leverage this system instead of creating a separate flow.

## 6. Proposed Solution

### 6.1 Tool registration strategy

Add all five tools to built-in skills in `src/config/skillsRegistry.ts` with:

- clear descriptions and JSON parameter schema
- `execute` handlers delegating to `ToolExecutor.execute(...)`
- risk classification through `requiresConfirmation` and `permissionCategory`

Suggested permission posture:

- `glob_files`, `grep_files`, `file_read`: read-style category (can be low-friction if policy allows)
- `file_write`, `file_edit`: confirmation required, higher-risk category

### 6.2 Execution design

Add new cases in `ToolExecutor.executeInternal(...)`:

- `file_read` -> `executeFileRead(...)`
- `file_write` -> `executeFileWrite(...)`
- `file_edit` -> `executeFileEdit(...)`
- `glob_files` -> `executeGlobFiles(...)`
- `grep_files` -> `executeGrepFiles(...)`

Implement shared logic in a dedicated service, e.g. `FileToolService`, to keep `ToolExecutor` thin and testable.

### 6.3 Safety model (mandatory)

#### Workspace jail

All file paths must resolve under allowed root(s).
Path normalization and escape prevention must be centralized (single helper).

#### Escape prevention

Defend against:

- `../` traversal
- absolute paths outside allowed root
- symlink escape (`realpath` check)
- malformed/null-byte path input

#### Deny list

Always block sensitive targets (examples):

- `.git/**`
- secret/credential key patterns
- app internal DB/config files not meant for AI edits

#### Size limits

Bound reads and outputs to avoid oversized tool payloads.

## 7. Tool Specifications

### 7.1 `file_read`

Inputs:

- `path` (required)
- `offset` (optional)
- `limit` (optional)
- `encoding` (optional, default `utf-8`)

Behavior:

- Return line-oriented content with bounded size.
- Detect binary files and return metadata instead of raw binary.

Output:

- `success`
- `path`
- `content` or `isBinary` metadata
- `truncated` flag when limits apply

### 7.2 `file_write`

Inputs:

- `path` (required)
- `content` (required)
- `mode` (optional: `create` | `overwrite`)

Behavior:

- Use atomic write (`temp + rename`).
- Create parent directories only within allowed root.
- Require permission confirmation.

Output:

- `success`
- `path`
- `bytesWritten`
- `created`/`overwritten`

### 7.3 `file_edit`

Inputs:

- `path` (required)
- `old_string` (required)
- `new_string` (required)
- `replace_all` (optional, default `false`)

Behavior:

- Exact match replacement.
- If `replace_all=false`, fail when match count != 1.
- Require permission confirmation.

Output:

- `success`
- `path`
- `replacements`
- optional `diff` summary

### 7.4 `glob_files`

Inputs:

- `pattern` (required)
- `cwd` (optional)
- `ignore` (optional)
- `head_limit` (optional)

Behavior:

- Fast filename/path pattern matching.
- Respect default ignore directories.
- Hard-cap result count with truncation flag.

Output:

- `success`
- `matches`
- `total`
- `truncated`

### 7.5 `grep_files`

Inputs:

- `pattern` (required)
- `path` (optional)
- `glob` (optional)
- `output_mode` (`content` | `files_with_matches` | `count`)
- context options (`-A`, `-B`, `-C`)
- `head_limit`
- case sensitivity flag

Behavior:

- Regex search with bounded output.
- Prefer ripgrep-backed execution for performance where feasible.

Output:

- `success`
- mode-specific results
- `truncated`

## 8. Permission and UX Requirements

- Reuse existing skill permission prompt mechanics.
- For deferred permission, maintain current tool call state and resume seamlessly.
- Persist permission decisions using existing `SkillPermissionService` behavior.

## 9. Observability and Persistence

- Preserve existing `ToolExecutionService.saveToolCall/saveToolResult` behavior.
- Include concise metadata in tool results to improve history clarity.
- Optional enhancement: add explicit audit metadata fields for filesystem operations (path, operation type, bytes).

## 10. Performance and Rate Limiting

- Add file-tool-specific branches in rate limiter config selection.
- Keep conservative defaults for write/edit concurrency.
- Enforce output caps for `file_read`/`grep_files` to protect stream throughput.

## 11. Testing Requirements

Must cover:

- safe path resolution and traversal rejection
- symlink escape rejection
- deny-list enforcement
- read truncation behavior
- binary file handling
- write atomicity and mode rules
- edit uniqueness behavior (`replace_all=false`)
- permission-gated defer/resume flow for write/edit tools

## 12. Rollout Plan

Phase 1 (low risk):

- `glob_files`, `grep_files`, `file_read`

Phase 2 (higher risk with prompts):

- `file_write`, `file_edit`

Phase 3:

- tighten UX, telemetry, and policy defaults after validation

## 13. Risks and Mitigations

- **Risk:** tools added only to legacy config and not active stream registry
  **Mitigation:** register in `skillsRegistry` as source of truth.

- **Risk:** filesystem escape vulnerabilities
  **Mitigation:** centralized path jail helper + realpath checks + deny-list.

- **Risk:** oversized tool outputs degrade chat reliability
  **Mitigation:** strict caps + truncation flags.

- **Risk:** write/edit operations without user trust controls
  **Mitigation:** mandatory permission prompt via existing skill permission pipeline.

## 14. Acceptance Criteria

- AI can discover and call all five tools in chat.
- Read tools work under allowed roots and reject unsafe paths.
- Write/edit tools require permission and resume correctly after approval.
- Tool results are saved, surfaced, and forwarded through existing stream flow without regressions.
- Automated tests cover core safety and behavior scenarios.
