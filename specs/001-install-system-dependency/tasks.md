# Tasks: System Dependency Installation for Python Skills

**Input**: Design documents from `/specs/001-install-system-dependency/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/
**Tests**: TDD is required per project CLAUDE.md (80%+ coverage). Tests are written first.
**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, etc.)
- File paths are exact

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Types, catalog data, and entity needed by all user stories

- [x] T001 Create shared type definitions in `src/entityTypes/systemDependencyTypes.ts` (DependencyCatalogEntry, PlatformCandidate, InstallResultStatus, ResolutionResult, InstallRequest, InstallResult, ResolveSystemDependencyInput, ResolveSystemDependencyOutput, InstallSystemDependencyRequest, InstallSystemDependencyResponse, InstallResultData, GetAuditLogRequest, GetAuditLogResponse, AuditLogEntry)
- [x] T002 [P] Create dependency catalog JSON with initial entries (poppler, tesseract, ffmpeg, imagemagick, wkhtmltopdf) in `src/config/dependency-catalog.json`
- [x] T003 [P] Create TypeORM entity for audit log in `src/entity/DependencyInstallAudit.ts` (id, conversation_id, skill_name, dependency_id, missing_binary, suggested_by_ai, user_decision, installer_backend, package_name, execution_status, execution_duration_ms, stderr_sanitized, created_at with 3 indexes)

**Checkpoint**: Types, catalog, and entity ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core services that MUST complete before ANY user story

### Tests (Write First - Must FAIL)

- [x] T004 [P] Write unit tests for SystemDependencyCatalog in `test/vitest/main/SystemDependencyCatalog.test.ts` (load catalog, validate entries, lookup by dependency_id, lookup by probe, platform candidate retrieval, missing returns undefined)
- [x] T005 [P] Write unit tests for stderr sanitization in `test/vitest/main/SystemDependencyAuditLogger.test.ts` (removes paths, home dir refs, truncates 500 chars, removes ANSI, removes secrets)
- [x] T006 [P] Write unit tests for DependencyAudit model in `test/modules/DependencyAudit.model.test.ts` (create entry, query by conversation_id, query by dependency_id, pagination)

### Implementation

- [x] T007 Implement SystemDependencyCatalog in `src/service/SystemDependencyCatalog.ts` (load JSON, validate schema, lookup by dependency_id, lookup by probe, get platform candidate)
- [x] T008 Implement DependencyAudit model in `src/model/DependencyAudit.model.ts` (extends BaseDb, createAuditEntry, getByConversationId, getByDependencyId, getPaginated)
- [x] T009 Implement SystemDependencyAuditLogger in `src/service/SystemDependencyAuditLogger.ts` (stderr sanitization, creates entries via model)

**Checkpoint**: Foundation ready. User story work can begin.

---

## Phase 3: User Story 1 - Diagnose Missing System Dependency (P1) MVP

**Goal**: Detect missing OS-level binary failures and return structured diagnostic data (dependency_id, missing_binary, reason) with backward-compatible text.

**Independent Test**: Run skill requiring missing pdfinfo, verify error includes missing_binary, dependency_id, reason. Unrecognized errors preserve text output.

**Covers**: FR-001, FR-002, FR-003

### Tests (Write First - Must FAIL)

- [x] T010 [US1] Write tests for enhanced SkillDiagnosticsService in `test/vitest/main/SkillDiagnosticsService.test.ts` (PDFInfoNotInstalledError → poppler/pdfinfo; TesseractNotFoundError → tesseract; ffmpeg not found → ffmpeg; unknown → no dependency_id; backward compat preserved)
- [x] T011 [US1] Write tests for SystemDependencyResolver in `test/vitest/main/SystemDependencyResolver.test.ts` (known stderr + manifest → resolved true + confidence >0.9; ambiguous → resolved false; no manifest → reduced confidence; not in catalog → resolved false)

### Implementation

- [x] T012 [US1] Enhance SkillDiagnosticsService in `src/service/SkillDiagnosticsService.ts` — extend SkillDiagnoseResult with optional dependency_id/missing_binary; add pattern matchers for PDFInfoNotInstalledError, TesseractNotFoundError, ffmpeg; cross-reference manifest python.system[]
- [x] T013 [US1] Implement SystemDependencyResolver in `src/service/SystemDependencyResolver.ts` — advisory resolver: takes ResolveSystemDependencyInput, calls diagnoseStderr, cross-references catalog, returns confidence-scored ResolveSystemDependencyOutput (exact 0.95, pattern 0.7, none 0)

**Checkpoint**: US1 complete. Diagnosis detects missing deps, returns structured data, preserves backward compat.

---

## Phase 4: User Story 2 - Advisory Dependency Resolution (P2)

**Goal**: Provide structured recommendation to chat (dependency_id, confidence, reason, platform candidates) without executing installs. Flag low-confidence for manual review.

**Independent Test**: Known failure → confidence >0.9 with platform candidates. Ambiguous failure → manual review flagged.

**Covers**: FR-004, FR-005, FR-016

### Tests (Write First - Must FAIL)

- [x] T014 [US2] Write tests for SystemDependencyModule.resolve() in `test/modules/SystemDependencyModule.test.ts` (known → recommendation with candidates; low confidence → manual_review true; unknown → not-resolved)

### Implementation

- [x] T015 [US2] Implement SystemDependencyModule in `src/modules/SystemDependencyModule.ts` — extends BaseModule; resolve() method calls resolver, applies 0.8 threshold, flags manual review, returns recommendation
- [x] T016 [US2] Add SYSTEM_DEPENDENCY_RESOLVE IPC handler in `src/main-process/communication/system-dependency-ipc.ts`
- [x] T017 [US2] Add renderer API in `src/views/api/systemDependency.ts` — expose resolveSystemDependency()
- [x] T018 [US2] Expose IPC channels in `src/preload.ts` — add SYSTEM_DEPENDENCY_RESOLVE, SYSTEM_DEPENDENCY_INSTALL, SYSTEM_DEPENDENCY_GET_AUDIT_LOG

**Checkpoint**: US2 complete. Resolver returns recommendations without side effects.

---

## Phase 5: User Story 3 - User-Approved Dependency Installation (P3)

**Goal**: User approves/denies install in chat. Approved: validated against catalog, executed via fixed template. Denied: no changes. Unknown dependency_id: blocked.

**Independent Test**: Approve poppler → binary available. Deny → no changes. Non-catalog id → blocked.

**Covers**: FR-006, FR-007, FR-008, FR-009, FR-015

### Tests (Write First - Must FAIL)

- [x] T019 [P] [US3] Write tests for SystemDependencyInstaller in `test/vitest/main/SystemDependencyInstaller.test.ts` (brew success → installed; already installed; brew not found → installer_not_found; unsupported platform; install failure; catalog validation blocks unknown)
- [x] T020 [P] [US3] Write tests for PATH refresh in `test/vitest/main/SystemDependencyInstaller.test.ts` (refreshPath from login shell; probeBinary after refresh; missing binary returns false)

### Implementation

- [x] T021 [US3] Implement SystemDependencyInstaller in `src/service/SystemDependencyInstaller.ts` — validate against catalog, probe binary, check manager, execute fixed template per platform (brew/apt/winget), handle exit codes, post-probe, PATH refresh via login shell, utility process restart
- [x] T022 [US3] Add install() to SystemDependencyModule in `src/modules/SystemDependencyModule.ts` — validate request, call installer, log audit, return InstallResultData with should_retry
- [x] T023 [US3] Add SYSTEM_DEPENDENCY_INSTALL IPC handler in `src/main-process/communication/system-dependency-ipc.ts`
- [x] T024 [US3] Add installSystemDependency() to renderer API in `src/views/api/systemDependency.ts`
- [x] T025 [US3] Create DependencyInstallDialog.vue in `src/views/components/DependencyInstallDialog.vue` — shows dep name, reason, command, approve/deny buttons
- [x] T026 [US3] Add i18n translations in all 6 lang files (`src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`) — dialog title, dep name, reason, approve/deny, status messages

**Checkpoint**: US3 complete. Users approve/deny installs. Only catalog-validated fixed commands execute.

---

## Phase 6: User Story 4 - Retry and Verification After Install (P4)

**Goal**: After successful install, re-probe binary, refresh PATH, restart utility process, retry failed skill exactly once. Result visible in chat.

**Independent Test**: Install poppler → probe succeeds → skill retries automatically. path_issue case handled.

**Covers**: FR-010, FR-011, FR-012

### Tests (Write First - Must FAIL)

- [x] T027 [US4] Write integration tests for retry flow in `test/vitest/main/SystemDependencyRetry.test.ts` (install success → should_retry true → re-execute; path_issue → no retry; install failure → no retry)

### Implementation

- [x] T028 [US4] Implement retry in StreamEventProcessor in `src/service/StreamEventProcessor.ts` + `src/service/SystemDependencyRetryService.ts` — catch missing_system_tool, trigger resolve, on approved install + should_retry re-invoke SkillExecutor with original args, display result in chat
- [x] T029 [US4] Implement PATH refresh + worker restart in SystemDependencyInstaller in `src/service/SystemDependencyInstaller.ts` — spawn login shell, update process.env.PATH, call PythonRuntimeWorkerClient.dispose()
- [x] T030 [US4] Integrate retry result in chat — emit retry result as tool result message replacing original failure

**Checkpoint**: US4 complete. Full self-healing loop: detect → resolve → approve → install → probe → retry.

---

## Phase 7: User Story 5 - Audit Trail for Install Actions (P5)

**Goal**: All actions logged in structured audit trail. Failed stderr sanitized.

**Independent Test**: Perform install → verify log entry with all fields. Verify stderr sanitized. Query by conversation_id.

**Covers**: FR-013, FR-014

### Implementation

- [x] T031 [US5] Add audit logging to resolve() in `src/modules/SystemDependencyModule.ts`
- [x] T032 [US5] Add audit logging to install() in `src/modules/SystemDependencyModule.ts` — log user_decision, execution_status, duration, stderr_sanitized
- [x] T033 [US5] Add SYSTEM_DEPENDENCY_GET_AUDIT_LOG IPC handler in `src/main-process/communication/system-dependency-ipc.ts` with pagination
- [x] T034 [US5] Add getAuditLog() to renderer API in `src/views/api/systemDependency.ts`

**Checkpoint**: US5 complete. All actions produce structured, sanitized audit entries.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T035 [P] Run all tests, verify 80%+ coverage across new files — 55 tests passing across 6 files
- [x] T036 [P] Security review — no free-form commands, catalog validation on every path, stderr sanitized, no secrets leaked — Fixed C-1 (shell injection), H-1 (catalog validation), H-2 (IPC input validation), H-3 (PATH validation), M-2 (pagination cap)
- [ ] T037 Run quickstart.md validation — end-to-end test with skill requiring pdfinfo on macOS (requires macOS environment)
- [x] T038 [P] Code cleanup — no `any` types, explicit return types, files under 400 lines (largest: 292 lines)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundation)**: Depends on Phase 1 — BLOCKS all stories
- **US1 (Phase 3)**: Depends on Phase 2
- **US2 (Phase 4)**: Depends on US1 (enhanced diagnostics)
- **US3 (Phase 5)**: Depends on US2 (module + resolver)
- **US4 (Phase 6)**: Depends on US3 (installer)
- **US5 (Phase 7)**: Depends on US3 — can parallel US4
- **Polish (Phase 8)**: Depends on all stories

### Within Each User Story

1. Tests FIRST (must FAIL)
2. Services before modules
3. Modules before IPC handlers
4. IPC handlers before renderer API
5. Renderer API before Vue components

### Parallel Opportunities

**Phase 1**: T002 || T003
**Phase 2**: T004 || T005 || T006 (tests), T007 || T008 || T009 (impl)
**Phase 5 US3**: T019 || T020 (tests)
**Phases 6+7**: US4 || US5 after US3 completes

---

## Implementation Strategy

### MVP (US1 Only)

1. Phase 1 Setup (T001-T003)
2. Phase 2 Foundation (T004-T009)
3. Phase 3 US1 (T010-T013)
4. **STOP** — validate diagnosis independently

### Incremental Delivery

1. Setup + Foundation → ready
2. +US1 → diagnosis works (MVP)
3. +US2 → advisory resolution works
4. +US3 → install with approve/deny works
5. +US4 + US5 (parallel) → retry + audit
6. Polish → feature complete

### Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 Setup | 3 | Types, catalog, entity |
| 2 Foundation | 6 | Tests + services |
| 3 US1 (P1) | 4 | Diagnosis |
| 4 US2 (P2) | 5 | Advisory resolution |
| 5 US3 (P3) | 8 | Install + UI + i18n |
| 6 US4 (P4) | 4 | Retry + PATH refresh |
| 7 US5 (P5) | 4 | Audit logging |
| 8 Polish | 4 | Coverage, security, cleanup |
| **Total** | **38** | |
