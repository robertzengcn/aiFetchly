# Tasks: Shell Execution Skill

**Input**: Design documents from `/specs/001-shell-execution-skill/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Included — TDD is mandatory per project CLAUDE.md (80%+ coverage requirement).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Electron desktop app with source under `src/` and tests under `test/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create type definitions, configuration, and foundational types shared across all user stories.

- [X] T001 Create shell type interfaces (ShellExecutionRequest, ShellExecutionResult, ShellPermissionConsent) with zod validation schemas in src/entityTypes/shellTypes.ts
- [X] T002 Add "shell" to SkillPermissionCategory union type in src/entityTypes/skillTypes.ts
- [X] T003 [P] Create shell tool configuration (denylist patterns, output caps, timeout defaults, env allowlist, rate limits) in src/config/shellToolConfig.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core execution engine and audit infrastructure that MUST be complete before ANY user story can be implemented.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Implement ShellToolService with spawn execution, timeout enforcement, process-tree kill, output collection with size caps, and environment scrubbing in src/service/ShellToolService.ts
- [X] T005 [P] Create ShellAudit TypeORM entity (extends AuditableEntity) with fields: conversationId, toolCallId, commandRedacted, cwd, shell, success, exitCode, timedOut, durationMs in src/entity/ShellAudit.entity.ts
- [X] T006 [P] Create ShellAuditModel data access class (extends BaseDb) with create method for audit entries in src/model/ShellAudit.model.ts
- [X] T007 [P] Implement ShellAuditLogger service with command redaction (API keys, passwords, tokens, credential URLs) and structured logging via ShellAuditModel in src/service/ShellAuditLogger.ts

**Checkpoint**: Foundation ready — ShellToolService can execute commands, ShellAuditLogger can record executions.

---

## Phase 3: User Story 1 — Execute a Local Command via AI Chat (Priority: P1) MVP

**Goal**: Users can request shell commands through AI chat, approve them via permission prompt, and receive structured output (stdout/stderr, exit code, duration).

**Independent Test**: Send "list files in this folder" through AI chat, verify permission prompt shows exact command, approve it, verify structured result returns in chat.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [X] T008 [P] [US1] Unit test for ShellToolService success path (simple echo command, verifies structured result with stdout, exit_code, duration_ms) in test/vitest/main/ShellToolService.test.ts
- [X] T009 [P] [US1] Unit test for ShellToolService non-zero exit code propagation in test/vitest/main/ShellToolService.test.ts
- [X] T010 [P] [US1] Unit test for input validation via zod schema (missing command, invalid shell enum, out-of-range timeout) in test/vitest/main/shellToolConfig.test.ts

### Implementation for User Story 1

- [X] T011 [US1] Register shell_execute in BUILT_IN_SKILLS array with tier "main", requiresConfirmation true, permissionCategory "shell", source "built-in", and execute handler wired to ShellToolService in src/config/skillsRegistry.ts
- [X] T012 [US1] Add shell-specific always-prompt permission policy in SkillPermissionService — shell category MUST always show prompt, no stored permission bypass in src/service/SkillPermissionService.ts
- [X] T013 [US1] Add shell command preview details (command text, cwd, shell type) to permission prompt payload in StreamEventProcessor for shell_execute tool calls in src/service/StreamEventProcessor.ts
- [X] T014 [US1] Add i18n translation keys for shell permission prompt (command preview, allow/deny labels, shell type label) to all 6 language files in src/views/lang/{en,zh,es,fr,de,ja}.ts
- [X] T015 [US1] Update AiChatBox.vue permission prompt component to display shell command preview when permissionCategory is "shell" in src/views/components/aiChat/AiChatBox.vue

**Checkpoint**: At this point, User Story 1 is fully functional — AI chat can execute commands with user consent and return results.

---

## Phase 4: User Story 2 — Protection from Destructive Commands (Priority: P2)

**Goal**: Destructive commands (rm -rf /, format, dd, fork bombs) are blocked before execution with clear explanations, regardless of user consent.

**Independent Test**: Attempt to run "rm -rf /" through AI chat, verify it is blocked with a safety policy message even if user tries to approve.

### Tests for User Story 2

- [X] T016 [P] [US2] Unit test for denylist block behavior — destructive commands (rm -rf /, format, dd, fork bombs, shutdown) are rejected without spawning in test/vitest/main/shellToolConfig.test.ts

### Implementation for User Story 2

