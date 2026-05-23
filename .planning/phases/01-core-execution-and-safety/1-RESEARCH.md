# Phase 1: Core Execution and Safety - Research

**Researched:** 2026-04-23
**Domain:** Node.js child_process.spawn, process-tree management, command safety
**Confidence:** HIGH

## Summary

Phase 1 builds a `ShellToolService` that executes AI-requested shell commands via `child_process.spawn` with `shell: false`, using explicit interpreter selection per platform. The service follows the exact same pattern as the existing `FileToolService`: a config file (`shellToolConfig.ts`) for denylists, size limits, and rate limits, plus a service class (`ShellToolService.ts`) with `FilePathGuard`-based CWD validation and structured result objects. The `shell_execute` skill registers in the existing `skillsRegistry.ts` and routes through `ToolExecutor` like all other built-in tools.

All 21 implementation decisions (D-01 through D-21) are locked in CONTEXT.md. This phase has no open architectural choices -- only implementation details remain. The primary risk surface is cross-platform spawn behavior (bash on Linux/macOS, PowerShell on Windows, cmd as fallback) and ensuring the process-tree kill works reliably on all three platforms.

**Primary recommendation:** Replicate the FileToolService pattern exactly. Create `shellToolConfig.ts` mirroring `fileToolConfig.ts`, create `ShellToolService.ts` mirroring `FileToolService.ts` with spawn-specific logic, and add a `shell_execute` case to ToolExecutor's switch statement. Use `tree-kill` (v1.2.2, MIT) for process-tree termination -- it is the established standard and handles platform differences internally.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Moderate scope denylist -- block safety-critical commands (rm -rf /, mkfs, dd of=/dev) PLUS privilege escalation (sudo, su, chmod 777) PLUS pipe-to-shell (curl|sh, wget|sh, eval with shell expansion)
- **D-02:** Hybrid matching -- raw string pattern matching for compound patterns (e.g., `rm -rf /`) combined with first-token matching for command names (e.g., `sudo`, `mkfs`)
- **D-03:** Denylist runs BEFORE user consent prompt -- blocked commands never reach the user for approval
- **D-04:** 1 MB per stream (stdout and stderr each) -- matches FileToolService maxReadBytes
- **D-05:** When output exceeds cap, truncate and set `stdout_truncated: true` or `stderr_truncated: true`
- **D-06:** On timeout, return partial stdout/stderr collected so far with `timed_out: true`
- **D-07:** `success` field is exit-code-based: exit_code 0 = true, anything else = false
- **D-08:** Pattern-based scrub -- remove env vars matching known secret patterns
- **D-09:** Also remove injection vectors: `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`
- **D-10:** Keep standard env vars: PATH, HOME, USER, LANG, LC_ALL, TEMP, TMP, SHELL, SystemRoot
- **D-11:** Use `tree-kill` npm package for full process-tree kill on timeout
- **D-12:** Default CWD is first workspace root from FilePathGuard
- **D-13:** Conservative rate limiting: max 10 commands/min, max 2 concurrent, 1s cooldown
- **D-14:** Always `spawn` with `shell: false` and explicit interpreter
- **D-15:** Cross-platform interpreter: `/bin/bash -lc <command>` (Linux/macOS), `powershell.exe -NoProfile -NonInteractive -Command <command>` (Windows), `cmd.exe /d /s /c <command>` (fallback)
- **D-16:** stdin set to "ignore" -- prevents hangs on interactive prompts
- **D-17:** Default timeout 60s, hard max 600s (10 min)
- **D-18:** Single `shell_execute` tool -- not separate bash/powershell aliases
- **D-19:** Tier "main", requiresConfirmation true, permissionCategory "shell", source "built-in"
- **D-20:** Parameters: command (string, required), cwd (string, optional), shell (enum: auto|bash|powershell|cmd, default auto), timeout_ms (number, default 60000, max 600000)
- **D-21:** Output schema: success, exit_code, stdout, stderr, duration_ms, stdout_truncated, stderr_truncated, timed_out

### Claude's Discretion
- Exact denylist pattern regex implementation details
- Exact env var scrub regex patterns
- Error messages wording (keep clear and user-friendly)
- Logging verbosity within ShellToolService

