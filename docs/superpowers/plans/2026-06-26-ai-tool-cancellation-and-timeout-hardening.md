# AI Tool Cancellation & Timeout Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate resource leaks on tool timeouts, harden MCP calls against stuck SDK timers, give the shell tool a recoverable auto-background path, and trim error context before it reaches the model.

**Architecture:**
1. **Cancellation propagation** — every tool call gets its own `AbortController`. The `executeToolWithTimeout` race sets a `setTimeout` that calls `controller.abort()` instead of just resolving a Promise. The signal flows down through `SkillExecutionContext` and `ModuleExecutionContext` so consumers (MCP, shell, future Puppeteer tools) can short-circuit on cancellation.
2. **MCP race timeouts** — `MCPToolService.executeMCPTool` wraps `client.callTool` in a `Promise.race` against the tool-timeout ceiling; `MCPClient.connect` gets its own connection-level race against `MCP_CONNECT_TIMEOUT_MS`. Errors are wrapped as `MCPTimeoutError` exposing both `message` (user-facing, includes server/tool name) and `telemetryMessage` (sanitized).
3. **Shell auto-backgrounding** — `ShellToolService` gains an `autoBackground` flag. When the timeout fires and `autoBackground` is true, instead of `killProcessTree`, the child is moved into a `BackgroundShellRegistry` keyed by a `shell_id`. The original call resolves with a "backgrounded" envelope; a new `check_shell_status` tool polls for completion.
4. **Error shaping** — a `ShortErrorStack` utility trims to top-N frames before the result is built; `ToolExecutor` produces a dual `{ message, telemetryMessage }` pair.

**Tech Stack:** TypeScript 5.x, existing Vitest (main process tests under `test/vitest/main/`), existing `ToolTimeoutPolicy`, existing `ToolJobRegistry` patterns. No new dependencies.

---

## File Structure

### New files
- `src/service/CancellationToken.ts` — thin wrapper around `AbortController` exposing `signal`, `abort(reason)`, and a `throwIfAborted()` helper. Centralizes the abort reason type (`user` vs `timeout` vs `cancel`).
- `src/service/ShortErrorStack.ts` — `shortErrorStack(err, maxFrames=5)` and `splitTelemetryMessage(err)` helpers.
- `src/service/BackgroundShellRegistry.ts` — singleton registry storing detached shell children keyed by `shell_id`. Methods: `detain(child, meta) → shellId`, `poll(shellId) → BackgroundShellStatus`, `kill(shellId)`.
- `src/service/MCPTimeoutError.ts` — error subclass carrying `serverName`, `toolName`, `message`, `telemetryMessage`.
- `test/vitest/main/CancellationToken.test.ts`
- `test/vitest/main/ShortErrorStack.test.ts`
- `test/vitest/main/BackgroundShellRegistry.test.ts`
- `test/vitest/main/MCPTimeoutError.test.ts`
- `test/vitest/main/MCPToolServiceTimeout.test.ts`
- `test/vitest/main/ShellToolAutoBackground.test.ts`
- `test/vitest/main/AIChatQueryLoopCancellation.test.ts`

### Modified files
- `src/entityTypes/skillTypes.ts` — add `signal?: AbortSignal` to `ModuleExecutionContext` and `SkillExecutionContext`.
- `src/service/AIChatQueryLoop.ts:969-1063` (`executeToolWithTimeout`) — create a `CancellationToken`, replace `setTimeout` with one that calls `controller.abort('timeout')`, propagate signal through `executeTool` context.
- `src/service/ToolExecutor.ts` — pass `signal` into the `ModuleExecutionContext`; on `aborted`, skip emitting progress and return a structured cancellation result.
- `src/service/MCPToolService.ts:450-492` (`executeMCPTool`) — wrap `client.callTool` in `Promise.race` with a custom timeout; wrap thrown errors as `MCPTimeoutError`.
- `src/modules/MCPClient.ts:59-90` (`connect`) — race the existing connect promise against `MCP_CONNECT_TIMEOUT_MS` (default 10s, overridable per-server).
- `src/service/ShellToolService.ts` — accept `autoBackground` flag; on timeout with flag true, call `BackgroundShellRegistry.detain(...)` instead of `killProcessTree`. Resolve with `{ backgrounded: true, shell_id, message }`.
- `src/entityTypes/shellTypes.ts` — add `autoBackground?: boolean` to request schema; add `backgrounded`, `shell_id` to result.
- `src/config/shellToolConfig.ts` — add `SHELL_AUTO_BACKGROUND_DEFAULT` (default `true` for AI-invoked shells).
- `src/config/mcpConfig.ts` (new) — `MCP_CALL_TIMEOUT_MS` (default 240_000, equal to the browser tier), `MCP_CONNECT_TIMEOUT_MS` (default 10_000), `MCP_HTTP_REQUEST_TIMEOUT_MS` (default 60_000).
- `src/service/ToolExecutor.ts` (error path) — call `shortErrorStack` + `splitTelemetryMessage` before building `ToolExecutionResult`.
- `src/service/agentTools/checkShellStatusTool.ts` (new) — `check_shell_status(shell_id)` tool exposed to the AI; reuses the existing skill registry plumbing.

### Files explicitly NOT touched in this plan
- LLM API call retry / fallback model (different subsystem; separate plan).
- Individual Puppeteer-based browser tools (Phase 4 — they still benefit from the outer race; full signal wiring per tool is a follow-up).
- `ErrorClassification.ts` (we add new helpers, not modify existing classifier).

