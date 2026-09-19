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
  AIChatSessionMemoryModule: vi.fn().mockImplementation(function () {
    return {
    getByConversation: mockGetByConversation,
    upsertMemory: mockUpsertMemory,
    markUpdating: mockMarkUpdating,
    recordFailure: mockRecordFailure,
    resetFailures: mockResetFailures,
  };
  }),
}));

const mockGetConversationMessages = vi.fn();
const mockHasMessagesAfter = vi.fn();
const mockFindBoundary = vi.fn();
const mockGetMessagesAfter = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockSaveFullCompact = vi.fn();
const mockMarkSuperseded = vi.fn();

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
    getConversationMessages: mockGetConversationMessages,
    hasMessagesAfter: mockHasMessagesAfter,
    findBoundaryInConversation: mockFindBoundary,
    getMessagesAfter: mockGetMessagesAfter,
    getDefaultSystemPrompt: vi.fn().mockReturnValue("sysp"),
    createConversationIfNeeded: vi.fn((id?: string) => id ?? "v2-x"),
  };
  }),
}));

vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(function () {
    return {
    getActiveSummary: mockGetActiveSummary,
    saveFullCompact: mockSaveFullCompact,
    markSuperseded: mockMarkSuperseded,
  };
  }),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return { getValue: vi.fn() };
  }),
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

/** Fake bounded coordinator: resolves like a completed single-batch run. */
function makeCoordinator() {
  return {
    requestCompaction: vi.fn().mockResolvedValue({
      state: "completed",
      generationId: "gen-test",
      sectionsPacked: 1,
      runId: "run-test",
    }),
  };
}