### Deferred Ideas (OUT OF SCOPE)
- Permission consent flow and UI (Phase 2)
- Audit logging with command redaction (Phase 3)
- Live stdout/stderr streaming to chat (optional Phase 4)
- Persistent "allow all shell commands" mode (v2)
- Network-domain prompts for curl/wget (v2)
- Bash/PowerShell as separate aliases (not planned)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REG-01 | Register shell_execute in skillsRegistry.ts | Follow existing BUILT_IN_SKILLS pattern; add to array |
| REG-02 | Define JSON Schema parameters (command, cwd, shell, timeout_ms) | Use same schema structure as file tools |
| REG-03 | Define output schema (success, exit_code, stdout, stderr, etc.) | Define ShellExecuteResult interface in shellToolTypes.ts |
| EXE-01 | Create ShellToolService.ts with spawn-based execution | Replicate FileToolService pattern |
| EXE-02 | Use spawn with shell:false and explicit interpreter | Platform detection via process.platform |
| EXE-03 | Cross-platform interpreter selection (bash/PowerShell/cmd) | Map process.platform to interpreter args |
| EXE-04 | Set stdin to "ignore" | spawn option: { stdio: ["ignore", "pipe", "pipe"] } |
| EXE-05 | Timeout with full process-tree kill | tree-kill package v1.2.2 |
| EXE-06 | Output size caps with truncation | 1MB per stream, Buffer-based accumulation |
| SAFE-01 | Validate cwd resolves under allowed workspace roots | Reuse FilePathGuard.validate() |
| SAFE-02 | Reject execution when cwd escapes workspace roots | FilePathGuard returns safe:false |
| SEC-01 | Command denylist pre-check | Hybrid matching: first-token + compound patterns |
| SEC-02 | Environment scrubbing before spawn | Filter process.env by pattern whitelist |
| SEC-03 | Return structured error output | Wrap all errors in { success: false, error: "..." } |
| SEC-04 | No interactive stdin | spawn stdio[0] = "ignore" |
| COMP-01 | SkillExecutor remains dispatcher | No changes to SkillExecutor.ts |
| COMP-02 | No changes to SkillEnvironmentManager.ts | Python-skill-only, not touched |
| COMP-03 | No changes to aiChat.ts streaming | v1 is fire-and-forget |
| COMP-04 | Existing skills and MCP tools continue working | Additive-only changes |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Spawn process execution | Main process (Electron) | -- | child_process.spawn only available in Node.js main/utility process, not renderer |
| CWD validation | Main process (FilePathGuard) | -- | Path safety must happen server-side; FilePathGuard is instantiated in main process |
| Command denylist check | Main process (ShellToolService) | -- | Security enforcement must happen before spawn, cannot be in renderer |
| Environment scrubbing | Main process (ShellToolService) | -- | process.env filtering must happen in the process that spawns the child |
| Output truncation | Main process (ShellToolService) | -- | Buffer accumulation and truncation happen during spawn lifecycle |
| Skill registration | Main process (skillsRegistry) | -- | Registry is a static module loaded in main process |
| Rate limiting | Main process (ToolExecutor) | -- | RateLimiter is a static class in ToolExecutor |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tree-kill | 1.2.2 | Kill entire process tree on timeout | Cross-platform (ps/pgrep on Unix, taskkill on Windows); MIT license; zero dependencies; established standard for this exact use case [VERIFIED: npm registry] |
| child_process (Node built-in) | -- | Spawn child processes with shell:false | Node.js built-in module; spawn is the only safe option (never exec) [ASSUMED] |
| picomatch (already installed) | -- | Pattern matching for denylist | Already used by FilePathGuard; consistent pattern matching [VERIFIED: package.json] |
| zod (already installed) | -- | Parameter validation | Already used for skill parameter validation in the codebase [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FilePathGuard (existing) | -- | CWD validation against workspace roots | Every shell execution to validate cwd parameter |
| RateLimiter (existing) | -- | Rate limiting for shell commands | Via ToolExecutor, same pattern as file tools |
| FileToolService pattern | -- | Architectural template | As the structural blueprint for ShellToolService |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tree-kill | Custom SIGTERM + PID tree walk | tree-kill handles all platform edge cases (Windows taskkill, macOS pgrep) that a custom solution would miss |
| spawn with shell:false | exec | exec uses shell:true internally, which is a security vulnerability for AI-generated commands |
| hybrid denylist matching | Pure regex | Compound patterns like "rm -rf /" need string matching, not just first-token matching |

**Installation:**
```bash
yarn add tree-kill@1.2.2
yarn add -D @types/tree-kill
```

**Version verification:**
```bash
npm view tree-kill version
# 1.2.2 (verified 2026-04-23)
npm view tree-kill license
# MIT (verified 2026-04-23)
```

## Architecture Patterns

### System Architecture Diagram

```
AI Stream (StreamEventProcessor)
    |
    v
SkillExecutor.execute()
    |
    v
skillsRegistry["shell_execute"].execute()
    |
    v
ToolExecutor.execute("shell_execute", args, conversationId)
    |
    +---> RateLimiter.acquire()
    |         (max 10/min, max 2 concurrent, 1s cooldown)
    |
    +---> ShellToolService.execute("shell_execute", args)
    |         |
    |         +---> validateCWD(args.cwd) via FilePathGuard
    |         |         [reject if outside workspace roots]
    |         |
    |         +---> checkDenylist(args.command)
    |         |         [reject destructive patterns BEFORE user consent]
    |         |
    |         +---> scrubEnvironment()
    |         |         [remove secrets, LD_PRELOAD, etc.]
    |         |
    |         +---> selectInterpreter(args.shell)
    |         |         [bash / PowerShell / cmd based on platform]
    |         |
    |         +---> spawn(interpreter, [args...], { shell: false, stdio: ["ignore", "pipe", "pipe"], env: scrubbed, cwd: validated })
    |                   |
    |                   +---> accumulate stdout (max 1MB)
    |                   +---> accumulate stderr (max 1MB)
    |                   +---> setTimeout -> tree-kill(pid) -> return partial output
    |                   |
    |                   v
    |              process exit/close
    |                   |
    |                   v
    |         return { success, exit_code, stdout, stderr, duration_ms, stdout_truncated, stderr_truncated, timed_out }
    |
    +---> RateLimiter.release()
    |
    v
Structured result to AI
```

### Recommended Project Structure
```
src/
├── config/
│   ├── shellToolConfig.ts       # NEW: denylist patterns, env scrub list, size limits, rate limits
│   └── skillsRegistry.ts        # MODIFY: add shell_execute entry to BUILT_IN_SKILLS
├── service/
│   ├── ShellToolService.ts      # NEW: spawn-based execution, denylist, env scrub, CWD validation
│   └── ToolExecutor.ts          # MODIFY: add shell_execute case + cached ShellToolService instance
└── entityTypes/
    ├── skillTypes.ts            # MODIFY: add "shell" to SkillPermissionCategory union
    └── shellToolTypes.ts        # NEW: parameter interfaces, result interfaces, config types

test/
└── vitest/
    └── main/
        └── ShellToolService.test.ts  # NEW: unit tests following FileToolService test pattern
```

### Pattern 1: Service Class with Guard (FileToolService Pattern)
**What:** Service class with FilePathGuard for validation, execute() dispatch method, structured results
**When to use:** This is THE pattern for ShellToolService -- replicate exactly from FileToolService
**Example:**
```typescript
// Source: src/service/FileToolService.ts (existing codebase)
import { FilePathGuard } from "@/service/FilePathGuard";
import { getDefaultWorkspaceRoots } from "@/config/fileToolConfig";

export class ShellToolService {
  private readonly guard: FilePathGuard;

  constructor(roots?: readonly string[]) {
    this.guard = new FilePathGuard(roots ?? getDefaultWorkspaceRoots());
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (toolName) {
      case "shell_execute":
        return this.executeShell(args as unknown as ShellExecuteParams)
          as unknown as Record<string, unknown>;
      default:
        return { success: false, error: `Unknown shell tool: ${toolName}` };
    }
  }
}
```

### Pattern 2: Config File (fileToolConfig Pattern)
**What:** Centralized configuration file with denylist, size limits, rate limits
**When to use:** shellToolConfig.ts mirrors fileToolConfig.ts structure exactly
**Example:**
```typescript
// Source: src/config/fileToolConfig.ts (existing codebase pattern)
export const SHELL_TOOL_SIZE_LIMITS: ShellToolSizeLimits = {
  maxOutputBytes: 1_000_000,  // 1 MB per stream (stdout/stderr)
  defaultTimeoutMs: 60_000,   // 60 seconds
  maxTimeoutMs: 600_000,      // 10 minutes
};

export const SHELL_TOOL_RATE_LIMITS: ShellToolRateLimitConfig = {
  maxPerMinute: 10,
  maxConcurrent: 2,
  cooldownMs: 1000,
};
```

### Pattern 3: ToolExecutor Integration (File Tool Pattern)
**What:** Cached singleton service instance in ToolExecutor with rate limit config
**When to use:** Adding shell_execute to ToolExecutor's switch statement
**Example:**
```typescript
// Source: src/service/ToolExecutor.ts (existing pattern)
private static shellToolService: ShellToolService | null = null;

private static getShellToolService(): ShellToolService {
  if (!ToolExecutor.shellToolService) {
    ToolExecutor.shellToolService = new ShellToolService();
  }
  return ToolExecutor.shellToolService;
}

// In executeInternal() switch:
case "shell_execute":
  return await ToolExecutor.getShellToolService().execute(
    "shell_execute", toolParams
  );
```

### Pattern 4: Skill Registration (BUILT_IN_SKILLS Pattern)
**What:** Add entry to BUILT_IN_SKILLS array with execute wiring
**When to use:** Registering shell_execute in skillsRegistry.ts
**Example:**
```typescript
// Source: src/config/skillsRegistry.ts (existing pattern)
{
  name: "shell_execute",
  description: "Execute a shell command and return stdout, stderr, and exit code",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      cwd: { type: "string", description: "Working directory" },
      shell: { type: "string", enum: ["auto", "bash", "powershell", "cmd"], default: "auto" },
      timeout_ms: { type: "number", default: 60000, maximum: 600000 },
    },
    required: ["command"],
  },
  tier: "main",
  requiresConfirmation: true,
  permissionCategory: "shell",
  source: "built-in",
  execute: async (args, context) => {
    const result = await ToolExecutor.execute(
      "shell_execute", args, context.conversationId
    );
    return { success: result.success ?? true, result };
  },
}
```

### Anti-Patterns to Avoid
- **Using `exec()` instead of `spawn()`:** exec() internally uses shell:true which allows shell injection. Always use spawn() with shell:false.
- **Calling `process.kill(childProcess.pid)`:** Only kills the parent process, not the spawned child's children. Use tree-kill for full process tree termination.
- **Passing `args` as a single string to spawn:** When shell:false, args must be an array of strings. Passing the entire command as one string will fail.
- **Setting stdin to "pipe" without draining:** Causes backpressure hangs when the child process writes to stdin. Use "ignore" to prevent all stdin interaction.
- **Using `child_process.execFile()` with user input:** execFile does not invoke a shell but still has argument injection risks if the command string is split incorrectly.
- **Forgetting to handle the `error` event on ChildProcess:** The `error` event fires when spawn itself fails (e.g., interpreter not found), separate from the child's exit code. Must handle both.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process-tree kill | Custom PID tree walker using ps/pgrep/taskkill | `tree-kill` npm package (v1.2.2) | Platform differences are substantial: Linux uses `ps -o pid --ppid`, macOS uses `pgrep -P`, Windows uses `taskkill /pid /T /F`. tree-kill handles all three. |
| CWD validation | Custom path traversal check | FilePathGuard.validate() | Already handles null-byte rejection, normalization, symlink resolution, workspace-root jail, and deny-list matching. |
| Rate limiting | Custom timer/counter | Existing RateLimiter class | Already handles per-minute tracking, concurrent counting, and cooldown. Just add config entry. |
| Pattern matching for denylist | Custom string matching | picomatch (already installed) | Already used by FilePathGuard for the same purpose. Consistent matching semantics. |
| Interpreter selection | Custom platform detection | process.platform switch | Simple and reliable: "win32" -> PowerShell, everything else -> bash. No need for a library. |

**Key insight:** The existing codebase already provides every infrastructure component needed (FilePathGuard, RateLimiter, picomatch, ToolExecutor, skillsRegistry). The only new external dependency is `tree-kill`. Everything else is following established patterns.

## Common Pitfalls

### Pitfall 1: spawn with shell:false Requires Argument Array
**What goes wrong:** Passing the entire command as a single argument to spawn when shell:false is set. spawn does not parse the command string -- it treats the first arg as the executable and the rest as literal arguments.
**Why it happens:** Developers are used to exec() which takes a single command string and shell-parses it.
**How to avoid:** Always pass the interpreter as the command and the full argument array: `spawn("/bin/bash", ["-lc", command], { shell: false })`.
**Warning signs:** Command appears to do nothing or fails with "command not found" for compound commands.

### Pitfall 2: Missing ChildProcess `error` Event Handler
**What goes wrong:** spawn() is asynchronous -- it returns before the process actually starts. If the interpreter binary doesn't exist, an `error` event fires on the ChildProcess object. Without a handler, this crashes the process.
**Why it happens:** The `exit` event only fires when a process successfully starts and then exits. A failed spawn fires `error`, not `exit`.
**How to avoid:** Always attach both `error` and `exit`/`close` handlers. Return structured error from the `error` handler.
**Warning signs:** Unhandled "ENOENT" or "spawn ENOENT" errors in logs.

### Pitfall 3: Using `exit` Instead of `close` Event
**What goes wrong:** The `exit` event fires when the process exits, but stdout/stderr pipes may still have buffered data that hasn't been read yet. Using `exit` to collect output can lose the last chunk.
**Why it happens:** The Node.js docs say `exit` fires when the process exits, but the stdio streams may still be open.
**How to avoid:** Use the `close` event instead of `exit`. The `close` event fires only after the process has exited AND all stdio streams are closed. If you need early termination detection (for timeout), track both: use `exit` for process termination but `close` for final output collection.
**Warning signs:** Intermittent missing output at the end of command results, especially for fast-finishing commands.

### Pitfall 4: Output Accumulation Without Backpressure Handling
**What goes wrong:** If a command produces output faster than it's consumed (e.g., `find /`), the Node.js process runs out of memory.
**Why it happens:** The default highWaterMark for pipes is 64KB in Node.js. When the internal buffer exceeds this, backpressure kicks in, but if you're just concatenating strings without checking, you can still accumulate beyond the cap.
**How to avoid:** Track accumulated byte count. When it exceeds 1MB, stop reading (call destroy() on the stream) and set the truncation flag.
**Warning signs:** Memory spikes during execution of commands with large output.

### Pitfall 5: Environment Scrubbing Breaks the Shell Interpreter
**What goes wrong:** Removing too many environment variables can cause the shell itself to malfunction (e.g., removing PATH means the shell can't find basic commands like `ls`).
**Why it happens:** Over-aggressive scrubbing removes variables the shell interpreter needs to function.
**How to avoid:** Use an allowlist approach: start with the current process.env and remove only patterns matching known secrets. Never remove PATH, HOME, USER, SHELL, LANG, LC_ALL, TEMP, TMP, SystemRoot.
**Warning signs:** Commands that work in a terminal fail when executed through shell_execute with "command not found" errors.

### Pitfall 6: tree-kill Fails on Zombie Processes
**What goes wrong:** After timeout, tree-kill may fail if the process has already exited or become a zombie. An unhandled error from tree-kill crashes the service.
**Why it happens:** There's a race condition between the timeout handler firing and the process exiting naturally.
**How to avoid:** Always wrap tree-kill in a try/catch. If it fails because the process already exited, that's fine -- the process is dead either way.
**Warning signs:** Intermittent crashes during timeout handling.

### Pitfall 7: Windows PowerShell Encoding Issues
**What goes wrong:** PowerShell on Windows uses UTF-16 by default, which can garble command output when captured by Node.js spawn.
**Why it happens:** PowerShell's default encoding doesn't match Node.js's UTF-8 string handling.
**How to avoid:** Use `-NoProfile -NonInteractive -Command` flags which limit encoding issues. If needed, set the spawn env variable `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8` in the command preamble.
**Warning signs:** Gibberish or mojibake in command output on Windows.

## Code Examples

Verified patterns from the existing codebase and official Node.js documentation:

### Spawn with shell:false and Explicit Interpreter
```typescript
// Source: Node.js child_process documentation + CONTEXT.md D-14/D-15
import { spawn } from "child_process";
import * as os from "os";

function selectInterpreter(shellArg: string): { command: string; args: string[] } {
  const platform = os.platform();

  if (shellArg === "bash" || (shellArg === "auto" && platform !== "win32")) {
    return { command: "/bin/bash", args: ["-lc"] };
  }
  if (shellArg === "powershell" || (shellArg === "auto" && platform === "win32")) {
    return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command"] };
  }
  if (shellArg === "cmd") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c"] };
  }

  // Fallback based on platform
  if (platform === "win32") {
    return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command"] };
  }
  return { command: "/bin/bash", args: ["-lc"] };
}

// Usage:
const interpreter = selectInterpreter(args.shell ?? "auto");
const childProcess = spawn(
  interpreter.command,
  [...interpreter.args, args.command],
  {
    shell: false,
    cwd: validatedCwd,
    env: scrubbedEnv,
    stdio: ["ignore", "pipe", "pipe"],
  }
);
```

### Environment Scrubbing
```typescript
// Source: CONTEXT.md D-08, D-09, D-10
const SECRET_PATTERNS: readonly RegExp[] = [
  /^AWS_SECRET_ACCESS_KEY$/i,
  /^AWS_SESSION_TOKEN$/i,
  /^GITHUB_TOKEN$/i,
  /^.*_API_KEY$/i,
  /^.*_SECRET$/i,
  /^DATABASE_URL$/i,
  /^.*_TOKEN$/i,
  /^.*_PASSWORD$/i,
];

const INJECTION_VECTORS: readonly RegExp[] = [
  /^LD_PRELOAD$/i,
  /^DYLD_INSERT_LIBRARIES$/i,
];

const KEEP_VARS: readonly Set<string> = new Set([
  "PATH", "HOME", "USER", "LANG", "LC_ALL", "TEMP", "TMP", "SHELL", "SystemRoot",
]);

function scrubEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (KEEP_VARS.has(key)) {
      scrubbed[key] = value;
      continue;
    }
    if (SECRET_PATTERNS.some(pattern => pattern.test(key))) {
      continue; // Remove
    }
    if (INJECTION_VECTORS.some(pattern => pattern.test(key))) {
      continue; // Remove
    }
    scrubbed[key] = value;
  }
  return scrubbed;
}
```

### Output Accumulation with Truncation
```typescript
// Source: CONTEXT.md D-04, D-05, D-06
const MAX_OUTPUT_BYTES = 1_000_000; // 1 MB

let stdout = "";
let stderr = "";
let stdoutTruncated = false;
let stderrTruncated = false;

childProcess.stdout?.on("data", (chunk: Buffer) => {
  if (!stdoutTruncated) {
    const str = chunk.toString("utf-8");
    if (stdout.length + str.length > MAX_OUTPUT_BYTES) {
      stdout += str.substring(0, MAX_OUTPUT_BYTES - stdout.length);
      stdoutTruncated = true;
      childProcess.stdout?.destroy(); // Stop reading
    } else {
      stdout += str;
    }
  }
});

childProcess.stderr?.on("data", (chunk: Buffer) => {
  if (!stderrTruncated) {
    const str = chunk.toString("utf-8");
    if (stderr.length + str.length > MAX_OUTPUT_BYTES) {
      stderr += str.substring(0, MAX_OUTPUT_BYTES - stderr.length);
      stderrTruncated = true;
      childProcess.stderr?.destroy();
    } else {
      stderr += str;
    }
  }
});
```

### Timeout with Process-Tree Kill
```typescript
// Source: tree-kill npm package documentation + CONTEXT.md D-11, D-17
import treeKill from "tree-kill";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;

const requestedTimeout = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
const timeout = Math.min(requestedTimeout, MAX_TIMEOUT_MS);

let timedOut = false;

const timeoutHandle = setTimeout(() => {
  timedOut = true;
  try {
    treeKill(childProcess.pid!, "SIGKILL");
  } catch {
    // Process may have already exited -- that's fine
  }
}, timeout);

childProcess.on("close", (exitCode) => {
  clearTimeout(timeoutHandle);

  const result: ShellExecuteResult = {
    success: !timedOut && exitCode === 0,
    exit_code: timedOut ? null : (exitCode ?? 1),
    stdout,
    stderr,
    duration_ms: Date.now() - startTime,
    stdout_truncated: stdoutTruncated,
    stderr_truncated: stderrTruncated,
    timed_out: timedOut,
  };

  resolve(result);
});
```

### Command Denylist (Hybrid Matching)
```typescript
// Source: CONTEXT.md D-01, D-02, D-03
const COMMAND_DENY_LIST: readonly DenyListEntry[] = [
  // First-token matching: match the first word of the command
  { pattern: "sudo", type: "firstToken", reason: "Privilege escalation blocked" },
  { pattern: "su", type: "firstToken", reason: "Privilege escalation blocked" },
  { pattern: "mkfs", type: "firstToken", reason: "Filesystem formatting blocked" },
  { pattern: "dd", type: "firstToken", reason: "Raw disk operations blocked" },
  { pattern: "format", type: "firstToken", reason: "Disk formatting blocked" },
  // Compound patterns: match substring in the full command string
  { pattern: "rm -rf /", type: "compound", reason: "Recursive root delete blocked" },
  { pattern: "chmod 777", type: "compound", reason: "Insecure permissions blocked" },
  { pattern: "curl|sh", type: "compound", reason: "Pipe-to-shell blocked" },
  { pattern: "wget|sh", type: "compound", reason: "Pipe-to-shell blocked" },
  { pattern: "curl|bash", type: "compound", reason: "Pipe-to-shell blocked" },
  { pattern: "wget|bash", type: "compound", reason: "Pipe-to-shell blocked" },
];

function checkDenylist(command: string): { blocked: boolean; reason?: string } {
  const trimmed = command.trim();
  const firstToken = trimmed.split(/\s+/)[0];

  for (const entry of COMMAND_DENY_LIST) {
    if (entry.type === "firstToken" && firstToken === entry.pattern) {
      return { blocked: true, reason: entry.reason };
    }
    if (entry.type === "compound" && trimmed.includes(entry.pattern)) {
      return { blocked: true, reason: entry.reason };
    }
  }
  return { blocked: false };
}
```

### Structured Error Handling (SEC-03)
```typescript
// Source: FileToolService pattern + CONTEXT.md D-07, SEC-03
// Every error path returns { success: false, error: "..." } -- never throws

async executeShell(args: ShellExecuteParams): Promise<ShellExecuteResult> {
  try {
    // 1. Validate CWD
    if (args.cwd) {
      const validation = this.guard.validate(args.cwd);
      if (!validation.safe) {
        return {
          success: false,
          exit_code: null,
          stdout: "",
          stderr: validation.error ?? "CWD validation failed",
          duration_ms: 0,
          stdout_truncated: false,
          stderr_truncated: false,
          timed_out: false,
        };
      }
    }

    // 2. Check denylist
    const denyResult = checkDenylist(args.command);
    if (denyResult.blocked) {
      return {
        success: false,
        exit_code: null,
        stdout: "",
        stderr: `Command blocked: ${denyResult.reason}`,
        duration_ms: 0,
        stdout_truncated: false,
        stderr_truncated: false,
        timed_out: false,
      };
    }

    // 3. Execute spawn...
  } catch (err) {
    return {
      success: false,
      exit_code: null,
      stdout: "",
      stderr: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
      duration_ms: 0,
      stdout_truncated: false,
      stderr_truncated: false,
      timed_out: false,
    };
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `child_process.exec()` | `spawn()` with `shell: false` | Long-standing best practice | exec() uses shell=true internally, allowing shell injection via user-supplied commands |
| `process.kill(pid)` | `tree-kill` package | Since ~2015 | process.kill only kills the parent, not child processes spawned by the shell |
| Simple string matching denylist | Hybrid first-token + compound matching | Phase-specific design | Handles both simple commands (sudo) and compound patterns (rm -rf /) without false positives |
| Full process.env pass-through | Scrubbed environment | Security best practice | Prevents accidental leakage of secrets (AWS keys, tokens) to child processes |

**Deprecated/outdated:**
- `child_process.exec()`: Never use for AI-generated commands -- shell injection vulnerability
- `child_process.execSync()`: Blocking, will freeze the Electron main process
- `process.kill()` for timeout: Only kills parent process, leaves orphans

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node.js child_process.spawn API is stable and well-documented as described | Architecture Patterns | LOW -- spawn is a core Node.js API, unlikely to change |
| A2 | `/bin/bash` exists on all target Linux/macOS systems | Architecture Patterns | MEDIUM -- some minimal Docker images lack bash; but Electron targets desktop OS where bash is universal |
| A3 | `powershell.exe` is available on all target Windows systems | Architecture Patterns | LOW -- PowerShell has been default on Windows since Windows 7 |
| A4 | tree-kill v1.2.2 is stable and handles edge cases correctly | Don't Hand-Roll | LOW -- well-established package (MIT, zero deps, widely used) |

## Open Questions

1. **Should `exit_code` be `null` or `-1` for timed-out processes?**
   - What we know: CONTEXT.md D-06 says return partial output with `timed_out: true`. D-07 says success is exit-code-based.
   - What's unclear: The exact value of `exit_code` when the process was killed before exiting naturally.
   - Recommendation: Use `null` for `exit_code` when `timed_out: true` (process did not exit naturally), and `exit_code ?? 1` for process crashes. This matches the pattern where `null` means "no meaningful exit code."

2. **Should the denylist check be case-insensitive on Windows?**
   - What we know: Commands are case-insensitive on Windows (`DEL` vs `del`).
   - What's unclear: Whether the denylist should normalize case before matching.
   - Recommendation: Use case-insensitive matching for first-token matching on all platforms (commands like `SUDO` should also be blocked). Compound patterns can remain case-sensitive since they match substrings of the user's command.

3. **How should bash `-lc` handle commands with newlines?**
   - What we know: bash `-lc` passes the command string to bash as a login shell command. Commands with embedded newlines should work since bash treats them as command separators.
   - What's unclear: Whether multi-line commands from AI tool calls are common or expected.
   - Recommendation: Accept multi-line commands as-is. bash -lc handles them natively. The denylist should check the full command string including newlines.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js child_process | ShellToolService | Yes | Built-in | -- |
| tree-kill npm package | Process-tree kill | Needs install | 1.2.2 (npm) | -- |
| picomatch | Denylist matching | Yes | package.json | -- |
| zod | Parameter validation | Yes | package.json | -- |
| vitest | Test framework | Yes | 1.2.2 | -- |
| /bin/bash (Linux/macOS) | Default interpreter | Yes | System | PowerShell/cmd on Windows |
| PowerShell (Windows) | Windows interpreter | Yes | System | cmd.exe as fallback |

**Missing dependencies with no fallback:**
- `tree-kill` must be installed before implementation begins (`yarn add tree-kill`)

**Missing dependencies with fallback:**
- None -- all other dependencies are already present

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 1.2.2 |
| Config file | vite.main.config.mjs |
| Quick run command | `yarn vitest run test/vitest/main/ShellToolService.test.ts` |
| Full suite command | `yarn vitest run test/vitest/main/` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXE-01 | ShellToolService spawn-based execution | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "spawn"` | Wave 0 |
| EXE-02 | spawn with shell:false | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "shell:false"` | Wave 0 |
| EXE-03 | Cross-platform interpreter selection | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "interpreter"` | Wave 0 |
| EXE-04 | stdin set to ignore | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "stdin"` | Wave 0 |
| EXE-05 | Timeout with process-tree kill | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "timeout"` | Wave 0 |
| EXE-06 | Output size caps with truncation | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "truncation"` | Wave 0 |
| SAFE-01 | CWD validation via FilePathGuard | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "CWD"` | Wave 0 |
| SAFE-02 | Reject escaped CWD | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "CWD escape"` | Wave 0 |
| SEC-01 | Command denylist pre-check | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "denylist"` | Wave 0 |
| SEC-02 | Environment scrubbing | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "env scrub"` | Wave 0 |
| SEC-03 | Structured error output | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "error"` | Wave 0 |
| REG-01 | Skill registration in registry | unit | `yarn vitest run test/vitest/main/ShellToolService.test.ts -t "registration"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `yarn vitest run test/vitest/main/ShellToolService.test.ts`
- **Per wave merge:** `yarn vitest run test/vitest/main/`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/vitest/main/ShellToolService.test.ts` -- covers EXE-01 through SEC-03
- [ ] `src/entityTypes/shellToolTypes.ts` -- type definitions for test fixtures
- [ ] `src/config/shellToolConfig.ts` -- config exports needed by tests

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Not in scope for shell execution |
| V3 Session Management | no | Not in scope |
| V4 Access Control | yes | FilePathGuard for CWD jail; denylist for command filtering |
| V5 Input Validation | yes | zod for parameter validation; denylist for command validation; FilePathGuard for path validation |
| V6 Cryptography | no | No crypto operations in this phase |

### Known Threat Patterns for Shell Execution

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via shell expansion | Tampering | spawn with shell:false prevents shell interpretation of metacharacters |
| Privilege escalation (sudo, su) | Elevation of Privilege | Denylist blocks sudo, su, chmod 777 before execution |
| Data exfiltration via env vars | Information Disclosure | Environment scrubbing removes secrets before passing to child process |
| Pipe-to-shell attacks (curl|sh) | Tampering | Denylist blocks curl|sh, wget|sh, curl|bash patterns |
| Path traversal in CWD | Tampering | FilePathGuard validates CWD against workspace roots |
| Resource exhaustion (fork bomb) | Denial of Service | Rate limiting: max 10/min, max 2 concurrent, 1s cooldown |
| Output memory exhaustion | Denial of Service | 1MB per stream cap with truncation |
| Zombie process accumulation | Denial of Service | tree-kill ensures full process tree cleanup on timeout |
| Interactive command hang (sudo, read) | Denial of Service | stdin set to "ignore" prevents interactive prompts |

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/service/FileToolService.ts`, `src/config/fileToolConfig.ts`, `src/service/FilePathGuard.ts`, `src/config/skillsRegistry.ts`, `src/entityTypes/skillTypes.ts`, `src/service/ToolExecutor.ts`, `src/service/RateLimiter.ts`
- npm registry: `tree-kill` v1.2.2, MIT license (verified 2026-04-23)
- CONTEXT.md locked decisions D-01 through D-21

### Secondary (MEDIUM confidence)
- Node.js child_process documentation (spawn, stdio configuration, error/close events) [ASSUMED -- based on well-established Node.js API documentation]

### Tertiary (LOW confidence)
- None -- all findings are based on verified codebase patterns or npm registry verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries verified via npm registry and existing codebase
- Architecture: HIGH - pattern directly replicated from working FileToolService implementation
- Pitfalls: HIGH - based on well-documented Node.js spawn behaviors and existing codebase experience

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (stable domain -- Node.js spawn patterns don't change rapidly)
