# Shell Execution Skill for aiFetchly

## What This Is

A built-in `shell_execute` skill for aiFetchly's AI chat that enables users to request local shell command execution (Bash/PowerShell/cmd) through natural language. The skill integrates into the existing skill system with hardened execution controls, explicit user consent, and structured audit logging.

## Core Value

Users can safely ask AI to run local commands ("list files", "run tests", "check git status") with strong security controls — every command requires explicit approval, runs within workspace boundaries, and is fully auditable.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- The skill system (SkillExecutor, SkillPermissionService, skillsRegistry) is operational
- File tools (read, write, edit, glob, grep) are working with permission prompts
- System dependency installer is functional
- FilePathGuard provides workspace path protection
- StreamEventProcessor handles tool calls from AI chat

### Active

<!-- Current scope. Building toward these. -->

- [ ] Register `shell_execute` as a built-in skill in skillsRegistry
- [ ] Implement ShellToolService with spawn-based execution, timeout, output caps
- [ ] Add `shell` permission category with mandatory consent flow
- [ ] Enforce workspace-safe CWD using existing path guard patterns
- [ ] Command denylist pre-check for destructive patterns
- [ ] Environment scrubbing before spawn
- [ ] Structured audit logging with command redaction
- [ ] Cross-platform shell support (Bash, PowerShell, cmd)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Interactive terminal sessions (stdin) — prevents hangs on sudo/read prompts; v1 is fire-and-forget
- Background job orchestration UI — adds significant complexity without core value
- Persistent "always allow all shell commands" mode — security risk; v1 requires per-command consent
- Changes to SkillEnvironmentManager — that's Python-skill-only; shell skill uses native spawn
- Python virtual environment integration — shell skill runs system commands, not Python code
- Live streaming stdout/stderr to chat — deferred to optional Phase 4

## Context

aiFetchly is an Electron desktop app (Vue 3 + TypeScript) with an AI chat interface. The skill system on the `001-skill-system` branch already supports:

- **skillsRegistry.ts**: Static registration of built-in skills with JSON Schema parameters
- **SkillExecutor.ts**: Validates input, checks permissions, executes, and audits
- **SkillPermissionService.ts**: Token-based permission storage with session grants
- **StreamEventProcessor**: Routes AI tool calls through the skill pipeline
- **FilePathGuard.ts**: Workspace root jail, null-byte rejection, symlink resolution, deny-list matching
- **FileToolService.ts**: Pattern for a dedicated service handling tool execution with security controls
- **fileToolConfig.ts**: Configuration pattern for defaults, size limits, rate limiting, deny-lists

Permission categories currently exist for: `pure`, `network`, `filesystem`, `automation`. Shell needs a new `shell` category with stricter consent defaults.

## Constraints

- **Tech stack**: TypeScript 5.x, Electron main process (tier: "main"), Node.js `child_process.spawn`
- **Platform support**: Linux/macOS (Bash), Windows (PowerShell/cmd), with auto-detection
- **Security**: Never use `exec` for arbitrary commands; always `spawn` with `shell: false` and explicit interpreter
- **Timeouts**: Default 60s, hard max 10 minutes, full process-tree kill on timeout
- **Output limits**: Truncate stdout/stderr with explicit flags when exceeding caps
- **Compatibility**: No changes to existing SkillEnvironmentManager or aiChat.ts streaming for v1

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single `shell_execute` tool (not separate bash/powershell aliases) | Simpler registry, shell override parameter provides platform flexibility | — Pending |
| New `shell` permission category (not reusing `automation`) | Shell execution has unique risk profile needing dedicated consent policy | — Pending |
| `spawn` with explicit interpreter (not `exec`) | Avoids shell injection via command string interpolation | — Pending |
| v1 per-command consent only (no persistent global grant) | Maximum security for initial release; can relax in v2 based on user feedback | — Pending |
| Audit logs redacted before persistence | Prevents secret leakage in stored command text | — Pending |

---
*Last updated: 2026-04-23 after project initialization*
