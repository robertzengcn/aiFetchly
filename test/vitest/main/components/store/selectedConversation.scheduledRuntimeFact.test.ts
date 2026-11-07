import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatV2ScheduledStreamEvent } from "@/entityTypes/aiChatScheduledLoopTypes";

/**
 * Bugfix 2026-11-02 — the selected workspace view never learned about
 * scheduled-turn lifecycle because the workspace does not consume the
 * scheduled stream broadcast (only the legacy AiChatV2 page did):
 *
 *   - while a scheduled occurrence runs, the selected conversation must
 *     present its running flag (composer Stop affordance + streaming
 *     presentation) even when the run started before/without selection;
 *   - when the occurrence terminal lands, the flag must clear so it never
 *     outlives the run;
 *   - an INTERACTIVE stream always owns the view — scheduled facts must
 *     never clobber a live interactive turn (same guard as the legacy
 *     surface's scheduled-stream routing).
 */

const startChatRunMock = vi.fn();
const stopScheduledLoopRunMock = vi.fn();

type ScheduledStreamCallback = (event: ChatV2ScheduledStreamEvent) => void;
let scheduledStreamHandler: ScheduledStreamCallback | null = null;

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  denyChatV2ToolPermission: vi.fn(),
  subscribeChatV2PendingEvents: () => () => undefined,
}));

vi.mock("@/views/api/aiChatScheduledLoop", () => ({
  subscribeScheduledStream: (
    handler: ScheduledStreamCallback
  ): (() => void) => {
    scheduledStreamHandler = handler;
    return () => {
      if (scheduledStreamHandler === handler) scheduledStreamHandler = null;
    };
  },
  stopScheduledLoopRun: (
    conversationId: string
  ): Promise<{ cancelled: boolean } | null> =>
    stopScheduledLoopRunMock(conversationId),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: () => () => undefined,
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-sched"),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { selectConversation } from "@/views/api/aiChatWorkspace";

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
    timestamp: new Date(2026, 10, 2, 8, offsetMinutes).toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: { source: "chat-v2" },
  };
}

interface SnapshotOptions {
  messages?: ChatV2MessageView[];
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
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: snapshot.runtimeStatus ?? "idle",
    activeRunId: snapshot.activeRunId ?? null,
    title: conversationId,
  } as never);
  await useSelectedConversationStore().loadSelection(conversationId);
  await flushPromises();
}

/** Broadcast payload emitted by both scheduled paths (technical-design §13.2). */
function scheduledEvent(
  conversationId: string,
  kind: ChatV2ScheduledStreamEvent["kind"],
  runId = 42
): ChatV2ScheduledStreamEvent {
  return {
    conversationId,
    runId,
    messageId: `scheduled-assistant-7-${runId}`,
    kind,
  };
}

function emitScheduled(
  event: ChatV2ScheduledStreamEvent
): void {
  expect(scheduledStreamHandler, "subscription must be installed").not.toBeNull();
  scheduledStreamHandler?.(event);
}

beforeEach(() => {
  setActivePinia(createPinia());
  startChatRunMock.mockReset();
  scheduledStreamHandler = null;
  vi.mocked(selectConversation).mockReset();
  vi.mocked(selectConversation).mockResolvedValue({
    acceptedGeneration: 1,
    messages: [],
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "idle",
    activeRunId: null,
    title: null,
  } as never);
});