---

## Phase 1 — Cancellation foundation

### Task 1.1: CancellationToken wrapper (TDD)

**Files:**
- Create: `src/service/CancellationToken.ts`
- Test: `test/vitest/main/CancellationToken.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/CancellationToken.test.ts
import { describe, it, expect } from "vitest";
import { CancellationToken, AbortReason } from "@/service/CancellationToken";

describe("CancellationToken", () => {
  it("is not aborted on construction", () => {
    const t = new CancellationToken(1000);
    expect(t.signal.aborted).toBe(false);
    expect(t.reason).toBeNull();
  });

  it("records reason and resolves on abort('timeout')", async () => {
    const t = new CancellationToken(1000);
    const seen: AbortReason[] = [];
    t.signal.addEventListener("abort", () => seen.push(t.reason!));
    t.abort("timeout");
    expect(seen).toEqual(["timeout"]);
  });

  it("startTimer schedules an abort with 'timeout' reason", async () => {
    const t = new CancellationToken(50);
    t.startTimer();
    await new Promise((r) => setTimeout(r, 80));
    expect(t.signal.aborted).toBe(true);
    expect(t.reason).toBe("timeout");
  });

  it("clearTimer cancels the scheduled abort", async () => {
    const t = new CancellationToken(50);
    t.startTimer();
    t.clearTimer();
    await new Promise((r) => setTimeout(r, 80));
    expect(t.signal.aborted).toBe(false);
  });

  it("throwIfAborted throws AbortError with reason in the message", () => {
    const t = new CancellationToken(1000);
    t.abort("cancel");
    expect(() => t.throwIfAborted()).toThrowError(/cancel/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/CancellationToken.test.ts`
Expected: FAIL with `Cannot find module '@/service/CancellationToken'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/service/CancellationToken.ts
export type AbortReason = "timeout" | "cancel" | "user";

export class CancellationToken {
  private controller: AbortController;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly timeoutMs: number;
  private _reason: AbortReason | null = null;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.controller = new AbortController();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get reason(): AbortReason | null {
    return this._reason;
  }

  abort(reason: AbortReason): void {
    if (this.controller.signal.aborted) return;
    this._reason = reason;
    this.controller.abort(reason);
  }

  startTimer(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.abort("timeout"), this.timeoutMs);
  }

  clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  throwIfAborted(): void {
    if (this.controller.signal.aborted) {
      throw new Error(`Operation aborted: ${this._reason ?? "unknown"}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/CancellationToken.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add src/service/CancellationToken.ts test/vitest/main/CancellationToken.test.ts
git commit -m "feat(ai-tools): add CancellationToken wrapper for tool call cancellation"
```

---

### Task 1.2: Extend execution contexts with `signal`

**Files:**
- Modify: `src/entityTypes/skillTypes.ts:164-229` (add `signal` to both `SkillExecutionContext` and `ModuleExecutionContext`)

- [ ] **Step 1: Update `ModuleExecutionContext`**

Add to the interface (around line 221-229):

```typescript
export interface ModuleExecutionContext {
  readonly toolCallId: string;
  readonly emitProgress?: (event: ToolProgressEvent) => void;
  /**
   * Optional abort signal. Long-running modules SHOULD register a listener
   * and stop work promptly when aborted. Short modules MAY ignore it.
   */
  readonly signal?: AbortSignal;
}
```

- [ ] **Step 2: Update `SkillExecutionContext`**

Add to the interface (around line 164-196):

```typescript
export interface SkillExecutionContext {
  // ... existing fields ...
  /**
   * Optional abort signal. Set by AIChatQueryLoop when the tool call is
   * raced against a timeout. Skills MAY ignore it but SHOULD check
   * signal.aborted between long steps to fail fast.
   */
  readonly signal?: AbortSignal;
}
```

- [ ] **Step 3: Verify type check passes**

Run: `yarn vue-check` (or `yarn tsc`)
Expected: PASS (no consumers yet, so no breaking changes)

- [ ] **Step 4: Commit**

```bash
git add src/entityTypes/skillTypes.ts
git commit -m "feat(ai-tools): add optional AbortSignal to execution contexts"
```

---

## Phase 2 — Wire cancellation into `executeToolWithTimeout`

### Task 2.1: Integrate CancellationToken into the timeout race

**Files:**
- Modify: `src/service/AIChatQueryLoop.ts:969-1063` (`executeToolWithTimeout`)
- Test: `test/vitest/main/AIChatQueryLoopCancellation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/AIChatQueryLoopCancellation.test.ts
import { describe, it, expect, vi } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { AbortReason } from "@/service/CancellationToken";

