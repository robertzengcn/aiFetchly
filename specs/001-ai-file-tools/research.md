# Research: AI File Tools Integration

**Branch**: `001-ai-file-tools` | **Date**: 2026-04-22

## 1. Architecture Integration Points

### Decision: Register as built-in skills in SkillRegistry

**Rationale**: The active stream continuation path uses `SkillRegistry.getAllToolFunctions()` to provide tool definitions to the AI. Tools must be registered here to be discoverable by the LLM. The legacy `aiTools.config.ts` lacks execute handlers, permission categories, and confirmation support.

**Alternatives considered**:
- Adding to `aiTools.config.ts` only → Rejected: lacks execution, permission, and tier metadata
- Creating a parallel registry → Rejected: would duplicate infrastructure and create confusion
- MCP tools → Rejected: file tools are built-in, not externally provided

### Decision: Use SkillExecutor + ToolExecutor layered execution

**Rationale**: `StreamEventProcessor.executeTool()` routes registered skills through `SkillExecutor` (which handles permission checks), then delegates to `ToolExecutor.execute()` internally. This matches the pattern used by existing tools like `scrape_urls_from_google`.

**Flow**: LLM tool call → StreamEventProcessor → SkillExecutor (permission check) → ToolExecutor (dispatch) → FileToolService (execution)

### Decision: Reuse existing permission defer/resume flow

**Rationale**: `SkillExecutor` already returns `needsPermissionPrompt: true` when permission is needed, and `StreamEventProcessor` preserves tool call state in `pendingSkillPermissionByToolId`. The UI shows a prompt, and on approval, `sendToolResultToAI()` resumes the stream. No new permission framework needed.

**Permission categories**:
- `file_read`, `glob_files`, `grep_files` → `permissionCategory: "pure"` (no side effects, auto-allowed)
- `file_write`, `file_edit` → `permissionCategory: "filesystem"` (always prompts on first use)

### Decision: Use "filesystem" permission category for write/edit, "pure" for read

**Rationale**: The existing `SkillPermissionCategory` type already defines `"filesystem"` as "Local file read/write. Always prompts." This aligns perfectly with write/edit tools. Read tools are non-destructive and match the `"pure"` category (no side effects, auto-allowed).

## 2. Service Architecture

### Decision: Create FileToolService for core logic, FilePathGuard for safety

**Rationale**: Technology advice recommends keeping `ToolExecutor` as dispatcher only. A dedicated `FileToolService` centralizes file operation logic, making it testable independently. A shared `FilePathGuard` ensures all five tools use the same safety enforcement.

**Alternatives considered**:
- Inline logic in ToolExecutor → Rejected: makes ToolExecutor too large, hard to test
- One service per tool → Rejected: excessive fragmentation for related operations
- Mix safety + execution in one class → Rejected: single responsibility principle

### Decision: FileToolService in src/service/, not src/modules/

**Rationale**: File tools are not business-logic modules with database access (no Module/Model pattern needed). They are service-layer utilities that operate on the filesystem. The `src/service/` directory already contains `ToolExecutor.ts`, `SkillExecutor.ts`, and `SkillPermissionService.ts`.

## 3. Library Choices

### Decision: fast-glob for glob_files

**Rationale**: Industry-standard Node.js glob library. Fast, supports ignore patterns, handles edge cases. Technology advice recommends it.

**Alternatives considered**:
- Node.js built-in `fs.glob` (Node 22+) → Rejected: not available in Electron's Node version
- `glob` package → Rejected: slower than fast-glob, less actively maintained
- `micromatch` → Rejected: pattern matching only, not filesystem traversal

### Decision: @vscode/ripgrep for grep_files with graceful fallback

**Rationale**: Ripgrep is the fastest code search tool available. `@vscode/ripgrep` packages the binary for Electron apps. Must handle `asarUnpack` in packaging config. Fallback to a Node.js-based search when rg binary is unavailable.

**Alternatives considered**:
- Node.js `readline` + regex → Rejected: too slow for large codebases
- `glob` + `fs.readFile` → Rejected: inefficient for content search
- `child_process.exec('grep')` → Rejected: platform-dependent, security risk

