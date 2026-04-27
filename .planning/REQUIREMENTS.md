# Requirements: Shell Execution Skill

**Defined:** 2026-04-23
**Core Value:** Users can safely ask AI to run local commands with strong security controls

## v1 Requirements

Requirements for the shell_execute built-in skill. Each maps to roadmap phases.

### Skill Registration

- [ ] **REG-01**: Register `shell_execute` in `src/config/skillsRegistry.ts` with tier "main", requiresConfirmation true, permissionCategory "shell", source "built-in"
- [ ] **REG-02**: Define JSON Schema parameters: command (string, required), cwd (string, optional), shell (enum: auto|bash|powershell|cmd, default auto), timeout_ms (number, default 60000, max 600000)
- [ ] **REG-03**: Define output schema: success, exit_code, stdout, stderr, duration_ms, stdout_truncated, stderr_truncated, timed_out

### Shell Execution Service

- [ ] **EXE-01**: Create `src/service/ShellToolService.ts` with spawn-based command execution (never exec)
- [ ] **EXE-02**: Use `spawn` with `shell: false` and explicit interpreter selection (bash on Linux/macOS, PowerShell on Windows, cmd as fallback)
- [ ] **EXE-03**: Implement cross-platform interpreter selection: `/bin/bash -lc <command>` (Linux/macOS), `powershell.exe -NoProfile -NonInteractive -Command <command>` (Windows), `cmd.exe /d /s /c <command>` (explicit fallback)
- [ ] **EXE-04**: Set stdin to "ignore" to prevent hangs on interactive prompts (sudo, read, etc.)
- [ ] **EXE-05**: Enforce timeout with full process-tree kill on expiry (default 60s, hard max 10 min)
- [ ] **EXE-06**: Implement output size caps with truncation and explicit truncation flags in result

### Workspace Safety

- [ ] **SAFE-01**: Validate `cwd` resolves under allowed workspace roots using existing FilePathGuard pattern
- [ ] **SAFE-02**: Reject execution when `cwd` escapes allowed workspace roots

### Permission and Consent

- [ ] **PERM-01**: Add `shell` permission category to `src/entityTypes/skillTypes.ts`
- [ ] **PERM-02**: Implement consent policy: always require explicit prompt before command execution
- [ ] **PERM-03**: Permission prompt must show exact command string and working directory
- [ ] **PERM-04**: v1 supports `allow_once` and `deny` only (no persistent global grant)
- [ ] **PERM-05**: Integrate with existing `needsPermissionPrompt` pipeline in StreamEventProcessor

### Security Controls

- [ ] **SEC-01**: Implement command denylist pre-check for clearly destructive patterns (rm -rf /, dd, mkfs, format, etc.)
- [ ] **SEC-02**: Implement environment scrubbing before spawn (remove secret vars, LD_PRELOAD, DYLD_INSERT_LIBRARIES, etc.)
- [ ] **SEC-03**: Return structured error output (never throw raw crashes back to AI stream)
- [ ] **SEC-04**: No interactive stdin (prevents hangs on sudo, read, etc.)

### Audit Logging

- [ ] **AUD-01**: Extend existing skill audit behavior for shell execution with minimum fields: tool, command_redacted, cwd, shell, success, exit_code, timed_out, duration_ms, timestamp
- [ ] **AUD-02**: Implement sensitive token redaction in command text before log persistence

### Compatibility

- [ ] **COMP-01**: SkillExecutor remains dispatcher/orchestrator (no architectural changes)
- [ ] **COMP-02**: No changes to SkillEnvironmentManager.ts (Python-skill-only)
- [ ] **COMP-03**: No changes to aiChat.ts streaming for v1
- [ ] **COMP-04**: Existing built-in skills and MCP tools continue to operate unchanged

## Out of Scope

| Feature | Reason |
|---------|--------|
| Interactive terminal sessions (stdin) | Prevents hangs on sudo/read prompts; v1 is fire-and-forget |
| Background job orchestration UI | Significant complexity without core value |
| Persistent global "allow all shell" | Security risk; v1 requires per-command consent |
| Python skill venv integration | Shell skill runs system commands, not Python |
| Live stdout/stderr streaming to chat | Deferred to optional Phase 4 |
| Separate bash_execute/powershell_execute aliases | Single tool with shell override is simpler |
| Network-domain prompts for curl/wget | v1 scope; can add in v2 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REG-01 | Phase 1 | Pending |
| REG-02 | Phase 1 | Pending |
| REG-03 | Phase 1 | Pending |
| EXE-01 | Phase 1 | Pending |
| EXE-02 | Phase 1 | Pending |
| EXE-03 | Phase 1 | Pending |
| EXE-04 | Phase 1 | Pending |
| EXE-05 | Phase 1 | Pending |
| EXE-06 | Phase 1 | Pending |
| SAFE-01 | Phase 1 | Pending |
| SAFE-02 | Phase 1 | Pending |
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SEC-03 | Phase 1 | Pending |
| SEC-04 | Phase 1 | Pending |
| COMP-01 | Phase 1 | Pending |
| COMP-02 | Phase 1 | Pending |
| COMP-03 | Phase 1 | Pending |
| COMP-04 | Phase 1 | Pending |
| PERM-01 | Phase 2 | Pending |
| PERM-02 | Phase 2 | Pending |
| PERM-03 | Phase 2 | Pending |
| PERM-04 | Phase 2 | Pending |
| PERM-05 | Phase 2 | Pending |
| AUD-01 | Phase 3 | Pending |
| AUD-02 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-04-23*
*Last updated: 2026-04-23 after initial definition*
