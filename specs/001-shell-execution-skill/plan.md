# Implementation Plan: Shell Execution Skill

**Branch**: `001-shell-execution-skill` | **Date**: 2026-04-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-shell-execution-skill/spec.md`

## Summary

Add a built-in `shell_execute` skill to aiFetchly that allows AI chat to execute local shell commands (Bash/PowerShell) with mandatory user consent, security controls (denylist, workspace-restricted cwd, timeout, output caps, environment scrubbing), and structured audit logging with sensitive token redaction. The implementation extends existing skill registry, permission, and execution patterns without modifying existing skill behavior.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: Electron (child_process.spawn), zod (input validation), TypeORM (audit entity)
**Storage**: SQLite via TypeORM (shell audit log entity)
**Testing**: Vitest (unit), Mocha (integration), manual E2E via AI chat
**Target Platform**: Linux, macOS, Windows (Electron desktop app)
**Project Type**: Electron desktop app (main process + Vue 3 renderer)
**Performance Goals**: Skill orchestration overhead under 100ms (excluding command runtime)
**Constraints**: No third-party process libraries, no interactive stdin, no persistent global grants
**Scale/Scope**: Single-user desktop app, one command at a time, max 2 concurrent

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file contains placeholder templates only (no ratified principles). No gates to evaluate — proceeding with project-level rules from CLAUDE.md:

- **Three-Layer Architecture**: Audit entity → Model → Service → IPC handler. Confirmed compliance.
- **Worker Process Rules**: Shell execution runs in main process (not a worker). No database access concerns.
- **Testing Requirements**: 80%+ coverage, TDD workflow. Planned.
- **Security Guidelines**: Input validation, secret redaction, permission prompts. Core to this feature.
- **Immutability**: All result/consent objects are readonly. Planned.

**Post-Design Re-check**: All design artifacts comply with project architecture rules. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-shell-execution-skill/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: entity definitions
├── quickstart.md        # Phase 1: implementation guide
├── contracts/
│   └── shell-execute-contract.md  # Phase 1: API contract
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
src/
├── config/
│   ├── shellToolConfig.ts         # NEW: denylist patterns, output caps, timeout defaults, env allowlist
│   └── skillsRegistry.ts          # MODIFY: add shell_execute to BUILT_IN_SKILLS
├── entity/
│   └── ShellAudit.entity.ts      # NEW: TypeORM audit log entity
├── entityTypes/
│   ├── skillTypes.ts              # MODIFY: add "shell" to SkillPermissionCategory
│   └── shellTypes.ts              # NEW: ShellExecutionRequest, ShellExecutionResult interfaces
├── model/
│   └── ShellAudit.model.ts       # NEW: data access for audit logs
├── service/
│   ├── ShellToolService.ts        # NEW: core execution engine (spawn, timeout, guards, scrubbing)
│   ├── ShellAuditLogger.ts        # NEW: audit logging with redaction
│   ├── SkillExecutor.ts           # MODIFY: add shell-specific permission policy
│   ├── SkillPermissionService.ts  # MODIFY: shell category always-prompt behavior
│   └── StreamEventProcessor.ts    # MODIFY: shell permission prompt details (command preview)
└── views/
    ├── components/aiChat/
    │   └── AiChatBox.vue          # MODIFY: shell permission prompt wording
    └── lang/
        └── {en,zh,es,fr,de,ja}.ts # MODIFY: add i18n keys for shell permission prompts

test/
├── modules/
│   ├── ShellToolService.test.ts   # NEW: unit tests for execution engine
│   ├── ShellAuditLogger.test.ts   # NEW: unit tests for audit + redaction
│   └── shellToolConfig.test.ts    # NEW: unit tests for denylist and validation
└── vitest/
    └── main/
        └── shell-integration.test.ts  # NEW: integration test (tool_call → permission → result)
```

**Structure Decision**: Following the existing aiFetchly three-layer architecture. New files in `service/` (ShellToolService, ShellAuditLogger), `model/` (ShellAudit.model), `entity/` (ShellAudit.entity), `config/` (shellToolConfig), and `entityTypes/` (shellTypes). Modifications to existing files are minimal — adding to existing arrays/types.

## Implementation Tasks

### Task 1: Add shell types and permission category
- Create `src/entityTypes/shellTypes.ts` with interfaces and zod schemas
- Add `"shell"` to `SkillPermissionCategory` in `src/entityTypes/skillTypes.ts`
- **Estimated files**: 2 (1 new, 1 modify)

### Task 2: Create shell tool configuration
- Create `src/config/shellToolConfig.ts` with denylist patterns, output caps, timeout defaults, env allowlist, rate limits
- **Estimated files**: 1 (new)

### Task 3: Build ShellToolService
- Create `src/service/ShellToolService.ts` with:
  - Input validation via zod
  - Denylist pre-check
  - CWD validation via FilePathGuard
  - Shell interpreter selection (cross-platform)
  - Spawn execution with timeout and process-tree kill
  - Output collection with size caps and truncation flags
  - Environment scrubbing (allowlist approach)
  - Structured error responses
- **Estimated files**: 1 (new)

### Task 4: Create audit logging
- Create `src/entity/ShellAudit.entity.ts` (TypeORM entity extending AuditableEntity)
- Create `src/model/ShellAudit.model.ts` (data access extending BaseDb)
- Create `src/service/ShellAuditLogger.ts` (redaction + structured logging)
- **Estimated files**: 3 (new)

### Task 5: Register shell_execute skill
- Add skill definition to `BUILT_IN_SKILLS` in `src/config/skillsRegistry.ts`
- Wire execute handler to ShellToolService
- **Estimated files**: 1 (modify)

### Task 6: Permission integration
- Update `SkillPermissionService` for shell-specific always-prompt policy
- Update `StreamEventProcessor` to include command preview in shell permission prompts
- Update `AiChatBox.vue` for shell permission prompt display
- Add i18n keys to all 6 language files
- **Estimated files**: ~9 (modify)

### Task 7: Write tests
- Unit tests: ShellToolService, ShellAuditLogger, shellToolConfig, denylist patterns
- Integration test: full tool_call → permission → execute → result flow
- **Estimated files**: 4 (new)

## Dependencies Between Tasks

```
Task 1 (types) → Task 2 (config) → Task 3 (ShellToolService) → Task 5 (register)
Task 4 (audit) is independent of Tasks 2-3, needed by Task 5
Task 6 (permissions) depends on Task 1
Task 7 (tests) depends on Tasks 1-6
```

Parallel execution opportunity: Tasks 2+4 can run in parallel after Task 1.
