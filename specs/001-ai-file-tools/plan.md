# Implementation Plan: AI File Tools Integration

**Branch**: `001-ai-file-tools` | **Date**: 2026-04-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-ai-file-tools/spec.md`

## Summary

Add five AI-callable file tools (`file_read`, `file_write`, `file_edit`, `glob_files`, `grep_files`) to aiFetchly's existing tool execution pipeline. The tools are registered as built-in skills in `SkillRegistry`, routed through the existing `SkillExecutor` → `ToolExecutor` execution path, and enforce strict filesystem safety through a centralized `FilePathGuard`. Write/edit operations require user permission via the existing defer/resume flow. No new database entities or IPC handlers are needed.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: fast-glob, @vscode/ripgrep, write-file-atomic, isbinaryfile, picomatch, zod, diff
**Storage**: No new database entities (uses existing ToolExecutionService for persistence)
**Testing**: Vitest (service/unit tests), Mocha (integration tests)
**Target Platform**: Electron desktop app (Windows, macOS, Linux via WSL2)
**Project Type**: Electron + Vue 3 desktop application
**Performance Goals**: Reads <2s for 1MB files; searches <3s for 10k files
**Constraints**: All operations workspace-jailed; write/edit require permission prompts; output size caps
**Scale/Scope**: 5 tools, ~6 new source files, ~4 test files

## Constitution Check

*Constitution is a template (not yet configured). Using CLAUDE.md rules as governing principles:*

| Gate | Status | Notes |
|------|--------|-------|
| Three-layer architecture (IPC → Module → Model) | PASS | File tools use Service layer (no DB access needed) |
| Worker process separation | PASS | All file ops run in main process only |
| Never use `any` type | PASS | All interfaces explicitly typed |
| Immutable data patterns | PASS | All types use `readonly`, results are new objects |
| Auto-commit after each function | PASS | Will follow per-function commit workflow |
| i18n for user-facing text | N/A | No new user-facing UI text (permission prompts use existing flow) |

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-file-tools/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Technical decisions and rationale
├── data-model.md        # Type definitions and data structures
├── quickstart.md        # Developer quickstart guide
├── contracts/
│   └── file-tools.md    # Tool parameter/result contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Implementation tasks (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── service/
│   ├── FileToolService.ts      # NEW: Core file tool execution logic
│   ├── FilePathGuard.ts        # NEW: Path safety validation service
│   ├── ToolExecutor.ts         # MODIFY: Add 5 dispatch cases + rate limit config
│   └── SkillExecutor.ts        # NO CHANGE: Existing permission flow handles it
├── config/
│   └── skillsRegistry.ts       # MODIFY: Add 5 built-in skill definitions
├── entityTypes/
│   └── fileToolTypes.ts        # NEW: TypeScript interfaces for file tool params/results
└── config/
    └── fileToolConfig.ts       # NEW: Workspace roots, deny list, size limits config

test/
├── vitest/
│   └── main/
│       ├── FilePathGuard.test.ts      # NEW: Path safety unit tests
│       ├── FileToolService.test.ts     # NEW: File tool execution unit tests
│       └── FileToolIntegration.test.ts # NEW: End-to-end pipeline tests
└── modules/
    └── FileToolPermission.test.ts      # NEW: Permission flow integration tests

forge.config.js                         # MODIFY: asarUnpack for @vscode/ripgrep binary
package.json                            # MODIFY: Add new dependencies
```

**Structure Decision**: Follows existing `src/service/` and `src/config/` patterns. New types in `src/entityTypes/` matching existing convention. Tests in `test/vitest/main/` matching existing main-process test location.

## Implementation Phases

### Phase 1: Foundation - Safety Layer (FilePathGuard + Types + Config)

**Goal**: Establish the path safety infrastructure that all file tools depend on.

**Files to create/modify**:
1. `src/entityTypes/fileToolTypes.ts` — All TypeScript interfaces (params, results, config)
2. `src/config/fileToolConfig.ts` — Workspace roots, deny list, size limits, rate limits
3. `src/service/FilePathGuard.ts` — Path validation service (workspace jail, deny list, symlink check)
4. `test/vitest/main/FilePathGuard.test.ts` — Unit tests for all safety scenarios

**Test plan**:
- Path traversal rejection (`../../etc/passwd`)
- Absolute path outside root rejection
- Null byte injection rejection
- Symlink escape rejection
- Deny list enforcement (`.git/**`, `**/*.pem`, etc.)
- Valid path resolution and normalization
- Multiple workspace roots support

**Commit point**: After FilePathGuard passes all safety tests.

### Phase 2: Read-Only Tools (file_read, glob_files, grep_files)

**Goal**: Implement the three read-only file tools with full safety integration.

