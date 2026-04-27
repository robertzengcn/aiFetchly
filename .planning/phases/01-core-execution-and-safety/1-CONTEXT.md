# Phase 1: Core Execution and Safety - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement ShellToolService with spawn-based execution, register `shell_execute` in the skills registry, and ensure safe end-to-end command execution with workspace safety, command denylist, and environment scrubbing.

**Covers:** REG-01, REG-02, REG-03, EXE-01 through EXE-06, SAFE-01, SAFE-02, SEC-01 through SEC-04, COMP-01 through COMP-04

**Does NOT cover:** Permission consent UI/flow (Phase 2), audit logging (Phase 3), streaming output (deferred Phase 4)

</domain>

<decisions>
## Implementation Decisions

### Command Denylist
- **D-01:** Moderate scope — block safety-critical commands (rm -rf /, mkfs, dd of=/dev) PLUS privilege escalation (sudo, su, chmod 777) PLUS pipe-to-shell (curl|sh, wget|sh, eval with shell expansion)
- **D-02:** Hybrid matching — raw string pattern matching for compound patterns (e.g., `rm -rf /`) combined with first-token matching for command names (e.g., `sudo`, `mkfs`)
- **D-03:** Denylist runs BEFORE user consent prompt — blocked commands never reach the user for approval

### Output Handling
- **D-04:** 1 MB per stream (stdout and stderr each) — matches FileToolService maxReadBytes
- **D-05:** When output exceeds cap, truncate and set `stdout_truncated: true` or `stderr_truncated: true`
- **D-06:** On timeout, return partial stdout/stderr collected so far with `timed_out: true` — user sees progress
- **D-07:** `success` field is exit-code-based: exit_code 0 = true, anything else = false

### Environment Scrubbing
- **D-08:** Pattern-based scrub — remove env vars matching known secret patterns: `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `GITHUB_TOKEN`, `*_API_KEY`, `*_SECRET`, `DATABASE_URL`, `*_TOKEN`, `*_PASSWORD`
- **D-09:** Also remove injection vectors: `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`
- **D-10:** Keep standard env vars: `PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `TEMP`, `TMP`, `SHELL`, `SystemRoot` (Windows)

### Process Management
- **D-11:** Use `tree-kill` npm package for full process-tree kill on timeout — cross-platform, well-tested
- **D-12:** Default CWD is first workspace root from FilePathGuard (consistent with file tools)
- **D-13:** Conservative rate limiting: max 10 commands/min, max 2 concurrent, 1s cooldown between commands

### Spawn Configuration (already decided in REQUIREMENTS)
- **D-14:** Always `spawn` with `shell: false` and explicit interpreter
- **D-15:** Cross-platform interpreter: `/bin/bash -lc <command>` (Linux/macOS), `powershell.exe -NoProfile -NonInteractive -Command <command>` (Windows), `cmd.exe /d /s /c <command>` (fallback)
- **D-16:** stdin set to "ignore" — prevents hangs on interactive prompts
- **D-17:** Default timeout 60s, hard max 600s (10 min)

### Skill Registration (already decided in REQUIREMENTS)
- **D-18:** Single `shell_execute` tool — not separate bash/powershell aliases
- **D-19:** Tier "main", requiresConfirmation true, permissionCategory "shell", source "built-in"
- **D-20:** Parameters: command (string, required), cwd (string, optional), shell (enum: auto|bash|powershell|cmd, default auto), timeout_ms (number, default 60000, max 600000)
- **D-21:** Output schema: success, exit_code, stdout, stderr, duration_ms, stdout_truncated, stderr_truncated, timed_out

### Claude's Discretion
- Exact denylist pattern regex implementation details
- Exact env var scrub regex patterns
- Error messages wording (keep clear and user-friendly)
- Logging verbosity within ShellToolService

</decisions>

<specifics>
## Specific Ideas

- Follow FileToolService pattern exactly: config file (shellToolConfig.ts) + service file (ShellToolService.ts) with guard-based path validation
- Reuse FilePathGuard for CWD validation (already instantiated with workspace roots)
- Config file should mirror fileToolConfig.ts structure: denylist, env scrub list, size limits, rate limits, defaults

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing patterns to replicate
- `src/service/FileToolService.ts` — Service pattern: guard validation, execute dispatch, structured results
- `src/config/fileToolConfig.ts` — Config pattern: denylists, size limits, rate limits, workspace roots
- `src/service/FilePathGuard.ts` — Path safety: null-byte rejection, normalization, workspace-root jail, deny-list matching
- `src/config/skillsRegistry.ts` — Skill registration: BUILT_IN_SKILLS array, parameter schema, execute function wiring
- `src/entityTypes/skillTypes.ts` — Type definitions: SkillDefinition, permission categories

### Project specs
- `.planning/REQUIREMENTS.md` — Full requirements traceability (REG-*, EXE-*, SAFE-*, SEC-*, COMP-*)
- `.planning/ROADMAP.md` Phase 1 — Plans 1.1, 1.2, 1.3 with key files and success criteria
- `.planning/PROJECT.md` — Key decisions and constraints

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **FilePathGuard**: Already handles CWD validation (null-byte, normalization, symlink, workspace-root jail, deny-list). Shell service can use it directly for CWD validation.
- **FileToolService**: Pattern for execute() dispatch with guard validation + structured result objects. ShellToolService should follow this exact pattern.
- **fileToolConfig.ts**: Template for shellToolConfig.ts — same structure (denylist, size limits, rate limits, workspace roots).
- **getDefaultWorkspaceRoots()**: Returns `[home, userData]` in production, `[os.homedir()]` in tests. Shell service uses this for default CWD.

### Established Patterns
- **Skill registration**: Add to `BUILT_IN_SKILLS` array in skillsRegistry.ts with execute function that calls ToolExecutor
- **Config centralization**: All tool configs live in `src/config/`, all services in `src/service/`
- **Structured results**: All tool results return `{ success: boolean, error?: string, ...toolSpecificFields }`
- **Type definitions**: Tool-specific types go in `src/entityTypes/` (e.g., `fileToolTypes.ts`)

### Integration Points
- **ToolExecutor.execute()**: Shell tool's execute function routes through ToolExecutor like other built-in skills
- **SkillExecutor.ts**: Validates input, checks permissions, calls execute, handles audit — no changes needed for shell tool
- **StreamEventProcessor**: Routes AI tool calls through skill pipeline — no changes needed for v1

</code_context>

<deferred>
## Deferred Ideas

- Permission consent flow and UI (Phase 2)
- Audit logging with command redaction (Phase 3)
- Live stdout/stderr streaming to chat (optional Phase 4)
- Persistent "allow all shell commands" mode (v2)
- Network-domain prompts for curl/wget (v2)
- Bash/PowerShell as separate aliases (not planned)

</deferred>

---
*Phase: 01-core-execution-and-safety*
*Context gathered: 2026-04-23*
