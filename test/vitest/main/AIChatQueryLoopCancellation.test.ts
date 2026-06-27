/**
 * Unit tests for AIChatQueryLoop cancellation behaviour.
 *
 * Verifies that executeToolWithTimeout:
 *   1. Creates a CancellationToken and propagates its AbortSignal via the
 *      SkillExecutionContext passed to deps.executeTool.
 *   2. Aborts the token when the timeout fires.
 *   3. Returns a { timedOut: true } result on timeout.
 *
 * The ToolTimeoutPolicy is mocked so "fast" maps to 50ms, keeping the test
 * fast and deterministic. Heavy dependencies (ToolExecutor, IPC modules) are
 * also mocked so the module can be imported cleanly under vitest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Module-level mocks -------------------------------------------------
// We must mock these BEFORE importing AIChatQueryLoop because the module
// touches them at import-time (top-level side effects in ToolExecutor etc.).

vi.mock("@/service/ToolTimeoutPolicy", () => ({
  inferTimeoutClassByName: () => "fast" as const,
  resolveTimeoutMs: () => 50,
  TOOL_TIMEOUT_POLICY: { fast: 50, network: 90_000, browser: 240_000 },
}));

vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: class {
    static partialSnapshots = new Map();
    static updatePartialSnapshot(): void {
      /* no-op for test */
    }
    static async requestPartialSnapshot() {
      return null;
    }
    static unregisterPartialSnapshot(): void {
      /* no-op for test */
    }
  },
}));

vi.mock("@/service/ToolJobRegistry", () => ({
  getDefaultToolJobRegistry: () => ({
    submit: () => "job-1",
    getStatus: () => ({ status: "running" }),
  }),
}));

vi.mock("@/config/usersetting", () => ({
  Token: class {
    getValue() {
      return "";
    }
  },
  USER_AI_ENABLED: "true",
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return "";
    }
  },
}));

// After mocks are in place, import the module under test.
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";

/** Type-erased accessor so we can call the private method from tests. */
interface LoopWithInternals {
  executeToolWithTimeout: (
    input: Record<string, unknown>,
    call: { id: string; name: string; arguments?: Record<string, unknown> }
  ) => Promise<Record<string, unknown>>;
}

/** Minimal event sink stub that satisfies the interface without empty-function lint. */
function makeEventSinkStub(): { emit: (e: unknown) => void } {
  const events: unknown[] = [];
  return {
    emit: (e: unknown) => {
      events.push(e);
    },
  };
}

/** Build the loop input shape expected by executeToolWithTimeout. */
function makeLoopInput(): Record<string, unknown> {
  return {
    conversationId: "c1",
    assistantMessageId: "m1",
    eventSink: makeEventSinkStub(),
    skillRegistry: undefined,
  };
}

describe("AIChatQueryLoop cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aborts the CancellationToken when the timeout fires", async () => {
    let capturedSignal: AbortSignal | undefined;

    const fakeDeps = {
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(() => undefined),
      async executeTool(
        name: string,
        args: Record<string, unknown>,
        ctx: { signal?: AbortSignal }
      ) {
        capturedSignal = ctx.signal;
        // Block longer than the 50ms timeout to simulate a non-cooperative tool
        await new Promise((r) => setTimeout(r, 500));
        return {
          tool_call_id: "t1",
          tool_name: name,
          success: true,
          result: { ok: true, args },
          execution_time_ms: 500,
        };
      },
    };

    const loop = new AIChatQueryLoop(
      fakeDeps as unknown as ConstructorParameters<typeof AIChatQueryLoop>[0]
    );

    const result = await (loop as unknown as LoopWithInternals).executeToolWithTimeout(
      makeLoopInput(),
      { id: "t1", name: "file_read", arguments: {} }
    );

    // The result should be a timeout failure
    expect(result.success).toBe(false);
    expect(result.result).toMatchObject({ timedOut: true });

    // The AbortSignal must have been propagated and marked as aborted
    expect(capturedSignal).toBeDefined();
    if (capturedSignal) {
      expect(capturedSignal.aborted).toBe(true);
    }
  });

  it("returns the tool result when it completes before the timeout", async () => {
    const fakeDeps = {
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(() => undefined),
      async executeTool(
        name: string,
        args: Record<string, unknown>,
        ctx: { signal?: AbortSignal }
      ) {
        // Complete well within the 50ms timeout
        await new Promise((r) => setTimeout(r, 5));
        return {
          tool_call_id: "t2",
          tool_name: name,
          success: true,
          result: { data: 42, args, signalPresent: !!ctx.signal },
          execution_time_ms: 5,
        };
      },
    };

    const loop = new AIChatQueryLoop(
      fakeDeps as unknown as ConstructorParameters<typeof AIChatQueryLoop>[0]
    );

    const result = await (loop as unknown as LoopWithInternals).executeToolWithTimeout(
      makeLoopInput(),
      { id: "t2", name: "file_read", arguments: {} }
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ data: 42 });
  });

  it("includes abortReason in the timeout result", async () => {
    const fakeDeps = {
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(() => undefined),
      async executeTool(
        name: string,
        args: Record<string, unknown>,
        ctx: { signal?: AbortSignal }
      ) {
        // Never resolves — simulates a fully hung tool
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        await new Promise<void>(() => {
          /* intentional: never resolve */
        });
        // Unreachable but keeps TS happy about the return type
        return {
          tool_call_id: "t3",
          tool_name: name,
          success: true,
          result: { args, signalPresent: !!ctx.signal },
          execution_time_ms: 0,
        };
      },
    };

    const loop = new AIChatQueryLoop(
      fakeDeps as unknown as ConstructorParameters<typeof AIChatQueryLoop>[0]
    );

    const result = await (loop as unknown as LoopWithInternals).executeToolWithTimeout(
      makeLoopInput(),
      { id: "t3", name: "file_read", arguments: {} }
    );

    expect(result.success).toBe(false);
    expect(result.result).toMatchObject({
      timedOut: true,
      abortReason: "timeout",
    });
  });
});
