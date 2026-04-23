# Quickstart: Shell Execution Skill

**Feature**: 001-shell-execution-skill

## Prerequisites

- Existing aiFetchly development environment
- Understanding of the skill registry pattern (`src/config/skillsRegistry.ts`)
- Familiarity with `FilePathGuard` for workspace path validation

## Key Files to Understand First

| File | Purpose |
|------|---------|
| `src/config/skillsRegistry.ts` | Skill registration pattern and BUILT_IN_SKILLS array |
| `src/service/SkillExecutor.ts` | Skill execution dispatcher and validation flow |
| `src/service/SkillPermissionService.ts` | Permission prompt generation and consent management |
| `src/service/FilePathGuard.ts` | Workspace path validation |
| `src/entityTypes/skillTypes.ts` | Permission categories and skill types |
| `src/service/StreamEventProcessor.ts` | Tool call event handling and permission flow |

## Implementation Order

### Step 1: Add Types and Permission Category
- Add `"shell"` to `SkillPermissionCategory` union in `src/entityTypes/skillTypes.ts`
- Define `ShellExecutionRequest`, `ShellExecutionResult` interfaces
- Add zod validation schemas

### Step 2: Create ShellToolConfig
- Create `src/config/shellToolConfig.ts`
- Define denylist patterns, output caps, timeout defaults, env allowlist
- Keep all configuration in one file for easy auditing

### Step 3: Build ShellToolService
- Create `src/service/ShellToolService.ts`
- Implement: input validation, denylist check, cwd validation via FilePathGuard
- Implement: spawn execution with timeout, output collection, process-tree kill
- Implement: environment scrubbing and structured error responses

### Step 4: Create ShellAuditLogger
- Create `src/entity/ShellAudit.entity.ts` (TypeORM entity)
- Create `src/model/ShellAudit.model.ts` (data access)
- Create `src/service/ShellAuditLogger.ts` (logging service with redaction)

### Step 5: Register Skill
- Add `shell_execute` to `BUILT_IN_SKILLS` in `src/config/skillsRegistry.ts`
- Wire up execute handler to `ShellToolService`
- Set `tier: "main"`, `requiresConfirmation: true`, `permissionCategory: "shell"`

### Step 6: Permission Integration
- Update `SkillPermissionService` with shell-specific consent policy
- Ensure shell category always requires prompt (no persistent grant)
- Verify permission prompt shows command preview in UI

### Step 7: Testing
- Unit tests for ShellToolService (all execution paths)
- Unit tests for denylist and cwd guard
- Integration test for full tool_call → permission → execute → result flow

## Verification Checklist

- [ ] `shell_execute` appears in skill registry
- [ ] Permission prompt shows exact command and cwd before execution
- [ ] Destructive commands are blocked
- [ ] Workspace-escaping cwd is rejected
- [ ] Timeout terminates process tree
- [ ] Output truncation works with flags
- [ ] Audit logs are written with redacted commands
- [ ] Existing skills continue working
