/**
 * Unit tests for AIChatQueryLoop async-tool permission propagation.
 *
 * Async tool jobs (e.g. search_maps_businesses with include_website=true)
 * resolve with the full SkillExecutor ToolExecutionResult. pollAsyncJobToCompletion
 * must propagate that result unwrapped so isPermissionPromptResult can detect
 * needsPermissionPrompt; otherwise the permission card never renders and the
 * "Permission required" error is treated as a plain tool failure.
 *
 * Heavy dependencies (ToolExecutor, IPC modules) are mocked so the module can
 * be imported cleanly under vitest, mirroring AIChatQueryLoopCancellation.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Module-level mocks -------------------------------------------------

vi.mock("@/service/ToolTimeoutPolicy", () => ({
  inferTimeoutClassByName: () => "browser" as const,
  resolveTimeoutMs: () => 240_000,
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

vi.mock("@/config/usersetting", () => ({
  Token: class {
    getValue() {
      return "";
    }
  },
  USER_AI_ENABLED: "true",
  TOKENNAME: "user-social-market-token",
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return "";
    }
  },
}));

// After mocks are in place, import the module under test.
import {
  AIChatQueryLoop,
  isPermissionPromptResult,
} from "@/service/AIChatQueryLoop";
import {
  ToolJobRegistry,
  setDefaultToolJobRegistry,
} from "@/service/ToolJobRegistry";

/** Type-erased accessor so we can call the private method from tests. */
interface LoopWithInternals {
  pollAsyncJobToCompletion: (
    input: Record<string, unknown>,
    call: { id: string; name: string },
    jobId: string
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

/** Build the loop input shape expected by pollAsyncJobToCompletion. */
function makeLoopInput(): Record<string, unknown> {
  return {
    conversationId: "c1",
    assistantMessageId: "m1",
    eventSink: makeEventSinkStub(),
    abortController: new AbortController(),
    request: { model: "test-model" },
  };
}

function fastRegistry(): ToolJobRegistry {
  return new ToolJobRegistry({
    maxConcurrent: 4,
    staleAfterMs: 60_000,
    pollMinIntervalMs: 1,
  });
}

describe("AIChatQueryLoop async permission propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setDefaultToolJobRegistry(new ToolJobRegistry());
  });

  it("propagates a permission-prompt ToolExecutionResult unwrapped", async () => {
    const reg = fastRegistry();
    setDefaultToolJobRegistry(reg);
    const { jobId } = reg.start(
      "search_maps_businesses",
      { query: "dentist", location: "New York" },
      { conversationId: "c1", toolCallId: "call_123" },
      async (handle) => {
        handle.resolve({
          tool_call_id: "call_123",
          tool_name: "search_maps_businesses",
          success: false,
          result: {
            error: "Permission required",
            needsPermissionPrompt: true,
            permissionCategory: "automation",
          },
          execution_time_ms: 1,
        });
      }
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(() => undefined),
      executeTool: vi.fn(),
    } as unknown as ConstructorParameters<typeof AIChatQueryLoop>[0]);

    const result = await (loop as unknown as LoopWithInternals).pollAsyncJobToCompletion(
      makeLoopInput(),
      { id: "call_123", name: "search_maps_businesses" },
      jobId
    );

    // needsPermissionPrompt must live at result.result so downstream
    // permission detection works — not nested under result.result.result.
    expect(result.result).toMatchObject({
      error: "Permission required",
      needsPermissionPrompt: true,
      permissionCategory: "automation",
    });
    expect(result.success).toBe(false);
    expect(
      isPermissionPromptResult(
        result as unknown as Parameters<typeof isPermissionPromptResult>[0]
      )
    ).toBe(true);
  }, 25_000);

  it("keeps the bare-data fallback for non-ToolExecutionResult resolutions", async () => {
    const reg = fastRegistry();
    setDefaultToolJobRegistry(reg);
    const { jobId } = reg.start(
      "some_tool",
      {},
      { conversationId: "c1", toolCallId: "t1" },
      async (handle) => {
        handle.resolve({ data: 42 });
      }
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      getSkillDefinition: vi.fn(() => undefined),
      executeTool: vi.fn(),
    } as unknown as ConstructorParameters<typeof AIChatQueryLoop>[0]);

    const result = await (loop as unknown as LoopWithInternals).pollAsyncJobToCompletion(
      makeLoopInput(),
      { id: "t1", name: "some_tool" },
      jobId
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ data: 42 });
  }, 25_000);
});
