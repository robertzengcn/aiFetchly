import { describe, expect, it } from "vitest";
import {
  AIChatEventRouter,
  type RoutableWebContents,
} from "@/service/AIChatEventRouter";
import type {
  ChatRunDetailEvent,
  ConversationSummaryEvent,
} from "@/entityTypes/aiChatWorkspaceTypes";

interface SentMessage {
  channel: string;
  payload: unknown;
}

function fakeWebContents(id: number): {
  contents: RoutableWebContents;
  sent: SentMessage[];
  destroy(): void;
} {
  const sent: SentMessage[] = [];
  let destroyed = false;
  return {
    sent,
    destroy(): void {
      destroyed = true;
    },
    contents: {
      id,
      isDestroyed: () => destroyed,
      send: (channel: string, payload: string) => {
        sent.push({ channel, payload: JSON.parse(payload) });
      },
    },
  };
}

function detailEvent(conversationId: string): ChatRunDetailEvent {
  return {
    conversationId,
    runId: "run-1",
    sequence: 1,
    emittedAt: new Date(0).toISOString(),
    eventType: "token",
    payload: { contentDelta: "hi" },
  };
}

function summaryEvent(conversationId: string): ConversationSummaryEvent {
  return {
    conversationId,
    workspaceKey: null,
    runtimeStatus: "completed",
    attention: "none",
    unread: true,
    lastActivityAt: new Date(0).toISOString(),
    reason: "run_completed",
  };
}

describe("AIChatEventRouter", () => {
  it("delivers detailed events only to the window selecting that conversation", () => {
    const router = new AIChatEventRouter();
    const windowA = fakeWebContents(1);
    const windowB = fakeWebContents(2);
    router.register(windowA.contents);
    router.register(windowB.contents);

    router.select(1, "conv-a", 1);
    router.select(2, "conv-b", 1);

    router.sendDetailEvent(detailEvent("conv-a"));

    expect(windowA.sent).toHaveLength(1);
    expect(windowB.sent).toHaveLength(0);
    expect(windowA.sent[0].channel).toBe("ai-chat-workspace:detail-event");
    expect(
      (windowA.sent[0].payload as ChatRunDetailEvent).conversationId
    ).toBe("conv-a");
  });

  it("stops detail delivery after the selection changes away", () => {
    const router = new AIChatEventRouter();
    const windowA = fakeWebContents(1);
    router.register(windowA.contents);
    router.select(1, "conv-a", 1);
    router.sendDetailEvent(detailEvent("conv-a"));
    expect(windowA.sent).toHaveLength(1);

    router.select(1, "conv-b", 2);
    router.sendDetailEvent(detailEvent("conv-a"));
    expect(windowA.sent).toHaveLength(1); // nothing new — stale conversation

    router.sendDetailEvent(detailEvent("conv-b"));
    expect(windowA.sent).toHaveLength(2);
  });

  it("rapid A→B→A selection keeps only the latest generation accepted", () => {
    const router = new AIChatEventRouter();
    const windowA = fakeWebContents(1);
    router.register(windowA.contents);

    const gen1 = router.select(1, "conv-a", 1);
    const gen2 = router.select(1, "conv-b", 2);
    const gen3 = router.select(1, "conv-a", 3);
    expect(gen2).toBeGreaterThan(gen1);
    expect(gen3).toBeGreaterThan(gen2);

    // Late handshake response for an earlier generation cannot win: the
    // router keeps the newest requested generation for the same window.
    const stale = router.select(1, "conv-b", 1);
    expect(stale).toBeGreaterThanOrEqual(gen3);
    expect(router.getSelection(1)?.conversationId).toBe("conv-b");
  });

  it("broadcasts redacted summary events to every live window", () => {
    const router = new AIChatEventRouter();
    const windowA = fakeWebContents(1);
    const windowB = fakeWebContents(2);
    router.register(windowA.contents);
    router.register(windowB.contents);

    router.broadcastSummary(summaryEvent("conv-x"));
    expect(windowA.sent).toHaveLength(1);
    expect(windowB.sent).toHaveLength(1);
    expect(windowA.sent[0].channel).toBe("ai-chat-workspace:summary-event");
    expect(
      (windowA.sent[0].payload as ConversationSummaryEvent).runtimeStatus
    ).toBe("completed");
  });

  it("never sends to destroyed webContents and prunes them", () => {
    const router = new AIChatEventRouter();
    const windowA = fakeWebContents(1);
    router.register(windowA.contents);
    router.select(1, "conv-a", 1);

    windowA.destroy();
    router.sendDetailEvent(detailEvent("conv-a"));
    router.broadcastSummary(summaryEvent("conv-a"));
    expect(windowA.sent).toHaveLength(0);
    expect(router.stats().droppedDestroyedWebContents).toBe(1);

    router.destroy(1);
    expect(router.getSelection(1)).toBeNull();
  });

  it("counts stale detail events that matched no selection", () => {
    const router = new AIChatEventRouter();
    const windowA = fakeWebContents(1);
    router.register(windowA.contents); // no selection yet
    router.sendDetailEvent(detailEvent("conv-a"));
    expect(router.stats().detailEventsDroppedStale).toBe(1);
    expect(router.stats().detailEventsSent).toBe(0);
    expect(router.hasDetailSubscriber("conv-a")).toBe(false);
  });
});