function makeAgent(opts: {
  aiEnabled?: boolean;
  completeChat?: (req: unknown) => Promise<OpenAIChatCompletionResponse>;
  getContextWindow?: (model?: string) => Promise<number>;
  onAutoCompacted?: (summary: AIChatCompactSummaryView) => void;
  /** Coordinator double; `null` omits it (fail-closed test). Defaults wired. */
  coordinator?: { requestCompaction: ReturnType<typeof vi.fn> } | null;
}) {
  const tokenService = new Token();
  const coordinator =
    opts.coordinator === undefined ? makeCoordinator() : opts.coordinator;
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
    ...(coordinator ? { compactionCoordinator: coordinator as never } : {}),
  };
  return new AIChatCompactAgentService(tokenService, deps);
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

  it("delegates new messages to the shared bounded coordinator (one algorithm)", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetMessagesAfter.mockResolvedValue([
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
    mockResetFailures.mockResolvedValue({ failureCount: 0 });

    // Session memory owns NO summarizer: even a tiny delta goes through the
    // coordinator's pack → summarize → validate → checkpoint pipeline (FR-07).
    const completeChat = vi.fn();
    const coordinator = makeCoordinator();
    const agent = makeAgent({ completeChat, coordinator });

    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-new",
      reason: "assistant_turn_completed",
      // High tokens open the token-based gate on a fresh conversation.
      promptTokens: 103_000,
    });

    expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
    expect(coordinator.requestCompaction.mock.calls[0][1]).toMatchObject({
      trigger: "session-memory",
    });
    expect(completeChat).not.toHaveBeenCalled();
    // The session store is read-only advisory now: no direct upsert.
    expect(mockUpsertMemory).not.toHaveBeenCalled();
    expect(mockResetFailures).toHaveBeenCalled();
  });

  it("skips when there are no new messages after boundary", async () => {
    mockGetByConversation.mockResolvedValue({
      conversationId: "v2-stale",
      coveredThroughMessageId: "m-last",
    });
    mockFindBoundary.mockResolvedValue({
      messageId: "m-last",
      id: 7,
      timestamp: new Date(1),
    });
    mockGetMessagesAfter.mockResolvedValue([]);
    const agent = makeAgent({});
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-stale",
      reason: "test",
    });
    expect(mockUpsertMemory).not.toHaveBeenCalled();
  });

  it("records failure when the delegated coordinator run throws", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetMessagesAfter.mockResolvedValue([
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
    const coordinator = makeCoordinator();
    coordinator.requestCompaction.mockRejectedValueOnce(new Error("boom"));
    const agent = makeAgent({ coordinator });

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
    mockGetMessagesAfter.mockResolvedValue([
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
    const coordinator = makeCoordinator();
    let release!: (v: {
      state: "completed";
      generationId: string;
      sectionsPacked: number;
      runId: string;
    }) => void;
    coordinator.requestCompaction.mockImplementation(
      () =>
        new Promise<{
          state: "completed";
          generationId: string;
          sectionsPacked: number;
          runId: string;
        }>((resolve) => {
          release = resolve;
        })
    );
    const agent = makeAgent({ coordinator });

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
    // Wait for p1 to reach the parked coordinator call; p2 must skip via
    // in-flight check.
    await vi.waitFor(() =>
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1)
    );
    release({
      state: "completed",
      generationId: "gen-1",
      sectionsPacked: 1,
      runId: "run-1",
    });
    await Promise.all([p1, p2]);
    expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
  });

  describe("auto compact", () => {
    it("runs a full compact when promptTokens >= 80% of the real context window", async () => {
      mockGetActiveSummary.mockResolvedValue(null);
      const coordinator = makeCoordinator();
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
        coordinator,
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
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
      expect(onAutoCompacted).toHaveBeenCalledTimes(1);
      expect(onAutoCompacted.mock.calls[0][0].conversationId).toBe("v2-auto");
    });

    it("skips below the threshold and reports false", async () => {
      mockGetActiveSummary.mockResolvedValue(null);
      const coordinator = makeCoordinator();
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
        coordinator,
      });

      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-low",
        reason: "assistant_turn_completed",
        promptTokens: 6000,
      });

      expect(ran).toBe(false);
      expect(coordinator.requestCompaction).not.toHaveBeenCalled();
      expect(onAutoCompacted).not.toHaveBeenCalled();
    });

    it("falls back to the §8.1 unknown-model window (8,192) when no resolver is wired", async () => {
      const coordinator = makeCoordinator();
      const agent = makeAgent({ coordinator });

      // 0.8 * 8_192 = 6553.6 -> 7000 trips the gate WITHOUT a resolver.
      // Never assume 128k: that denominator would delay auto-compact past a
      // small model's real window (AC-16).
      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-default",
        reason: "assistant_turn_completed",
        promptTokens: 7000,
      });

      expect(ran).toBe(true);
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
    });

    it("still skips below the fallback threshold without a resolver", async () => {
      const coordinator = makeCoordinator();
      const agent = makeAgent({ coordinator });

      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-default-low",
        reason: "assistant_turn_completed",
        promptTokens: 6000,
      });

      expect(ran).toBe(false);
      expect(coordinator.requestCompaction).not.toHaveBeenCalled();
    });

    it("skips when the active compact boundary already covers the latest message", async () => {
      mockGetActiveSummary.mockResolvedValue({
        throughTimestamp: new Date(100).toISOString(),
      });
      // Bounded coverage check: nothing after the boundary — no full load.
      mockHasMessagesAfter.mockResolvedValue(false);
      const coordinator = makeCoordinator();
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
        coordinator,
      });

      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-bound",
        reason: "assistant_turn_completed",
        promptTokens: 7000,
      });

      expect(ran).toBe(false);
      expect(coordinator.requestCompaction).not.toHaveBeenCalled();
      expect(onAutoCompacted).not.toHaveBeenCalled();
    });

    it("compacts when messages exist beyond the boundary", async () => {
      mockGetActiveSummary.mockResolvedValue({
        throughTimestamp: new Date(1).toISOString(),
      });
      mockHasMessagesAfter.mockResolvedValue(true);
      const coordinator = makeCoordinator();
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
        coordinator,
      });

      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-new",
        reason: "assistant_turn_completed",
        promptTokens: 7000,
      });

      expect(ran).toBe(true);
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
      expect(onAutoCompacted).toHaveBeenCalledTimes(1);
    });

    it("returns false and does not throw when the coordinator call fails", async () => {
      mockGetActiveSummary.mockResolvedValue(null);
      const coordinator = makeCoordinator();
      coordinator.requestCompaction.mockRejectedValueOnce(new Error("boom"));
      const onAutoCompacted = vi.fn();
      const agent = makeAgent({
        getContextWindow: vi.fn().mockResolvedValue(8192),
        onAutoCompacted,
        coordinator,
      });

      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-err",
        reason: "assistant_turn_completed",
        promptTokens: 7000,
      });

      expect(ran).toBe(false);
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
      mockGetMessagesAfter.mockResolvedValue([
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
      const coordinator = makeCoordinator();
      const agent = makeAgent({ coordinator });

      // 0.8 * 8_192 = 6553.6 (§8.1 fallback). 103_000 must trip the gate
      // even on a fresh conversation (token check fires before time check).
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-gate-tokens",
        reason: "test",
        promptTokens: 103_000,
      });

      expect(mockGetByConversation).toHaveBeenCalledWith("v2-gate-tokens");
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
    });

    it("uses the real context window as the gate denominator when provided", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetMessagesAfter.mockResolvedValue([
        {
          messageId: "m1",
          conversationId: "v2-gate-real",
          role: "user",
          content: "hello",
          timestamp: new Date(1),
          messageType: "message",
        },
        {
          messageId: "m2",
          conversationId: "v2-gate-real",
          role: "assistant",
          content: "hi",
          timestamp: new Date(2),
          messageType: "message",
        },
      ]);
      const coordinator = makeCoordinator();
      const agent = makeAgent({
        coordinator,
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
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
    });

    it("triggers when >60 min have passed since the first observation", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      try {
        mockGetByConversation.mockResolvedValue(null);
        mockGetMessagesAfter.mockResolvedValue([
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
        const coordinator = makeCoordinator();
        const agent = makeAgent({ coordinator });

        // First call: low tokens + fresh timestamp (lazy-init to now) -> skip.
        await agent.enqueueSessionMemoryUpdate({
          conversationId: "v2-gate-time",
          reason: "test",
          promptTokens: 1000,
        });
        expect(coordinator.requestCompaction).not.toHaveBeenCalled();

        // Advance past 60 min -> time gate opens.
        vi.setSystemTime(new Date("2026-01-01T01:01:00Z"));
        await agent.enqueueSessionMemoryUpdate({
          conversationId: "v2-gate-time",
          reason: "test",
          promptTokens: 1000,
        });
        expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

  describe("session memory unification (AC-23: one algorithm)", () => {
    const memRows = (convId: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        messageId: `m${i}`,
        conversationId: convId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
        timestamp: new Date(1 + i),
        messageType: "message",
      }));

    it("routes an over-row delta to the coordinator (no direct summarize)", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetMessagesAfter.mockResolvedValue(memRows("v2-sess-big", 65));
      const coordinator = makeCoordinator();
      const completeChat = vi.fn();
      const agent = makeAgent({ completeChat, coordinator });

      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-sess-big",
        reason: "test",
        promptTokens: 103_000,
      });

      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
      expect(coordinator.requestCompaction.mock.calls[0][1]).toMatchObject({
        trigger: "session-memory",
      });
      expect(completeChat).not.toHaveBeenCalled();
      expect(mockUpsertMemory).not.toHaveBeenCalled();
    });

    it("routes a tiny delta to the coordinator too (no second summarizer)", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetMessagesAfter.mockResolvedValue(memRows("v2-sess-tiny", 2));
      const coordinator = makeCoordinator();
      const completeChat = vi.fn();
      const agent = makeAgent({ completeChat, coordinator });

      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-sess-tiny",
        reason: "test",
        promptTokens: 103_000,
      });

      // Small deltas do NOT take a buildSessionMemoryUserPrompt + completeChat
      // fast path: one bounded incremental algorithm for every size (FR-07).
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
      expect(completeChat).not.toHaveBeenCalled();
      expect(mockUpsertMemory).not.toHaveBeenCalled();
    });

    it("delegates a boundary-unresolvable backlog instead of skipping blindly", async () => {
      mockGetByConversation.mockResolvedValue({
        conversationId: "v2-sess-gone",
        coveredThroughMessageId: "m-vanished",
      });
      mockFindBoundary.mockResolvedValue(null);
      const coordinator = makeCoordinator();
      const agent = makeAgent({ coordinator });

      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-sess-gone",
        reason: "test",
        promptTokens: 103_000,
      });

      // Deleted/ambiguous boundary: the coordinator rebuild owns legacy
      // migration via bounded sections — never a full-archive rescan here.
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
      expect(mockGetMessagesAfter).not.toHaveBeenCalled();
    });

    it("records failure when the coordinator is unavailable (fail closed)", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetMessagesAfter.mockResolvedValue(memRows("v2-sess-nocoord", 65));
      mockRecordFailure.mockResolvedValue({ failureCount: 1 });
      const agent = makeAgent({ completeChat: vi.fn(), coordinator: null });

      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-sess-nocoord",
        reason: "test",
        promptTokens: 103_000,
      });

      // Fail closed with a limitation — never a direct unbounded summarize.
      expect(mockRecordFailure).toHaveBeenCalledWith(
        "v2-sess-nocoord",
        expect.stringMatching(/coordinator/i)
      );
      expect(mockUpsertMemory).not.toHaveBeenCalled();
    });
  });

    it("resets the timer on success so an immediate second call is skipped", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetMessagesAfter.mockResolvedValue([
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
      const coordinator = makeCoordinator();
      const agent = makeAgent({ coordinator });

      // Force the gate open via high tokens so delegation fires and the timer
      // gets reset on success.
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-gate-reset",
        reason: "test",
        promptTokens: 103_000,
      });
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);

      // Second call immediately after success: low tokens + fresh timer -> skip.
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-gate-reset",
        reason: "test",
        promptTokens: 1000,
      });
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
    });
  });
});
