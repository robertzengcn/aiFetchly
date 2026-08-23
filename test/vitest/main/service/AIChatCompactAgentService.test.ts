import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import type { AIChatCompactAgentDeps } from "@/service/AIChatCompactAgentService";
import type { OpenAIChatCompletionResponse } from "@/api/aiChatApi";
import type { AIChatLightweightCompletionResult } from "@/service/AIChatLightweightTypes";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";

// --- Mocks --------------------------------------------------------------
const mockGetByConversation = vi.fn();
const mockUpsertMemory = vi.fn();
const mockMarkUpdating = vi.fn();
const mockRecordFailure = vi.fn();
const mockResetFailures = vi.fn();

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: mockGetByConversation,
    upsertMemory: mockUpsertMemory,
    markUpdating: mockMarkUpdating,
    recordFailure: mockRecordFailure,
    resetFailures: mockResetFailures,
  })),
}));

const mockGetConversationMessages = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockSaveFullCompact = vi.fn();
const mockMarkSuperseded = vi.fn();

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversationMessages: mockGetConversationMessages,
    getDefaultSystemPrompt: vi.fn().mockReturnValue("sysp"),
    createConversationIfNeeded: vi.fn((id?: string) => id ?? "v2-x"),
  })),
}));

vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: mockGetActiveSummary,
    saveFullCompact: mockSaveFullCompact,
    markSuperseded: mockMarkSuperseded,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

function makeCompletion(text: string): OpenAIChatCompletionResponse {
  return {
    id: "resp-1",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  };
}

function makeAgent(opts: {
  aiEnabled?: boolean;
  completeChat?: (req: unknown) => Promise<OpenAIChatCompletionResponse>;
  getContextWindow?: (model?: string) => Promise<number>;
  getSmallModelCapability?: () => Promise<
    import("@/api/aiChatApi").OpenAISmallModelCapability | null
  >;
  onAutoCompacted?: (summary: AIChatCompactSummaryView) => void;
}) {
  const tokenService = new Token();
  // Wrap a raw-response mock into the lightweight result shape the service
  // now consumes. Returns the spy so existing `completeChat` call assertions
  // keep working (callers pass `completeChat`; the spy records those calls).
  const wrap = (
    fn: (req: unknown) => Promise<OpenAIChatCompletionResponse>
  ): AIChatCompactAgentDeps["completeLightweight"] => {
    const spy = vi.fn(async (input: unknown) => {
      const response = await fn(input);
      return {
        response,
        route: "provider_normal",
        resolvedModel: response.model ?? "test-model",
        providerKind: "hosted",
        attemptCount: 1,
        repairAttempted: false,
        fallbackAttempted: false,
      } as AIChatLightweightCompletionResult;
    });
    return spy as unknown as AIChatCompactAgentDeps["completeLightweight"];
  };
  const defaultFn = vi
    .fn()
    .mockResolvedValue(makeCompletion("# Session Memory\n## Current Goal\nx"));
  const completeLightweight = wrap(opts.completeChat ?? defaultFn);
  const deps = {
    completeLightweight,
    isEnabled: () => opts.aiEnabled ?? true,
    ...(opts.getContextWindow
      ? { getContextWindow: opts.getContextWindow }
      : {}),
    ...(opts.getSmallModelCapability
      ? { getSmallModelCapability: opts.getSmallModelCapability }
      : {}),
    ...(opts.onAutoCompacted ? { onAutoCompacted: opts.onAutoCompacted } : {}),
  };
  return new AIChatCompactAgentService(tokenService, deps);
}

/** Two plain message rows for conversation `convId` (timestamps 1 and 2). */
function messageRows(convId: string) {
  return [
    {
      messageId: "m1",
      conversationId: convId,
      role: "user",
      content: "hello",
      timestamp: new Date(1),
      messageType: "message",
    },
    {
      messageId: "m2",
      conversationId: convId,
      role: "assistant",
      content: "hi",
      timestamp: new Date(2),
      messageType: "message",
    },
  ];
}

