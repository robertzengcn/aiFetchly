# Tasks: AI Skills System

**Input**: Design documents from `/specs/001-skill-system/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Tests are included per project CLAUDE.md testing requirements (80% coverage, TDD workflow).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create type definitions and project scaffolding needed by all user stories.

- [X] T001 [P] Create skill type definitions in `src/entityTypes/skillTypes.ts` - define SkillDefinition, SkillTier, SkillPermissionCategory, SkillExecutionContext, SkillManifest interfaces per data-model.md
- [X] T002 [P] Add isolated-vm and adm-zip to project dependencies via `yarn add isolated-vm adm-zip`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core registry and executor infrastructure that MUST be complete before ANY user story can be implemented.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Create static skill registry in `src/config/skillsRegistry.ts` - implement Map-based registry with getAllToolFunctions(), getSkill(), isRegistered(), registerSkill(), unregisterSkill(). Merge MCP tools via MCPToolService.getEnabledMCPToolsAsFunctions() per research.md Decision 7
- [X] T004 Create SkillExecutor service in `src/service/SkillExecutor.ts` - implement execute(name, args, context) that wraps existing ToolExecutor per research.md Decision 8. Include tier dispatching (renderer/main), registry validation, error handling that returns structured ToolExecutionResult instead of throwing
- [X] T005 Wire SkillExecutor into StreamEventProcessor in `src/service/StreamEventProcessor.ts` - modify handleToolCallEvent() to: (1) validate tool name via registry, (2) delegate to SkillExecutor.execute(), (3) call streamContinueWithToolResults() with result per research.md Decision 2

**Checkpoint**: Foundation ready - tool_call events flow through registry to executor to streamContinue. User story implementation can now begin.

---

## Phase 3: User Story 1 - AI Invokes Built-in Skill During Chat (Priority: P1) - MVP

**Goal**: User asks AI to search Google; AI calls tool, executes it, returns results in the same conversation.

**Independent Test**: Send a message triggering a tool call, verify the tool executes and AI incorporates the result.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T006 [P] [US1] Create registry unit tests in `test/vitest/utilitycode/skillsRegistry.test.ts` - test getAllToolFunctions() returns correct shape, getSkill() finds and misses, isRegistered() works, registerSkill/unregisterSkill add and remove
- [X] T007 [P] [US1] Create executor unit tests in `test/vitest/utilitycode/skillExecutor.test.ts` - test execute() returns ToolExecutionResult for valid skill, returns error result for unknown skill, handles ToolExecutor exceptions gracefully

### Implementation for User Story 1

- [X] T008 [US1] Migrate 2-3 built-in tools (scrape_urls_from_google, scrape_urls_from_bing, extract_emails_from_urls) from `src/config/aiTools.config.ts` into registry entries in `src/config/skillsRegistry.ts` - create SkillDefinition objects with tier='main', permissionCategory='network', source='built-in'
- [X] T009 [US1] Verify end-to-end tool-call loop - run the app, start AI chat, ask to search Google, confirm tool executes and result appears in conversation. Verify MCP tools still work unchanged (FR-019, SC-008)
- [X] T010 [US1] Migrate all remaining built-in tools from `src/config/aiTools.config.ts` into registry entries in `src/config/skillsRegistry.ts` - scrape_urls_from_yandex, scrape_urls_from_baidu, search_yellow_pages, get_available_yellow_pages_platforms, analyze_website, analyze_website_batch, analyze_websites, read_url_content, generate_keywords, extract_contact_info

**Checkpoint**: All 12 built-in tools work through the registry. AI can invoke any tool during chat and receive results. MCP tools unchanged.

---

## Phase 4: User Story 2 - Unified Skill Registry Powers AI Tool Discovery (Priority: P1)

**Goal**: All available skills are discoverable through a single registry. AI receives accurate tool list when chat starts.

**Independent Test**: Verify registry enumerates all built-in tools and MCP tools appear alongside them.

### Implementation for User Story 2

- [X] T011 [US2] Implement registry tool aggregation with MCP in `src/config/skillsRegistry.ts` - ensure getAllToolFunctions() merges static built-in skills with MCPToolService.getEnabledMCPToolsAsFunctions() results, deduplicates by name, and returns ToolFunction[] for the AI
- [X] T012 [US2] Update AI chat IPC handler to use registry - replace direct getAvailableToolFunctions() call with SkillRegistry.getAllToolFunctions() so the AI always gets the unified tool list
- [X] T013 [US2] Verify tool discovery - start AI chat, check that all 12 built-in tools plus enabled MCP tools appear in the tool list. Test with MCP enabled and disabled (FR-019, SC-008)

**Checkpoint**: All user stories 1 AND 2 work independently. Unified registry is the single source of truth for tool discovery.

---

## Phase 5: User Story 3 - Skill Execution Isolation and Permissions (Priority: P2)

**Goal**: User-authored skills run in sandboxed isolation. Permission prompts protect sensitive operations.

**Independent Test**: Import a user-authored skill, verify it cannot access filesystem/process, confirm permission prompts appear for high-risk operations.

### Tests for User Story 3

- [X] T014 [P] [US3] Create permission service tests in `test/modules/skillPermissionService.test.ts` - test grant/deny/check lifecycle, test Token service persistence, test per-domain network permissions, test permission revocation
- [X] T015 [P] [US3] Create sandbox executor tests in `test/modules/sandboxedSkillExecutor.test.ts` - test sandbox blocks process/fs/require/electron access, test memory limit enforcement, test timeout enforcement, test explicit API grants work

### Implementation for User Story 3

- [X] T016 [P] [US3] Create SkillPermissionService in `src/service/SkillPermissionService.ts` - implement checkPermission(name), grantPermission(name, persistent), denyPermission(name), revokePermission(name), checkNetworkDomain(name, domain). Use Token service with keys per data-model.md PermissionGrant entity
- [X] T017 [P] [US3] Add permission categories to all registry entries in `src/config/skillsRegistry.ts` - categorize each built-in tool: search tools as 'network', email extraction as 'automation', website analysis as 'network', yellow pages as 'network', keyword generation as 'pure'
- [X] T018 [US3] Integrate permission checks into SkillExecutor in `src/service/SkillExecutor.ts` - before executing non-pure skills: check stored permission, if unknown trigger CHECK_SKILL_PERMISSION IPC to renderer for user prompt, if granted execute, if denied return error result (FR-007 thru FR-012)
- [X] T019 [US3] Create SkillApprovalCard component in `src/views/components/aiChat/SkillApprovalCard.vue` - inline chat card with skill name, permission request details, and three buttons: "Allow Once", "Always Allow", "Deny". Emits result to parent (FR-020)
- [X] T020 [US3] Wire SkillApprovalCard into AiChatBox in `src/views/components/aiChat/AiChatBox.vue` - when SkillExecutor needs runtime permission, show the approval card inline in the chat, await user response, then continue or deny execution
- [X] T021 [US3] Add CHECK_SKILL_PERMISSION IPC handler in `src/main-process/communication/skills-ipc.ts` - handle permission check requests from renderer, use SkillPermissionService for lookup, return granted/persistent response. Check AI enable first per CLAUDE.md rules
- [X] T022 [US3] Add EXECUTE_SKILL IPC channel in `src/preload.ts` - expose invokeSkill via contextBridge for renderer-to-main skill execution
- [X] T023 [US3] Create SandboxedSkillExecutor in `src/service/SandboxedSkillExecutor.ts` - implement isolated-vm sandbox with 64MB memory limit, 30s timeout, explicit API grants (proxied fetch, log, args). Block process/fs/require/electron access (FR-005, FR-006)
- [X] T024 [US3] Add audit logging to SkillExecutor in `src/service/SkillExecutor.ts` - log every execution with tool name, sanitized args (strip tokens/cookies/passwords per FR-024), success/failure, duration
- [X] T025 [US3] Add input sanitization to SkillExecutor in `src/service/SkillExecutor.ts` - validate args against skill parameter schema, reject arguments containing token/cookie/password patterns, return structured error for invalid input (FR-003, FR-024)

**Checkpoint**: Pure skills auto-execute; high-risk skills prompt for approval; sandboxed skills isolated; all executions logged.

---

## Phase 6: User Story 4 - Import and Manage External Skills (Priority: P2)

**Goal**: Users import skill packages from zip files; skills persist across restarts and work immediately.

**Independent Test**: Create a valid skill zip, import via UI, verify it appears in list, confirm AI can invoke it.

### Tests for User Story 4

- [X] T026 [P] [US4] Create import service tests in `test/vitest/utilitycode/skillImportService.test.ts` - test valid zip import, invalid manifest rejection, missing required fields, duplicate name rejection, corrupted zip handling, atomic cleanup on failure

### Implementation for User Story 4

- [X] T027 [P] [US4] Create InstalledSkill TypeORM entity in `src/entity/InstalledSkill.entity.ts` - columns per data-model.md: id, name, version, source, manifest_json, permissions_json, enabled, installed_at, updated_at
- [X] T028 [P] [US4] Create InstalledSkill model in `src/model/InstalledSkill.model.ts` - extend BaseDb, implement findAll(), findByName(), create(), update(), remove() data access methods
- [X] T029 [US4] Create SkillManagementModule in `src/modules/SkillManagementModule.ts` - extend BaseModule, implement importSkill(zipPath), listInstalledSkills(), toggleSkill(name, enabled), uninstallSkill(name). Use InstalledSkill model for DB access per CLAUDE.md three-layer architecture
- [X] T030 [US4] Create SkillImportService in `src/service/SkillImportService.ts` - implement importFromZip(zipPath): extract with adm-zip to userData/installed_skills/name/, validate manifest (required fields, semver, unique name, runtime='javascript', valid JSON Schema), store in SQLite via SkillManagementModule. Atomic: clean up on validation failure (FR-013, FR-014)
- [X] T031 [US4] Create skills IPC handlers in `src/main-process/communication/skills-ipc.ts` - add IMPORT_SKILL, LIST_INSTALLED_SKILLS, TOGGLE_SKILL, UNINSTALL_SKILL handlers. All check AI enable first. Use SkillManagementModule for business logic (FR-016)
- [X] T032 [US4] Register skill IPC channels in `src/preload.ts` - add importSkill, listInstalledSkills, toggleSkill, uninstallSkill to contextBridge
- [X] T033 [US4] Register skills IPC handlers in `src/background.ts` - import and register handlers from skills-ipc.ts
- [X] T034 [US4] Implement hot registration in `src/config/skillsRegistry.ts` - after successful import, call registerSkill() to make the imported skill immediately available without restart. Load persisted skills on app startup from InstalledSkill table (FR-017)
- [X] T035 [US4] Add InstalledSkill table migration - ensure yarn init creates the installed_skills table. Update entity registration in SqliteDb config if needed

**Checkpoint**: Users can import .zip skill packages; skills persist across restarts; available immediately after import.

---

## Phase 7: User Story 5 - Skills Management Page (Priority: P3)

**Goal**: Dedicated UI page for browsing, enabling/disabling, importing, and managing all skills.

**Independent Test**: Navigate to Skills page, verify all skills listed, perform enable/disable/import actions.

### Implementation for User Story 5

- [X] T036 [P] [US5] Create Skills management page in `src/views/pages/systemsetting/skills.vue` - Vue 3 + Vuetify page with: skill list table (name, source, status, category), skill detail drawer, import button with file dialog, enable/disable toggle, uninstall button, MCP tools tab. Follow existing system settings page patterns
- [X] T037 [P] [US5] Add i18n translations for Skills page in all 6 language files: `src/views/lang/en.ts`, `src/views/lang/zh.ts`, `src/views/lang/es.ts`, `src/views/lang/fr.ts`, `src/views/lang/de.ts`, `src/views/lang/ja.ts` - add skills section with keys for: page title, column headers, button labels, status text, permission labels, import dialog text, error messages
- [X] T038 [US5] Add Skills page route and navigation in route/menu config - add route to skills.vue, add menu item in settings navigation following existing pattern

**Checkpoint**: All user stories independently functional. Full skill system: execute, discover, sandbox, import, manage.

---

## Phase 8: Polish and Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories.

- [X] T039 [P] Run TypeScript type check via `yarn tsc` - fix any type errors introduced by new files
- [X] T040 [P] Verify all existing tests pass - ensure no regressions from migration
- [X] T041 [P] Security review of sandbox boundaries - verify isolated-vm blocks all filesystem/process/electron access, verify input sanitization catches common attack patterns
- [X] T042 Run quickstart.md validation - follow quickstart steps end-to-end, verify all phases work as documented

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001, T002) - BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational (T003-T005) - MVP core loop
- **US2 (Phase 4)**: Depends on US1 (T008) - needs registry entries to verify enumeration
- **US3 (Phase 5)**: Depends on Foundational - integrates with US1 executor
- **US4 (Phase 6)**: Depends on US3 (T016, T023) - needs permission service and sandbox
- **US5 (Phase 7)**: Depends on US4 (T027-T031) - needs IPC handlers and data model
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### Within Each User Story

- Tests written FIRST and must FAIL before implementation
- Types before services
- Services before IPC handlers
- Core implementation before UI integration
- Story complete before moving to next priority

### Parallel Opportunities

- T001 + T002: Both setup tasks, different files
- T006 + T007: Both US1 tests, different test files
- T014 + T015 + T016 + T017: All US3 can run in parallel (different files)
- T019 + T020: Sequential (component before integration)
- T021 + T022: Can run in parallel (IPC handler + preload)
- T027 + T028: Can run in parallel (entity + model, different files)
- T036 + T037: Can run in parallel (page + translations, different files)

---

## Implementation Strategy

### MVP First (User Stories 1 and 2 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T005)
3. Complete Phase 3: User Story 1 (T006-T010)
4. Complete Phase 4: User Story 2 (T011-T013)
5. **STOP and VALIDATE**: Test full tool-call loop with all built-in tools
6. Deploy/demo if ready - this delivers immediate value

### Incremental Delivery

1. Setup + Foundational (T001-T005) = Foundation ready
2. US1 (T006-T010) = Working tool calls, MVP!
3. US2 (T011-T013) = Unified discovery
4. US3 (T014-T025) = Permissions and sandboxing
5. US4 (T026-T035) = Import and persistence
6. US5 (T036-T038) = Management UI
7. Polish (T039-T042) = Final validation

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD per CLAUDE.md)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All IPC handlers must check AI enable first per CLAUDE.md rules
- All UI text must have translations in all 6 language files per CLAUDE.md rules
- No any types, no dynamic imports, no direct DB access in IPC handlers per CLAUDE.md rules
