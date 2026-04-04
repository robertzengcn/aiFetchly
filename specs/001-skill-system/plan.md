# Implementation Plan: AI Skills System

**Branch**: 001-skill-system | **Date**: 2026-04-03 | **Spec**: spec.md
**Input**: Feature specification from /specs/001-skill-system/spec.md

## Summary

Build a unified AI Skills System that enables the AI chat to execute built-in, user-authored, and marketplace-sourced capabilities during conversations. The core technical approach is a static TypeScript skill registry that wraps the existing ToolExecutor, a SkillExecutor service that validates/permission-checks/dispatches skill calls through the existing SSE streaming infrastructure, and a phased rollout from core execution loop through permissions to marketplace import.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: Electron, Vue 3, Vuetify, Pinia, TypeORM, better-sqlite3, Puppeteer
**Storage**: SQLite (TypeORM) for installed skills; Token service for permission grants
**Testing**: Mocha (modules), Vitest (main process/utility), Vue test utils
**Target Platform**: Electron desktop application (Windows/macOS/Linux)
**Project Type**: Electron desktop app (renderer + main process + child processes)
**Performance Goals**: Tool-call round-trip < 2s (built-in), registry enumeration < 10ms
**Constraints**: No dynamic imports, no any types, immutable patterns, < 400 lines per skill file
**Scale/Scope**: 12 existing built-in tools to migrate, ~5 new files, ~7 files to modify

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution is a template (not yet filled with specific principles). Checking against CLAUDE.md rules:

| Gate | Status | Notes |
|------|--------|-------|
| No any types | PASS | All interfaces use Record<string, unknown> with type guards |
| No dynamic imports | PASS | Static registry with compile-time registration |
| File size < 400 lines | PASS | Each skill file < 400 lines; registry < 200 lines |
| Three-layer DB architecture | PASS | Model/Module/IPC pattern followed for all DB operations |
| Child processes in src/childprocess/ | N/A | No new child processes in this feature |
| i18n for all UI text | PASS | Will update all 6 language files for new UI |
| AI enable check in IPC handlers | PASS | All skill IPC handlers check USER_AI_ENABLED first |
| Worker processes no direct DB | N/A | No worker processes in this feature |

**Post-Phase 1 re-check**: All design artifacts maintain compliance. No violations.

## Project Structure

### Documentation (this feature)

specs/001-skill-system/
  plan.md              # This file
  research.md          # Phase 0: Technical decisions and rationale
  data-model.md        # Phase 1: Entity definitions and state transitions
  quickstart.md        # Phase 1: Developer onboarding guide
  contracts/           # Phase 1: API and IPC contracts
    registry-contracts.md
  tasks.md             # Phase 2: Task breakdown (via /speckit.tasks)

### Source Code (repository root)

src/
  config/
    skillsRegistry.ts           # NEW: Static skill registry
  service/
    SkillExecutor.ts            # NEW: Validates, dispatches, returns results
    SkillPermissionService.ts   # NEW (Phase 2): Permission checks and storage
    SkillImportService.ts       # NEW (Phase 3): Zip import and manifest validation
    ToolExecutor.ts             # MODIFY: Wrapped by SkillExecutor
    StreamEventProcessor.ts     # MODIFY: Integrate SkillExecutor in tool_call handler
  main-process/
    communication/
      skills-ipc.ts           # NEW (Phase 3): IPC for main-process skills and import
  entity/
    InstalledSkill.ts           # NEW (Phase 3): TypeORM entity
  model/
    InstalledSkill.model.ts     # NEW (Phase 3): Data access layer
  modules/
    SkillManagementModule.ts    # NEW (Phase 3): Business logic for skill CRUD
  entityTypes/
    skillTypes.ts               # NEW: Type definitions for skill system
  views/
    components/
      aiChat/
        SkillApprovalCard.vue   # NEW (Phase 2): Inline permission prompt
    pages/
      systemsetting/
        skills.vue              # NEW (Phase 3): Skills management page
  preload.ts                    # MODIFY: Add skill IPC channels
  background.ts                 # MODIFY: Register skills IPC handlers

