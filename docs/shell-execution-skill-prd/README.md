# PRD: Shell Execution Skill (Bash/PowerShell)

**Version:** 1.0  
**Date:** 2026-04-23  
**Status:** Draft  
**Owner:** aiFetchly Core Team

---

## 1. Background and Problem

aiFetchly already supports built-in skills, MCP tools, and user skill execution with permission prompts.  
Users now want AI chat to run local commands such as:

- "list files in this folder"
- "run npm test"
- "check git status"

Current gaps:

1. There is no first-class shell command skill in the built-in skill registry.
2. Existing permission categories do not distinguish shell execution risk.
3. No dedicated service exists for hardened shell command execution (timeouts, output limits, env scrubbing, kill-tree behavior).

---

## 2. Product Goal

Enable AI chat to execute user-requested local shell commands safely through a built-in skill, with clear user consent and strong security controls.

### 2.1 Primary Goal

Provide a reliable and secure `shell_execute` built-in skill that supports:

- Bash on Linux/macOS
- PowerShell on Windows
- Optional shell override (`auto`, `bash`, `powershell`, `cmd`)

### 2.2 Non-Goals (v1)

- No full interactive terminal session (stdin remains disabled)
- No background job orchestration UI
- No persistent unrestricted "always allow all shell commands" mode
- No changes to Python skill virtual environment management

---

## 3. Scope

### In Scope

- Add one built-in skill: `shell_execute`
- Add `ShellToolService` for execution and safety controls
- Add new permission category: `shell`
- Integrate with existing `SkillExecutor` and permission prompt flow
- Add structured shell audit logging

### Out of Scope

- Modifying `src/service/SkillEnvironmentManager.ts` logic for shell execution
- Reworking renderer-side chat API contracts unless incremental stdout streaming is added in a later phase

---

## 4. User Stories

1. **As a user**, I can ask AI to run a local command and get stdout/stderr + exit code.
2. **As a user**, I see a permission prompt with the exact command before execution.
3. **As a user**, destructive commands are blocked with a clear explanation.
4. **As a developer**, I can trace every shell execution via audit logs.
5. **As a security-conscious user**, I am protected from hidden command execution and secret leakage.

---

## 5. Functional Requirements

## FR-1: New Built-In Skill Registration

Register `shell_execute` in `src/config/skillsRegistry.ts` with:

- `name`: `shell_execute`
- `tier`: `main`
- `requiresConfirmation`: `true`
- `permissionCategory`: `shell`
- `source`: `built-in`

### Required Input Schema

- `command` (string, required)
- `cwd` (string, optional; workspace-contained path)
- `shell` (enum: `auto|bash|powershell|cmd`, default `auto`)
- `timeout_ms` (number, default 60000, max 600000)

### Output Schema (tool result payload)

- `success` (boolean)
- `exit_code` (number | null)
- `stdout` (string, truncated if needed)
- `stderr` (string, truncated if needed)
- `duration_ms` (number)
- `stdout_truncated` (boolean)
- `stderr_truncated` (boolean)
- `timed_out` (boolean)

---

## FR-2: Shell Execution Service

Create `src/service/ShellToolService.ts` for command execution.

### Execution Rules

1. Use `spawn` (never `exec` for arbitrary command text).
2. Keep Node spawn option `shell: false`.
3. Explicit interpreter selection:
   - Linux/macOS: `/bin/bash -lc <command>`
   - Windows: `powershell.exe -NoProfile -NonInteractive -Command <command>`
   - `cmd.exe /d /s /c <command>` only when explicitly requested or when fallback is required.
4. Use non-interactive stdio (`stdin: ignore`, stdout/stderr piped).
5. Enforce timeout and terminate full process tree on timeout.

---

## FR-3: Workspace-Safe CWD

`cwd` must resolve under allowed workspace roots.

Implementation requirement:

- Reuse existing path-guard pattern (`FilePathGuard` and current workspace root strategy).
- Reject execution when `cwd` escapes allowed roots.

---

## FR-4: Permission and Consent

Add new skill permission category in `src/entityTypes/skillTypes.ts`:

- `shell`

### Consent Policy for `shell`

1. Always require explicit prompt before command execution.
2. Prompt must show exact command string and working directory.
3. v1 should not allow permanent global grant for all future shell commands.
4. Support at least:
   - `allow_once`
   - `deny`
   - optional session grant (non-persistent) if product UX approves

Integrate with existing `needsPermissionPrompt` pipeline used by `StreamEventProcessor` and chat UI.

---

## FR-5: Security Controls

`ShellToolService` must enforce:

1. **Command denylist pre-check** for clearly destructive patterns
2. **Timeout enforcement** (default 60s, hard max 10m)
3. **Output size caps** (truncate stdout/stderr with explicit truncation flags)
4. **Environment scrubbing** before spawn (remove common secret vars and risky inherited values)
5. **No interactive stdin** to prevent hangs on prompts (`sudo`, `read`, etc.)
6. **Structured error output** (never throw raw crashes back to AI stream)

