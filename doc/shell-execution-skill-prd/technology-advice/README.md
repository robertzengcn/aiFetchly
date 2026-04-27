# Technology Advice: Shell Execution Skill

This document captures implementation advice for adding shell command execution to aiFetchly skills (Bash/PowerShell), aligned with the current Electron + TypeScript architecture.

---

## 1) Core execution approach

- Use Node's built-in `child_process.spawn` directly.
- Do not add `execa`, `cross-spawn`, or `shelljs` for v1.
- Keep spawn option `shell: false` to avoid an extra shell wrapper.
- Reuse the robust process pattern already used in `src/service/SkillEnvironmentManager.ts` (`runProcess`-style flow: timeout, stdout/stderr collection, structured result).

### Why

- Full control over interpreter selection and argv boundaries.
- Lower attack surface.
- Fewer dependency and maintenance risks.

---

## 2) Interpreter strategy (cross-platform)

Use explicit shell interpreter invocation with a single command argument.

- Linux/macOS: `/bin/bash -c <command>` (or `-lc` only if login shell behavior is required)
- Windows preferred: `pwsh.exe -NoProfile -NonInteractive -Command <command>`
- Windows fallback: `powershell.exe -NoProfile -NonInteractive -Command <command>`
- `cmd.exe /d /s /c <command>` only for explicit `shell=cmd` or controlled fallback

### Rules

- Never build a concatenated command string with user values outside the shell's own parser.
- Pass command as exactly one argument after shell flag.
- Keep Node spawn with `shell: false`.

---

## 3) Use one tool, not two

Prefer one built-in tool:

- `shell_execute`

with optional parameter:

- `shell: "auto" | "bash" | "powershell" | "cmd"`

### Why

- Simpler model behavior (LLM chooses fewer wrong tools).
- Cleaner permission and audit policy.
- Single implementation path in service layer.

---

## 4) Service layering

Recommended file placement:

- `src/service/ShellToolService.ts` (new)
- `src/config/shellToolConfig.ts` (new)
- `src/config/skillsRegistry.ts` (register `shell_execute`)

Keep these unchanged for core shell runtime:

- `src/service/SkillEnvironmentManager.ts` (Python env lifecycle only)
- `src/views/api/aiChat.ts` (unless adding optional live output streaming)

`SkillExecutor.ts` should remain orchestration/dispatch and call the skill's execute handler from registry.

---

## 5) CWD safety and path controls

Reuse existing workspace safety components:

- `FilePathGuard`
- `getDefaultWorkspaceRoots()`

Validate `cwd` before spawn:

1. If provided, must resolve under allowed workspace roots.
2. Reject path traversal / out-of-root absolute paths.
3. If omitted, default to workspace root.

---

## 6) Permission model

Add a dedicated permission category:

- `shell`

in `src/entityTypes/skillTypes.ts`.

### Policy recommendation

- Always prompt before execution.
- Prompt must display:
  - exact command text
  - selected shell
  - cwd
- Avoid permanent global "always allow all shell commands" in v1.
- Allow at most:
  - `allow_once`
  - optional session-only grant
  - deny

Integrate with existing `needsPermissionPrompt` flow in `SkillExecutor` / `StreamEventProcessor` / chat UI.

---

## 7) Security hardening requirements

### 7.1 Pre-execution denylist

Block known destructive patterns before running:

- filesystem destruction patterns
- format/partition operations
- fork bomb pattern
- shutdown/reboot patterns

Keep denylist regex definitions in `shellToolConfig.ts`.

### 7.2 Timeout + process-tree kill

- Default timeout: 60s
- Max timeout: 10 minutes
- On timeout, kill entire process tree, not only immediate child:
  - POSIX: process group kill
  - Windows: `taskkill /T /F /PID <pid>`

### 7.3 Output caps

- Cap stdout/stderr by bytes (e.g., 256KB each).
- Return truncation flags:
  - `stdout_truncated`
  - `stderr_truncated`

### 7.4 Non-interactive stdio

- `stdin: "ignore"`
- Prevent hanging on prompts (`sudo`, `read`, `Read-Host`, etc.)

### 7.5 Env scrubbing

Prefer env allowlist over blacklist.

- Keep only essential environment keys.
- Remove likely secret-bearing keys (`*TOKEN*`, `*KEY*`, `*SECRET*`, `*PASSWORD*`, etc.).

---

## 8) Logging and redaction

Use structured shell audit logs with sensitive redaction.

Recommended fields:

- `tool`
- `command_redacted`
- `shell`
- `cwd`
- `success`
- `exit_code`
- `timed_out`
- `duration_ms`
- output size/truncation metadata
- timestamp

Prefer file-backed app logging (`electron-log` or existing logger infrastructure) over console-only logs.

---

## 9) Runtime validation

Use `zod` for input validation at service boundary:

- `command` required, bounded length
- `shell` enum
- `cwd` optional validated string
- `timeout_ms` bounded integer range

Return structured failures instead of throwing unhandled exceptions.

---

## 10) Windows-specific considerations

- Prefer `pwsh.exe` when available.
- Handle native command exit-code propagation explicitly.
- Normalize line endings (`\r\n` -> `\n`) before returning output.
- Be careful with encoding; normalize to UTF-8 where possible.

---

## 11) Rate limiting and concurrency

Add dedicated rate-limit bucket for shell operations in executor routing:

- Low `maxConcurrent` (e.g., 2)
- Reasonable per-minute limit

Why:

- Prevent accidental command storms from repeated tool-call loops.

---

## 12) Testing strategy

### Unit tests (ShellToolService)

- success path: simple echo command
- non-zero exit code propagation
- timeout behavior and process kill
- output truncation behavior
- denylist block behavior (must not spawn)
- cwd guard rejection
- env scrubbing coverage

### Integration tests

- `tool_call -> permission prompt -> grant -> execute -> tool_result -> stream continue`
- deny flow and surfaced error shape

---

## 13) Suggested implementation sequence

1. Add `shell` permission category.
2. Build `ShellToolService` with spawn, timeout, caps, guard, redaction.
3. Register `shell_execute` in `skillsRegistry.ts`.
4. Connect permission prompt details (command preview) for shell category.
5. Add shell audit logs.
6. Add rate limit + tests.
7. Optional phase: incremental stdout/stderr streaming in chat UI.

---

## 14) Recommended defaults (v1)

- Tool name: `shell_execute`
- Tier: `main`
- `requiresConfirmation`: `true`
- Permission category: `shell`
- Default timeout: `60000ms`
- Max timeout: `600000ms`
- Stdout cap: `256KB`
- Stderr cap: `256KB`
- Stdin: ignored

---

## 15) Final recommendation

Ship a single hardened `shell_execute` tool first.  
Treat shell execution as a dedicated permission category with strict consent defaults, workspace-bound cwd, timeout + process-tree kill, output caps, env scrubbing, and redacted audit logs.  
This gives users command-execution power while preserving trust and safety in aiFetchly's skill system.

