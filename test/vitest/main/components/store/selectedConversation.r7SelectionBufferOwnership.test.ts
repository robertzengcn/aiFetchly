import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Audit R7 (2026-10-22-r7) — R7-01: an older selection request clears the
 * newer selection's buffered completion.
 *
 * Between `presenter.dispose()` and the selection snapshot's resolution,
 * detail events are buffered (audit R6-01) and replayed after the seed.
 * Every cleanup/enable/disable/replay operation previously ran against a
 * SINGLE shared buffer without ownership: a superseded request whose
 * snapshot resolved later (success **or** rejection) cleared that buffer and
 * disabled deferral — discarding the CURRENT selection's valid terminal
 * facts buffered while its snapshot was in flight.
 *
 * The fix gives the buffer immutable selection ownership (`generation`
 * token): only the handshake that owns the current buffer may clear,
 * disable or replay it; stale success and stale rejection behave
 * identically (no-ops); teardown and null selection stay explicit.
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
  createClientRequestId: vi.fn().mockReturnValue("req-r7-buffer"),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: vi.fn(),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { selectConversation } from "@/views/api/aiChatWorkspace";

/** Pending transport promise per (mock) call order — selections overlap. */
interface PendingSelection {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}
const pendingSelections: PendingSelection[] = [];

function holdSnapshot(): void {
  let resolve!: PendingSelection["resolve"];
  let reject!: PendingSelection["reject"];
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pendingSelections.push({ promise, resolve, reject });
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
    timestamp: new Date(2026, 9, 22, 8, offsetMinutes).toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: { source: "chat-v2" },
  };
}

interface SnapshotOptions {
  partialAnswer?: string;
  runtimeStatus?: string;
  activeRunId?: string | null;
}

function snapshotView(
  conversationId: string,
  options: SnapshotOptions = {}
): unknown {
  return {
    acceptedGeneration: 1,
    messages: [
      historyRow(conversationId, `m-${conversationId}`, 0),
      ...(options.partialAnswer === undefined
        ? []
        : [
            {
              id: "live-answer",
              conversationId,
              role: "assistant",
              content: options.partialAnswer,
              timestamp: new Date(2026, 9, 22, 8, 1).toISOString(),
              messageType: MessageType.MESSAGE,
              metadata: { source: "chat-v2" },
            } satisfies ChatV2MessageView,
          ]),
    ],
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: options.runtimeStatus ?? "idle",
    activeRunId: options.activeRunId ?? null,
    title: conversationId,
  };
}

/**
 * Selection call order (i) is taken over by soak... by the mock: the Nth
 * `selectConversation` call awaits the Nth held snapshot (or resolves
 * immediately when none is held in that call order).
 */
let selectionCalls = 0;