- [X] T017 [US2] Add destructive command denylist regex patterns (filesystem destruction, format/partition, fork bomb, shutdown/reboot) to shellToolConfig.ts in src/config/shellToolConfig.ts
- [X] T018 [US2] Integrate denylist pre-check into ShellToolService.execute() — check command against denylist BEFORE cwd validation and process spawn, return structured error on match in src/service/ShellToolService.ts

**Checkpoint**: User Stories 1 AND 2 both work — commands execute safely, destructive ones are blocked.

---

## Phase 5: User Story 3 — Workspace-Restricted Command Execution (Priority: P3)

**Goal**: Commands with working directories outside allowed workspace roots are rejected. Default cwd falls back to workspace root.

**Independent Test**: Attempt to set cwd to "/etc" or "C:\Windows", verify rejection. Run command with no cwd, verify it defaults to workspace root.

### Tests for User Story 3

- [X] T019 [P] [US3] Unit test for cwd guard rejection — commands with out-of-root cwd are rejected, omitted cwd defaults to workspace root in test/vitest/main/ShellToolService.test.ts

### Implementation for User Story 3

- [X] T020 [US3] Integrate FilePathGuard into ShellToolService for cwd validation — resolve cwd against getDefaultWorkspaceRoots(), reject if outside, default to workspace root if omitted in src/service/ShellToolService.ts

**Checkpoint**: User Stories 1-3 all work — commands are safe, blocked if destructive, restricted to workspace.

---

## Phase 6: User Story 4 — Automatic Timeout on Long-Running Commands (Priority: P4)

**Goal**: Commands running beyond their timeout are terminated (full process tree), user receives timeout indication with partial output.

**Independent Test**: Run "sleep 120" with default timeout, verify it is killed at 60s with timed_out=true and partial output returned.

### Tests for User Story 4

- [X] T021 [P] [US4] Unit test for timeout behavior — command exceeding timeout is killed, result has timed_out=true and partial output captured in test/vitest/main/ShellToolService.test.ts

### Implementation for User Story 4

- [X] T022 [US4] Implement process-tree kill on timeout in ShellToolService — POSIX: process group kill, Windows: taskkill /T /F /PID; return partial stdout/stderr collected before timeout in src/service/ShellToolService.ts

**Checkpoint**: User Stories 1-4 all work — hung commands are safely terminated.

---

## Phase 7: User Story 5 — Cross-Platform Shell Support (Priority: P5)

**Goal**: Shell interpreter is auto-selected based on OS (Bash for Linux/macOS, PowerShell for Windows). User can override with explicit shell parameter.

**Independent Test**: Run "echo hello" on Linux, verify Bash is used. Override to "cmd", verify cmd.exe is used.

### Tests for User Story 5

- [X] T023 [P] [US5] Unit test for shell interpreter selection — verify auto selects Bash on POSIX (mock process.platform), PowerShell on Windows, and explicit override works in test/vitest/main/ShellToolService.test.ts

### Implementation for User Story 5

- [X] T024 [US5] Implement shell interpreter selection in ShellToolService — detect platform, select appropriate interpreter (bash/pwsh/powershell/cmd), handle Windows line-ending normalization (\r\n to \n) in src/service/ShellToolService.ts

**Checkpoint**: User Stories 1-5 all work — cross-platform execution is seamless.

---

## Phase 8: User Story 6 — Audit Trail for Shell Executions (Priority: P6)

**Goal**: Every shell execution is logged with redacted command text, metadata, and timestamps for security review.

**Independent Test**: Execute several commands, review audit log entries, verify all metadata is present and sensitive tokens are redacted.

### Tests for User Story 6

- [X] T025 [P] [US6] Unit test for ShellAuditLogger — verify redaction of API keys (sk-*, ghp-*, AKIA*), passwords, tokens, and credential URLs in command text in test/vitest/main/ShellAuditLogger.test.ts
- [X] T026 [P] [US6] Unit test for audit log creation — verify ShellAuditModel stores entry with all required fields (conversationId, toolCallId, commandRedacted, cwd, shell, success, exitCode, timedOut, durationMs) in test/vitest/main/ShellAuditLogger.test.ts

### Implementation for User Story 6

- [X] T027 [US6] Integrate ShellAuditLogger into shell_execute skill execute handler — after command completion (success, failure, or timeout), write audit entry with redacted command via ShellAuditLogger in src/config/skillsRegistry.ts
- [X] T028 [US6] Register ShellAudit entity in TypeORM configuration so the shell_audit table is created on next app initialization in src/config/SqliteDb.ts

