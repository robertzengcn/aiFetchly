import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Audit R7 (2026-10-22-r7) — R7-02: recreating an evicted content row
 * overwrites the logical accumulator.
 *
 * `trimToWindow`'s bound-authoritative final pass deliberately allows
 * content-bearing rows to leave the mounted window on the premise that the
 * turn accumulator survives. When the row was absent, `ensureAssistantView`
 * unconditionally reset that accumulator to empty content and appended a
 * blank row — erasing the saved prefix before the next delta or
 * `materializeFromAccumulator()` could recover it. The fix materializes
 * from the existing accumulation (text AND reasoning) first and initializes
 * empty content ONLY for a genuinely new logical message.
 */

const startChatRunMock = vi.fn();

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  denyChatV2ToolPermission: vi.fn(),
  subscribeChatV2PendingEvents: () => () => undefined,
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: () => () => undefined,
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-r7-overflow"),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { loadHistoryPage, selectConversation } from "@/views/api/aiChatWorkspace";

function historyRow(
  conversationId: string,
  id: string,
  offsetMinutes: number
): ChatV2MessageView {
  return {
    id,
    conversationId,
    role: "user",
    content: `row ${id}`,
    timestamp: new Date(2026, 9, 22, 8, offsetMinutes).toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: { source: "chat-v2" },
  };
}

interface SnapshotOptions {
  messages?: ChatV2MessageView[];
  nextBefore?: { timestamp: string; messageId: string } | null;
  hasOlder?: boolean;
  runtimeStatus?: string;
  activeRunId?: string | null;
}

async function selectSnapshot(
  conversationId: string,
  snapshot: SnapshotOptions = {}
): Promise<void> {
  vi.mocked(selectConversation).mockResolvedValue({
    acceptedGeneration: 1,
    messages: snapshot.messages ?? [
      historyRow(conversationId, `m-${conversationId}`, 0),
    ],
    nextBefore: snapshot.nextBefore ?? null,
    hasOlder: snapshot.hasOlder ?? false,
    runtimeStatus: snapshot.runtimeStatus ?? "idle",
    activeRunId: snapshot.activeRunId ?? null,
    title: conversationId,
  } as never);
  await useSelectedConversationStore().loadSelection(conversationId);
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  startChatRunMock.mockReset();
  vi.mocked(loadHistoryPage).mockReset();
  vi.mocked(loadHistoryPage).mockResolvedValue({
    messages: [],
    nextBefore: null,
    hasOlder: false,
  } as never);
});

function detailEvent(
  sequence: number,
  eventType:
    | "start"
    | "token"
    | "reasoning_delta"
    | "complete"
    | "error"
    | "cancelled",
  extra: Record<string, unknown> = {}
): ChatRunDetailEvent {
  return {
    conversationId: "conv-1",
    runId: "run-live",
    sequence,
    emittedAt: "2026-10-22T10:00:00.000Z",
    eventType,
    payload: {
      eventType,
      messageId: "live-answer",
      ...extra,
    },
  } as ChatRunDetailEvent;
}

async function flushBatchedDelta(): Promise<void> {
  // The presenter batches deltas for 50 ms; wait past the window.
  await new Promise((resolve) => setTimeout(resolve, 80));
}

interface StreamOptions {
  start?: boolean;
}

function answerId(index: number): string {
  return `answer-${index}`;
}