**Files to create/modify**:
1. `src/service/FileToolService.ts` — Read tool methods (`executeFileRead`, `executeGlobFiles`, `executeGrepFiles`)
2. `src/service/ToolExecutor.ts` — Add dispatch cases for read tools + rate limit config
3. `src/config/skillsRegistry.ts` — Register `file_read`, `glob_files`, `grep_files` as built-in skills
4. `test/vitest/main/FileToolService.test.ts` — Read tool unit tests

**Test plan**:
- file_read: text content, binary detection, offset/limit, truncation, non-existent file
- glob_files: pattern matching, ignore patterns, head_limit, truncation
- grep_files: all output modes, context lines, case sensitivity, invalid regex, head_limit
- All tools: path safety enforced via FilePathGuard

**Commit point**: After read tools pass all tests.

### Phase 3: Write/Edit Tools (file_write, file_edit)

**Goal**: Implement write and edit tools with permission integration.

**Files to create/modify**:
1. `src/service/FileToolService.ts` — Add `executeFileWrite`, `executeFileEdit` methods
2. `src/service/ToolExecutor.ts` — Add dispatch cases for write/edit tools
3. `src/config/skillsRegistry.ts` — Register `file_write`, `file_edit` as built-in skills (with `requiresConfirmation: true`, `permissionCategory: "filesystem"`)
4. `test/vitest/main/FileToolService.test.ts` — Add write/edit test cases
5. `test/vitest/main/FileToolPermission.test.ts` — Permission defer/resume tests

**Test plan**:
- file_write: create mode, overwrite mode, parent directory creation, atomic write, existing file error
- file_edit: single match replacement, replace_all, no match error, multiple match error, diff output
- Permission: defer/resume flow for write/edit, denial handling, persistence of decisions
- All tools: path safety enforced via FilePathGuard

**Commit point**: After write/edit tools and permission flow pass all tests.

### Phase 4: Integration, Packaging, and Polish

**Goal**: End-to-end validation, packaging configuration, and final cleanup.

**Files to modify**:
1. `forge.config.js` — Add `asarUnpack` entry for `@vscode/ripgrep` binary
2. `package.json` — Verify all dependencies listed
3. `test/vitest/main/FileToolIntegration.test.ts` — Full pipeline integration tests

**Test plan**:
- End-to-end: AI calls tool → SkillExecutor (permission) → ToolExecutor → FileToolService → result
- Stream continuation: tool result delivered through StreamEventProcessor
- Ripgrep fallback: graceful degradation when rg binary unavailable
- Package build: verify app builds and packs correctly

**Commit point**: After integration tests pass and packaging verified.

## Dependencies

### New npm packages

| Package          | Version | Purpose                         | Size Impact |
|------------------|---------|---------------------------------|-------------|
| fast-glob         | ^3.x    | glob_files pattern matching     | ~50KB       |
| @vscode/ripgrep  | ^1.x    | grep_files search engine        | ~5MB (binary) |
| write-file-atomic| ^5.x    | Atomic write for file_write/edit| ~10KB       |
| isbinaryfile     | ^5.x    | Binary detection for file_read  | ~5KB        |
| picomatch        | ^4.x    | Deny list pattern matching      | ~20KB       |
| zod              | ^3.x    | Parameter validation            | ~50KB       |
| diff             | ^5.x    | Edit diff summaries             | ~30KB       |

### Existing code dependencies

| Component                | File                                | Integration Point              |
|--------------------------|-------------------------------------|-------------------------------|
| SkillRegistry            | src/config/skillsRegistry.ts        | Tool registration (BUILT_IN_SKILLS) |
| ToolExecutor             | src/service/ToolExecutor.ts         | Dispatch cases + rate limits  |
| SkillExecutor            | src/service/SkillExecutor.ts        | Permission checks (existing)  |
| StreamEventProcessor     | src/service/StreamEventProcessor.ts | Tool execution orchestration  |
| ToolExecutionService     | src/service/ToolExecutionService.ts | Call/result persistence       |
| SkillPermissionService   | src/service/SkillPermissionService.ts | Permission persistence       |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Ripgrep binary not found after packaging | Medium | High | Fallback to Node.js-based search; asarUnpack config |
| Path escape vulnerability | Low | Critical | Centralized FilePathGuard; exhaustive test suite |
| Large file read overloads chat stream | Medium | Medium | Strict size caps; truncation with flags |
| Permission prompt breaks conversation flow | Low | High | Reuse proven existing defer/resume mechanism |
| Tool output too large for AI context window | Medium | Medium | Output caps enforced before returning to stream |

## Rollout Plan

1. **Phase 1** (Foundation): Ship `FilePathGuard` + types + config — no user-visible change
2. **Phase 2** (Read tools): Ship read-only tools — immediate value for AI-assisted exploration
3. **Phase 3** (Write/edit tools): Ship with mandatory permission prompts — full AI coding capability
4. **Phase 4** (Polish): Integration testing, packaging fixes, performance tuning
