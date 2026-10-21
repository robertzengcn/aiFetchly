import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";

const startChatRunMock = vi.fn();

/**
 * Audit R4-01 / R4-04 — selected-conversation history paging boundaries.
 *
 * R4-01: `loadOlder()` captured the conversation for its request but wrote
 * the shared presenter/cursor unconditionally after the transport await. An
 * in-flight A page resolved while B was selected mixed A's content into B's
 * transcript and corrupted B's paging state. The fix gates every post-await
 * mutation (messages, cursor, hasOlder, eviction) on an immutable selection
 * token and makes the `loadingOlder` ownership token-specific, so a stale
 * operation can neither touch the newer selection's transcript nor clear a
 * newer operation's flag.
 *
 * R4-04: backward paging evicted from the WRONG end (the newly requested
 * older range was trimmed immediately once the window was full) and forced
 * `hasOlder = true`, discarding the server's exhausted-history signal.
 * Backward paging now retains the requested older range and evicts from the
 * opposite (newest) end while the 200-row bound is preserved, and `hasOlder`
 * always reflects the page the server actually returned.
 */

type SummaryCallback = (event: unknown) => void;
let summaryHandler: SummaryCallback | null = null;

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  denyChatV2ToolPermission: vi.fn(),
  subscribeChatV2PendingEvents: () => () => undefined,
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: (callback: SummaryCallback): (() => void) => {
    summaryHandler = callback;
    return () => {
      if (summaryHandler === callback) summaryHandler = null;
    };
  },
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-r4"),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { loadHistoryPage, selectConversation } from "@/views/api/aiChatWorkspace";

interface HistoryPage {
  messages: ChatV2MessageView[];
  nextBefore: { timestamp: string; messageId: string } | null;
  hasOlder: boolean;
}

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
    timestamp: new Date(2026, 9, 20, 8, offsetMinutes).toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: { source: "chat-v2" },
  };
}

async function selectSnapshot(
  conversationId: string,
  snapshot: {
    messages?: ChatV2MessageView[];
    nextBefore?: { timestamp: string; messageId: string } | null;
    hasOlder?: boolean;
  }
): Promise<void> {
  vi.mocked(selectConversation).mockResolvedValue({
    acceptedGeneration: 1,
    messages: snapshot.messages ?? [
      historyRow(conversationId, `m-${conversationId}`, 0),
    ],
    nextBefore: snapshot.nextBefore ?? null,
    hasOlder: snapshot.hasOlder ?? false,
    runtimeStatus: "idle",
    activeRunId: null,
    title: conversationId,
  } as never);
  await useSelectedConversationStore().loadSelection(conversationId);
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  startChatRunMock.mockReset();
  summaryHandler = null;
  vi.mocked(loadHistoryPage).mockReset();
  vi.mocked(loadHistoryPage).mockResolvedValue({
    messages: [],
    nextBefore: null,
    hasOlder: false,
  } as never);
});

/** Live detail event helper mirroring the detail-event shape. */
function detailEvent(
  sequence: number,
  eventType: "start" | "token" | "complete",
  extra: Record<string, unknown> = {}
): ChatRunDetailEvent {
  return {
    conversationId: "conv-1",
    runId: "run-live",
    sequence,
    emittedAt: "2026-10-20T10:00:00.000Z",
    eventType,
    payload: { eventType, messageId: "live-answer", ...extra },
  } as ChatRunDetailEvent;
}

async function flushBatchedDelta(): Promise<void> {
  // The presenter batches deltas for 50 ms; wait past the window.
  await new Promise((resolve) => setTimeout(resolve, 80));
}

