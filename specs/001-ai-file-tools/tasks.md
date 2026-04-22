# Tasks: AI File Tools Integration

**Input**: Design documents from `/specs/001-ai-file-tools/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/file-tools.md, quickstart.md

**Tests**: TDD is mandatory per CLAUDE.md rules. Tests written FIRST, must FAIL before implementation.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and create shared type definitions and configuration.

- [x] T001 Install new npm dependencies: `yarn add fast-glob @vscode/ripgrep write-file-atomic isbinaryfile picomatch zod diff && yarn add -D @types/diff`
- [x] T002 [P] Create file tool TypeScript interfaces in `src/entityTypes/fileToolTypes.ts` (FileReadParams, FileWriteParams, FileEditParams, GlobFilesParams, GrepFilesParams, all result types, DenyListConfig, PathValidationResult)
- [x] T003 [P] Create file tool configuration in `src/config/fileToolConfig.ts` (DEFAULT_DENY_LIST patterns, FILE_TOOL_RATE_LIMITS, FILE_TOOL_SIZE_LIMITS, default workspace roots resolver)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core safety infrastructure that MUST be complete before ANY user story can be implemented.

**CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundation

- [x] T004 Write FilePathGuard unit tests in `test/vitest/main/FilePathGuard.test.ts` (path traversal rejection, null byte rejection, absolute path outside root rejection, symlink escape rejection, deny list enforcement, valid path resolution, multiple workspace roots)

### Implementation for Foundation

- [x] T005 Implement FilePathGuard service in `src/service/FilePathGuard.ts` (workspace jail validation, path normalization, symlink realpath check, deny list matching via picomatch, centralized `validate(path)` method returning `PathValidationResult`)
- [x] T006 Create FileToolService skeleton in `src/service/FileToolService.ts` (class with `execute(toolName, args)` dispatch method, private method stubs for each tool, FilePathGuard dependency injection)

**Checkpoint**: FilePathGuard passes all safety tests. FileToolService skeleton compiles. User story implementation can now begin.

---

## Phase 3: User Story 1 - AI Reads and Searches Files (Priority: P1) MVP

**Goal**: AI can read file contents, find files by pattern, and search file contents by regex within allowed workspace roots.

**Independent Test**: Ask AI to find files with `glob_files`, search content with `grep_files`, and read files with `file_read`. Verify results are returned correctly and unsafe paths are rejected.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T007 [P] [US1] Write file_read unit tests in `test/vitest/main/FileToolService.test.ts` (text content with line numbers, offset/limit, truncation flag, binary detection and metadata, file not found error, path safety rejection)
- [ ] T008 [P] [US1] Write glob_files unit tests in `test/vitest/main/FileToolService.test.ts` (pattern matching, default ignore patterns, head_limit and truncation, cwd option, empty results)
- [ ] T009 [P] [US1] Write grep_files unit tests in `test/vitest/main/FileToolService.test.ts` (content mode with line numbers, files_with_matches mode, count mode, context lines, case insensitive, invalid regex error, head_limit truncation, path safety rejection)

### Implementation for User Story 1

- [ ] T010 [US1] Implement `executeFileRead` in `src/service/FileToolService.ts` (path validation via FilePathGuard, binary detection via isbinaryfile, line-oriented content read, offset/limit support, truncation flag, size cap enforcement)
- [ ] T011 [US1] Implement `executeGlobFiles` in `src/service/FileToolService.ts` (path validation, fast-glob pattern matching, default ignore patterns from config, head_limit enforcement, truncation flag with total count)
- [ ] T012 [US1] Implement `executeGrepFiles` in `src/service/FileToolService.ts` (path validation, ripgrep JSON output parsing, Node.js fallback when rg unavailable, output mode dispatch, context line support, case sensitivity flag, head_limit enforcement, truncation flag)
- [ ] T013 [US1] Add `file_read`, `glob_files`, `grep_files` skill entries to `BUILT_IN_SKILLS` in `src/config/skillsRegistry.ts` (tier: "main", requiresConfirmation: false, permissionCategory: "pure", source: "built-in", execute delegates to ToolExecutor)
- [ ] T014 [US1] Add read tool dispatch cases in `src/service/ToolExecutor.ts` `executeInternal()` (switch cases for "file_read", "glob_files", "grep_files" delegating to FileToolService.execute) and add file-tool rate limit buckets (fileRead, fileSearch configs) to RATE_LIMIT_CONFIG

**Checkpoint**: AI can discover and call all three read tools in chat. Read tools work under allowed roots and reject unsafe paths. All read tool tests pass.

---

## Phase 4: User Story 2 - AI Edits Existing Files (Priority: P2)

**Goal**: AI can perform precise string replacements in existing files, with user permission required before any edit is applied.

**Independent Test**: Ask AI to make a specific text replacement in a file. Verify permission prompt appears, edit is applied after approval, and edit fails gracefully for non-unique or missing matches.

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T015 [US2] Write file_edit unit tests in `test/vitest/main/FileToolService.test.ts` (single match replacement, replace_all mode, no match error, multiple match error when replace_all=false, diff output, path safety rejection, atomic write verification)

### Implementation for User Story 2

- [ ] T016 [US2] Implement `executeFileEdit` in `src/service/FileToolService.ts` (path validation, read current content, count matches, enforce single-match rule when replace_all=false, exact string replacement, atomic write via write-file-atomic, optional diff summary via diff library, return replacement count)
- [ ] T017 [US2] Add `file_edit` skill entry to `BUILT_IN_SKILLS` in `src/config/skillsRegistry.ts` (tier: "main", requiresConfirmation: true, permissionCategory: "filesystem", source: "built-in", execute delegates to ToolExecutor)
- [ ] T018 [US2] Add `file_edit` dispatch case in `src/service/ToolExecutor.ts` `executeInternal()` (switch case delegating to FileToolService.execute) and add fileWrite rate limit config to RATE_LIMIT_CONFIG

**Checkpoint**: AI can edit files via `file_edit`. Permission prompt appears before edits. Edits are applied atomically. Non-unique and missing matches fail gracefully. US1 and US2 both work independently.

---

## Phase 5: User Story 3 - AI Creates New Files (Priority: P3)

**Goal**: AI can create new files or overwrite existing files atomically, with user permission required before any write is applied.

**Independent Test**: Ask AI to create a new file with specific content. Verify permission prompt appears, file is created after approval, and create/overwrite modes behave correctly.

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T019 [US3] Write file_write unit tests in `test/vitest/main/FileToolService.test.ts` (create mode success, overwrite mode success, create mode fails on existing file, parent directory auto-creation, atomic write verification, bytesWritten in result, path safety rejection)

### Implementation for User Story 3

- [ ] T020 [US3] Implement `executeFileWrite` in `src/service/FileToolService.ts` (path validation, mode check: create vs overwrite, parent directory creation within allowed root only, atomic write via write-file-atomic, bytesWritten calculation, error on existing file in create mode)
- [ ] T021 [US3] Add `file_write` skill entry to `BUILT_IN_SKILLS` in `src/config/skillsRegistry.ts` (tier: "main", requiresConfirmation: true, permissionCategory: "filesystem", source: "built-in", execute delegates to ToolExecutor)
- [ ] T022 [US3] Add `file_write` dispatch case in `src/service/ToolExecutor.ts` `executeInternal()` (switch case delegating to FileToolService.execute, reuses fileWrite rate limit config)

**Checkpoint**: AI can create and overwrite files via `file_write`. Permission prompt appears before writes. Atomic write confirmed. US1, US2, and US3 all work independently.

---

## Phase 6: User Story 4 - Seamless Permission Defer and Resume (Priority: P4)

**Goal**: Write/edit tool permission prompts seamlessly defer and resume the AI conversation, maintaining full task context.

**Independent Test**: Trigger a write or edit in a multi-step AI task. Verify conversation pauses at permission prompt and resumes correctly with full context after user responds.

### Tests for User Story 4

- [ ] T023 [US4] Write permission defer/resume integration tests in `test/vitest/main/FileToolPermission.test.ts` (write tool triggers needsPermissionPrompt, edit tool triggers needsPermissionPrompt, conversation resumes after approval, conversation resumes after denial, read tools do NOT trigger permission prompts)

### Implementation for User Story 4

- [ ] T024 [US4] Verify `file_write` and `file_edit` skill entries use `permissionCategory: "filesystem"` which triggers existing SkillExecutor permission flow in `src/service/SkillExecutor.ts` (no code change needed - confirm existing flow handles filesystem category correctly)
- [ ] T025 [US4] Verify StreamEventProcessor handles defer/resume for file tools correctly in `src/service/StreamEventProcessor.ts` (confirm existing `pendingSkillPermissionByToolId` mechanism works for file tool tool_call_ids - no code change needed if existing flow is generic)

**Checkpoint**: Permission defer/resume flow works for all write/edit tools. Read tools bypass permission prompts. All four user stories work independently and together.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation, packaging configuration, and final cleanup.

- [ ] T026 Write end-to-end integration tests in `test/vitest/main/FileToolIntegration.test.ts` (full pipeline: AI tool call -> SkillExecutor permission -> ToolExecutor dispatch -> FileToolService execution -> result returned through stream, ripgrep fallback when binary unavailable, packaging verification)
- [ ] T027 Add `asarUnpack` entry for `@vscode/ripgrep` binary in `forge.config.js`
- [ ] T028 Run full test suite `yarn vitest run test/vitest/main/` and fix any failures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Phase 2 (Foundational) completion
  - US1 (P1): Can start after Foundational - no dependencies on other stories
  - US2 (P2): Can start after Foundational - no dependencies on US1 for core logic, but reads files first in practice
  - US3 (P3): Can start after Foundational - no dependencies on US1/US2 for core logic
  - US4 (P4): Depends on US2 and US3 being complete (tests write/edit permission flow)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: No story dependencies - MVP target
- **US2 (P2)**: No story dependencies - file_edit is independent of read tools
- **US3 (P3)**: No story dependencies - file_write is independent of other tools
- **US4 (P4)**: Depends on US2 + US3 (tests write/edit permission integration)

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD mandatory)
- FileToolService methods before SkillRegistry entries
- SkillRegistry entries before ToolExecutor dispatch cases
- Core implementation before integration

### Parallel Opportunities

- **Phase 1**: T002 and T003 can run in parallel (different files)
- **Phase 3 tests**: T007, T008, T009 can run in parallel (same test file but different describe blocks)
- **Phase 3 implementation**: T010, T011, T012 can be partially parallel (different methods, same file)
- **Phase 4 vs Phase 5**: US2 and US3 can run in parallel after Foundational (different tool methods)
- **Phase 7**: T027 and T028 can run in parallel

---

## Parallel Example: User Story 1

```bash
# Phase 1 - parallel dependency setup:
Task: "Create file tool TypeScript interfaces in src/entityTypes/fileToolTypes.ts"
Task: "Create file tool configuration in src/config/fileToolConfig.ts"