/** Minimal compact summary view returned by saveFullCompact. */
function compactView(convId: string): AIChatCompactSummaryView {
  return {
    compactId: "compact-1",
    conversationId: convId,
    summary: "# Compact Summary\n## Primary Request\nx",
    throughMessageId: "m2",
    throughTimestamp: new Date(2).toISOString(),
    sourceMessageCount: 2,
    outputTokenEstimate: 120,
    model: "test-model",
    status: "active",
  };
}

describe("AIChatCompactAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    USER_AI_ENABLED;
  });

  it("skips session memory update when AI is disabled", async () => {
    const agent = makeAgent({ aiEnabled: false });
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-disabled",
      reason: "assistant_turn_completed",
    });
    expect(mockUpsertMemory).not.toHaveBeenCalled();
  });

  it("skips when conversationId is missing or non-v2", async () => {
    const agent = makeAgent({});
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "",
      reason: "test",
    });
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "legacy-conv",
      reason: "test",
    });
    expect(mockGetByConversation).not.toHaveBeenCalled();
  });

  it("updates session memory with new messages", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      {
        messageId: "m1",
        conversationId: "v2-new",
        role: "user",
        content: "hello",
        timestamp: new Date(1),
        messageType: "message",
      },
      {
        messageId: "m2",
        conversationId: "v2-new",
        role: "assistant",
        content: "hi",
        timestamp: new Date(2),
        messageType: "message",
      },
    ]);
    mockUpsertMemory.mockImplementation(async (input) => ({
      conversationId: input.conversationId,
      summary: input.summary,
      failureCount: 0,
      status: "active",
    }));

    const completeChat = vi
      .fn()
      .mockResolvedValue(
        makeCompletion("# Session Memory\n## Current Goal\nx")
      );
    const agent = makeAgent({ completeChat });

    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-new",
      reason: "assistant_turn_completed",
      // High tokens open the token-based gate on a fresh conversation.
      promptTokens: 103_000,
    });

    expect(completeChat).toHaveBeenCalled();
    expect(mockUpsertMemory).toHaveBeenCalled();
    const call = mockUpsertMemory.mock.calls[0][0];
    expect(call.conversationId).toBe("v2-new");
    expect(call.sourceMessageCount).toBe(2);
    expect(call.coveredThroughMessageId).toBe("m2");
    expect(call.failureCount).toBeUndefined();
  });

  it("skips when there are no new messages after boundary", async () => {
    mockGetByConversation.mockResolvedValue({
      conversationId: "v2-stale",
      coveredThroughMessageId: "m-last",
    });
    mockGetConversationMessages.mockResolvedValue([
      {
        messageId: "m-last",
        conversationId: "v2-stale",
        role: "user",
        content: "x",
        timestamp: new Date(1),
        messageType: "message",
      },
    ]);
    const agent = makeAgent({});
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-stale",
      reason: "test",
    });
    expect(mockUpsertMemory).not.toHaveBeenCalled();
  });

  it("records failure when the model call throws", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      {
        messageId: "m1",
        conversationId: "v2-fail",
        role: "user",
        content: "x",
        timestamp: new Date(1),
        messageType: "message",
      },
      {
        messageId: "m2",
        conversationId: "v2-fail",
        role: "assistant",
        content: "y",
        timestamp: new Date(2),
        messageType: "message",
      },
    ]);
    mockRecordFailure.mockResolvedValue({ failureCount: 1 });
    const completeChat = vi.fn().mockRejectedValue(new Error("boom"));
    const agent = makeAgent({ completeChat });

    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-fail",
      reason: "test",
      promptTokens: 103_000,
    });

    expect(mockRecordFailure).toHaveBeenCalledWith(
      "v2-fail",
      expect.any(String)
    );
  });

  it("does not run two updates for the same conversation in parallel", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      {
        messageId: "m1",
        conversationId: "v2-parallel",
        role: "user",
        content: "x",
        timestamp: new Date(1),
        messageType: "message",
      },
      {
        messageId: "m2",
        conversationId: "v2-parallel",
        role: "assistant",
        content: "y",
        timestamp: new Date(2),
        messageType: "message",
      },
    ]);
    mockUpsertMemory.mockResolvedValue({ failureCount: 0 });
    const holder: {
      resolve: ((v: OpenAIChatCompletionResponse) => void) | null;
    } = { resolve: null };
    const completeChat = vi.fn(
      () =>
        new Promise<OpenAIChatCompletionResponse>((r) => {
          holder.resolve = r;
        })
    );
    const agent = makeAgent({ completeChat });

    const p1 = agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-parallel",
      reason: "test",
      promptTokens: 103_000,
    });
    const p2 = agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-parallel",
      reason: "test",
      promptTokens: 103_000,
    });
    // Wait for p1 to reach the parked model call; p2 must skip via in-flight check.
    await vi.waitFor(() => expect(completeChat).toHaveBeenCalledTimes(1));
    holder.resolve?.(makeCompletion("# Session Memory\n## Current Goal\nx"));
    await Promise.all([p1, p2]);
    expect(completeChat).toHaveBeenCalledTimes(1);
  });

  describe("auto compact", () => {
    it("runs a full compact when promptTokens >= 80% of the real context window", async () => {
      mockGetActiveSummary.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue(messageRows("v2-auto"));
      mockSaveFullCompact.mockResolvedValue(compactView("v2-auto"));
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
      });

      // 0.8 * 8192 = 6553.6 -> 7000 trips the gate with the REAL window
      // (the old hard-coded 128k denominator would have skipped it).
      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto",
        reason: "assistant_turn_completed",
        promptTokens: 7000,
        model: "test-model",
      });

      expect(ran).toBe(true);
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
      expect(onAutoCompacted).toHaveBeenCalledTimes(1);
      expect(onAutoCompacted.mock.calls[0][0].conversationId).toBe("v2-auto");
    });

    it("skips below the threshold and reports false", async () => {
      mockGetActiveSummary.mockResolvedValue(null);
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
      });

      // AUTO_COMPACT_THRESHOLD_FRACTION is 0.7: floor(0.7 * 8192) = 5734,
      // so 5000 stays below the gate and must skip.
      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-low",
        reason: "assistant_turn_completed",
        promptTokens: 5000,
      });

      expect(ran).toBe(false);
      expect(mockGetConversationMessages).not.toHaveBeenCalled();
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
      expect(onAutoCompacted).not.toHaveBeenCalled();
    });

    it("falls back to the 128k default window when no resolver is wired", async () => {
      const agent = makeAgent({});

      // 80_000 < floor(0.7 * 128_000) = 89_600 -> skipped without a resolver.
      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-default",
        reason: "assistant_turn_completed",
        promptTokens: 80_000,
      });

      expect(ran).toBe(false);
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
    });

    it("skips when the active compact boundary already covers the latest message", async () => {
      mockGetActiveSummary.mockResolvedValue({
        throughTimestamp: new Date(100).toISOString(),
      });
      mockGetConversationMessages.mockResolvedValue(
        messageRows("v2-auto-bound")
      );
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
      });

      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-bound",
        reason: "assistant_turn_completed",
        promptTokens: 7000,
      });

      expect(ran).toBe(false);
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
      expect(onAutoCompacted).not.toHaveBeenCalled();
    });

    it("compacts when messages exist beyond the boundary", async () => {
      mockGetActiveSummary.mockResolvedValue({
        // Boundary sits between m1 (t=1) and m2 (t=2): m2 is new.
        throughTimestamp: new Date(1).toISOString(),
      });
      mockGetConversationMessages.mockResolvedValue(messageRows("v2-auto-new"));
      mockSaveFullCompact.mockResolvedValue(compactView("v2-auto-new"));
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
      });

      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-new",
        reason: "assistant_turn_completed",
        promptTokens: 7000,
      });

      expect(ran).toBe(true);
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
      expect(onAutoCompacted).toHaveBeenCalledTimes(1);
    });

    it("returns false and does not throw when the compact model call fails", async () => {
      mockGetActiveSummary.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue(messageRows("v2-auto-err"));
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        completeChat: vi.fn().mockRejectedValue(new Error("boom")),
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
      });

      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-err",
        reason: "assistant_turn_completed",
        promptTokens: 7000,
      });

      expect(ran).toBe(false);
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
      expect(onAutoCompacted).not.toHaveBeenCalled();
    });

    it("skips for non-v2 conversation ids and when AI is disabled", async () => {
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
      });

      expect(
        await agent.enqueueAutoCompact({
          conversationId: "legacy-conv",
          reason: "test",
          promptTokens: 7000,
        })
      ).toBe(false);
      expect(
        await agent.enqueueAutoCompact({
          conversationId: "v2-no-tokens",
          reason: "test",
        })
      ).toBe(false);
      expect(mockGetConversationMessages).not.toHaveBeenCalled();
    });
  });

  describe("threshold gate", () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    it("skips on a fresh conversation when tokens are below threshold", async () => {
      // Fresh agent: lastSessionMemoryAt is empty. The gate must lazy-init
      // the per-conversation timestamp to Date.now() and SKIP, rather than
      // treating the missing entry as epoch 0 (which would always be stale
      // and cause compaction to fire on every turn).
      const agent = makeAgent({});
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-gate-skip",
        reason: "test",
        promptTokens: 1000,
      });
      // No DB read, no LLM call.
      expect(mockGetByConversation).not.toHaveBeenCalled();
    });

    it("keeps skipping on subsequent low-token turns within the time window", async () => {
      const agent = makeAgent({});
      for (let i = 0; i < 5; i++) {
        await agent.enqueueSessionMemoryUpdate({
          conversationId: "v2-gate-skip-multi",
          reason: "test",
          promptTokens: 500 + i * 100,
        });
      }
      expect(mockGetByConversation).not.toHaveBeenCalled();
    });

    it("triggers when promptTokens >= 80% of context window", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue([
        {
          messageId: "m1",
          conversationId: "v2-gate-tokens",
          role: "user",
          content: "x",
          timestamp: new Date(1),
          messageType: "message",
        },
        {
          messageId: "m2",
          conversationId: "v2-gate-tokens",
          role: "assistant",
          content: "y",
          timestamp: new Date(2),
          messageType: "message",
        },
      ]);
      mockUpsertMemory.mockResolvedValue({ failureCount: 0 });
      const completeChat = vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Session Memory\n## Current Goal\nx")
        );
      const agent = makeAgent({ completeChat });

      // 0.8 * 128_000 = 102_400. 103_000 must trip the gate even on a
      // fresh conversation (token check fires before time check).
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-gate-tokens",
        reason: "test",
        promptTokens: 103_000,
      });

      expect(mockGetByConversation).toHaveBeenCalledWith("v2-gate-tokens");
      expect(completeChat).toHaveBeenCalled();
      expect(mockUpsertMemory).toHaveBeenCalled();
    });

    it("uses the real context window as the gate denominator when provided", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue(
        messageRows("v2-gate-real")
      );
      mockUpsertMemory.mockResolvedValue({ failureCount: 0 });
      const completeChat = vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Session Memory\n## Current Goal\nx")
        );
      const agent = makeAgent({
        completeChat,
        // Small-window model: 0.8 * 8192 = 6553.6. The hard-coded 128k
        // denominator would have skipped 7_000 forever.
        getContextWindow: vi.fn().mockResolvedValue(8192),
      });

      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-gate-real",
        reason: "test",
        promptTokens: 7_000,
      });

      expect(mockGetByConversation).toHaveBeenCalledWith("v2-gate-real");
      expect(completeChat).toHaveBeenCalled();
      expect(mockUpsertMemory).toHaveBeenCalled();
    });

    it("triggers when >60 min have passed since the first observation", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      try {
        mockGetByConversation.mockResolvedValue(null);
        mockGetConversationMessages.mockResolvedValue([
          {
            messageId: "m1",
            conversationId: "v2-gate-time",
            role: "user",
            content: "x",
            timestamp: new Date(1),
            messageType: "message",
          },
          {
            messageId: "m2",
            conversationId: "v2-gate-time",
            role: "assistant",
            content: "y",
            timestamp: new Date(2),
            messageType: "message",
          },
        ]);
        mockUpsertMemory.mockResolvedValue({ failureCount: 0 });
        const completeChat = vi
          .fn()
          .mockResolvedValue(
            makeCompletion("# Session Memory\n## Current Goal\nx")
          );
        const agent = makeAgent({ completeChat });

        // First call: low tokens + fresh timestamp (lazy-init to now) -> skip.
        await agent.enqueueSessionMemoryUpdate({
          conversationId: "v2-gate-time",
          reason: "test",
          promptTokens: 1000,
        });
        expect(completeChat).not.toHaveBeenCalled();

        // Advance past 60 min -> time gate opens.
        vi.setSystemTime(new Date("2026-01-01T01:01:00Z"));
        await agent.enqueueSessionMemoryUpdate({
          conversationId: "v2-gate-time",
          reason: "test",
          promptTokens: 1000,
        });
        expect(completeChat).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("resets the timer on success so an immediate second call is skipped", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue([
        {
          messageId: "m1",
          conversationId: "v2-gate-reset",
          role: "user",
          content: "x",
          timestamp: new Date(1),
          messageType: "message",
        },
        {
          messageId: "m2",
          conversationId: "v2-gate-reset",
          role: "assistant",
          content: "y",
          timestamp: new Date(2),
          messageType: "message",
        },
      ]);
      mockUpsertMemory.mockResolvedValue({ failureCount: 0 });
      const completeChat = vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Session Memory\n## Current Goal\nx")
        );
      const agent = makeAgent({ completeChat });

      // Force the gate open via high tokens so the LLM fires and the timer
      // gets reset on success.
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-gate-reset",
        reason: "test",
        promptTokens: 103_000,
      });
      expect(completeChat).toHaveBeenCalledTimes(1);

      // Second call immediately after success: low tokens + fresh timer -> skip.
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-gate-reset",
        reason: "test",
        promptTokens: 1000,
      });
      expect(completeChat).toHaveBeenCalledTimes(1);
    });
  });

  describe("small-model routing (session_memory_summary)", () => {
    beforeEach(() => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue([
        {
          messageId: "m1",
          conversationId: "v2-sm",
          role: "user",
          content: "x",
          timestamp: new Date(1),
          messageType: "message",
        },
        {
          messageId: "m2",
          conversationId: "v2-sm",
          role: "assistant",
          content: "y",
          timestamp: new Date(2),
          messageType: "message",
        },
      ]);
      mockUpsertMemory.mockResolvedValue({});
      mockResetFailures.mockResolvedValue(undefined);
      mockMarkUpdating.mockResolvedValue(undefined);
    });

    it("routes session-memory updates through the session_memory_summary workload", async () => {
      const completeChat = vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Session Memory\n## Current Goal\nx")
        );
      const agent = makeAgent({ completeChat });
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-sm",
        reason: "test",
        promptTokens: 103_000,
      });
      expect(completeChat).toHaveBeenCalledTimes(1);
      // The raw mock received the lightweight input carrying the workload id.
      const lwInput = completeChat.mock.calls[0]![0] as {
        workload: string;
      };
      expect(lwInput.workload).toBe("session_memory_summary");
    });

    it("first-failure persists circuit-breaker state even when no prior row exists", async () => {
      // No prior session-memory row (first run). recordFailure must still
      // create one so the breaker can trip (tech-design §15.3).
      const completeChat = vi.fn().mockRejectedValue(new Error("boom"));
      const agent = makeAgent({ completeChat });
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-sm",
        reason: "test",
        promptTokens: 103_000,
      });
      expect(mockRecordFailure).toHaveBeenCalledWith(
        "v2-sm",
        expect.any(String)
      );
    });

    it("cancelled signal aborts the session-memory update without surfacing", async () => {
      const completeChat = vi
        .fn()
        .mockRejectedValue(new DOMException("aborted", "AbortError"));
      const agent = makeAgent({ completeChat });
      // Should not throw past enqueueSessionMemoryUpdate.
      await expect(
        agent.enqueueSessionMemoryUpdate({
          conversationId: "v2-sm",
          reason: "test",
          promptTokens: 103_000,
        })
      ).resolves.toBeUndefined();
      // A failure is recorded so the breaker can react to repeated aborts.
      expect(mockRecordFailure).toHaveBeenCalled();
    });
  });

  describe("hierarchical full compact (conversation_compact)", () => {
    function bigRows(convId: string, n: number) {
      return Array.from({ length: n }, (_, i) => ({
        messageId: `m${i}`,
        conversationId: convId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(2000),
        timestamp: new Date(i + 1),
        messageType: "message",
      }));
    }

    beforeEach(() => {
      mockGetActiveSummary.mockResolvedValue(null);
      mockSaveFullCompact.mockClear();
      mockSaveFullCompact.mockResolvedValue(compactView("v2-hier"));
    });

    it("summarizes an oversized conversation in multiple bounded chunks and saves one final compact", async () => {
      // 30 messages x 2000 chars ~ a lot of tokens; a tiny context window
      // forces multiple chunks.
      mockGetConversationMessages.mockResolvedValue(bigRows("v2-hier", 30));
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\nchunk"));
      const agent = makeAgent({
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });

      const view = await agent.runFullCompact({
        conversationId: "v2-hier",
      });

      expect(view.conversationId).toBe("v2-hier");
      // More than one lightweight call (multiple chunks + possibly a merge).
      expect(completeChat.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Exactly one compact record activated.
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
    });

    it("a small conversation that fits one chunk makes exactly one completion call", async () => {
      mockGetConversationMessages.mockResolvedValue(messageRows("v2-hier"));
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\none"));
      const agent = makeAgent({
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(128_000),
      });

      await agent.runFullCompact({ conversationId: "v2-hier" });

      expect(completeChat).toHaveBeenCalledTimes(1);
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
      // The single-chunk response's resolved model is attributed to the saved
      // compact, NOT the input conversation model (PRD §11.3.1 / §17).
      const savedArg = mockSaveFullCompact.mock.calls[0]![0] as {
        model: string;
      };
      expect(savedArg.model).toBe("test-model");
    });

    it("capability absence falls back to the normal context window (does not block compact)", async () => {
      mockGetConversationMessages.mockResolvedValue(messageRows("v2-hier"));
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\nx"));
      const agent = makeAgent({
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(128_000),
        getSmallModelCapability: vi.fn().mockResolvedValue(null),
      });

      const view = await agent.runFullCompact({ conversationId: "v2-hier" });
      expect(view.conversationId).toBe("v2-hier");
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
    });

    it("an intermediate chunk failure leaves the previous active compact untouched", async () => {
      mockGetConversationMessages.mockResolvedValue(bigRows("v2-hier", 30));
      // First chunk succeeds, second chunk returns empty -> throws.
      const completeChat = vi
        .fn()
        .mockResolvedValueOnce(makeCompletion("# Compact\n## Summary\nok"))
        .mockResolvedValueOnce(
          makeCompletion("") // empty -> normalizeFullCompactSummary returns ok=false
        );
      const agent = makeAgent({
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });

      await expect(
        agent.runFullCompact({ conversationId: "v2-hier" })
      ).rejects.toThrow(/empty summary for a chunk/);
      // No compact record activated on partial failure.
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
    });
  });
});