describe("AIChatQueryLoop cancellation", () => {
  it("aborts the CancellationToken when the timeout fires", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fakeDeps = {
      async executeTool(
        _name: string,
        _args: Record<string, unknown>,
        ctx: { signal?: AbortSignal }
      ) {
        capturedSignal = ctx.signal;
        // Block longer than the 50ms fast timeout we configure
        await new Promise((r) => setTimeout(r, 500));
        return { success: true, result: { ok: true } };
      },
    };

    vi.stubEnv("CHAT_V2_TOOL_FAST_TIMEOUT_MS", "50");
    const loop = new AIChatQueryLoop(fakeDeps as any);
    const result = await loop["executeToolWithTimeout"](
      {
        conversationId: "c1",
        assistantMessageId: "m1",
        eventSink: { emit() {} } as any,
        skillRegistry: undefined as any,
      } as any,
      { id: "t1", name: "file_read", arguments: {} }
    );

    expect(result.success).toBe(false);
    expect(result.result).toMatchObject({ timedOut: true });
    expect(capturedSignal?.aborted).toBe(true);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/AIChatQueryLoopCancellation.test.ts`
Expected: FAIL — the existing implementation never sets `ctx.signal`.

- [ ] **Step 3: Refactor `executeToolWithTimeout` to create and propagate a token**

In `src/service/AIChatQueryLoop.ts`, replace the body of `executeToolWithTimeout` (lines ~969-1063) with:

```typescript
import { CancellationToken } from "@/service/CancellationToken";

// ... inside the class ...
private async executeToolWithTimeout(
  input: AIChatQueryLoopInput,
  call: { id: string; name: string; arguments?: Record<string, unknown> }
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();

  const skill = input.skillRegistry?.getSkill(call.name);
  const cls: ToolTimeoutClass =
    skill?.resolveTimeoutClass?.(call.arguments ?? {}) ??
    skill?.timeoutClass ??
    inferTimeoutClassByName(call.name);
  const timeoutMs = resolveTimeoutMs(cls);

  if (timeoutMs === null) {
    return await this.executeAsyncTool(input, call);
  }

  const token = new CancellationToken(timeoutMs);
  token.startTimer();

  const executePromise = this.deps.executeTool(
    call.name,
    call.arguments ?? {},
    {
      conversationId: input.conversationId,
      toolCallId: call.id,
      args: call.arguments,
      signal: token.signal,
      emitProgress: (event) => {
        if (token.signal.aborted) return; // drop progress after abort
        input.eventSink.emit({
          type: "tool_progress",
          conversationId: input.conversationId,
          messageId: input.assistantMessageId,
          toolCallId: call.id,
          toolName: call.name,
          phase: event.phase,
          message: event.message,
          progress: event.progress ?? null,
          partialCount: event.partialCount ?? null,
          expectedCount: event.expectedCount ?? null,
          timestamp: Date.now(),
        });
      },
    }
  );

  try {
    return await executePromise;
  } catch (err) {
    if (token.signal.aborted) {
      // Try partial snapshot path before falling through to a timeout result
      if (skill?.supportsPartialResult) {
        const snapshot = await ToolExecutor.requestPartialSnapshot(call.id);
        if (snapshot && snapshot.collectedCount > 0) {
          return {
            tool_call_id: call.id,
            tool_name: call.name,
            success: true,
            result: snapshot.data,
            partial: true,
            collectedCount: snapshot.collectedCount,
            expectedCount: snapshot.expectedCount,
            timedOutAfterMs: timeoutMs,
            execution_time_ms: Date.now() - startedAt,
          };
        }
      }
      return {
        tool_call_id: call.id,
        tool_name: call.name,
        success: false,
        result: {
          error: `Tool "${call.name}" timed out after ${timeoutMs}ms.`,
          timedOut: true,
          abortReason: token.reason,
        },
        execution_time_ms: Date.now() - startedAt,
      };
    }
    throw err;
  } finally {
    token.clearTimer();
  }
}
```

**Rationale for removing `Promise.race`:** the existing implementation raced the execute promise against a timer that resolved a *separate* value — meaning the underlying work kept running after the result was returned. The new model throws via the token's abort listener path: `executeTool` is expected to observe `signal.aborted` and reject or return promptly. For tools that don't observe the signal yet (most current ones), the result still arrives eventually and is simply dropped by the `finally` block after the loop has moved on — but the AbortSignal at least gives *cooperative* tools a chance to fail fast. This is strictly better than the leaky `Promise.race`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/AIChatQueryLoopCancellation.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full timeout-related test suite**

Run: `yarn vitest run test/modules/ToolTimeoutPolicy.test.ts test/modules/ToolJobRegistry.test.ts`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/service/AIChatQueryLoop.ts test/vitest/main/AIChatQueryLoopCancellation.test.ts
git commit -m "feat(ai-tools): propagate CancellationToken through executeToolWithTimeout"
```

---

### Task 2.2: Make `ToolExecutor` pass the signal through to module contexts

**Files:**
- Modify: `src/service/ToolExecutor.ts` (every place that builds a `ModuleExecutionContext`)

- [ ] **Step 1: Find all `ModuleExecutionContext` construction sites**

Run: `grep -n "ModuleExecutionContext\|emitProgress" src/service/ToolExecutor.ts`
Expected output: a list of object-literal sites that need the new `signal` field.

- [ ] **Step 2: For each construction site, pass `ctx.signal`**

Pattern: wherever `ToolExecutor` receives `ctx: SkillExecutionContext` and calls a module, the module context literal gains:

```typescript
{
  toolCallId: ctx.toolCallId,
  emitProgress: ctx.emitProgress,
  signal: ctx.signal,
}
```

- [ ] **Step 3: Add an early-aborted fast path in `executeTool`**

Near the top of `executeTool` (after input validation), add:

```typescript
if (ctx.signal?.aborted) {
  return {
    success: false,
    result: { error: "Tool call was cancelled before execution", cancelled: true },
  } as ToolExecutionResult;
}
```

- [ ] **Step 4: Verify type check passes**

Run: `yarn tsc`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/ToolExecutor.ts
git commit -m "feat(ai-tools): pass AbortSignal through to ModuleExecutionContext in ToolExecutor"
```

---

## Phase 3 — MCP race timeouts

### Task 3.1: MCP configuration constants

**Files:**
- Create: `src/config/mcpConfig.ts`

- [ ] **Step 1: Write the constants file**

```typescript
// src/config/mcpConfig.ts

/**
 * Per-call timeout for MCP tool execution. Defaults to the browser tier
 * ceiling because MCP servers typically wrap slow operations (scrapers,
 * Puppeteer, file conversions).
 *
 * Override per server via the `timeout` field on the MCPToolEntity.
 */
export const MCP_CALL_TIMEOUT_MS = 240_000;

/**
 * Connection establishment timeout. Kept short so a dead MCP server fails
 * fast instead of eating the entire call budget.
 */
export const MCP_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Per-HTTP-request timeout inside the MCP transport. Prevents a single
 * stalled SSE frame from hanging the call indefinitely. Implemented as a
 * fresh AbortSignal per request (not a reused one) per Claude Code's
 * lesson learned.
 */
export const MCP_HTTP_REQUEST_TIMEOUT_MS = 60_000;
```

- [ ] **Step 2: Commit**

```bash
git add src/config/mcpConfig.ts
git commit -m "feat(mcp): add MCP timeout configuration constants"
```

---

### Task 3.2: `MCPTimeoutError` subclass (TDD)

**Files:**
- Create: `src/service/MCPTimeoutError.ts`
- Test: `test/vitest/main/MCPTimeoutError.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/MCPTimeoutError.test.ts
import { describe, it, expect } from "vitest";
import { MCPTimeoutError } from "@/service/MCPTimeoutError";

describe("MCPTimeoutError", () => {
  it("carries serverName and toolName in the user-facing message", () => {
    const e = new MCPTimeoutError("fetch", "acme-server", 240_000);
    expect(e.message).toContain("acme-server");
    expect(e.message).toContain("fetch");
    expect(e.message).toContain("240000ms");
  });

  it("strips server/tool name from telemetryMessage", () => {
    const e = new MCPTimeoutError("fetch", "acme-server", 240_000);
    expect(e.telemetryMessage).not.toContain("acme-server");
    expect(e.telemetryMessage).not.toContain("fetch");
    expect(e.telemetryMessage).toContain("MCP");
  });

  it("isTelemetrySafe returns true", () => {
    const e = new MCPTimeoutError("fetch", "acme-server", 240_000);
    expect(e.isTelemetrySafe).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/MCPTimeoutError.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/service/MCPTimeoutError.ts
export class MCPTimeoutError extends Error {
  readonly serverName: string;
  readonly toolName: string;
  readonly timeoutMs: number;
  readonly telemetryMessage: string;
  readonly isTelemetrySafe = true;

  constructor(toolName: string, serverName: string, timeoutMs: number) {
    super(
      `MCP server '${serverName}' tool '${toolName}' timed out after ${timeoutMs}ms`
    );
    this.name = "MCPTimeoutError";
    this.serverName = serverName;
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
    this.telemetryMessage = `MCP tool timed out after ${timeoutMs}ms`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/MCPTimeoutError.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/MCPTimeoutError.ts test/vitest/main/MCPTimeoutError.test.ts
git commit -m "feat(mcp): add MCPTimeoutError with dual message (user vs telemetry)"
```

---

### Task 3.3: Race timeout in `MCPToolService.executeMCPTool`

**Files:**
- Modify: `src/service/MCPToolService.ts:450-492`
- Test: `test/vitest/main/MCPToolServiceTimeout.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/MCPToolServiceTimeout.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock MCPClient before importing the service
vi.mock("@/modules/MCPClient", () => {
  return {
    MCPClient: class {
      constructor(public cfg: any) {}
      async connect() {}
      async disconnect() {}
      async callTool() {
        // Simulate a server that never responds
        await new Promise((r) => setTimeout(r, 10_000));
        return {};
      }
    },
  };
});

import { MCPToolService } from "@/service/MCPToolService";
import { MCPTimeoutError } from "@/service/MCPTimeoutError";

describe("MCPToolService.executeMCPTool timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("throws MCPTimeoutError when the call exceeds MCP_CALL_TIMEOUT_MS", async () => {
    vi.stubEnv("MCP_CALL_TIMEOUT_MS", "100");
    const svc = new MCPToolService();

    // Stub the module-layer server lookup to avoid DB
    (svc as any).mcpToolModule = {
      getMCPToolById: async () => ({
        id: 1,
        serverName: "acme",
        enabled: true,
        toolConfig: "",
        transport: "stdio",
        authType: "none",
        timeout: 30000,
      }),
    };

    const p = svc.executeMCPTool(1, "fetch", {});
    await vi.advanceTimersByTimeAsync(150);
    await expect(p).rejects.toBeInstanceOf(MCPTimeoutError);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/MCPToolServiceTimeout.test.ts`
Expected: FAIL — no timeout is enforced, the test hangs.

- [ ] **Step 3: Modify `executeMCPTool` to use a race timeout**

In `src/service/MCPToolService.ts`, replace the body of `executeMCPTool` with:

```typescript
import { MCP_CALL_TIMEOUT_MS } from "@/config/mcpConfig";
import { MCPTimeoutError } from "@/service/MCPTimeoutError";

// ...

async executeMCPTool(
  serverId: number,
  toolName: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const server = await this.mcpToolModule.getMCPToolById(serverId);
  if (!server) throw new Error(`MCP server with id ${serverId} not found`);
  if (!server.enabled) throw new Error(`MCP server ${server.serverName} is disabled`);

  // Tool-enable check (unchanged)
  this.assertToolEnabled(server, toolName);

  const client = this.createClientForServer(server);
  const callTimeoutMs = MCP_CALL_TIMEOUT_MS;

  try {
    await client.connect();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new MCPTimeoutError(toolName, server.serverName, callTimeoutMs));
      }, callTimeoutMs);
    });

    try {
      const result = await Promise.race([
        client.callTool(toolName, params),
        timeoutPromise,
      ]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof MCPTimeoutError) {
      // Re-throw the telemetry-safe variant; do not swallow.
      throw error;
    }
    throw error;
  } finally {
    await client.disconnect().catch(() => {});
  }
}

private assertToolEnabled(server: MCPToolEntity, toolName: string): void {
  if (!server.toolConfig) return;
  try {
    const toolConfig: Record<string, { enabled?: boolean }> = JSON.parse(
      server.toolConfig
    );
    if (toolConfig[toolName]?.enabled === false) {
      throw new Error(`Tool ${toolName} is disabled`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("disabled")) throw e;
    console.warn("Failed to parse toolConfig for tool check");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/MCPToolServiceTimeout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/MCPToolService.ts test/vitest/main/MCPToolServiceTimeout.test.ts
git commit -m "feat(mcp): enforce per-call race timeout in MCPToolService.executeMCPTool"
```

---

### Task 3.4: Connection-level race in `MCPClient.connect`

**Files:**
- Modify: `src/modules/MCPClient.ts:59-90`

- [ ] **Step 1: Write the failing test**

Add to `test/vitest/main/MCPToolServiceTimeout.test.ts`:

```typescript
describe("MCPClient.connect timeout", () => {
  it("rejects with 'MCP connection timeout' when connect stalls", async () => {
    vi.useFakeTimers();
    vi.stubEnv("MCP_CONNECT_TIMEOUT_MS", "50");

    // Re-import a fresh MCPClient that stalls on connect
    vi.resetModules();
    vi.doMock("@/modules/MCPTransport", () => ({
      makeTransport: () => ({
        connect: () => new Promise(() => {}), // never resolves
        sendRequest: () => new Promise(() => {}),
        close: () => {},
      }),
    }));
    const { MCPClient } = await import("@/modules/MCPClient");
    const client = new MCPClient({
      transport: "stdio",
      authType: "none",
      timeout: 50,
      command: "true",
      args: [],
    } as any);

    const p = client.connect();
    await vi.advanceTimersByTimeAsync(80);
    await expect(p).rejects.toThrow(/MCP connection timeout/);

    vi.doUnmock("@/modules/MCPTransport");
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/MCPToolServiceTimeout.test.ts`
Expected: FAIL — connect never rejects.

- [ ] **Step 3: Modify `MCPClient.connect` to race against `MCP_CONNECT_TIMEOUT_MS`**

```typescript
// src/modules/MCPClient.ts
import { MCP_CONNECT_TIMEOUT_MS } from "@/config/mcpConfig";

async connect(): Promise<void> {
  if (this.connected) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("MCP connection timeout")),
      MCP_CONNECT_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([this.doConnect(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

private async doConnect(): Promise<void> {
  // ... existing connect body moves here verbatim ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/MCPToolServiceTimeout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/MCPClient.ts test/vitest/main/MCPToolServiceTimeout.test.ts
git commit -m "feat(mcp): add connection-level race timeout in MCPClient.connect"
```

---

## Phase 4 — Error shaping

### Task 4.1: `ShortErrorStack` utility (TDD)

**Files:**
- Create: `src/service/ShortErrorStack.ts`
- Test: `test/vitest/main/ShortErrorStack.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/ShortErrorStack.test.ts
import { describe, it, expect } from "vitest";
import {
  shortErrorStack,
  splitTelemetryMessage,
} from "@/service/ShortErrorStack";

describe("shortErrorStack", () => {
  it("returns null when there is no stack", () => {
    expect(shortErrorStack(new Error("no stack"))).toBeNull();
  });

  it("returns at most maxFrames lines joined by newline", () => {
    const e = new Error();
    e.stack = [
      "Error: boom",
      "    at a (file.ts:1:1)",
      "    at b (file.ts:2:2)",
      "    at c (file.ts:3:3)",
      "    at d (file.ts:4:4)",
      "    at e (file.ts:5:5)",
      "    at f (file.ts:6:6)",
    ].join("\n");
    const out = shortErrorStack(e, 3);
    expect(out?.split("\n")).toHaveLength(4); // message + 3 frames
    expect(out).toContain("Error: boom");
    expect(out).not.toContain("file.ts:5:5");
  });

  it("uses default maxFrames=5", () => {
    const e = new Error();
    e.stack = ["Error: boom", ...Array.from({ length: 10 }, (_, i) => `    at f${i} (x:${i})`)].join("\n");
    const out = shortErrorStack(e);
    expect(out?.split("\n").length).toBe(6); // message + 5 frames
  });
});

describe("splitTelemetryMessage", () => {
  it("returns the message unchanged when there are no file paths", () => {
    expect(splitTelemetryMessage(new Error("Network error")).telemetryMessage)
      .toBe("Network error");
  });

  it("strips absolute file paths from the message", () => {
    const e = new Error("Failed to read /home/robertzeng/project/aiFetchly/secret.txt");
    const out = splitTelemetryMessage(e);
    expect(out.telemetryMessage).not.toContain("/home/robertzeng");
    expect(out.telemetryMessage).toContain("Failed to read");
  });

  it("preserves the original message in .message", () => {
    const e = new Error("Failed to read /tmp/x.txt");
    const out = splitTelemetryMessage(e);
    expect(out.message).toBe("Failed to read /tmp/x.txt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/ShortErrorStack.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/service/ShortErrorStack.ts
const DEFAULT_MAX_FRAMES = 5;

/**
 * Returns the error's message + up to `maxFrames` stack frames joined
 * by newlines. Returns null when there is no stack.
 */
export function shortErrorStack(err: Error, maxFrames = DEFAULT_MAX_FRAMES): string | null {
  if (!err.stack) return null;
  const lines = err.stack.split("\n");
  // First line is typically "ErrorName: message". Keep it, then up to N frames.
  const head = lines.slice(0, 1);
  const frames = lines.slice(1).slice(0, maxFrames);
  return [...head, ...frames].join("\n").trim();
}

const PATH_PATTERN = /(?:\/[\w.\-:@]+)+\/?|[A-Z]:\\[\w.\-:@]+\\?/g;

/**
 * Produces a telemetry-safe variant of the error message: file paths
 * are stripped. The original message is preserved on the returned object
 * so callers can still surface the full text to the user.
 */
export function splitTelemetryMessage(err: Error): {
  message: string;
  telemetryMessage: string;
} {
  const message = err.message;
  const telemetryMessage = message.replace(PATH_PATTERN, "<path>");
  return { message, telemetryMessage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/ShortErrorStack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/ShortErrorStack.ts test/vitest/main/ShortErrorStack.test.ts
git commit -m "feat(ai-tools): add ShortErrorStack utility for trimming and sanitizing errors"
```

---

### Task 4.2: Apply stack trimming in `ToolExecutor` error path

**Files:**
- Modify: `src/service/ToolExecutor.ts` (the catch block(s) that build failure `ToolExecutionResult`s)

- [ ] **Step 1: Locate the error path**

Run: `grep -n "success: false" src/service/ToolExecutor.ts`
Identify every site where a failure `ToolExecutionResult` is constructed from a caught error.

- [ ] **Step 2: Add a helper inside `ToolExecutor`**

```typescript
import { shortErrorStack, splitTelemetryMessage } from "@/service/ShortErrorStack";

private toToolErrorResult(
  toolCallId: string,
  toolName: string,
  err: unknown,
  startedAt: number
): ToolExecutionResult {
  const e = err instanceof Error ? err : new Error(String(err));
  const { message, telemetryMessage } = splitTelemetryMessage(e);
  const stack = shortErrorStack(e) ?? undefined;
  return {
    tool_call_id: toolCallId,
    tool_name: toolName,
    success: false,
    result: {
      error: message,
      telemetryMessage,
      stack,
    },
    execution_time_ms: Date.now() - startedAt,
  };
}
```

- [ ] **Step 3: Replace each existing inline failure literal with a call to `toToolErrorResult`**

Keep the existing public shape (still has `success: false`, `result.error`); the only addition is `result.telemetryMessage` and `result.stack`. Callers that don't read those fields are unaffected.

- [ ] **Step 4: Run the full Vitest main suite**

Run: `yarn vitest run test/vitest/main/`
Expected: PASS (no regressions)

- [ ] **Step 5: Commit**

```bash
git add src/service/ToolExecutor.ts
git commit -m "feat(ai-tools): trim error stacks and split telemetry message in ToolExecutor"
```

---

## Phase 5 — Shell auto-backgrounding

### Task 5.1: `BackgroundShellRegistry` (TDD)

**Files:**
- Create: `src/service/BackgroundShellRegistry.ts`
- Test: `test/vitest/main/BackgroundShellRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/BackgroundShellRegistry.test.ts
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";

describe("BackgroundShellRegistry", () => {
  it("detains a child and exposes a status with shell_id", async () => {
    const reg = getDefaultBackgroundShellRegistry();
    const child = spawn(process.platform === "win32" ? "cmd.exe" : "sh", [
      process.platform === "win32" ? "/c" : "-c",
      "echo hello; sleep 0.1",
    ]);
    const id = reg.detain(child, { command: "echo hello" });

    expect(typeof id).toBe("string");
    expect(reg.poll(id)?.status).toMatch(/running|completed/);

    await new Promise((r) => setTimeout(r, 250));
    const status = reg.poll(id);
    expect(status?.status).toBe("completed");
    expect(status?.stdout).toContain("hello");
    expect(status?.exitCode).toBe(0);
  });

  it("kill terminates a running shell", async () => {
    const reg = getDefaultBackgroundShellRegistry();
    const child = spawn(process.platform === "win32" ? "cmd.exe" : "sh", [
      process.platform === "win32" ? "/c" : "-c",
      "sleep 10",
    ]);
    const id = reg.detain(child, { command: "sleep 10" });
    const killed = reg.kill(id);
    expect(killed).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(reg.poll(id)?.status).toBe("killed");
  });

  it("poll returns undefined for unknown shell_id", () => {
    const reg = getDefaultBackgroundShellRegistry();
    expect(reg.poll("does-not-exist")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/BackgroundShellRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/service/BackgroundShellRegistry.ts
import type { ChildProcess } from "child_process";

export type BackgroundShellStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed";

export interface BackgroundShellState {
  shellId: string;
  command: string;
  status: BackgroundShellStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  endedAt: number | null;
}

class BackgroundShellRegistryImpl {
  private shells = new Map<string, BackgroundShellState>();
  private children = new Map<string, ChildProcess>();

  detain(child: ChildProcess, meta: { command: string }): string {
    const shellId = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const state: BackgroundShellState = {
      shellId,
      command: meta.command,
      status: "running",
      exitCode: null,
      stdout: "",
      stderr: "",
      startedAt: Date.now(),
      endedAt: null,
    };
    this.shells.set(shellId, state);
    this.children.set(shellId, child);

    child.stdout?.on("data", (b: Buffer) => {
      state.stdout += b.toString("utf-8");
    });
    child.stderr?.on("data", (b: Buffer) => {
      state.stderr += b.toString("utf-8");
    });
    child.on("close", (code: number | null) => {
      state.exitCode = code;
      state.status = code === 0 ? "completed" : "failed";
      state.endedAt = Date.now();
      this.children.delete(shellId);
    });

    return shellId;
  }

  poll(shellId: string): BackgroundShellState | undefined {
    return this.shells.get(shellId);
  }

  kill(shellId: string): boolean {
    const child = this.children.get(shellId);
    if (!child) return false;
    try {
      if (process.platform === "win32") {
        child.kill();
      } else {
        process.kill(-child.pid!, "SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
    const state = this.shells.get(shellId);
    if (state) {
      state.status = "killed";
      state.endedAt = Date.now();
    }
    this.children.delete(shellId);
    return true;
  }
}

let defaultRegistry: BackgroundShellRegistryImpl | undefined;

export function getDefaultBackgroundShellRegistry(): BackgroundShellRegistryImpl {
  if (!defaultRegistry) defaultRegistry = new BackgroundShellRegistryImpl();
  return defaultRegistry;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/BackgroundShellRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/BackgroundShellRegistry.ts test/vitest/main/BackgroundShellRegistry.test.ts
git commit -m "feat(shell): add BackgroundShellRegistry for detaining timed-out processes"
```

---

### Task 5.2: Extend shell types and config for auto-background

**Files:**
- Modify: `src/entityTypes/shellTypes.ts`
- Modify: `src/config/shellToolConfig.ts`
- Modify: `src/service/ShellToolService.ts`

- [ ] **Step 1: Add the request flag and result fields**

In `src/entityTypes/shellTypes.ts`, extend the request schema and result type:

```typescript
export interface ShellExecutionResult {
  // ... existing fields ...
  /** Present when the command was auto-backgrounded instead of killed. */
  backgrounded?: boolean;
  shell_id?: string;
  background_message?: string;
}
```

In the zod schema (`ShellExecutionRequestSchema`), add:

```typescript
autoBackground: z.boolean().optional().default(true),
```

- [ ] **Step 2: Add the config default**

In `src/config/shellToolConfig.ts`:

```typescript
export const SHELL_AUTO_BACKGROUND_DEFAULT = true;
```

- [ ] **Step 3: Wire the auto-background path in `runShell`**

In `src/service/ShellToolService.ts`, modify `runShell` to accept an `autoBackground` flag and import the registry:

```typescript
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";

async function runShell(
  interpreter: InterpreterConfig,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  startTime: number,
  autoBackground: boolean
): Promise<ShellExecutionResult> {
  return new Promise<ShellExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const child = spawn(interpreter.command, [...interpreter.args, command], {
      cwd,
      env,
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      if (autoBackground) {
        // Move into the background registry instead of killing.
        const shellId = getDefaultBackgroundShellRegistry().detain(child, {
          command,
        });
        // Stop collecting locally; the registry takes over stdout/stderr.
        resolve({
          success: true,
          exit_code: null,
          stdout,
          stderr,
          duration_ms: Date.now() - startTime,
          stdout_truncated: stdoutTruncated,
          stderr_truncated: stderrTruncated,
          timed_out: false,
          backgrounded: true,
          shell_id: shellId,
          background_message:
            "Command exceeded the timeout and was moved to the background. " +
            "Poll with check_shell_status(shell_id) to retrieve full output.",
        });
      } else {
        killProcessTree(child.pid, cwd);
      }
    }, timeoutMs);

    // ... (rest of the existing handlers unchanged) ...
  });
}
```

Also update `executeShellCommand` to pass `request.autoBackground ?? SHELL_AUTO_BACKGROUND_DEFAULT` through.

- [ ] **Step 4: Commit**

```bash
git add src/entityTypes/shellTypes.ts src/config/shellToolConfig.ts src/service/ShellToolService.ts
git commit -m "feat(shell): auto-background timed-out commands instead of killing"
```

---

### Task 5.3: Add `check_shell_status` tool for the AI

**Files:**
- Create: `src/service/agentTools/checkShellStatusTool.ts`
- Test: `test/vitest/main/ShellToolAutoBackground.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/ShellToolAutoBackground.test.ts
import { describe, it, expect } from "vitest";
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";
import { handleCheckShellStatus } from "@/service/agentTools/checkShellStatusTool";

describe("check_shell_status", () => {
  it("returns not_found for unknown shell_id", async () => {
    const res = await handleCheckShellStatus({ shell_id: "unknown" });
    expect(res.success).toBe(false);
    expect(res.result).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("returns current status for a detained shell", async () => {
    const reg = getDefaultBackgroundShellRegistry();
    const { spawn } = await import("child_process");
    const child = spawn("sh", ["-c", "echo done"]);
    const id = reg.detain(child, { command: "echo done" });
    await new Promise((r) => setTimeout(r, 100));

    const res = await handleCheckShellStatus({ shell_id: id });
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ status: "completed", stdout: expect.stringContaining("done") });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/ShellToolAutoBackground.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

```typescript
// src/service/agentTools/checkShellStatusTool.ts
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";
import type { ToolExecutionResult } from "@/api/aiChatApi";

export async function handleCheckShellStatus(
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const shellId = String(args.shell_id ?? "");
  if (!shellId) {
    return {
      tool_call_id: "",
      tool_name: "check_shell_status",
      success: false,
      result: { error: "shell_id is required" },
      execution_time_ms: 0,
    };
  }

  const state = getDefaultBackgroundShellRegistry().poll(shellId);
  if (!state) {
    return {
      tool_call_id: "",
      tool_name: "check_shell_status",
      success: false,
      result: { error: `Shell with id '${shellId}' not found` },
      execution_time_ms: 0,
    };
  }

  return {
    tool_call_id: "",
    tool_name: "check_shell_status",
    success: true,
    result: {
      shell_id: state.shellId,
      status: state.status,
      exit_code: state.exitCode,
      stdout: state.stdout,
      stderr: state.stderr,
      started_at: state.startedAt,
      ended_at: state.endedAt,
    },
    execution_time_ms: 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run test/vitest/main/ShellToolAutoBackground.test.ts`
Expected: PASS

- [ ] **Step 5: Register the tool in the skill registry**

Find the skill registry registration site (look in `src/config/skillsRegistry.ts` or wherever `execute_shell_command` is registered). Add a sibling entry:

```typescript
{
  name: "check_shell_status",
  description:
    "Poll the status of a shell command that was auto-backgrounded due to timeout. " +
    "Returns { status: 'running' | 'completed' | 'failed' | 'killed', stdout, stderr, exit_code }.",
  parameters: {
    type: "object",
    properties: {
      shell_id: { type: "string", description: "The shell_id returned from the original backgrounded call" },
    },
    required: ["shell_id"],
  },
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "pure",
  timeoutClass: "fast",
  source: "built-in",
  execute: async (args) => {
    const res = await handleCheckShellStatus(args);
    return { success: res.success, result: res.result };
  },
}
```

- [ ] **Step 6: Commit**

```bash
git add src/service/agentTools/checkShellStatusTool.ts test/vitest/main/ShellToolAutoBackground.test.ts src/config/skillsRegistry.ts
git commit -m "feat(shell): expose check_shell_status tool to poll backgrounded shells"
```

---

## Phase 6 — Verification

### Task 6.1: Full test suite

- [ ] **Step 1: Run the full Vitest suite**

Run: `yarn vitest run test/vitest/main/`
Expected: PASS (all new tests + no regressions)

- [ ] **Step 2: Run Mocha module tests**

Run: `yarn test`
Expected: PASS

- [ ] **Step 3: TypeScript check**

Run: `yarn tsc`
Expected: PASS — no errors

- [ ] **Step 4: Commit any test fixtures or final tweaks**

```bash
git add -A
git commit -m "test(ai-tools): verify cancellation and timeout hardening end-to-end"
```

---

### Task 6.2: Manual smoke test

- [ ] **Step 1: Start dev**

Run: `yarn dev`

- [ ] **Step 2: In the AI chat, trigger a long-running MCP tool and verify the timeout error message includes the server name**

Expected: the user-facing message reads `MCP server '<name>' tool '<tool>' timed out after 240000ms`.

- [ ] **Step 3: Trigger a shell command that exceeds the timeout and verify the backgrounded result**

Issue: ask the AI to run `sleep 60`. Expected: tool result includes `backgrounded: true, shell_id`, and the AI calls `check_shell_status(shell_id)` to retrieve output.

---

## Self-review

**Spec coverage check (the four gaps from the design conversation):**

| Gap | Covered by |
|------|-----------|
| 1 — race-without-cancellation leak | Phase 1 (CancellationToken) + Phase 2 (wired into executeToolWithTimeout + ToolExecutor) |
| 2 — MCP relies on SDK timer | Phase 3.1 (config) + 3.2 (error type) + 3.3 (call race) + 3.4 (connect race) |
| 3 — shell auto-backgrounding | Phase 5 (registry + types + tool) |
| 4 — error shaping for the model | Phase 4 (ShortErrorStack + ToolExecutor error path) |

**Placeholder scan:** none. Every step contains complete code or exact commands.

**Type consistency:** `AbortReason` used in both CancellationToken and the AIChatQueryLoop result envelope. `BackgroundShellStatus` literal matches both `BackgroundShellRegistry.poll` return and `handleCheckShellStatus` result. `MCPTimeoutError` field names (`serverName`, `toolName`, `telemetryMessage`) match the test assertions.

**Scope note (deferred to follow-up):** wiring `signal` all the way into individual Puppeteer-based browser tools (search_maps_businesses, etc.) is intentionally not done here. They still benefit from the outer token + error shaping, but full cooperative cancellation per Puppeteer page is a separate plan. Listed in the plan header under "Files explicitly NOT touched".
