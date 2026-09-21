import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

const windowInvokeMock = vi.fn();
const startChatRunMock = vi.fn();

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: (...args: unknown[]) => windowInvokeMock(...args),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  // chatWorkspace store contract
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
  // selectedConversation store contract
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-1"),
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

/**
 * Seed the store through the real selection handshake, then (optionally)
 * drive one live turn start through the detail-event path so isBusy reflects
 * the scenario under test — the same way a running turn marks the shell busy.
 */
async function seedStore(runtimeStatus: "idle" | "running"): Promise<void> {
  const seeded: ChatV2MessageView[] = [
    {
      id: "m-history",
      conversationId: "conv-1",
      role: "assistant",
      content: "earlier turn",
      timestamp: new Date(2026, 8, 18, 10, 0, 0).toISOString(),
      messageType: MessageType.MESSAGE,
      metadata: { source: "chat-v2" },
    },
  ];
  vi.mocked(selectConversation).mockResolvedValue({
    conversationId: "conv-1",
    acceptedGeneration: 1,
    messages: seeded,
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "idle",
    activeRunId: null,
    title: "Queue chat",
  });
  const store = useSelectedConversationStore();
  await store.loadSelection("conv-1");
  await flushPromises();
  if (runtimeStatus === "running") {
    store.applyDetailEvent({
      conversationId: "conv-1",
      runId: "run-1",
      sequence: 1,
      emittedAt: new Date(2026, 8, 18, 10, 0, 1).toISOString(),
      eventType: "start",
      payload: {
        eventType: "start",
        conversationId: "conv-1",
        messageId: "a-running",
      },
    });
  }
}

beforeEach(() => {
  setActivePinia(createPinia());
  windowInvokeMock.mockReset();
  startChatRunMock.mockReset();
  useChatWorkspaceStore().bootstrapError; // touch store without bootstrapping
});

describe("selectedConversation queue-delegated sends (message-queue §9.2)", () => {
  it("a pending-queue response replaces the optimistic row with the pending bubble", async () => {
    await seedStore("running");
    const store = useSelectedConversationStore();
    expect(store.isBusy).toBe(true);

    // Main-process delegation: the coordinator accepted the busy send into
    // the durable queue and answered with the pending-row run marker.
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "pending-p-1",
      status: "queued",
    });

    await store.sendMessage("follow-up B", { model: "gpt-test" });
    await flushPromises();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
      conversationId: "conv-1",
      message: "follow-up B",
      model: "gpt-test",
    });
    // The optimistic user row is gone — the pending bubble (driven by the
    // pendingMessages store's lifecycle subscription) is the surface.
    expect(store.messages.some((m) => m.content === "follow-up B")).toBe(false);
    // The running turn keeps run identity (the pending row is not a run);
    // truthy activeRunId still satisfies the composer's accepted-send rule.
    expect(store.activeRunId).toBe("run-1");
    expect(store.errorMessage).toBeNull();
  });

  it("a coordinator-queued response keeps the optimistic row", async () => {
    await seedStore("idle");
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "run-2",
      status: "queued",
    });

    const store = useSelectedConversationStore();
    await store.sendMessage("capacity queued A");
    await flushPromises();

    expect(
      store.messages.some(
        (m) => m.role === "user" && m.content === "capacity queued A"
      )
    ).toBe(true);
    expect(store.activeRunId).toBe("run-2");
  });

  it("a rejection surfaces the error and keeps the optimistic row for retry", async () => {
    await seedStore("running");
    startChatRunMock.mockRejectedValue(
      new Error("A run is already active for this conversation.")
    );

    const store = useSelectedConversationStore();
    await store.sendMessage("rejected B");
    await flushPromises();

    expect(store.errorMessage).toContain("already active");
    expect(store.messages.some((m) => m.content === "rejected B")).toBe(true);
  });

  it("an idle send runs through startRun with the optimistic row", async () => {
    await seedStore("idle");
    const store = useSelectedConversationStore();
    expect(store.isBusy).toBe(false);

    startChatRunMock.mockResolvedValue({
      runId: "run-3",
      status: "running",
      conversationId: "conv-1",
    });

    await store.sendMessage("fresh A");
    await flushPromises();

    expect(
      store.messages.some((m) => m.role === "user" && m.content === "fresh A")
    ).toBe(true);
    expect(store.activeRunId).toBe("run-3");
  });
});