# Phase 3 - write all US1 tests in parallel:
Task: "Write file_read unit tests in test/vitest/main/FileToolService.test.ts"
Task: "Write glob_files unit tests in test/vitest/main/FileToolService.test.ts"
Task: "Write grep_files unit tests in test/vitest/main/FileToolService.test.ts"

# Phase 3 - implement read tools (sequential within same file):
Task: "Implement executeFileRead in src/service/FileToolService.ts"
Task: "Implement executeGlobFiles in src/service/FileToolService.ts"
Task: "Implement executeGrepFiles in src/service/FileToolService.ts"

# Phase 3 - registration (sequential, depends on implementation):
Task: "Add read tool skill entries in src/config/skillsRegistry.ts"
Task: "Add read tool dispatch cases in src/service/ToolExecutor.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T006) - CRITICAL
3. Complete Phase 3: User Story 1 (T007-T014)
4. **STOP and VALIDATE**: Test read tools independently via AI chat
5. Deploy/demo if ready - AI can now explore codebases

### Incremental Delivery

1. Setup + Foundational (T001-T006) -> Safety infrastructure ready
2. US1 Read Tools (T007-T014) -> Test independently -> Deploy (MVP!)
3. US2 Edit Tool (T015-T018) -> Test independently -> Deploy
4. US3 Write Tool (T019-T022) -> Test independently -> Deploy
5. US4 Permission Flow (T023-T025) -> Test permission integration -> Deploy
6. Polish (T026-T028) -> Integration tests, packaging, final validation

### Parallel Team Strategy

1. Team completes Setup + Foundational together (T001-T006)
2. Once Foundational is done:
   - Developer A: US1 Read Tools (T007-T014)
   - Developer B: US2 Edit Tool (T015-T018) - can start in parallel
3. Then:
   - Developer A: US3 Write Tool (T019-T022)
   - Developer B: US4 Permission Tests (T023-T025)
4. Together: Polish (T026-T028)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- TDD mandatory: tests must FAIL before implementation begins
- Commit after each completed function per CLAUDE.md auto-commit rule
- Stop at any checkpoint to validate story independently
- FilePathGuard is the single safety enforcement point - all tools MUST use it
- No new database entities or IPC handlers needed
- Existing SkillExecutor permission flow handles filesystem category automatically