### Decision: write-file-atomic for safe write/edit commits

**Rationale**: Provides atomic write via temp file + rename pattern. Prevents partial writes on crash. Technology advice recommends it.

**Alternatives considered**:
- Manual `fs.writeFile` + `fs.rename` → Rejected: reinventing the wheel, error-prone
- `graceful-fs` → Rejected: handles retries, not atomicity

### Decision: isbinaryfile for binary detection

**Rationale**: Lightweight, well-tested library for detecting binary files. Prevents returning raw binary content to the AI.

### Decision: picomatch for deny-list glob matching

**Rationale**: Fast, glob-based pattern matching for deny list rules. Supports `**/*.pem`, `.git/**`, etc.

### Decision: zod for parameter validation

**Rationale**: Runtime type validation with TypeScript type inference. Validates all tool parameters before execution. Provides clear error messages for invalid inputs.

### Decision: diff for optional edit diff summaries

**Rationale**: Generates unified diff output for `file_edit` results. Helps users understand what changed.

## 4. Safety Model

### Decision: Centralized FilePathGuard as single enforcement point

**Rationale**: All path safety checks (workspace jail, traversal prevention, symlink escape, null bytes, deny list) must be enforced consistently across all five tools. A single helper class prevents duplication and ensures no tool bypasses safety.

**Safety checks in order**:
1. Reject null bytes and malformed characters
2. Resolve to absolute path
3. Normalize (remove `..`, redundant separators)
4. Resolve symlinks via `fs.realpathSync()`
5. Verify resolved path starts with an allowed workspace root
6. Check against deny list patterns

### Decision: Workspace roots configurable, not hardcoded

**Rationale**: The allowed workspace roots should be configurable (e.g., from settings or campaign context). This allows flexibility without compromising safety. The guard validates against whatever roots are configured.

### Decision: Default deny list patterns

**Mandatory deny patterns**:
- `.git/**` - Version control internals
- `**/*.pem`, `**/*.key`, `**/*.p12` - Cryptographic keys
- `**/.env`, `**/.env.*` - Environment variables with secrets
- `**/credentials*` - Credential files
- `**/node_modules/**` - Dependencies (read clutter, accidental edits)
- App internal DB files - Application database and config

## 5. Rate Limiting

### Decision: Add file-specific rate limit buckets

**Rationale**: File operations have different performance characteristics than web scraping. Read tools can be more permissive; write/edit tools should be conservative.

**Proposed config**:
```
fileRead:    { maxPerMinute: 30, maxConcurrent: 5, cooldownMs: 200 }
fileSearch:  { maxPerMinute: 20, maxConcurrent: 3, cooldownMs: 500 }
fileWrite:   { maxPerMinute: 10, maxConcurrent: 1, cooldownMs: 1000 }
```

## 6. Packaging Considerations

### Decision: asarUnpack for @vscode/ripgrep binary

**Rationale**: Electron packages app into asar archive by default. Native binaries (like ripgrep) cannot run from inside asar. Must add to `asarUnpack` in forge.config.js.

## 7. No New Database Entities Required

**Rationale**: Tool calls and results are already persisted by `ToolExecutionService.saveToolCall/saveToolResult`. The file tools themselves are stateless - they operate on the filesystem and return results. No new TypeORM entities are needed.

## 8. No New IPC Handlers Required

**Rationale**: File tools are invoked by the AI through the existing chat stream pipeline. The `StreamEventProcessor` handles tool execution, permission deferral, and result delivery. Permission prompts use the existing `SYSTEM_DEPENDENCY_PROMPT` flow. No new IPC channels needed.

## 9. Testing Strategy

### Decision: Unit tests for FilePathGuard and FileToolService, integration tests for full pipeline

**Rationale**: 
- FilePathGuard: Pure logic, easy to unit test with temp directories
- FileToolService: Filesystem operations, test with temp directories
- Integration: Test full SkillExecutor → ToolExecutor → FileToolService flow
- Permission: Test defer/resume flow for write/edit tools

**Test location**: `test/vitest/main/` for service unit tests, `test/vitest/main/` for integration tests matching existing patterns.