describe("scheduled-turn liveness for the selected view", () => {
  it("a selected conversation flags running on the scheduled start and clears it on the terminal", async () => {
    await selectSnapshot("v2-sched");
    const store = useSelectedConversationStore();

    expect(store.runtimeStatus).toBe("idle");
    expect(store.isBusy).toBe(false);

    emitScheduled(scheduledEvent("v2-sched", "start"));

    // The bottom-of-chat composer Stop affordance and the streaming
    // presentation both derive from runtimeStatus/streamStatus.
    expect(store.runtimeStatus).toBe("running");
    expect(store.isBusy).toBe(true);

    emitScheduled(scheduledEvent("v2-sched", "done"));

    expect(store.runtimeStatus).toBe("idle");
    expect(store.isBusy).toBe(false);
  });

  it("an error terminal also clears the running flag", async () => {
    await selectSnapshot("v2-sched-err");

    emitScheduled(scheduledEvent("v2-sched-err", "start"));
    expect(useSelectedConversationStore().isBusy).toBe(true);

    emitScheduled(
      scheduledEvent("v2-sched-err", "error")
    );
    expect(useSelectedConversationStore().runtimeStatus).toBe("idle");
    expect(useSelectedConversationStore().isBusy).toBe(false);
  });

  it("a run running before selection stays flagged via token events (snapshot gap repair)", async () => {
    // Snapshot taken mid-run (e.g. the main projection restarted idle) — a
    // subsequent token proof brings the schedule's liveness back.
    await selectSnapshot("v2-mid");

    const store = useSelectedConversationStore();
    expect(store.runtimeStatus).toBe("idle");

    emitScheduled(scheduledEvent("v2-mid", "token"));

    expect(store.runtimeStatus).toBe("running");
    expect(store.isBusy).toBe(true);
  });

  it("foreign-conversation scheduled facts never touch the selected view", async () => {
    await selectSnapshot("v2-selected");

    const store = useSelectedConversationStore();
    emitScheduled(scheduledEvent("v2-other", "start"));

    expect(store.runtimeStatus).toBe("idle");
    expect(store.isBusy).toBe(false);
  });

  it("a live interactive stream owns the view — scheduled start never clobbers it", async () => {
    await selectSnapshot("v2-busy");
    const store = useSelectedConversationStore();
    // Simulate an interactive run already presenting (as sendMessage
    // acceptance does through the presenter).
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "running",
      activeRunId: "run-interactive",
      title: "busy",
    } as never);
    await store.loadSelection("v2-busy");
    await flushPromises();

    expect(store.runtimeStatus).toBe("running");
    expect(store.activeRunId).toBe("run-interactive");

    emitScheduled(scheduledEvent("v2-busy", "start", 77));

    expect(store.activeRunId).toBe("run-interactive");
    expect(store.isBusy).toBe(true);
  });

  it("a snapshot-hydrated running scheduled conversation clears when its terminal arrives", async () => {
    // Piece 1 (select projection) hydrates running from the scheduled engine
    // probe; the stream terminal must clear it while the view stays open.
    await selectSnapshot("v2-hydrated", {
      runtimeStatus: "running",
      activeRunId: "scheduled-42",
    });
    const store = useSelectedConversationStore();
    expect(store.runtimeStatus).toBe("running");

    emitScheduled(scheduledEvent("v2-hydrated", "done", 42));

    expect(store.runtimeStatus).toBe("idle");
    expect(store.isBusy).toBe(false);
  });
});

describe("scheduled-turn live presentation in the workspace transcript", () => {
  /** The presenter batches token deltas on a ~50ms flush window. */
  async function flushPresenterBatch(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  it("the scheduled start paints the pending assistant row and flags running", async () => {
    await selectSnapshot("v2-live");
    const store = useSelectedConversationStore();
    expect(store.isBusy).toBe(false);

    emitScheduled(scheduledEvent("v2-live", "start"));

    expect(store.runtimeStatus).toBe("running");
    expect(store.isBusy).toBe(true);
    expect(store.activeAssistantMessageId).toBe(
      "scheduled-assistant-7-42"
    );
    expect(
      store.messages.some(
        (m) => m.id === "scheduled-assistant-7-42" && m.role === "assistant"
      )
    ).toBe(true);
  });

  it("scheduled tokens stream content into the pending assistant row", async () => {
    await selectSnapshot("v2-stream");
    emitScheduled(scheduledEvent("v2-stream", "start"));
    emitScheduled({
      ...scheduledEvent("v2-stream", "token"),
      contentDelta: "Hello",
    });
    emitScheduled({
      ...scheduledEvent("v2-stream", "token"),
      contentDelta: " world",
    });

    await flushPresenterBatch();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "scheduled-assistant-7-42");
    expect(row?.content).toBe("Hello world");
    expect(store.streamStatus).toBe("streaming");
  });

  it("the scheduled terminal finalizes the row and clears the running flag", async () => {
    await selectSnapshot("v2-final");
    emitScheduled(scheduledEvent("v2-final", "start"));
    emitScheduled({
      ...scheduledEvent("v2-final", "token"),
      contentDelta: "Answer",
    });
    await flushPresenterBatch();

    emitScheduled(scheduledEvent("v2-final", "done"));

    const store = useSelectedConversationStore();
    expect(store.runtimeStatus).toBe("idle");
    expect(store.streamStatus).toBe("idle");
    expect(store.activeAssistantMessageId).toBe(null);
    expect(store.isBusy).toBe(false);
    const row = store.messages.find(
      (m) => m.id === "scheduled-assistant-7-42"
    );
    expect(row?.content).toBe("Answer");
  });

  it("a scheduled error terminal raises the stream error and clears running", async () => {
    await selectSnapshot("v2-fail");
    emitScheduled(scheduledEvent("v2-fail", "start"));

    emitScheduled({
      ...scheduledEvent("v2-fail", "error"),
      errorMessage: "provider unreachable",
    });

    const store = useSelectedConversationStore();
    expect(store.runtimeStatus).toBe("idle");
    expect(store.errorMessage).toBe("provider unreachable");
    expect(store.streamStatus).toBe("error");
    expect(store.isBusy).toBe(false);
  });

  it("a live interactive run owns the view — scheduled facts paint nothing", async () => {
    await selectSnapshot("v2-busy-live", {
      runtimeStatus: "running",
      activeRunId: "run-interactive",
    });

    emitScheduled(scheduledEvent("v2-busy-live", "start", 77));
    emitScheduled({
      ...scheduledEvent("v2-busy-live", "token", 77),
      contentDelta: " should not appear",
    });
    await flushPresenterBatch();

    const store = useSelectedConversationStore();
    expect(store.activeRunId).toBe("run-interactive");
    expect(store.activeAssistantMessageId).toBe(null);
    expect(
      store.messages.some(
        (m) => m.id === "scheduled-assistant-7-77"
      )
    ).toBe(false);
  });

  it("a queued view is not stomped by scheduled liveness", async () => {
    await selectSnapshot("v2-queued", {
      runtimeStatus: "queued",
      activeRunId: "pending-1",
    });

    emitScheduled(scheduledEvent("v2-queued", "start", 88));

    const store = useSelectedConversationStore();
    expect(store.runtimeStatus).toBe("queued");
    expect(store.activeRunId).toBe("pending-1");
    expect(
      store.messages.some(
        (m) => m.id === "scheduled-assistant-7-88"
      )
    ).toBe(false);
  });

  it("an awaiting-permission view is not stomped by scheduled liveness", async () => {
    await selectSnapshot("v2-parked", {
      runtimeStatus: "awaiting_permission",
      activeRunId: "scheduled-90",
    });

    emitScheduled(scheduledEvent("v2-parked", "token", 90));

    const store = useSelectedConversationStore();
    expect(store.runtimeStatus).toBe("awaiting_permission");
    expect(store.activeRunId).toBe("scheduled-90");
  });

  it("foreign-conversation scheduled facts never paint the selected transcript", async () => {
    await selectSnapshot("v2-picked");
    emitScheduled(scheduledEvent("v2-stranger", "start"));

    const store = useSelectedConversationStore();
    expect(store.isBusy).toBe(false);
    expect(
      store.messages.some(
        (m) => m.id === "scheduled-assistant-7-42"
      )
    ).toBe(false);
  });
});

