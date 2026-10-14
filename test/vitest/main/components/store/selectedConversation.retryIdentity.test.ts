import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

let requestCounter = 0;
const startChatRunMock = vi.fn();

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn(() => `req-${(requestCounter += 1)}`),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { selectConversation } from "@/views/api/aiChatWorkspace";

async function seedConversation(conversationId: string): Promise<void> {
  const seeded: ChatV2MessageView[] = [
    {
      id: `m-${conversationId}`,
      conversationId,
      role: "assistant",
      content: "hi",
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
  await useSelectedConversationStore().loadSelection(conversationId);
  await flushPromises();
}

function sentIds(): string[] {
  return startChatRunMock.mock.calls.map(
    (call) => (call[0] as { clientRequestId: string }).clientRequestId
  );
}

beforeEach(() => {
  setActivePinia(createPinia());
  requestCounter = 0;
  startChatRunMock.mockReset();
});

/**
 * B14: durable submission identity per logical draft + conversation.
 * Committed-main/lost-response retries reuse the id (one row/turn via main
 * dedupe); intentional changes and post-acceptance repeats mint fresh ids.
 */
describe("selectedConversation retry identities (B14)", () => {
  it("reuses the identity when the first attempt rejects ambiguously", async () => {
    await seedConversation("conv-a");
    const store = useSelectedConversationStore();
    startChatRunMock.mockRejectedValueOnce(new Error("transport lost"));
    startChatRunMock.mockResolvedValueOnce({
      conversationId: "conv-a",
      runId: "run-1",
      status: "running",
    });

    expect(await store.sendMessage("same draft")).toBe(false);
    expect(await store.sendMessage("same draft")).toBe(true);
    expect(sentIds()).toEqual(["req-1", "req-1"]);
  });

  it("mints a fresh identity for intentionally changed text", async () => {
    await seedConversation("conv-a");
    const store = useSelectedConversationStore();
    startChatRunMock.mockRejectedValue(new Error("nope"));

    await store.sendMessage("version one");
    await store.sendMessage("version two changed");
    expect(sentIds()).toEqual(["req-1", "req-2"]);
  });

  it("rotates after confirmed acceptance (intentional repeats are not collapsed)", async () => {
    await seedConversation("conv-a");
    const store = useSelectedConversationStore();
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-a",
      runId: "run-1",
      status: "running",
    });

    await store.sendMessage("hello again");
    await store.sendMessage("hello again");
    expect(sentIds()).toEqual(["req-1", "req-2"]);
  });

  it("keeps per-conversation identities across A→B→A", async () => {
    await seedConversation("conv-a");
    const store = useSelectedConversationStore();
    startChatRunMock.mockRejectedValue(new Error("transport lost"));

    await store.sendMessage("draft for A");
    await seedConversation("conv-b");
    await store.sendMessage("draft for B");
    await seedConversation("conv-a");
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-a",
      runId: "run-a",
      status: "running",
    });
    await store.sendMessage("draft for A");

    const calls = startChatRunMock.mock.calls.map((call) => [
      (call[0] as { conversationId: string }).conversationId,
      (call[0] as { clientRequestId: string }).clientRequestId,
    ]);
    expect(calls).toEqual([
      ["conv-a", "req-1"],
      ["conv-b", "req-2"],
      ["conv-a", "req-1"],
    ]);
  });
});