function detailEvent(
  conversationId: string,
  runId: string,
  sequence: number,
  eventType:
    | "start"
    | "token"
    | "reasoning_delta"
    | "complete"
    | "error"
    | "cancelled"
    | "tool_call"
    | "tool_result",
  extra: Record<string, unknown> = {}
): ChatRunDetailEvent {
  return {
    conversationId,
    runId,
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

beforeEach(() => {
  setActivePinia(createPinia());
  pendingSelections.length = 0;
  selectionCalls = 0;
  summaryHandler = null;
  vi.mocked(selectConversation).mockReset();
  vi.mocked(selectConversation).mockImplementation(() => {
    selectionCalls += 1;
    const pending = pendingSelections[selectionCalls - 1];
    if (pending) return pending.promise as Promise<never>;
    return Promise.resolve(snapshotView("conv-unheld")) as Promise<never>;
  });
});

describe("deferred detail-event buffer ownership (audit R7-01)", () => {
  it("a superseded request RESOLVING after a newer selection started must not discard the newer selection's buffered completion", async () => {
    holdSnapshot(); // call order 1 → conv-a (the stale request)
    const store = useSelectedConversationStore();
    const loadingA = store.loadSelection("conv-a");
    await flushPromises();

    holdSnapshot(); // call order 2 → conv-b (the current selection)
    const loadingB = store.loadSelection("conv-b");
    await flushPromises();

    // B's authoritative terminal arrives while B's snapshot is in flight —
    // it must be buffered for the post-seed replay.
    store.applyDetailEvent(
      detailEvent("conv-b", "run-b", 1, "complete", {
        fullContent: "B completed while loading",
      })
    );
    await flushPromises();

    // The stale A request resolves after B took the buffer over.
    pendingSelections[0]!.resolve(snapshotView("conv-a"));
    await Promise.all([loadingA, flushPromises()]);

    // B's snapshot lands with earlier partial text and a running runtime.
    pendingSelections[1]!.resolve(
      snapshotView("conv-b", {
        partialAnswer: "partial",
        runtimeStatus: "running",
        activeRunId: "run-b",
      })
    );
    await Promise.all([loadingB, flushPromises()]);

    // The guarded stale cleanup can no longer destroy B's buffer: the
    // live terminal replays over the seed and wins.
    const answer = store.messages.find((m) => m.id === "live-answer");
    expect(answer?.content).toBe("B completed while loading");
    expect(store.runtimeStatus).toBe("idle");
    expect(store.streamStatus).toBe("idle");
    expect(store.loadError).toBeNull();
  });

  it("a superseded request REJECTING after a newer selection started behaves identically (no buffer clear, deferral stays on)", async () => {
    holdSnapshot(); // call order 1 → conv-a
    const store = useSelectedConversationStore();
    const loadingA = store.loadSelection("conv-a");
    await flushPromises();

    holdSnapshot(); // call order 2 → conv-b
    const loadingB = store.loadSelection("conv-b");
    await flushPromises();

    // The stale A request rejects after B took the buffer over.
    pendingSelections[0]!.reject(new Error("conv-a transport lost"));
    await Promise.all([loadingA, flushPromises()]);

    // Deferral must STILL be on: the current selection's events keep
    // buffering after the stale rejection instead of applying early.
    store.applyDetailEvent(
      detailEvent("conv-b", "run-b", 1, "token", {
        contentDelta: "streamed ",
      })
    );
    store.applyDetailEvent(
      detailEvent("conv-b", "run-b", 2, "complete", {
        fullContent: "B terminal after stale rejection",
      })
    );
    await flushPromises();

    pendingSelections[1]!.resolve(
      snapshotView("conv-b", {
        partialAnswer: "partial",
        runtimeStatus: "running",
        activeRunId: "run-b",
      })
    );
    await Promise.all([loadingB, flushBatchedDelta(), flushPromises()]);

    const answer = store.messages.find((m) => m.id === "live-answer");
    expect(answer?.content).toBe("B terminal after stale rejection");
    expect(store.runtimeStatus).toBe("idle");
    expect(store.loadError).toBeNull();
  });

  it("A→B→A: only the last handshake owns the buffer; both stale resolutions leave the final selection's replay intact", async () => {
    holdSnapshot(); // call order 1 → conv-a (v1)
    const store = useSelectedConversationStore();
    const firstA = store.loadSelection("conv-a");
    await flushPromises();

    holdSnapshot(); // call order 2 → conv-b
    const loadingB = store.loadSelection("conv-b");
    await flushPromises();

    holdSnapshot(); // call order 3 → conv-a again (the current owner)
    const secondA = store.loadSelection("conv-a");
    await flushPromises();

    // Buffered terminal/token facts for the CURRENT conv-a selection.
    store.applyDetailEvent(
      detailEvent("conv-a", "run-a", 1, "token", {
        contentDelta: "A streamed ",
      })
    );
    store.applyDetailEvent(
      detailEvent("conv-a", "run-a", 2, "complete", {
        fullContent: "A final tercer",
      })
    );
    await flushPromises();

    // Both stale requests settle (one succeeds, one fails) — neither owns
    // the buffer, both cleanups are no-ops.
    pendingSelections[1]!.resolve(snapshotView("conv-b"));
    pendingSelections[0]!.reject(new Error("conv-a v1 transport lost"));
    await Promise.all([firstA, loadingB, flushPromises()]);

    pendingSelections[2]!.resolve(
      snapshotView("conv-a", {
        partialAnswer: "A partial",
        runtimeStatus: "running",
        activeRunId: "run-a",
      })
    );
    await Promise.all([secondA, flushBatchedDelta(), flushPromises()]);

    const answer = store.messages.find((m) => m.id === "live-answer");
    expect(answer?.content).toBe("A final tercer");
    expect(store.runtimeStatus).toBe("idle");
  });

  it("three overlapping loads: buffered token, permission prompt and terminal for the CURRENT selection all replay once over its snapshot", async () => {
    holdSnapshot(); // call order 1 → conv-a
    const store = useSelectedConversationStore();
    const loadingA = store.loadSelection("conv-a");
    await flushPromises();

    holdSnapshot(); // call order 2 → conv-b
    const loadingB = store.loadSelection("conv-b");
    await flushPromises();

    holdSnapshot(); // call order 3 → conv-c (current)
    const loadingC = store.loadSelection("conv-c");
    await flushPromises();

    // Stale A succeeds, stale B rejects — differently, and both must be
    // no-ops against conv-c's buffer.
    pendingSelections[0]!.resolve(snapshotView("conv-a"));
    pendingSelections[1]!.reject(new Error("conv-b transport lost"));
    await Promise.all([loadingA, loadingB, flushPromises()]);

    // Current selection events buffered while conv-c's snapshot flies:
    // streamed token, a permission prompt row and the terminal.
    store.applyDetailEvent(
      detailEvent("conv-c", "run-c", 1, "token", {
        contentDelta: "C streamed ",
      })
    );
    store.applyDetailEvent(
      detailEvent("conv-c", "run-c", 2, "tool_result", {
        toolCallId: "tp-1",
        fullContent: "Permission required",
        toolResult: { success: true, needsPermissionPrompt: true },
      })
    );
    store.applyDetailEvent(
      detailEvent("conv-c", "run-c", 3, "complete", {
        fullContent: "C final",
      })
    );
    await flushPromises();

    pendingSelections[2]!.resolve(
      snapshotView("conv-c", {
        partialAnswer: "partial",
        runtimeStatus: "running",
        activeRunId: "run-c",
      })
    );
    await Promise.all([loadingC, flushBatchedDelta(), flushPromises()]);

    // Each buffered event replayed exactly once, in order, over the seed.
    expect(store.messages.find((m) => m.id === "live-answer")?.content).toBe(
      "C final"
    );
    expect(
      store.messages.some((m) => m.id === "tool-result-tp-1")
    ).toBe(true);
    expect(store.runtimeStatus).toBe("idle");
    expect(store.streamStatus).toBe("idle");
    expect(store.loadError).toBeNull();
  });

  it("teardown drops a pending selection's buffered events; the later snapshot resolution cannot resurrect them", async () => {
    holdSnapshot(); // call order 1 → conv-a
    const store = useSelectedConversationStore();
    const loading = store.loadSelection("conv-a");
    await flushPromises();

    // Events buffered for the pending selection…
    store.applyDetailEvent(
      detailEvent("conv-a", "run-a", 1, "token", {
        contentDelta: "streamed before teardown",
      })
    );
    store.applyDetailEvent(
      detailEvent("conv-a", "run-a", 2, "complete", {
        fullContent: "completed after teardown",
      })
    );
    await flushPromises();

    // …must never replay after teardown.
    store.teardown();
    pendingSelections[0]!.resolve(
      snapshotView("conv-a", {
        partialAnswer: "partial",
        runtimeStatus: "running",
        activeRunId: "run-a",
      })
    );
    await Promise.all([loading, flushBatchedDelta(), flushPromises()]);

    const answer = store.messages.find((m) => m.id === "live-answer");
    expect(answer).toBeDefined();
    expect(answer?.content).toBe("partial");
    expect(store.runtimeStatus).toBe("running");
  });
});
