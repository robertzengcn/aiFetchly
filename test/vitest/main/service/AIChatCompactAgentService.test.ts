import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import type { AIChatCompactAgentDeps } from "@/service/AIChatCompactAgentService";
import type { OpenAIChatCompletionResponse } from "@/api/aiChatApi";
import type { AIChatLightweightCompletionResult } from "@/service/AIChatLightweightTypes";
import { AIChatLightweightFailure } from "@/service/AIChatLightweightTypes";
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
  getSmallModelCapability?: () => Promise<
    import("@/api/aiChatApi").OpenAISmallModelCapability | null
  >;
  onAutoCompacted?: (summary: AIChatCompactSummaryView) => void;
  /** Coordinator double; `null` omits it (fail-closed test). Defaults wired. */
  coordinator?: { requestCompaction: ReturnType<typeof vi.fn> } | null;
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
  const completeLightweight = opts.completeChat
    ? wrap(opts.completeChat)
    : undefined;
  // Keep the raw spy visible as deps.completeChat as well: the coordinator
  // delegation's summarize path reads completeChat directly (merged union).
  const completeChatDep = opts.completeChat;
  const coordinator =
    opts.coordinator === undefined ? makeCoordinator() : opts.coordinator;
  const deps = {
    completeLightweight,
    ...(completeChatDep ? { completeChat: completeChatDep } : {}),
    isEnabled: () => opts.aiEnabled ?? true,
    ...(opts.getContextWindow
      ? { getContextWindow: opts.getContextWindow }
      : {}),
    ...(opts.getSmallModelCapability
      ? { getSmallModelCapability: opts.getSmallModelCapability }
      : {}),
    ...(opts.onAutoCompacted ? { onAutoCompacted: opts.onAutoCompacted } : {}),
    ...(coordinator ? { compactionCoordinator: coordinator as never } : {}),
  };
  return new AIChatCompactAgentService(tokenService, deps);
}

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

      // AUTO_COMPACT_THRESHOLD_FRACTION is 0.7: floor(0.7 * 8192) = 5734,
      // so 5000 stays below the gate and must skip.
      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-low",
        reason: "assistant_turn_completed",
        promptTokens: 5000,
      });

      expect(ran).toBe(false);
      expect(coordinator.requestCompaction).not.toHaveBeenCalled();
      expect(onAutoCompacted).not.toHaveBeenCalled();
    });

    it("falls back to the §8.1 unknown-model window (8,192) when no resolver is wired", async () => {
      const coordinator = makeCoordinator();
      const agent = makeAgent({ coordinator });

      // 80_000 < floor(0.7 * 128_000) = 89_600 -> skipped without a resolver.
      // 0.8 * 8_192 = 6553.6 -> 7000 trips the gate WITHOUT a resolver.
      // Never assume 128k: that denominator would delay auto-compact past a
      // small model's real window (AC-16).
      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-default",
        reason: "assistant_turn_completed",
        promptTokens: 80_000,
      });

      expect(ran).toBe(true);
      expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
    });

    it("still skips below the fallback threshold without a resolver", async () => {
      const coordinator = makeCoordinator();
      const agent = makeAgent({ coordinator });

      // Merged product uses the 8,192 fallback window (§8.1 AC-16), so the
      // gate is floor(0.7 * 8192) = 5734 — 5000 stays below it.
      const ran = await agent.enqueueAutoCompact({
        conversationId: "v2-auto-default-low",
        reason: "assistant_turn_completed",
        promptTokens: 5000,
      });

      expect(ran).toBe(false);
      expect(coordinator.requestCompaction).not.toHaveBeenCalled();
    });

    it("skips when the active compact boundary already covers the latest message", async () => {
      mockGetActiveSummary.mockResolvedValue({
        throughTimestamp: new Date(100).toISOString(),
      });
      mockGetConversationMessages.mockResolvedValue(
        messageRows("v2-auto-bound")
      );
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
      mockGetConversationMessages.mockResolvedValue(
        messageRows("v2-gate-real")
      );
      mockUpsertMemory.mockResolvedValue({ failureCount: 0 });
      const completeChat = vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Session Memory\n## Current Goal\nx")
        );
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
      // Fail-closed branch keys on BOTH routes being unwired (merged union:
      // flag-off + lightweight-off → limitation recorded). Omit completeChat
      // so the harness stops wiring the lightweight wrapper.
      const agent = makeAgent({ coordinator: null });

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
      mockGetMessagesAfter.mockResolvedValue([
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
      // Workload routing lives on the SMBW bounded lightweight path; the
      // coordinator delegation (flag-on) owns the same workload elsewhere.
      const agent = makeAgent({ completeChat, coordinator: null });
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
      const agent = makeAgent({ completeChat, coordinator: null });
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
      const agent = makeAgent({ completeChat, coordinator: null });
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

  describe("cancellation propagation (SMBW-011)", () => {
    it("a cancelled full compact stops without further model calls or activation", async () => {
      mockGetActiveSummary.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          messageId: `m${i}`,
          conversationId: "v2-cancel",
          role: i % 2 === 0 ? "user" : "assistant",
          content: "x".repeat(2000),
          timestamp: new Date(i + 1),
          messageType: "message",
        }))
      );
      const controller = new AbortController();
      let calls = 0;
      const completeChat = vi.fn(async () => {
        calls += 1;
        if (calls >= 1) controller.abort();
        return makeCompletion("# Compact\n## Summary\npart");
      });
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });

      await expect(
        agent.runFullCompact({
          conversationId: "v2-cancel",
          signal: controller.signal,
        })
      ).rejects.toThrow();
      // No compact activated on cancellation.
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
    });

    it("a cancelled session-memory update stops without recording a failure", async () => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          messageId: `m${i}`,
          conversationId: "v2-sm-cancel",
          role: i % 2 === 0 ? "user" : "assistant",
          content: "x".repeat(2000),
          timestamp: new Date(i + 1),
          messageType: "message",
        }))
      );
      mockUpsertMemory.mockResolvedValue({});
      const controller = new AbortController();
      let calls = 0;
      const completeChat = vi.fn(async () => {
        calls += 1;
        if (calls >= 1) controller.abort();
        return makeCompletion("# Session Memory\n## Current Goal\nx");
      });
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });

      await expect(
        agent.enqueueSessionMemoryUpdate({
          conversationId: "v2-sm-cancel",
          reason: "test",
          promptTokens: 103_000,
          signal: controller.signal,
        })
      ).resolves.toBeUndefined();
      // Cancellation is not a failure — no recordFailure.
      expect(mockRecordFailure).not.toHaveBeenCalled();
    });
  });

  describe("rolling session-memory chunks (SMBW-010)", () => {
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
      mockGetByConversation.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue(bigRows("v2-roll", 30));
      mockUpsertMemory.mockResolvedValue({});
      mockResetFailures.mockResolvedValue(undefined);
      mockMarkUpdating.mockResolvedValue(undefined);
    });

    it("oversized deltas cause multiple bounded chunk requests", async () => {
      const completeChat = vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Session Memory\n## Current Goal\nx")
        );
      const agent = makeAgent({ coordinator: null,
        completeChat,
        // Tiny window forces many chunks.
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-roll",
        reason: "test",
        promptTokens: 103_000,
      });
      // Multiple lightweight calls ⇒ rolling chunks.
      expect(completeChat.mock.calls.length).toBeGreaterThan(1);
      // Each chunk persists the replacement summary + boundary as it validates.
      expect(mockUpsertMemory.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("successful early chunks remain committed after a later chunk fails", async () => {
      const completeChat = vi
        .fn()
        .mockResolvedValueOnce(
          makeCompletion("# Session Memory\n## Current Goal\nok")
        )
        .mockResolvedValueOnce(
          makeCompletion("# Session Memory\n## Current Goal\nok")
        )
        .mockResolvedValueOnce(makeCompletion("")); // empty -> invalid
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-roll",
        reason: "test",
        promptTokens: 103_000,
      });
      // First two chunks persisted their summaries before the third failed.
      expect(mockUpsertMemory.mock.calls.length).toBeGreaterThanOrEqual(2);
      // A failure was recorded for the failed chunk.
      expect(mockRecordFailure).toHaveBeenCalled();
    });

    it("the persisted summary of chunk N is fed into chunk N+1", async () => {
      const completeChat = vi.fn(async (lwInput: unknown) => {
        // The second+ chunk's user prompt includes the prior summary text.
        void lwInput;
        return makeCompletion("# Session Memory\n## Current Goal\nnext");
      });
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-roll",
        reason: "test",
        promptTokens: 103_000,
      });
      // The second chunk's input contains the first chunk's persisted summary.
      const secondCall = completeChat.mock.calls[1]![0] as {
        messages: { content: string }[];
      };
      expect(secondCall.messages[1]!.content).toContain("Current Goal");
    });

    it("tool-group chunks advance the boundary by MESSAGE count, not group count (SMBW-010 regression)", async () => {
      // Delta = [user msg, assistant+tool_call, tool result]. The atomic
      // grouper collapses the assistant tool-call + tool result into ONE
      // group, so 3 messages = 2 groups. A tiny window forces 2 chunks:
      // chunk 1 = the tool group (2 messages), chunk 2 = the user msg.
      // The persisted boundary after chunk 1 must be the tool RESULT row
      // (message index 2), not the user msg (index 0) — otherwise the next
      // run re-sends the tool group.
      mockGetConversationMessages.mockResolvedValue([
        {
          messageId: "u1",
          conversationId: "v2-tool",
          role: "user",
          content: "run the build",
          timestamp: new Date(1),
          messageType: "message",
        },
        {
          messageId: "a1",
          conversationId: "v2-tool",
          role: "assistant",
          content: "",
          timestamp: new Date(2),
          messageType: "message",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "build", arguments: "{}" },
            },
          ],
        },
        {
          messageId: "t1",
          conversationId: "v2-tool",
          role: "tool",
          content: "build ok",
          timestamp: new Date(3),
          messageType: "message",
          tool_call_id: "call_1",
        },
      ]);
      const completeChat = vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Session Memory\n## Current Goal\nx")
        );
      const agent = makeAgent({ coordinator: null,
        completeChat,
        // Tiny window forces the 3-message delta into 2 chunks.
        getContextWindow: vi.fn().mockResolvedValue(120),
      });

      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-tool",
        reason: "test",
        promptTokens: 103_000,
      });

      // The LAST upsert (chunk 2's persisted boundary — the tool group)
      // must point at the tool RESULT (t1, message index 2), not at the
      // assistant tool-call (a1, message index 1). Group-count indexing
      // would land on a1 and under-advance the boundary.
      const upserts = mockUpsertMemory.mock.calls as unknown as ReadonlyArray<
        ReadonlyArray<{ coveredThroughMessageId?: string }>
      >;
      const lastUpsertArg = upserts[upserts.length - 1]?.[0];
      expect(lastUpsertArg).toBeDefined();
      expect(lastUpsertArg!.coveredThroughMessageId).toBe("t1");
    });

    it("one same-small formatting repair is attempted on invalid non-empty output", async () => {
      const completeChat = vi
        .fn()
        .mockResolvedValueOnce(makeCompletion("not valid headings"))
        .mockResolvedValueOnce(
          makeCompletion("# Session Memory\n## Current Goal\nrepaired")
        );
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(128_000),
      });
      mockGetConversationMessages.mockResolvedValue([
        {
          messageId: "m1",
          conversationId: "v2-repair",
          role: "user",
          content: "x",
          timestamp: new Date(1),
          messageType: "message",
        },
        {
          messageId: "m2",
          conversationId: "v2-repair",
          role: "assistant",
          content: "y",
          timestamp: new Date(2),
          messageType: "message",
        },
      ]);
      await agent.enqueueSessionMemoryUpdate({
        conversationId: "v2-repair",
        reason: "test",
        promptTokens: 103_000,
      });
      // First call (invalid) + one repair call.
      expect(completeChat).toHaveBeenCalledTimes(2);
      expect(mockUpsertMemory).toHaveBeenCalled();
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
      const agent = makeAgent({ coordinator: null,
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
      const agent = makeAgent({ coordinator: null,
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
      const agent = makeAgent({ coordinator: null,
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
      const agent = makeAgent({ coordinator: null,
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

  describe("recursive budgeted merge (SMBW-003)", () => {
    /** Many large rows forcing multiple chunks AND a multi-level merge. */
    function hugeRows(convId: string, n: number) {
      return Array.from({ length: n }, (_, i) => ({
        messageId: `m${i}`,
        conversationId: convId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(4000),
        timestamp: new Date(i + 1),
        messageType: "message",
      }));
    }

    beforeEach(() => {
      mockGetActiveSummary.mockResolvedValue(null);
      mockSaveFullCompact.mockClear();
      mockSaveFullCompact.mockImplementation(
        async (input: { conversationId: string }) => ({
          ...compactView(input.conversationId),
          conversationId: input.conversationId,
        })
      );
    });

    it("a transcript requiring >1 merge level completes and activates one final compact", async () => {
      mockGetConversationMessages.mockResolvedValue(hugeRows("v2-merge", 60));
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\npart"));
      const agent = makeAgent({ coordinator: null,
        completeChat,
        // Tiny window forces many chunks; summaries then require a
        // multi-level recursive reduce to reach one final summary.
        getContextWindow: vi.fn().mockResolvedValue(1500),
      });

      const view = await agent.runFullCompact({ conversationId: "v2-merge" });

      expect(view.conversationId).toBe("v2-merge");
      // Many map calls + at least one merge call; the last call is a merge.
      expect(completeChat.mock.calls.length).toBeGreaterThan(1);
      // Exactly one compact record activated (the final summary only).
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
    });

    it("single oversized summary is clamped rather than submitted oversized", async () => {
      // One row → one chunk → one summary. With a tiny merge budget the
      // single-summary branch clamps it instead of erroring.
      mockGetConversationMessages.mockResolvedValue([
        {
          messageId: "m0",
          conversationId: "v2-clamp",
          role: "user",
          content: "x".repeat(200),
          timestamp: new Date(1),
          messageType: "message",
        },
      ]);
      const completeChat = vi
        .fn()
        .mockResolvedValue(
          makeCompletion("# Compact\n## Summary\n" + "y".repeat(8000))
        );
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(500),
      });

      // Must not throw — the oversized single summary is clamped, not
      // rejected, so a final compact still activates.
      const view = await agent.runFullCompact({ conversationId: "v2-clamp" });
      expect(view.conversationId).toBe("v2-clamp");
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
    });

    it("determinism — identical input + budget produce identical chunk counts", async () => {
      mockGetConversationMessages.mockResolvedValue(hugeRows("v2-det", 40));
      const mk = () =>
        vi.fn().mockResolvedValue(makeCompletion("# Compact\n## Summary\np"));
      const run = async () => {
        const completeChat = mk();
        const agent = makeAgent({ coordinator: null,
          completeChat,
          getContextWindow: vi.fn().mockResolvedValue(1500),
        });
        await agent.runFullCompact({ conversationId: "v2-det" });
        return completeChat.mock.calls.length;
      };
      const a = await run();
      const b = await run();
      expect(a).toBe(b);
    });
  });

  describe("one fallback per logical compact (SMBW-004)", () => {
    /** Rows that force multiple chunks in a small window. */
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
      mockSaveFullCompact.mockImplementation(
        async (input: { conversationId: string }) => ({
          ...compactView(input.conversationId),
          conversationId: input.conversationId,
        })
      );
    });

    it("sub-requests suppress router-level fallback (allowNormalFallback:false on small route)", async () => {
      mockGetConversationMessages.mockResolvedValue(bigRows("v2-fb", 30));
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\npart"));
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });

      await agent.runFullCompact({ conversationId: "v2-fb" });

      // Every lightweight sub-request on the small route must suppress the
      // router-level fallback so the orchestration owns the single fallback.
      for (const call of completeChat.mock.calls) {
        const lwInput = call[0] as { allowNormalFallback?: boolean };
        expect(lwInput.allowNormalFallback).toBe(false);
      }
    });

    it("a definitive small failure restarts the whole compact once on the normal route", async () => {
      mockGetConversationMessages.mockResolvedValue(bigRows("v2-restart", 30));
      // First (small) route: 404 -> definitive small_model_unavailable.
      // Then the restart forces normal route; those calls succeed.
      const ok = makeCompletion("# Compact\n## Summary\nrebuilt");
      let firstCall = true;
      const completeChat = vi.fn(async (input: unknown) => {
        if (firstCall) {
          firstCall = false;
          throw new AIChatLightweightFailure({
            reason: "small_model_unavailable",
            message: "small unavailable",
            definitive: true,
          });
        }
        return ok;
      });
      // Provide a small-model capability so the small route is eligible.
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
        getSmallModelCapability: vi
          .fn()
          .mockResolvedValue({ available: true, context_size: 200_000 }),
      });

      const view = await agent.runFullCompact({ conversationId: "v2-restart" });

      // A final compact activated despite the small failure.
      expect(view.conversationId).toBe("v2-restart");
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
      // The restart sub-requests force the normal route (no small attempt).
      const restartCalls = completeChat.mock.calls
        .slice(1)
        .map((c) => c[0] as { forceNormalRoute?: boolean });
      expect(restartCalls.length).toBeGreaterThan(0);
      for (const lwInput of restartCalls) {
        expect(lwInput.forceNormalRoute).toBe(true);
      }
    });

    it("context overflow retries the small route once with a reduced budget before any fallback (SMBW-004)", async () => {
      mockGetConversationMessages.mockResolvedValue(bigRows("v2-overflow", 30));
      let calls = 0;
      const completeChat = vi.fn(async (input: unknown) => {
        calls += 1;
        if (calls === 1) {
          // First small attempt overflows.
          throw new AIChatLightweightFailure({
            reason: "context_overflow",
            message: "too big",
            definitive: true,
          });
        }
        // Reduced-budget retry succeeds on the small route.
        return makeCompletion("# Compact\n## Summary\nreduced-ok");
      });
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
        getSmallModelCapability: vi
          .fn()
          .mockResolvedValue({ available: true, context_size: 200_000 }),
      });

      const view = await agent.runFullCompact({
        conversationId: "v2-overflow",
      });
      expect(view.conversationId).toBe("v2-overflow");
      expect(mockSaveFullCompact).toHaveBeenCalledTimes(1);
      // All sub-requests stayed on the small route — no normal fallback.
      for (const call of completeChat.mock.calls) {
        const lwInput = call[0] as { forceNormalRoute?: boolean };
        expect(lwInput.forceNormalRoute).toBeFalsy();
      }
    });

    it("an ambiguous small failure does NOT trigger a fallback restart", async () => {
      mockGetConversationMessages.mockResolvedValue(bigRows("v2-amb", 30));
      const completeChat = vi.fn(async (input: unknown) => {
        throw new AIChatLightweightFailure({
          reason: "timeout_ambiguous",
          message: "aborted",
          definitive: false,
        });
      });
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
        getSmallModelCapability: vi
          .fn()
          .mockResolvedValue({ available: true, context_size: 200_000 }),
      });

      await expect(
        agent.runFullCompact({ conversationId: "v2-amb" })
      ).rejects.toThrow();
      // No compact activated.
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
      // Only the first (failed) small request — no restart, no second request.
      expect(completeChat).toHaveBeenCalledTimes(1);
    });

    it("authentication failure does NOT trigger a fallback restart", async () => {
      mockGetConversationMessages.mockResolvedValue(bigRows("v2-auth", 30));
      const completeChat = vi.fn(async (input: unknown) => {
        throw new AIChatLightweightFailure({
          reason: "authentication",
          message: "unauth",
          definitive: true,
        });
      });
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
        getSmallModelCapability: vi
          .fn()
          .mockResolvedValue({ available: true, context_size: 200_000 }),
      });

      await expect(
        agent.runFullCompact({ conversationId: "v2-auth" })
      ).rejects.toThrow();
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
      expect(completeChat).toHaveBeenCalledTimes(1);
    });
  });

  describe("active compact boundary reuse (SMBW-002)", () => {
    /** Five rows: m1..m5 with strictly increasing timestamps. */
    function fiveRows(convId: string) {
      return Array.from({ length: 5 }, (_, i) => ({
        messageId: `m${i + 1}`,
        conversationId: convId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg-${i + 1}`,
        timestamp: new Date(i + 1),
        messageType: "message",
      }));
    }

    const activeView = {
      compactId: "compact-old",
      conversationId: "v2-reuse",
      summary: "# Compact Summary\n## Primary Request\nold coverage",
      fromMessageId: "m0",
      throughMessageId: "m2",
      throughTimestamp: new Date(2).toISOString(),
      sourceMessageCount: 2,
      outputTokenEstimate: 60,
      model: "test-model",
      status: "active",
    } as AIChatCompactSummaryView;

    beforeEach(() => {
      mockGetConversationMessages.mockResolvedValue(fiveRows("v2-reuse"));
      mockSaveFullCompact.mockResolvedValue(compactView("v2-reuse"));
    });

    it("does not resend previously covered raw rows", async () => {
      mockGetActiveSummary.mockResolvedValue(activeView);
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\nnew"));
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(128_000),
      });

      await agent.runFullCompact({ conversationId: "v2-reuse" });

      // One chunk covers m3..m5 (fits easily in 128k).
      expect(completeChat).toHaveBeenCalledTimes(1);
      const userContent = (
        completeChat.mock.calls[0]![0] as {
          messages: { role: string; content: string }[];
        }
      ).messages[1]!.content as string;
      expect(userContent).toContain("msg-3");
      expect(userContent).toContain("msg-5");
      expect(userContent).not.toContain("msg-1");
      expect(userContent).not.toContain("msg-2");
    });

    it("feeds the prior compact summary in and preserves the original fromMessageId", async () => {
      mockGetActiveSummary.mockResolvedValue(activeView);
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\nnew"));
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(128_000),
      });

      await agent.runFullCompact({ conversationId: "v2-reuse" });

      const userContent = (
        completeChat.mock.calls[0]![0] as {
          messages: { role: string; content: string }[];
        }
      ).messages[1]!.content as string;
      // The prior summary is the representation of covered history.
      expect(userContent).toContain("old coverage");

      const savedArg = mockSaveFullCompact.mock.calls[0]![0] as {
        fromMessageId: string;
        throughMessageId: string;
        throughTimestamp: Date;
        sourceMessageCount: number;
      };
      // The replacement represents the FULL history chain: original start,
      // new end boundary, cumulative count.
      expect(savedArg.fromMessageId).toBe("m0");
      expect(savedArg.throughMessageId).toBe("m5");
      expect(savedArg.throughTimestamp).toEqual(new Date(5));
      expect(savedArg.sourceMessageCount).toBe(2 + 3);
    });

    it("returns the active view without a model call when nothing is new", async () => {
      mockGetActiveSummary.mockResolvedValue(activeView);
      mockGetConversationMessages.mockResolvedValue(
        fiveRows("v2-reuse").slice(0, 2) // only covered rows exist
      );
      const completeChat = vi.fn();
      const agent = makeAgent({ coordinator: null, completeChat });

      const view = await agent.runFullCompact({ conversationId: "v2-reuse" });

      expect(completeChat).not.toHaveBeenCalled();
      expect(mockSaveFullCompact).not.toHaveBeenCalled();
      expect(view.compactId).toBe("compact-old");
    });

    it("stale throughMessageId falls back to throughTimestamp selection", async () => {
      mockGetActiveSummary.mockResolvedValue({
        ...activeView,
        throughMessageId: "deleted-row",
      });
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\nnew"));
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(128_000),
      });

      await agent.runFullCompact({ conversationId: "v2-reuse" });

      const userContent = (
        completeChat.mock.calls[0]![0] as {
          messages: { role: string; content: string }[];
        }
      ).messages[1]!.content as string;
      // m1/m2 sit AT or before t=2; strictly-after selects m3..m5.
      expect(userContent).toContain("msg-3");
      expect(userContent).not.toContain("msg-2");
    });

    it("invalid boundary fields fail safe: the full conversation is processed", async () => {
      mockGetActiveSummary.mockResolvedValue({
        ...activeView,
        throughMessageId: "deleted-row",
        throughTimestamp: "not-a-date",
      });
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\nall"));
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(128_000),
      });

      await agent.runFullCompact({ conversationId: "v2-reuse" });

      const userContent = (
        completeChat.mock.calls[0]![0] as {
          messages: { role: string; content: string }[];
        }
      ).messages[1]!.content as string;
      // Fail-safe direction: include everything rather than drop messages.
      expect(userContent).toContain("msg-1");
      expect(userContent).toContain("msg-5");
    });

    it("multi-chunk deltas merge the prior summary with the chunk summaries", async () => {
      mockGetActiveSummary.mockResolvedValue(activeView);
      // 30 large rows after the boundary force multiple chunks in a 2k window.
      mockGetConversationMessages.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          messageId: `m${i + 1}`,
          conversationId: "v2-reuse",
          role: i % 2 === 0 ? "user" : "assistant",
          content: "x".repeat(2000),
          timestamp: new Date(i + 1),
          messageType: "message",
        }))
      );
      const completeChat = vi
        .fn()
        .mockResolvedValue(makeCompletion("# Compact\n## Summary\npart"));
      const agent = makeAgent({ coordinator: null,
        completeChat,
        getContextWindow: vi.fn().mockResolvedValue(2000),
      });

      await agent.runFullCompact({ conversationId: "v2-reuse" });

      // The prior active summary ("old coverage") is folded into the FIRST
      // merge request alongside the chunk summaries (SMBW-002). With a
      // recursive merge the final request contains only intermediates, so
      // assert against the first merge call, not the last.
      const mergeCalls = completeChat.mock.calls
        .map(
          (c) =>
            (c[0] as { messages: { content: string }[] }).messages[1]!.content
        )
        .filter((content) => content.includes("old coverage"));
      expect(mergeCalls.length).toBeGreaterThan(0);
    });
  });
});