describe("composer Stop routes scheduled occurrences", () => {
  beforeEach(() => {
    stopScheduledLoopRunMock.mockReset();
    stopScheduledLoopRunMock.mockResolvedValue({ cancelled: true });
  });

  it("a scheduled-owned running view stops the occurrence and clears the flag locally", async () => {
    await selectSnapshot("v2-schedstop", {
      runtimeStatus: "running",
      activeRunId: "scheduled-42",
    });
    const store = useSelectedConversationStore();
    expect(store.isBusy).toBe(true);

    const handled = await store.stopScheduledActiveRun();

    expect(stopScheduledLoopRunMock).toHaveBeenCalledWith("v2-schedstop");
    expect(handled).toBe(true);
    expect(store.runtimeStatus).toBe("idle");
    expect(store.isBusy).toBe(false);
  });

  it("an interactive-owned run is not routed to the scheduled-stop IPC", async () => {
    await selectSnapshot("v2-intstop", {
      runtimeStatus: "running",
      activeRunId: "run-abc",
    });

    const handled = await useSelectedConversationStore().stopScheduledActiveRun();

    expect(handled).toBe(false);
    expect(stopScheduledLoopRunMock).not.toHaveBeenCalled();
    expect(useSelectedConversationStore().isBusy).toBe(true);
  });

  it("a stop IPC miss leaves the flag up for the terminal to clear", async () => {
    await selectSnapshot("v2-missstop", {
      runtimeStatus: "running",
      activeRunId: "scheduled-42",
    });
    stopScheduledLoopRunMock.mockResolvedValueOnce({ cancelled: false });

    const handled = await useSelectedConversationStore().stopScheduledActiveRun();

    expect(handled).toBe(false);
    expect(useSelectedConversationStore().isBusy).toBe(true);
  });

  it("a failed stop IPC falls through (flag stays until terminal)", async () => {
    await selectSnapshot("v2-failstop", {
      runtimeStatus: "running",
      activeRunId: "scheduled-42",
    });
    stopScheduledLoopRunMock.mockRejectedValueOnce(new Error("ipc down"));

    const handled = await useSelectedConversationStore().stopScheduledActiveRun();

    expect(handled).toBe(false);
    expect(useSelectedConversationStore().isBusy).toBe(true);
  });

  it("an idle view has nothing scheduled to stop", async () => {
    await selectSnapshot("v2-idlestop");

    const handled = await useSelectedConversationStore().stopScheduledActiveRun();

    expect(handled).toBe(false);
    expect(stopScheduledLoopRunMock).not.toHaveBeenCalled();
  });
});
