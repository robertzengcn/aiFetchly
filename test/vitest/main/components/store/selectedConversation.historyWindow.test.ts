import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

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
