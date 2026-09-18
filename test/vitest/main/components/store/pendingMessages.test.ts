import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { usePendingMessagesStore } from "@/views/store/pendingMessages";
import type {
  AIChatPendingMessageEvent,
  AIChatPendingMessageView,
} from "@/entityTypes/aiChatV2Types";

/**
 * Message-queue PRD §7 rendered surface: the shell's pending-row store —
 * per-conversation isolation, immutable commits, lifecycle upsert/remove, and
 * the list-IPC seeding used on conversation switches.
 */

const subscribeMock = vi.fn().mockReturnValue(() => undefined);

vi.mock("@/views/api/aiChatV2", () => ({
  listChatV2PendingMessages: (...args: unknown[]) => listMock(...args),
  subscribeChatV2PendingEvents: (...args: unknown[]) => subscribeMock(...args),
}));

const listMock = vi.fn();

function view(
  conversationId: string,
  pendingMessageId: string,
  overrides: Partial<AIChatPendingMessageView> = {}
): AIChatPendingMessageView {
  return {
    pendingMessageId,
    conversationId,
    clientRequestId: `cr-${pendingMessageId}`,
    sequence: 1,
    content: `queued ${pendingMessageId}`,
    status: "queued",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    canSteer: false,
    ...overrides,
  };
}

function event(
  conversationId: string,
  pendingMessageId: string,
  status: AIChatPendingMessageEvent["status"],
  pendingMessage?: AIChatPendingMessageView
): AIChatPendingMessageEvent {
  return {
    conversationId,
    pendingMessageId,
    status,
    occurredAt: "2026-09-18T00:00:01.000Z",
    ...(pendingMessage ? { pendingMessage } : {}),
  };
}

describe("pendingMessages store (message-queue §7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    subscribeMock.mockReturnValue(() => undefined);
  });

  it("returns empty rows for null conversations", () => {
    const store = usePendingMessagesStore();
    expect(store.rowsFor(null)).toEqual([]);
    expect(store.rowsFor("conv-unknown")).toEqual([]);
  });

  it("loads rows per conversation via the list IPC and subscribes once", async () => {
    listMock.mockImplementation(async (conversationId: string) =>
      conversationId === "conv-1"
        ? [view("conv-1", "p-1"), view("conv-1", "p-2")]
        : []
    );
    const store = usePendingMessagesStore();

    await store.loadConversation("conv-1");
    await store.loadConversation("conv-2");

    expect(listMock).toHaveBeenCalledWith("conv-1");
    expect(listMock).toHaveBeenCalledWith("conv-2");
    expect(store.rowsFor("conv-1")).toHaveLength(2);
    expect(store.rowsFor("conv-2")).toEqual([]);
    // Subscription is installed on first use, not per load.
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps rows isolated per conversation", () => {
    const store = usePendingMessagesStore();
    store.upsert(view("conv-1", "p-1"));
    store.upsert(view("conv-2", "p-2"));

    expect(store.rowsFor("conv-1").map((r) => r.pendingMessageId)).toEqual([
      "p-1",
    ]);
    expect(store.rowsFor("conv-2").map((r) => r.pendingMessageId)).toEqual([
      "p-2",
    ]);
  });

  it("upserts by pendingMessageId (update, not duplicate)", () => {
    const store = usePendingMessagesStore();
    store.upsert(view("conv-1", "p-1", { status: "queued" }));
    store.upsert(view("conv-1", "p-1", { status: "steering", canSteer: true }));

    const rows = store.rowsFor("conv-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("steering");
    expect(rows[0].canSteer).toBe(true);
  });

  it("lifecycle events upsert, update, and remove rows", () => {
    const store = usePendingMessagesStore();
    store.applyEvent(event("conv-1", "p-1", "queued", view("conv-1", "p-1")));
    expect(store.rowsFor("conv-1")).toHaveLength(1);

    store.applyEvent(
      event(
        "conv-1",
        "p-1",
        "steering",
        view("conv-1", "p-1", { status: "steering" })
      )
    );
    expect(store.rowsFor("conv-1")[0].status).toBe("steering");

    for (const terminal of ["sent", "cancelled", "applied"] as const) {
      store.applyEvent(event("conv-1", "p-1", terminal));
      expect(store.rowsFor("conv-1")).toEqual([]);
      store.applyEvent(event("conv-1", "p-1", "queued", view("conv-1", "p-1")));
    }
  });

  it("teardown unsubscribes and clears state", async () => {
    const unsub = vi.fn();
    subscribeMock.mockReturnValue(unsub);
    const store = usePendingMessagesStore();
    await store.loadConversation(null); // installs the subscription only
    store.upsert(view("conv-1", "p-1"));

    store.teardown();

    expect(unsub).toHaveBeenCalledTimes(1);
    expect(store.rowsFor("conv-1")).toEqual([]);
  });

  it("a failed load keeps prior rows (lifecycle events still refresh)", async () => {
    listMock.mockResolvedValue([view("conv-1", "p-1")]);
    const store = usePendingMessagesStore();
    await store.loadConversation("conv-1");
    expect(store.rowsFor("conv-1")).toHaveLength(1);

    listMock.mockRejectedValue(new Error("ipc down"));
    await store.loadConversation("conv-1");
    expect(store.rowsFor("conv-1")).toHaveLength(1);
  });
});