---

## FR-6: Audit Logging

Extend existing skill audit behavior for shell execution.

Minimum shell audit fields:

- `tool`: `shell_execute`
- `command_redacted`
- `cwd`
- `shell`
- `success`
- `exit_code`
- `timed_out`
- `duration_ms`
- `timestamp`

Sensitive tokens in command text must be redacted in logs.

---

## FR-7: Compatibility with Existing Flow

1. `SkillExecutor.ts` remains dispatcher/orchestrator.
2. `aiChat.ts` remains unchanged for v1 unless live output streaming is added.
3. `SkillEnvironmentManager.ts` remains Python-skill-only and is not used for shell skill runtime.

---

## 6. Non-Functional Requirements

### NFR-1 Security

- No unrestricted shell execution without prompt.
- No access outside workspace via `cwd`.
- Secrets must not be persisted in logs.

### NFR-2 Reliability

- Command result always returns structured response (success/failure).
- Timeout path must be deterministic and safe.

### NFR-3 Performance

- Shell skill orchestration overhead (excluding command runtime) should be under 100ms.
- Audit log write should not block command execution path.

---

## 7. API Contract (Skill Tool Function)

```json
{
  "name": "shell_execute",
  "description": "Execute a local shell command with explicit user confirmation and safety controls.",
  "parameters": {
    "type": "object",
    "properties": {
      "command": { "type": "string", "description": "Command text to execute." },
      "cwd": { "type": "string", "description": "Optional working directory under workspace roots." },
      "shell": {
        "type": "string",
        "enum": ["auto", "bash", "powershell", "cmd"],
        "default": "auto"
      },
      "timeout_ms": {
        "type": "number",
        "default": 60000
      }
    },
    "required": ["command"]
  }
}
```

---

## 8. Suggested File Changes

### New Files

- `src/service/ShellToolService.ts`
- `src/config/shellToolConfig.ts`

### Modified Files

- `src/config/skillsRegistry.ts` (add built-in `shell_execute`)
- `src/entityTypes/skillTypes.ts` (add `shell` permission category)
- `src/service/SkillPermissionService.ts` (shell-specific consent policy behavior)
- `src/views/components/aiChat/AiChatBox.vue` (permission prompt wording for shell category, if required)

### Explicitly No Change in v1

- `src/service/SkillEnvironmentManager.ts`
- `src/views/api/aiChat.ts` (unless optional live shell output streaming is approved later)

---

## 9. Milestones

## Phase 1: Core Skill and Safe Execution

- Implement `ShellToolService` with spawn-based execution, timeout, output cap, and cwd guard.
- Register `shell_execute` in skills registry.
- Verify `SkillExecutor` can run and return shell result end-to-end.

## Phase 2: Permission and UX Hardening

- Add `shell` permission category.
- Ensure explicit command preview in permission prompt.
- Implement no-persistent-global-grant behavior for shell category.

## Phase 3: Audit and Observability

- Add shell-focused audit log schema and redaction.
- Add failure analytics (timeout rate, denylist blocks, user-denied rate).

## Phase 4 (Optional): Streaming Output UX

- Add incremental stdout/stderr streaming through chat events.
- Improve long-running command visibility with partial output chunks.

---

## 10. Acceptance Criteria

1. AI can execute a user-requested shell command through `shell_execute`.
2. User receives explicit prompt containing command and cwd before execution.
3. Commands outside workspace via `cwd` are rejected safely.
4. Timeout and output truncation behave as specified.
5. Shell logs are redacted and include execution metadata.
6. Existing built-in skills and MCP tools continue to operate unchanged.

---

## 11. Risks and Mitigations

1. **Risk:** Dangerous command execution  
   **Mitigation:** Denylist + mandatory prompt + workspace cwd guard

2. **Risk:** Secret leakage in logs  
   **Mitigation:** Command redaction before audit persistence

3. **Risk:** Hung commands  
   **Mitigation:** Hard timeout + process-tree kill

4. **Risk:** Cross-platform shell differences  
   **Mitigation:** Controlled interpreter selection and shell override parameter

---

## 12. Open Questions

1. Should shell permission support session-scoped "allow all shell commands in this session"?
2. Should network-related shell commands (`curl`, `wget`, `Invoke-WebRequest`) require additional network-domain prompts?
3. Do we want to ship v1 with `shell_execute` only, or also alias tools (`bash_execute`, `powershell_execute`) for explicitness?
4. Should shell audit logs be persisted only in app logs, or also in a searchable local table?

---

## 13. Final Recommendation

Ship a single `shell_execute` built-in skill first, backed by a hardened `ShellToolService`, and treat shell execution as a dedicated permission category (`shell`) with strict consent defaults. This gives users the capability they want while preserving trust and safety in the AI command execution loop.

