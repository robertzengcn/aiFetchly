import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

const startChatRunMock = vi.fn();

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
  windowReceive: vi.fn().mockReturnValue(() => undefined),
  windowRemoveListener: vi.fn(),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-b07"),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { selectConversation } from "@/views/api/aiChatWorkspace";

async function seedConversation(conversationId: string): Promise<void> {
  const seeded: ChatV2MessageView[] = [
    {
      id: `m-history-${conversationId}`,
      conversationId,
      role: "assistant",
      content: `earlier turn in ${conversationId}`,
      timestamp: new Date(2026, 8, 18, 10, 0, 0).toISOString(),
      messageType: MessageType.MESSAGE,
      metadata: { source: "chat-v2" },
    },
  ];
  vi.mocked(selectConversation).mockResolvedValue({
    conversationId,
    acceptedGeneration: 1,
    messages: seeded,
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "idle",
    activeRunId: null,
    title: conversationId,
  });
  const store = useSelectedConversationStore();
  await store.loadSelection(conversationId);
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  startChatRunMock.mockReset();
});

/**
 * B07: delayed IPC outcomes for A must never mutate B's presenter, error
 * banner or run status — including A→B→A generation changes.
 */
describe("selectedConversation cross-conversation send ownership (B07)", () => {
  it("a delayed rejection for A leaves B untouched", async () => {
    await seedConversation("conv-a");
    const store = useSelectedConversationStore();
    const workspace = useChatWorkspaceStore();

    let rejectSend!: (err: unknown) => void;
    startChatRunMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSend = reject;
      })
    );
    const sendPromise = store.sendMessage("message for A");
    // Optimistic row is in for A.
    expect(
      store.messages.some((m) => m.content === "message for A")
    ).toBe(true);

    // Switch to B while the IPC is in flight.
    await seedConversation("conv-b");
    expect(workspace.selectedConversationId).toBe("conv-b");
    const bMessages = store.messages.map((m) => m.id);

    rejectSend(new Error("queue full"));
    const accepted = await sendPromise;
    await flushPromises();

    expect(accepted).toBe(false);
    // B unchanged: no error bubble, no banner, no status flip.
    expect(store.messages.map((m) => m.id)).toEqual(bMessages);
    expect(
      store.messages.some((m) => m.content === "queue full")
    ).toBe(false);
    expect(store.errorMessage).toBeNull();
    expect(store.activeRunId).toBeNull();
  });

  it("a delayed success for A leaves B untouched", async () => {
    await seedConversation("conv-a");
    const store = useSelectedConversationStore();

    let resolveSend!: (value: unknown) => void;
    startChatRunMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      })
    );
    const sendPromise = store.sendMessage("hello from A");
    await seedConversation("conv-b");
    const bMessages = store.messages.map((m) => m.id);

    resolveSend({ conversationId: "conv-a", runId: "run-a1", status: "running" });
    const accepted = await sendPromise;
    await flushPromises();

    expect(accepted).toBe(true);
    expect(store.messages.map((m) => m.id)).toEqual(bMessages);
    expect(store.activeRunId).toBeNull();
    expect(store.errorMessage).toBeNull();
  });

  it("A→B→A return restores origin handling (error surfaces in A)", async () => {
    await seedConversation("conv-a");
    const store = useSelectedConversationStore();

    let rejectSend!: (err: unknown) => void;
    startChatRunMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSend = reject;
      })
    );
    const sendPromise = store.sendMessage("retry me in A");
    await seedConversation("conv-b");
    await seedConversation("conv-a");

    rejectSend(new Error("transport down"));
    const accepted = await sendPromise;
    await flushPromises();

    expect(accepted).toBe(false);
    // Back on A: the rejection surfaces where it belongs.
    expect(store.errorMessage).toContain("transport down");
    expect(
      store.messages.some(
        (m) => m.role === "assistant" && m.content.includes("transport down")
      )
    ).toBe(true);
  });
});
