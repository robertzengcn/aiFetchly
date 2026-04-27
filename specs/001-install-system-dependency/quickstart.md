# Quickstart: System Dependency Installation

**Feature Branch**: `001-install-system-dependency`

---

## Prerequisites

- Node.js and Yarn installed
- Electron development environment set up (see project README)
- macOS development (Phase 2 target platform)
- Homebrew installed (for testing install flow)

## Key Files to Understand

| File | Purpose |
|------|---------|
| `src/service/SkillDiagnosticsService.ts` | Current error classification — will be extended |
| `src/service/SkillExecutor.ts` | Skill execution wrapper — handles errors |
| `src/service/SkillEnvironmentManager.ts` | Python env management — probes system deps |
| `src/service/PythonRuntimeWorkerClient.ts` | Utility process management — PATH refresh target |
| `src/service/StreamEventProcessor.ts` | Chat stream integration — retry orchestration |
| `src/service/SkillPermissionService.ts` | Permission gating — pattern to follow |
| `src/config/dependency-catalog.json` | NEW — shipped catalog of known dependencies |

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Skill Execution Failure                                  │
│  (PythonRuntimeWorker returns stderr)                     │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  SkillDiagnosticsService (enhanced) │
│  Classifies error → dependency_id   │
└─────────────┬───────────────────────┘
              │ missing_system_tool
              ▼
┌─────────────────────────────────────┐
│  SystemDependencyResolver           │
│  Advisory lookup in local catalog   │
│  (no side effects)                  │
└─────────────┬───────────────────────┘
              │ recommendation
              ▼
┌─────────────────────────────────────┐
│  Chat UI (DependencyInstallDialog)  │
│  User sees reason + approve/deny    │
└──────┬──────────────┬───────────────┘
       │ approved     │ denied
       ▼              ▼
┌──────────────┐  ┌───────────────────┐
│ Installer    │  │ Audit: denied     │
│ (catalog-    │  │ Return to chat    │
│  validated)  │  └───────────────────┘
└──────┬───────┘
       │ success
       ▼
┌──────────────────────────────────────┐
│  PATH Refresh + Worker Restart       │
│  Re-probe binary + retry skill once  │
└──────────────────────────────────────┘
```

## Data Contracts (Summary)

### Resolve (advisory, no side effects)
- Input: stderr + manifest + platform
- Output: dependency_id + confidence + platform_candidates
- See: `contracts/resolve-system-dependency.md`

### Install (side-effect, validated)
- Input: dependency_id + reason + conversation_id + skill_name
- Output: install_status + should_retry flag
- See: `contracts/install-system-dependency.md`

### Audit (append-only)
- Every resolve, approve/deny, install attempt is logged
- See: `contracts/audit-log.md`

## Getting Started

### 1. Create the dependency catalog

```bash
# Create the catalog JSON
touch src/config/dependency-catalog.json
```

Initial entries: poppler, tesseract, ffmpeg, imagemagick, wkhtmltopdf

### 2. Define types

```bash
# Create type definitions
touch src/entityTypes/systemDependencyTypes.ts
```

Types needed: `DependencyCatalogEntry`, `PlatformCandidate`, `InstallResultStatus`, `ResolutionResult`, `InstallRequest`, `InstallResult`

### 3. Write tests first (TDD)

```bash
# Create test files
touch test/vitest/main/SystemDependencyCatalog.test.ts
touch test/vitest/main/SystemDependencyResolver.test.ts
touch test/vitest/main/SystemDependencyInstaller.test.ts
touch test/vitest/main/SystemDependencyAuditLogger.test.ts
```

### 4. Implement services

Order of implementation:
1. `SystemDependencyCatalog` — catalog loader + validator
2. `SkillDiagnosticsService` — extend with dependency_id detection
3. `SystemDependencyResolver` — advisory resolution
4. `SystemDependencyInstaller` — validated installation (macOS/brew first)
5. `SystemDependencyAuditLogger` — audit logging
6. `DependencyAudit.model.ts` — data access layer
7. `SystemDependencyModule` — business logic orchestration
8. `system-dependency-ipc.ts` — IPC handlers
9. `DependencyInstallDialog.vue` — chat UI component
10. i18n updates for all 6 languages

### 5. Integration test

```bash
# Test with a skill that requires pdfinfo
# 1. Ensure pdfinfo is NOT installed
# 2. Run a PDF skill → expect missing_system_tool diagnosis
# 3. Approve install → expect brew install poppler
# 4. Verify pdfinfo is available → expect automatic retry
```

## Testing Strategy

| Layer | Framework | Files |
|-------|-----------|-------|
| Types | Vitest | `test/vitest/utilitycode/systemDependencyTypes.test.ts` |
| Services (unit) | Vitest | `test/vitest/main/SystemDependency*.test.ts` |
| Module (unit) | Mocha | `test/modules/SystemDependencyModule.test.ts` |
| IPC (integration) | Vitest | `test/vitest/main/system-dependency-ipc.test.ts` |
| E2E | Playwright | Chat install flow |

## Platform Rollout

| Phase | Platform | Manager | Status |
|-------|----------|---------|--------|
| Phase 2 | macOS | Homebrew | **Target** |
| Phase 3 | Linux | apt | Future |
| Phase 3 | Windows | winget | Future |
