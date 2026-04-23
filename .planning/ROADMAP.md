# Roadmap: Shell Execution Skill

**Created:** 2026-04-23
**Granularity:** Coarse (3 phases)
**Execution:** Parallel where possible

## Phase Overview

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 1 | Core Execution and Safety | 3 | Pending |
| 2 | Permission and Consent Integration | 2 | Pending |
| 3 | Audit Logging and Observability | 2 | Pending |

---

## Phase 1: Core Execution and Safety

**Goal:** Implement the ShellToolService with spawn-based execution, register the skill, and ensure safe end-to-end command execution.

**Depends on:** None (existing skill system is foundation)

**Requirements covered:** REG-01, REG-02, REG-03, EXE-01, EXE-02, EXE-03, EXE-04, EXE-05, EXE-06, SAFE-01, SAFE-02, SEC-01, SEC-02, SEC-03, SEC-04, COMP-01, COMP-02, COMP-03, COMP-04

### Plan 1.1: ShellToolService Core

**What:** Create `src/service/ShellToolService.ts` and `src/config/shellToolConfig.ts`

- Spawn-based execution with `shell: false` and explicit interpreter
- Cross-platform interpreter selection (bash/PowerShell/cmd)
- Timeout enforcement with process-tree kill
- Output size caps with truncation
- stdin set to "ignore"
- Structured error output

**Key files:**
- `src/service/ShellToolService.ts` (new)
- `src/config/shellToolConfig.ts` (new) — defaults, denylist, size limits, env scrub list
- Reuse patterns from `src/service/FileToolService.ts` and `src/config/fileToolConfig.ts`

### Plan 1.2: Security Controls and Workspace Guard

**What:** Implement command denylist, environment scrubbing, and workspace CWD validation

- Command denylist pre-check for destructive patterns
- Environment variable scrubbing (remove secrets, LD_PRELOAD, etc.)
- CWD validation using FilePathGuard pattern
- Reject commands outside workspace roots

**Key files:**
- `src/service/ShellToolService.ts` (extend)
- `src/config/shellToolConfig.ts` (extend denylist and env scrub config)
- `src/service/FilePathGuard.ts` (reuse for CWD validation)

### Plan 1.3: Skill Registration and End-to-End Verification

**What:** Register `shell_execute` in the skills registry and verify end-to-end execution through SkillExecutor

- Register skill in `src/config/skillsRegistry.ts` with JSON Schema
- Wire execute function to ShellToolService
- Verify SkillExecutor can run and return shell result
- Ensure existing skills and MCP tools continue working

**Key files:**
- `src/config/skillsRegistry.ts` (modify — add shell_execute)
- `src/service/SkillExecutor.ts` (no changes needed — routes to registered skill)
- `src/entityTypes/skillTypes.ts` (modify — add shell-related types)

**Success criteria:**
- AI can request `shell_execute` with a command
- Command runs through spawn with proper interpreter
- Result includes stdout, stderr, exit_code, duration_ms
- Timeout kills the process tree
- Destructive commands are blocked
- CWD is validated against workspace roots
- Existing skills are unaffected

---

## Phase 2: Permission and Consent Integration

**Goal:** Add the `shell` permission category with mandatory per-command consent flow integrated into the existing permission prompt pipeline.

**Depends on:** Phase 1

**Requirements covered:** PERM-01, PERM-02, PERM-03, PERM-04, PERM-05

### Plan 2.1: Shell Permission Category

**What:** Add `shell` permission category to skillTypes and SkillPermissionService

- Add `shell` to SkillPermissionCategory union type
- Implement shell-specific consent policy in SkillPermissionService
- Always require prompt (no auto-allow)
- v1 supports allow_once and deny only

**Key files:**
- `src/entityTypes/skillTypes.ts` (modify)
- `src/service/SkillPermissionService.ts` (modify — shell-specific behavior)

### Plan 2.2: Permission Prompt UX

**What:** Update the permission prompt UI to show command details for shell category

- Show exact command string in prompt
- Show working directory in prompt
- Integrate with existing needsPermissionPrompt flow in StreamEventProcessor
- Ensure chat UI renders shell permission prompt correctly

**Key files:**
- `src/views/components/aiChat/AiChatBox.vue` (modify — shell prompt wording if needed)
- `src/service/StreamEventProcessor.ts` (verify integration)

**Success criteria:**
- User sees permission prompt with exact command before execution
- allow_once executes the command once
- deny returns structured error to AI
- No persistent global grant available in v1
- Prompt displays command and working directory

---

## Phase 3: Audit Logging and Observability

**Goal:** Add shell-specific audit logging with command redaction and execution metadata.

**Depends on:** Phase 1 (can run in parallel with Phase 2)

**Requirements covered:** AUD-01, AUD-02

### Plan 3.1: Shell Audit Schema and Redaction

**What:** Implement structured shell audit logging with sensitive data redaction

- Define shell audit log fields: tool, command_redacted, cwd, shell, success, exit_code, timed_out, duration_ms, timestamp
- Implement command text redaction (remove tokens, passwords, API keys)
- Use regex patterns to detect and redact sensitive values

**Key files:**
- `src/service/ShellToolService.ts` (extend — add audit logging)
- `src/config/shellToolConfig.ts` (extend — redaction patterns)

### Plan 3.2: Audit Integration and Failure Analytics

**What:** Wire audit logging into the skill execution flow and track failure metrics

- Audit log writes are non-blocking (do not delay command result)
- Track failure categories: timeout rate, denylist blocks, user-denied rate
- Console log format consistent with existing `[SkillAudit]` pattern

**Key files:**
- `src/service/ShellToolService.ts` (extend)
- `src/service/SkillExecutor.ts` (verify audit integration)

**Success criteria:**
- Every shell execution is logged with redacted command
- Logs include all required metadata fields
- Secrets/tokens are redacted before persistence
- Audit logging does not block command execution path
- Existing skill audit behavior is preserved

---

## Optional / v2

### Phase 4: Streaming Output UX (Deferred)

- Add incremental stdout/stderr streaming through chat events
- Improve long-running command visibility with partial output chunks
- Would require changes to aiChat.ts streaming contract

---
*Roadmap created: 2026-04-23*
*Last updated: 2026-04-23 after initial creation*