**Checkpoint**: All 6 user stories are complete — full feature with audit trail.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final integration validation and hardening.

- [X] T029 [P] Integration test for full tool_call -> permission prompt -> grant -> execute -> tool_result -> stream continue flow in test/vitest/main/shell-integration.test.ts
- [X] T030 [P] Integration test for deny flow — user denies command, verify structured error returned and no process spawned in test/vitest/main/shell-integration.test.ts
- [X] T031 Add rate limiting for shell operations (max 2 concurrent, per-minute limit) in SkillExecutor dispatch for shell_execute in src/service/SkillExecutor.ts
- [X] T032 Verify existing built-in skills and MCP tools still work after shell skill integration — run existing test suites to confirm no regressions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **User Stories (Phases 3-8)**: All depend on Phase 2 completion
  - US1 (Phase 3) is the MVP — must be done first
  - US2-US5 (Phases 4-7) build on ShellToolService, can proceed in order
  - US6 (Phase 8) adds audit logging, depends on ShellAuditLogger from Phase 2
- **Polish (Phase 9)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 2 only — no other story dependencies
- **US2 (P2)**: Adds denylist to ShellToolService — builds on US1 registration
- **US3 (P3)**: Adds cwd guard to ShellToolService — builds on US1 registration
- **US4 (P4)**: Adds timeout kill to ShellToolService — builds on US1 registration
- **US5 (P5)**: Adds interpreter selection to ShellToolService — builds on US1 registration
- **US6 (P6)**: Integrates audit logger into ShellToolService — builds on Phase 2 audit infra

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Types before services, services before registration
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1**: T001 and T003 can run in parallel (different files)
- **Phase 2**: T005, T006, T007 can run in parallel (audit infra, independent of T004)
- **Within each US**: All test tasks marked [P] can run in parallel
- **US2-US5**: Phases 4-7 modify different aspects of ShellToolService but could be parallelized with careful coordination

---

## Parallel Example: Phase 2 (Foundational)

```text
# Launch audit infrastructure in parallel with core execution:
Task: "Implement ShellToolService in src/service/ShellToolService.ts"        # T004
Task: "Create ShellAudit entity in src/entity/ShellAudit.entity.ts"          # T005
Task: "Create ShellAuditModel in src/model/ShellAudit.model.ts"              # T006
Task: "Implement ShellAuditLogger in src/service/ShellAuditLogger.ts"        # T007
```

## Parallel Example: User Story 1 (MVP)

```text
# Launch all US1 tests in parallel:
Task: "Unit test ShellToolService success path"                              # T008
Task: "Unit test ShellToolService non-zero exit code"                        # T009
Task: "Unit test input validation via zod"                                   # T010

# Then sequential implementation:
Task: "Register shell_execute in skillsRegistry"                             # T011
Task: "Add shell permission policy in SkillPermissionService"                # T012
Task: "Add command preview in StreamEventProcessor"                          # T013
Task: "Add i18n keys to 6 language files"                                    # T014
Task: "Update AiChatBox.vue permission prompt"                               # T015
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (types + config)
2. Complete Phase 2: Foundational (ShellToolService + audit infra)
3. Complete Phase 3: User Story 1 (registration + permission + i18n + UI)
4. **STOP and VALIDATE**: Test US1 independently — can execute commands via AI chat
5. Ship MVP if ready

### Incremental Delivery

1. Setup + Foundational -> Foundation ready
2. Add US1 -> Test independently -> Ship MVP
3. Add US2 -> Test destructive command blocking -> Ship
4. Add US3 -> Test workspace restriction -> Ship
5. Add US4 -> Test timeout enforcement -> Ship
6. Add US5 -> Test cross-platform -> Ship
7. Add US6 -> Test audit trail -> Ship
8. Polish -> Integration tests + rate limiting -> Final ship

### Single Developer Strategy

Proceed sequentially through phases. The tasks are ordered so each builds on the last:
T001-T003 -> T004-T007 -> T008-T015 -> T016-T018 -> T019-T020 -> T021-T022 -> T023-T024 -> T025-T028 -> T029-T032

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing (TDD)
- Commit after each task or logical group per CLAUDE.md auto-commit rule
- Stop at any checkpoint to validate story independently
- All result/consent objects must be immutable (readonly) per project coding style