describe("content-bearing overflow keeps the logical accumulator (audit R7-02)", () => {
  it("new rows: resuming an overflow-evicted answer materializes 'prefix suffix' instead of an empty recreation", async () => {
    await selectSnapshot("conv-1", { messages: [] });
    const store = useSelectedConversationStore();

    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(detailEvent(2, "token", { contentDelta: "prefix " }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");

    // 200 additional distinct content-bearing answer rows push the turn
    // into the protected-content overflow case (mounted population alone
    // reaches the bound).
    let sequence = 3;
    for (let i = 1; i <= 200; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "token", {
          messageId: answerId(i),
          contentDelta: `chunk-${i} `,
        })
      );
    }
    expect(store.messages.length).toBeLessThanOrEqual(200);
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(false);
    await flushBatchedDelta();
    expect(store.messages.find((m) => m.id === answerId(1))?.content).toBe(
      "chunk-1 "
    );

    // Resume the overflow-evicted answer — the accumulator must survive.
    store.applyDetailEvent(
      detailEvent(sequence++, "token", { contentDelta: "suffix" })
    );
    await flushBatchedDelta();
    const answer = store.messages.find((m) => m.id === "live-answer");
    expect(answer?.content).toBe("prefix suffix");
    expect(store.messages.length).toBeLessThanOrEqual(200);

    // The turn continues and completes authoritatively.
    store.applyDetailEvent(
      detailEvent(sequence++, "complete", {
        fullContent: "prefix suffix final",
      })
    );
    await flushPromises();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix suffix final");
    expect(store.runtimeStatus).toBe("idle");
    expect(store.streamStatus).toBe("idle");
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("reasoning materializes together with content after overflow eviction", async () => {
    await selectSnapshot("conv-1", { messages: [] });
    const store = useSelectedConversationStore();

    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(
      detailEvent(2, "reasoning_delta", { reasoningDelta: "thought," })
    );
    store.applyDetailEvent(detailEvent(3, "token", { contentDelta: "prefix " }));
    await flushBatchedDelta();
    const answerBefore = store.messages.find((m) => m.id === "live-answer");
    expect(answerBefore?.content).toBe("prefix ");
    expect(answerBefore?.metadata?.reasoning?.content).toBe("thought,");

    let sequence = 4;
    for (let i = 1; i <= 200; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "token", {
          messageId: answerId(i),
          contentDelta: `chunk-${i} `,
        })
      );
    }
    expect(store.messages.length).toBeLessThanOrEqual(200);
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(false);
    await flushBatchedDelta();

    // Resume BOTH channels — neither survives at empty.
    store.applyDetailEvent(
      detailEvent(sequence++, "reasoning_delta", { reasoningDelta: " more" })
    );
    store.applyDetailEvent(
      detailEvent(sequence++, "token", { contentDelta: "suffix" })
    );
    await flushBatchedDelta();

    const answer = store.messages.find((m) => m.id === "live-answer");
    expect(answer?.content).toBe("prefix suffix");
    expect(answer?.metadata?.reasoning?.content).toBe("thought, more");
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("backward history paging during the overflow state does not erase the saved accumulation", async () => {
    await selectSnapshot("conv-1", { messages: [] });
    const store = useSelectedConversationStore();

    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(detailEvent(2, "token", { contentDelta: "prefix " }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");
    let sequence = 3;
    for (let i = 1; i <= 200; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "token", {
          messageId: answerId(i),
          contentDelta: `chunk-${i} `,
        })
      );
    }
    await flushBatchedDelta();
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(false);

    // Backward paging while the accumulator still owns the evicted answer:
    // the bound holds and the saved text must not reset.
    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [historyRow("conv-1", "older-0", -1), historyRow("conv-1", "older-1", -2), historyRow("conv-1", "older-2", -3)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();
    expect(store.messages.length).toBeLessThanOrEqual(200);

    store.applyDetailEvent(
      detailEvent(sequence++, "token", { contentDelta: "suffix" })
    );
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix suffix");
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("hydrated rows: a re-selected running answer survives content overflow with its saved baseline", async () => {
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      historyRow("conv-1", `r-${index}`, index)
    );
    const answer = {
      id: "live-answer",
      conversationId: "conv-1",
      role: "assistant",
      content: "saved ",
      timestamp: new Date(2026, 9, 22, 8, 400).toISOString(),
      messageType: MessageType.MESSAGE,
      metadata: { source: "chat-v2" },
    } satisfies ChatV2MessageView;
    await selectSnapshot("conv-1", {
      messages: [...rows, answer],
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
      runtimeStatus: "running",
      activeRunId: "run-live",
    });
    const store = useSelectedConversationStore();

    store.applyDetailEvent(detailEvent(1, "token", { contentDelta: "prefix " }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved prefix ");

    let sequence = 2;
    for (let i = 1; i <= 200; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "token", {
          messageId: answerId(i),
          contentDelta: `chunk-${i} `,
        })
      );
    }
    expect(store.messages.length).toBeLessThanOrEqual(200);
    // With the unpinned history consumed first, the final pass evicts the
    // content-bearing answer itself — the accumulator premise kicks in.
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(false);
    await flushBatchedDelta();

    store.applyDetailEvent(
      detailEvent(sequence++, "token", { contentDelta: "suffix" })
    );
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved prefix suffix");
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("an error terminal after overflow re-materializes the evicted answer before retiring", async () => {
    await selectSnapshot("conv-1", { messages: [] });
    const store = useSelectedConversationStore();

    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(detailEvent(2, "token", { contentDelta: "prefix " }));
    let sequence = 3;
    for (let i = 1; i <= 200; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "token", {
          messageId: answerId(i),
          contentDelta: `chunk-${i} `,
        })
      );
    }
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(false);

    store.applyDetailEvent(
      detailEvent(sequence++, "error", { errorMessage: "engine lost" })
    );
    await flushPromises();

    // The turn's registrations re-materialize on the terminal, then the
    // mounted bound re-establishes itself.
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");
    expect(store.streamStatus).toBe("error");
    expect(store.runtimeStatus).toBe("idle");
    expect(store.errorMessage).toBe("engine lost");
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("a cancelled turn after overflow keeps the accumulated answer on the display", async () => {
    await selectSnapshot("conv-1", { messages: [] });
    const store = useSelectedConversationStore();

    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(detailEvent(2, "token", { contentDelta: "prefix " }));
    let sequence = 3;
    for (let i = 1; i <= 200; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "token", {
          messageId: answerId(i),
          contentDelta: `chunk-${i} `,
        })
      );
    }
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(false);

    store.applyDetailEvent(detailEvent(sequence++, "cancelled"));
    await flushPromises();

    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");
    expect(store.streamStatus).toBe("cancelled");
    expect(store.runtimeStatus).toBe("idle");
    expect(store.messages.length).toBeLessThanOrEqual(200);

    // An idle turn after cancellation is ordinary evictable history — a
    // resumed run re-establishes fresh baselines instead of stale text.
    store.applyDetailEvent(
      detailEvent(sequence++, "start", { messageId: "live-answer" })
    );
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");
  });
});