describe("selectedConversation history paging isolation (audit R4-01)", () => {
  it("a resolved A history page never enters conversation B", async () => {
    await selectSnapshot("conv-a", {
      nextBefore: { timestamp: "2026-10-19T00:00:00.000Z", messageId: "cursor-a" },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    let finish: (page: HistoryPage) => void = () => undefined;
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      () =>
        new Promise<HistoryPage>((resolve) => {
          finish = resolve;
        }) as never
    );
    const loading = store.loadOlder();
    await flushPromises();
    expect(store.loadingOlder).toBe(true);

    await selectSnapshot("conv-b", {});
    finish({
      messages: [
        historyRow("conv-a", "private-a", -30),
      ],
      nextBefore: null,
      hasOlder: false,
    });
    await Promise.all([loading, flushPromises()]);

    // Private content of A is never shown inside B's transcript…
    expect(store.messages.some((m) => m.id === "private-a")).toBe(false);
    // …and B's own paging state is untouched: its snapshot had hasOlder
    // false, so the control disappears and a further click cannot request.
    expect(store.hasOlder).toBe(false);
    const callsAfter =
      vi.mocked(loadHistoryPage).mock.calls.length;
    await store.loadOlder();
    expect(vi.mocked(loadHistoryPage).mock.calls.length).toBe(callsAfter);
    // The stale operation must not have leaked its loading ownership.
    expect(store.loadingOlder).toBe(false);
  });

  it("A→B→A: the stale page stays discarded and A keeps paging with its own cursor", async () => {
    await selectSnapshot("conv-a", {
      nextBefore: { timestamp: "2026-10-19T00:00:00.000Z", messageId: "cursor-a" },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    let finish: (page: HistoryPage) => void = () => undefined;
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      () =>
        new Promise<HistoryPage>((resolve) => {
          finish = resolve;
        }) as never
    );
    const stale = store.loadOlder();
    await flushPromises();

    await selectSnapshot("conv-b", {});
    await selectSnapshot("conv-a", {
      nextBefore: { timestamp: "2026-10-19T06:00:00.000Z", messageId: "cursor-a2" },
      hasOlder: true,
    });
    finish({
      messages: [historyRow("conv-a", "private-a", -30)],
      nextBefore: null,
      hasOlder: false,
    });
    await Promise.all([stale, flushPromises()]);

    expect(store.messages.some((m) => m.id === "private-a")).toBe(false);
    // A returned to its own snapshot cursor: a fresh older request pages
    // with A's CURRENT cursor and still works.
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async (conversationId, limit, cursor) => {
        expect(cursor?.messageId).toBe("cursor-a2");
        return {
          messages: [historyRow("conv-a", "older-real", -60)],
          nextBefore: null,
          hasOlder: false,
        } as HistoryPage as never;
      }
    );
    await store.loadOlder();
    expect(store.messages.some((m) => m.id === "older-real")).toBe(true);
    expect(store.hasOlder).toBe(false);
  });

  it("route deselection discards the in-flight page and hands paging state to the next selection", async () => {
    await selectSnapshot("conv-a", {
      nextBefore: { timestamp: "2026-10-19T00:00:00.000Z", messageId: "cursor-a" },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    let finish: (page: HistoryPage) => void = () => undefined;
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      () =>
        new Promise<HistoryPage>((resolve) => {
          finish = resolve;
        }) as never
    );
    const loading = store.loadOlder();
    await flushPromises();

    await store.loadSelection(null);
    await flushPromises();
    finish({
      messages: [historyRow("conv-a", "private-a", -30)],
      nextBefore: null,
      hasOlder: false,
    });
    await Promise.all([loading, flushPromises()]);

    expect(store.messages.some((m) => m.id === "private-a")).toBe(false);
    expect(store.loadingOlder).toBe(false);

    // The NEXT selection can page immediately (no stuck ownership).
    await selectSnapshot("conv-c", {
      nextBefore: { timestamp: "2026-10-19T02:00:00.000Z", messageId: "cursor-c" },
      hasOlder: true,
    });
    await store.loadOlder();
    expect(useChatWorkspaceStore().selectedConversationId).toBe("conv-c");
    expect(
      vi.mocked(loadHistoryPage).mock.calls.some(
        (call) => call[0] === "conv-c"
      )
    ).toBe(true);
  });

  it("a delayed rejection after switching does not clear the newer selection's paging attempt", async () => {
    await selectSnapshot("conv-a", {
      nextBefore: { timestamp: "2026-10-19T00:00:00.000Z", messageId: "cursor-a" },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    let failA: (error: Error) => void = () => undefined;
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      () =>
        new Promise<HistoryPage>((_resolve, reject) => {
          failA = reject;
        }) as never
    );
    const loadingA = store.loadOlder();
    await flushPromises();

    await selectSnapshot("conv-b", {
      nextBefore: { timestamp: "2026-10-19T01:00:00.000Z", messageId: "cursor-b" },
      hasOlder: true,
    });
    let resolveB: (page: HistoryPage) => void = () => undefined;
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      () =>
        new Promise<HistoryPage>((resolve) => {
          resolveB = resolve;
        }) as never
    );
    const loadingB = store.loadOlder();
    expect(store.loadingOlder).toBe(true);

    failA(new Error("transport lost"));
    await flushPromises();
    // A's delayed rejection must NOT clear B's in-flight ownership…
    expect(store.loadingOlder).toBe(true);

    resolveB({ messages: [], nextBefore: null, hasOlder: false });
    await Promise.all([loadingB, loadingA, flushPromises()]);
    // …only B's own completion does.
    expect(store.messages.some((m) => m.id === "private-a")).toBe(false);
    expect(store.loadingOlder).toBe(false);
  });

  it("valid same-generation paging still prepends pages and advances the cursor", async () => {
    await selectSnapshot("conv-a", {
      nextBefore: { timestamp: "2026-10-19T00:00:00.000Z", messageId: "cursor-a" },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async (conversationId, limit, cursor) => {
        expect(conversationId).toBe("conv-a");
        expect(limit).toBe(50);
        expect(cursor?.messageId).toBe("cursor-a");
        return {
          messages: [historyRow("conv-a", "older-1", -60)],
          nextBefore: {
            timestamp: "2026-10-19T00:00:00.000Z",
            messageId: "cursor-a2",
          },
          hasOlder: true,
        } as HistoryPage as never;
      }
    );
    await store.loadOlder();

    expect(store.messages.some((m) => m.id === "older-1")).toBe(true);
    expect(store.hasOlder).toBe(true);

    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async (_conversationId, _limit, cursor) => {
        expect(cursor?.messageId).toBe("cursor-a2");
        return {
          messages: [historyRow("conv-a", "older-2", -90)],
          nextBefore: null,
          hasOlder: false,
        } as HistoryPage as never;
      }
    );
    await store.loadOlder();
    expect(store.messages.some((m) => m.id === "older-2")).toBe(true);
    expect(store.hasOlder).toBe(false);
  });
});

describe("selectedConversation history window eviction (audit R4-04)", () => {
  it("keeps newly requested older rows when the window is full and honors exhausted history", async () => {
    const rows = Array.from({ length: 200 }, (_unused, index) =>
      historyRow("conv-1", `recent-${index}`, 200 - index)
    );
    await selectSnapshot("conv-1", {
      messages: rows,
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async () =>
        ({
          messages: [historyRow("conv-1", "oldest", -30)],
          nextBefore: null,
          hasOlder: false,
        }) as HistoryPage as never
    );
    await store.loadOlder();

    // The requested older message is RETAINED even though the window was
    // full and trimmed (backward paging evicts the opposite end)…
    expect(store.messages.some((m) => m.id === "oldest")).toBe(true);
    // …the bound still holds…
    expect(store.messages.length).toBeLessThanOrEqual(200);
    // …and the server's exhausted-history state survives (no forced true).
    expect(store.hasOlder).toBe(false);
  });

  it("pages backward across more than 200 messages without cursor gaps and returns to the live tail", async () => {
    const rows = Array.from({ length: 200 }, (_unused, index) =>
      historyRow("conv-1", `recent-${index}`, 400 - index)
    );
    await selectSnapshot("conv-1", {
      messages: rows,
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    let cursorForSecond: string | null = null;
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async () =>
        ({
          messages: Array.from({ length: 50 }, (_i, index) =>
            historyRow("conv-1", `older-a-${index}`, 180 - index)
          ),
          nextBefore: { timestamp: "2026-10-19T01:00:00.000Z", messageId: "cursor-2" },
          hasOlder: true,
        }) as HistoryPage as never
    );
    await store.loadOlder();
    // Still bounded, first fetched page retained.
    expect(store.messages.length).toBe(200);
    expect(store.messages.some((m) => m.id === "older-a-0")).toBe(true);
    expect(store.hasOlder).toBe(true);

    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async (_conversationId: string, _limit: number, cursor: unknown) => {
        cursorForSecond = (cursor as { messageId: string }).messageId;
        return {
          messages: Array.from({ length: 50 }, (_i, index) =>
            historyRow("conv-1", `older-b-${index}`, 130 - index)
          ),
          nextBefore: null,
          hasOlder: false,
        } as HistoryPage as never;
      }
    );
    await store.loadOlder();
    // No cursor gaps: the second page requested the cursor of the first.
    expect(cursorForSecond).toBe("cursor-2");
    // Newly fetched content stays navigable and exhaustion is honored.
    expect(store.messages.some((m) => m.id === "older-b-49")).toBe(true);
    expect(store.messages.length).toBe(200);
    expect(store.hasOlder).toBe(false);

    // "Return to the live tail": the selection handshake reseeds the full
    // authoritative snapshot (seedHistory)—the trimmed newest rows return.
    await selectSnapshot("conv-2", {});
    await selectSnapshot("conv-1", { messages: rows });
    expect(store.messages.some((m) => m.id === "recent-199")).toBe(true);
    expect(store.messages.some((m) => m.id === "recent-0")).toBe(true);
  });

  it("empty and duplicate pages keep the window stable while cursor and hasOlder stay honored", async () => {
    const rows = [
      historyRow("conv-1", "keep-1", 30),
      historyRow("conv-1", "keep-2", 29),
      historyRow("conv-1", "keep-3", 28),
    ];
    await selectSnapshot("conv-1", {
      messages: rows,
      nextBefore: { timestamp: rows[0].timestamp, messageId: "keep-1" },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async () =>
        ({
          messages: [
            historyRow("conv-1", "keep-2", 29),
            historyRow("conv-1", "keep-3", 28),
          ],
          nextBefore: { timestamp: "2026-10-19T00:00:00.000Z", messageId: "cursor-dup" },
          hasOlder: true,
        }) as HistoryPage as never
    );
    await store.loadOlder();
    // Dedup: duplicates add nothing.
    expect(store.messages.length).toBe(3);

    let requestedCursor: string | null = null;
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async (_conversationId: string, _limit: number, cursor: unknown) => {
        requestedCursor = (cursor as { messageId: string }).messageId;
        return { messages: [], nextBefore: null, hasOlder: false } as HistoryPage as never;
      }
    );
    await store.loadOlder();
    expect(requestedCursor).toBe("cursor-dup");
    expect(store.messages.length).toBe(3);
    expect(store.hasOlder).toBe(false);
  });

  it("new streamed rows arriving while history is loaded stay appended and navigable", async () => {
    const rows = Array.from({ length: 200 }, (_unused, index) =>
      historyRow("conv-1", `recent-${index}`, 400 - index)
    );
    const store = useSelectedConversationStore();
    await selectSnapshot("conv-1", {
      messages: rows,
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
    });

    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async () =>
        ({
          messages: [historyRow("conv-1", "oldest-kept", -30)],
          nextBefore: { timestamp: "2026-10-19T00:00:00.000Z", messageId: "cursor-2" },
          hasOlder: true,
        }) as HistoryPage as never
    );
    await store.loadOlder();
    expect(store.messages.some((m) => m.id === "oldest-kept")).toBe(true);

    // A live run starts while the user is paged back: its streamed row is
    // appended at the tail. A full window overflows at the FIRST live row,
    // so the front row (the deepest fetched page) is evicted — audit
    // R5-02 refines R4-04: the eviction is recoverable, because the store
    // re-arms the cursor/availability at the retained top row's boundary.
    store.applyDetailEvent({
      conversationId: "conv-1",
      runId: "run-live",
      sequence: 1,
      emittedAt: "2026-10-20T10:00:00.000Z",
      eventType: "start",
      payload: { eventType: "start", messageId: "live-row" },
    });
    await flushPromises();
    expect(store.messages[store.messages.length - 1]?.id).toBe("live-row");
    expect(store.messages.some((m) => m.id === "oldest-kept")).toBe(false);
    expect(store.hasOlder).toBe(true);
    // Recovery: the next Load older request addresses the retained top
    // row's boundary and refetches the evicted page content.
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async (_conversationId: string, _limit: number, cursor: unknown) => {
        expect((cursor as { messageId: string }).messageId).toBe("recent-0");
        return {
          messages: [historyRow("conv-1", "oldest-kept", -30)],
          nextBefore: null,
          hasOlder: false,
        } as HistoryPage as never;
      }
    );
    await store.loadOlder();
    expect(store.messages.some((m) => m.id === "oldest-kept")).toBe(true);
    expect(store.messages.length).toBeLessThanOrEqual(200);
    expect(store.messages[store.messages.length - 1]?.id).toBe("live-row");
  });
});

describe("active answer survives history-window eviction (audit R5-01)", () => {
  it("does not lose the response prefix when history paging evicts the active row", async () => {
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      historyRow("conv-1", `recent-${index}`, 400 - index)
    );
    await selectSnapshot("conv-1", {
      messages: rows,
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();
    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(detailEvent(2, "token", { contentDelta: "prefix " }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");

    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [historyRow("conv-1", "old-row", -1)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();

    // The requested older page is retained, the bound holds…
    expect(store.messages.some((m) => m.id === "old-row")).toBe(true);
    expect(store.messages.length).toBeLessThanOrEqual(200);
    // …and the streamed row keeps its accumulated prefix.
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");

    store.applyDetailEvent(detailEvent(3, "token", { contentDelta: "suffix" }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix suffix");
  });

  it("retains a completed answer evicted during history paging", async () => {
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      historyRow("conv-1", `recent-${index}`, 400 - index)
    );
    await selectSnapshot("conv-1", {
      messages: rows,
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();
    store.applyDetailEvent(detailEvent(1, "start"));

    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [historyRow("conv-1", "old-row", -1)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();

    store.applyDetailEvent(
      detailEvent(2, "complete", {
        fullContent: "complete authoritative answer",
      })
    );
    await flushPromises();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("complete authoritative answer");
  });
});

describe("live growth obeys the row bound and keeps evicted rows reachable (audit R5-02)", () => {
  it("a live response start enforces the 200-row bound synchronously", async () => {
    const rows = Array.from({ length: 200 }, (_unused, index) =>
      historyRow("conv-1", `recent-${index}`, 400 - index)
    );
    await selectSnapshot("conv-1", {
      messages: rows,
      nextBefore: null,
      hasOlder: false,
    });
    const store = useSelectedConversationStore();
    store.applyDetailEvent(detailEvent(1, "start"));
    await flushPromises();
    expect(store.messages.length).toBe(200);
  });

  it("rows evicted by live growth stay reachable through a re-armed cursor and availability", async () => {
    const rows = Array.from({ length: 200 }, (_unused, index) =>
      historyRow("conv-1", `recent-${index}`, 400 - index)
    );
    // The exhausted snapshot below (hasOlder false + null cursor) asserts
    // that a live eviction re-opens availability for the evicted rows.
    await selectSnapshot("conv-1", {
      messages: rows,
      nextBefore: null,
      hasOlder: false,
    });
    const store = useSelectedConversationStore();
    store.applyDetailEvent(detailEvent(1, "start"));
    await flushPromises();
    // The window trimmed its OLDEST row and re-armed the paging state:
    // the cursor covers the evicted row and the control re-appears.
    expect(store.hasOlder).toBe(true);

    vi.mocked(loadHistoryPage).mockImplementationOnce(
      async (_conversationId: string, _limit: number, cursor: unknown) => {
        // The cursor must address the boundary of the retained top row —
        // never the evicted one.
        expect((cursor as { messageId: string }).messageId).toBe("recent-1");
        return {
          messages: [historyRow("conv-1", "recent-0", 400)],
          nextBefore: null,
          hasOlder: false,
        } as HistoryPage as never;
      }
    );
    await store.loadOlder();
    expect(store.messages.some((m) => m.id === "recent-0")).toBe(true);
    expect(store.messages.length).toBe(200);
    // The retry hit exhaustion through the server's own verdict.
    expect(store.hasOlder).toBe(false);
  });
});