test/
  modules/
    skillExecutor.test.ts       # NEW: Mocha tests for executor
  vitest/
    main/
      skills-ipc.test.ts        # NEW: Vitest tests for IPC handlers
    utilitycode/
      skillsRegistry.test.ts    # NEW: Vitest tests for registry

**Structure Decision**: Follows the existing Electron + Vue 3 architecture. New files placed in their conventional directories. No new directory structures needed.

## Complexity Tracking

No violations to justify.

## Phased Implementation

### Phase 1: Core Execution Loop (P0)

**Goal**: AI can invoke any built-in skill during chat and receive results.

| Step | Deliverable | Files |
|------|-------------|-------|
| 1.1 | Create skill type definitions | src/entityTypes/skillTypes.ts |
| 1.2 | Create static skill registry with 2-3 migrated tools | src/config/skillsRegistry.ts |
| 1.3 | Create SkillExecutor that wraps ToolExecutor | src/service/SkillExecutor.ts |
| 1.4 | Wire tool_call handler to use SkillExecutor | src/service/StreamEventProcessor.ts |
| 1.5 | End-to-end verification | Manual test |
| 1.6 | Migrate all remaining built-in tools | src/config/aiTools.config.ts to registry |
| 1.7 | Unit tests for registry and executor | test/ |

**Exit Criteria**: AI calls any built-in tool during chat; result appears in conversation; MCP tools unchanged.

### Phase 2: Permissions and Security (P1)

**Goal**: User-authored skills run safely; permissions protect sensitive operations.

| Step | Deliverable | Files |
|------|-------------|-------|
| 2.1 | Permission service with Token storage | src/service/SkillPermissionService.ts |
| 2.2 | Add permission categories to registry entries | src/config/skillsRegistry.ts |
| 2.3 | Confirmation prompts for high-risk skills | SkillApprovalCard.vue, IPC handler |
| 2.4 | Integrate permission checks into SkillExecutor | src/service/SkillExecutor.ts |
| 2.5 | Audit logging for all executions | src/service/SkillExecutor.ts |
| 2.6 | Sandboxed executor with isolated-vm | src/service/SandboxedSkillExecutor.ts |
| 2.7 | Tests for permissions and sandboxing | test/ |

**Exit Criteria**: Pure skills auto-execute; high-risk skills require approval; sandboxed skills cannot access filesystem/process; all executions logged.

### Phase 3: Import and Management UI (P2)

**Goal**: Users can import, manage, and use external skill packages.

| Step | Deliverable | Files |
|------|-------------|-------|
| 3.1 | InstalledSkill entity and SQLite migration | src/entity/InstalledSkill.ts |
| 3.2 | Data access model | src/model/InstalledSkill.model.ts |
| 3.3 | Business logic module | src/modules/SkillManagementModule.ts |
| 3.4 | Skill import service (zip + validation) | src/service/SkillImportService.ts |
| 3.5 | Skills IPC handlers | src/main-process/communication/skills-ipc.ts |
| 3.6 | Preload and background registration | src/preload.ts, src/background.ts |
| 3.7 | Skills management page | src/views/pages/systemsetting/skills.vue |
| 3.8 | Navigation integration | Menu/route config |
| 3.9 | i18n translations | All 6 language files |
| 3.10 | Hot registration for imported skills | Registry dynamic additions |
| 3.11 | Tests for import and management | test/ |

**Exit Criteria**: Users import .zip skill packages through UI; skills appear in chat; can enable/disable/uninstall.

## Dependencies Between Phases

Phase 1 (Core Loop) is the foundation.
Phase 2 (Permissions) builds on the registry and executor from Phase 1.
Phase 3 (Import and UI) builds on permissions and executor from Phase 2.

Each phase is independently deployable. Phase 1 delivers immediate value (working tool calls). Phase 2 adds security. Phase 3 adds extensibility.
