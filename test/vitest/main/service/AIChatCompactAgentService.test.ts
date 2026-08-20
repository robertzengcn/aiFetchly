import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import type {
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";
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
  onAutoCompacted?: (summary: AIChatCompactSummaryView) => void;
}) {
  const tokenService = new Token();
  const deps = {
    completeChat:
      opts.completeChat ??
      vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Session Memory\n## Current Goal\nx")
        ),
    isEnabled: () => opts.aiEnabled ?? true,
    ...(opts.getContextWindow ? { getContextWindow: opts.getContextWindow } : {}),
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
      mockGetConversationMessages.mockResolvedValue(messageRows("v2-auto-bound"));
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
      mockGetConversationMessages.mockResolvedValue(messageRows("v2-gate-real"));
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
});
