# Implementation Plan: System Dependency Installation for Python Skills

**Branch**: `001-install-system-dependency` | **Date**: 2026-04-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-install-system-dependency/spec.md`

## Summary

Add a safe, user-approved self-healing flow for Python skills that require OS-level binaries. When a skill fails due to a missing system dependency (e.g., `pdfinfo`, `tesseract`, `ffmpeg`), the system detects the failure via enhanced diagnostics, resolves the dependency through a local catalog (never from AI free-form output), presents an install recommendation to the user in chat, and upon approval executes a fixed command template. After successful install, the system re-probes the binary, refreshes the runtime PATH if needed, and retries the failed skill exactly once. All actions are audit-logged.

The approach uses a **two-tool pattern**: `resolve_system_dependency` (advisory, no side effects) and `install_system_dependency` (side-effect, validated against local catalog). This separates trust boundaries — the AI server can suggest, but the desktop client validates and executes.

## Technical Context

**Language/Version**: TypeScript 5.x (Electron main process + Vue 3 renderer)
**Primary Dependencies**: Electron utility process API, `child_process.spawnSync`/`spawn`, existing `SkillDiagnosticsService`, `SkillExecutor`, `SkillPermissionService`, `StreamEventProcessor`
**Storage**: SQLite via TypeORM (audit log entity), JSON file (local dependency catalog shipped with app)
**Testing**: Vitest (main process unit tests), Mocha (module tests), Playwright (E2E)
**Target Platform**: macOS first (Homebrew), Linux (apt) and Windows (winget) in subsequent phases
**Project Type**: Electron desktop application (main process + renderer)
**Performance Goals**: Dependency resolution <2s (catalog lookup), install command execution within package manager timeline
**Constraints**: No free-form command execution from AI output (FR-008), mandatory user confirmation (FR-006), single retry after install (FR-010)
**Scale/Scope**: ~5 catalog entries initially (poppler, tesseract, ffmpeg, imagemagick, wkhtmltopdf), 1 new service + 2 enhanced services + 1 new IPC channel + Vue chat UI components

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file is a placeholder template with no ratified principles. No gates to evaluate. Proceeding with CLAUDE.md project-level constraints:

| Principle | Status | Notes |
|-----------|--------|-------|
| Three-layer DB architecture (Model/Module/IPC) | PASS | Audit log uses new Model class, Module for business logic, IPC handler for communication only |
| Worker processes must not access DB directly | PASS | All install and audit operations run in main process |
| TypeScript strict typing (no `any`) | PASS | All new types defined explicitly |
| i18n for all user-facing text | PASS | Install confirmation UI must support all 6 languages |
| AI enable check before AI function IPC | PASS | This feature is triggered by skill execution failure, not AI directly |
| TDD mandatory (80%+ coverage) | PASS | Unit tests for diagnostics, catalog, installer; integration tests for flow |

## Project Structure

### Documentation (this feature)

```text
specs/001-install-system-dependency/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── resolve-system-dependency.md
│   ├── install-system-dependency.md
│   └── audit-log.md
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created by this command)
```

### Source Code (repository root)

```text
src/
├── service/
│   ├── SkillDiagnosticsService.ts          # ENHANCED: add structured dependency_id detection
│   ├── SystemDependencyCatalog.ts          # NEW: local catalog loader + validator
│   ├── SystemDependencyResolver.ts         # NEW: advisory resolver (no side effects)
│   ├── SystemDependencyInstaller.ts        # NEW: validated installer with fixed templates
│   └── SystemDependencyAuditLogger.ts      # NEW: audit logging service
├── entity/
│   └── DependencyInstallAudit.ts           # NEW: TypeORM entity for audit records
├── entityTypes/
│   └── systemDependencyTypes.ts            # NEW: typed interfaces for all data contracts
├── model/
│   └── DependencyAudit.model.ts            # NEW: data access for audit records
├── modules/
│   └── SystemDependencyModule.ts           # NEW: business logic orchestrator
├── main-process/communication/
│   └── system-dependency-ipc.ts            # NEW: IPC handlers for resolve + install + audit
├── config/
│   └── dependency-catalog.json             # NEW: shipped catalog of known dependencies
├── views/
│   ├── components/
│   │   └── DependencyInstallDialog.vue     # NEW: approve/deny UI in chat
│   ├── lang/
│   │   ├── en.ts                           # MODIFIED: add install dependency translations
│   │   ├── zh.ts                           # MODIFIED
│   │   ├── es.ts                           # MODIFIED
│   │   ├── fr.ts                           # MODIFIED
│   │   ├── de.ts                           # MODIFIED
│   │   └── ja.ts                           # MODIFIED
│   └── api/
│       └── systemDependency.ts             # NEW: renderer API for dependency IPC
└── preload.ts                              # MODIFIED: expose new IPC channels

test/
├── vitest/main/
│   ├── SystemDependencyCatalog.test.ts
│   ├── SystemDependencyResolver.test.ts
│   ├── SystemDependencyInstaller.test.ts
│   └── SystemDependencyAuditLogger.test.ts
├── modules/
│   └── SystemDependencyModule.test.ts
└── vitest/utilitycode/
    └── systemDependencyTypes.test.ts
```

**Structure Decision**: Follows existing aiFetchly three-layer architecture. New services in `src/service/`, types in `src/entityTypes/`, entity in `src/entity/`, model in `src/model/`, module in `src/modules/`, IPC in `src/main-process/communication/`. The dependency catalog is a static JSON config file in `src/config/`.

## Complexity Tracking

> No constitution violations to justify.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
