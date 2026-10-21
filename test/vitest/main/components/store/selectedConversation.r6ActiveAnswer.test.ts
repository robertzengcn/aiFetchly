import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";

const startChatRunMock = vi.fn();

/**
 * Audit R6 (2026-10-21-r6) — authoritative runtime hydration and active
 * answer retention.
 *
 * R6-01: selection hydration overwrote the snapshot's authoritative
 * runtime facts (`runtimeStatus`, `activeRunId`) with the presenter's
 * default idle projection — a re-selected quiet running/waiting
 * conversation presented idle (no run strip, no Stop affordance,
 * misleading busy-dependent composer state) until an engine event
 * repaired it. The fix hydrates the PRESENTER from the same snapshot and
 * reconciles detail events that arrive during the snapshot await so an
 * older snapshot can never overwrite newer terminal/live facts.
 *
 * R6-02: a resumed answer hydrated from history was never registered as
 * protected (the append/deduplicate path returned before pin
 * registration), so the same pre-fix loss (audit R5-01) remained after
 * reload/reselection: paging removed the hydrated answer and the next
 * token recreated an empty row.
 *
 * R6-03: live-direction trimming ignored the active-turn protection
 * entirely and could destroy an in-flight answer once one turn alone
 * overflowed the mounted window. The bound must hold for BOTH directions
 * while current response, reasoning and actionable decision rows stay
 * preserved/recoverable at the same boundary.
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
  createClientRequestId: vi.fn().mockReturnValue("req-r6"),
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

function assistantRow(
  conversationId: string,
  id: string,
  content: string,
  offsetMinutes: number,
  metadata?: ChatV2MessageView["metadata"]
): ChatV2MessageView {
  return {
    id,
    conversationId,
    role: "assistant",
    content,
    timestamp: new Date(2026, 9, 20, 8, offsetMinutes).toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: metadata ?? { source: "chat-v2" },
  };
}

function toolResultRow(
  conversationId: string,
  id: string,
  toolCallId: string,
  offsetMinutes: number,
  toolResult: Record<string, unknown> | undefined
): ChatV2MessageView {
  return {
    id,
    conversationId,
    role: "assistant",
    content: "",
    timestamp: new Date(2026, 9, 20, 8, offsetMinutes).toISOString(),
    messageType: MessageType.TOOL_RESULT,
    metadata: {
      source: "chat-v2",
      toolCallId,
      toolName: "search",
      toolResult,
      toolResultStatus: "success",
      success: true,
    },
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

describe("authoritative runtime hydration after selection (audit R6-01)", () => {
  it("a running snapshot presents its runtime status and run identity, and history paging cannot reset it", async () => {
    // Audited repro: resolve the snapshot with a persisted row and a
    // freshly running run; page WITHOUT emitting any new stream event.
    await selectSnapshot("conv-1", {
      nextBefore: { timestamp: "2026-10-20T08:00:00.000Z", messageId: "c-1" },
      hasOlder: true,
      runtimeStatus: "running",
      activeRunId: "live-run",
    });
    const store = useSelectedConversationStore();

    expect(store.runtimeStatus).toBe("running");
    expect(store.activeRunId).toBe("live-run");
    // Busy policy: the composer keeps its busy affordances although the
    // engine may stay quiet (streaming presentation from a running run).
    expect(store.isBusy).toBe(true);
    expect(store.streamStatus).toBe("streaming");

    // Load history / mutate presentation without any new engine event —
    // the authoritative runtime must remain intact.
    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [historyRow("conv-1", "older", -30)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();
    expect(store.messages.some((m) => m.id === "older")).toBe(true);
    expect(store.runtimeStatus).toBe("running");
    expect(store.activeRunId).toBe("live-run");
    expect(store.isBusy).toBe(true);
  });

  it("queued, waiting and terminal snapshots present their states with the matching busy/stop policy", async () => {
    // Queued: busy (durable pending queue), stream presentation idle.
    await selectSnapshot("conv-1", {
      runtimeStatus: "queued",
      activeRunId: "pending-1",
    });
    expect(useSelectedConversationStore().isBusy).toBe(true);
    expect(useSelectedConversationStore().streamStatus).toBe("idle");
    expect(useSelectedConversationStore().runtimeStatus).toBe("queued");

    // Awaiting user: NOT busy, but the run strip state survives.
    await selectSnapshot("conv-1", {
      runtimeStatus: "awaiting_user",
      activeRunId: "run-q",
    });
    expect(useSelectedConversationStore().isBusy).toBe(false);
    expect(useSelectedConversationStore().runtimeStatus).toBe("awaiting_user");
    expect(useSelectedConversationStore().activeRunId).toBe("run-q");

    // Awaiting permission: same waiting policy.
    await selectSnapshot("conv-1", {
      runtimeStatus: "awaiting_permission",
      activeRunId: "run-p",
    });
    expect(useSelectedConversationStore().runtimeStatus).toBe(
      "awaiting_permission"
    );

    // Settled terminal snapshots present idle again.
    await selectSnapshot("conv-1", {
      runtimeStatus: "completed",
      activeRunId: "run-old",
    });
    expect(useSelectedConversationStore().runtimeStatus).toBe("completed");
    expect(useSelectedConversationStore().streamStatus).toBe("idle");
    expect(useSelectedConversationStore().isBusy).toBe(false);
  });

  it("a terminal event that arrives DURING the snapshot await overwrites the snapshot's stale running state after the seed", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const snapshot = new Promise((resolve) => {
      finish = resolve;
    });
    vi.mocked(selectConversation).mockReturnValueOnce(
      snapshot as Promise<never>
    );

    const store = useSelectedConversationStore();
    const loading = store.loadSelection("conv-1");
    await flushPromises();
    expect(store.loading).toBe(true);

    // The run streams + completes while the snapshot is still in flight
    // — the live channel carried NEWER terminal facts than the snapshot.
    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(
      detailEvent(2, "token", { contentDelta: "late text" })
    );
    await flushBatchedDelta();
    store.applyDetailEvent(
      detailEvent(3, "complete", { fullContent: "late text final" })
    );
    await flushPromises();

    // The seeded snapshot / hydration must not overwrite these newer
    // facts — the replay orders live facts AFTER the snapshot.
    finish({
      acceptedGeneration: 1,
      messages: [historyRow("conv-1", "persisted", 0)],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "running",
      activeRunId: "run-live",
      title: "conv-1",
    } as never);
    await Promise.all([loading, flushPromises()]);

    expect(store.runtimeStatus).toBe("idle");
    expect(store.activeRunId).toBe("run-live");
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(true);
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("late text final");
    expect(store.messages.some((m) => m.id === "persisted")).toBe(true);
  });

  it("a token that streams during the snapshot await survives the seed (replay, not eviction)", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const snapshot = new Promise((resolve) => {
      finish = resolve;
    });
    vi.mocked(selectConversation).mockReturnValueOnce(
      snapshot as Promise<never>
    );

    const store = useSelectedConversationStore();
    const loading = store.loadSelection("conv-1");
    await flushPromises();
    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(
      detailEvent(2, "token", { contentDelta: "streamed early" })
    );
    await flushBatchedDelta();

    finish({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "conv-1",
    } as never);
    await Promise.all([loading, flushPromises()]);

    // The replayed token flushes on its own batch window.
    await flushBatchedDelta();

    // Seeding no longer WIPES streamed content received during the load.
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(true);
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("streamed early");
    expect(useChatWorkspaceStore().selectedConversationId).toBe("conv-1");
  });

  it("route A→B→A reselection keeps the quiet running conversation presenting running (the audited R6-01 repro)", async () => {
    await selectSnapshot("conv-1", {
      runtimeStatus: "running",
      activeRunId: "live-run",
    });
    await selectSnapshot("conv-2", {});
    await selectSnapshot("conv-1", {
      runtimeStatus: "running",
      activeRunId: "live-run",
    });
    const store = useSelectedConversationStore();
    // No engine events at all — the snapshot ALONE must present the run.
    expect({
      status: store.runtimeStatus,
      run: store.activeRunId,
      busy: store.isBusy,
    }).toEqual({ status: "running", run: "live-run", busy: true });
  });
});

describe("resumed answers loaded from history stay protected while paging (audit R6-02)", () => {
  it("preserves saved text plus resumed deltas around a backward history page", async () => {
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      historyRow("conv-1", `r-${index}`, index)
    );
    const answer = assistantRow("conv-1", "live-answer", "saved ", 400);
    await selectSnapshot("conv-1", {
      messages: [...rows, answer],
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();

    // The run resumes WITHOUT a fresh start event: a first mid-run token.
    store.applyDetailEvent(detailEvent(1, "token", { contentDelta: "prefix " }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved prefix ");

    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [historyRow("conv-1", "older", -1)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();
    expect(store.messages.length).toBeLessThanOrEqual(200);

    store.applyDetailEvent(detailEvent(2, "token", { contentDelta: "suffix" }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved prefix suffix");
    await flushPromises();
  });

  it("a resumed start after re-selection adopts the persisted answer and pins it for paging", async () => {
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      historyRow("conv-1", `r-${index}`, index)
    );
    const answer = assistantRow("conv-1", "live-answer", "saved ", 400);
    await selectSnapshot("conv-1", {
      messages: [...rows, answer],
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
      runtimeStatus: "running",
      activeRunId: "run-live",
    });
    const store = useSelectedConversationStore();

    // The engine re-acknowledges the run after the re-selection.
    store.applyDetailEvent(detailEvent(1, "start"));
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved ");

    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [historyRow("conv-1", "older", -1)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();

    store.applyDetailEvent(detailEvent(2, "token", { contentDelta: "resumed" }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved resumed");
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("reasoning follows the same adoption path (saved reasoning plus resumed deltas)", async () => {
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      historyRow("conv-1", `r-${index}`, index)
    );
    const answer = assistantRow("conv-1", "live-answer", "saved ", 400, {
      source: "chat-v2",
      reasoning: {
        content: "saved reasoning",
        format: "plain_text",
        source: "server",
      },
    });
    await selectSnapshot("conv-1", {
      messages: [...rows, answer],
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
      runtimeStatus: "running",
      activeRunId: "run-live",
    });
    const store = useSelectedConversationStore();

    store.applyDetailEvent(
      detailEvent(1, "reasoning_delta", { reasoningDelta: " resumed" })
    );
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.metadata
        ?.reasoning?.content
    ).toBe("saved reasoning resumed");

    store.applyDetailEvent(detailEvent(2, "token", { contentDelta: " tail" }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved  tail");
  });

  it("error and cancelled turns keep the accumulated rows on the display before retiring the pins", async () => {
    const rows = Array.from({ length: 198 }, (_unused, index) =>
      historyRow("conv-1", `r-${index}`, index)
    );
    const answer = assistantRow("conv-1", "live-answer", "saved ", 400);
    for (const [eventType, extra] of [
      ["error", { errorMessage: "engine lost" }],
      ["cancelled", {}],
    ] as const) {
      await selectSnapshot("conv-1", {
        messages: [...rows, answer],
        nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
        hasOlder: true,
        runtimeStatus: "running",
        activeRunId: "run-live",
      });
      const store = useSelectedConversationStore();

      store.applyDetailEvent(
        detailEvent(1, "token", { contentDelta: "resumed " })
      );
      await flushBatchedDelta();
      expect(
        store.messages.find((m) => m.id === "live-answer")?.content
      ).toBe("saved resumed ");
      vi.mocked(loadHistoryPage).mockResolvedValueOnce({
        messages: [historyRow("conv-1", "older", -1)],
        nextBefore: null,
        hasOlder: false,
      } as never);
      await store.loadOlder();
      // Eviction pruned something; the answer may or may not be mounted.
      store.applyDetailEvent(detailEvent(2, eventType, extra));
      await flushPromises();

      // The accumulated text survives the terminal, mounted again.
      const answerRow = store.messages.find((m) => m.id === "live-answer");
      expect(answerRow).toBeDefined();
      expect(answerRow?.content).toBe("saved resumed ");
      const event = eventType as "error" | "cancelled";
      expect(store.runtimeStatus).toBe("idle");
      expect(event.length).toBeGreaterThan(0);

      // Subsequent history paging after the turn retired shows the row as
      // ordinary evictable content (protected only within its run).
      vi.mocked(loadHistoryPage).mockResolvedValueOnce({
        messages: [historyRow("conv-1", "older-2", -2)],
        nextBefore: null,
        hasOlder: false,
      } as never);
      await store.loadOlder();
      expect(store.messages.length).toBeLessThanOrEqual(200);
      if (store.messages.some((m) => m.id === "older-2")) {
        expect(
          store.messages.find((m) => m.id === "live-answer")?.content
        ).toBe("saved resumed ");
      }
    }
  });

  it("complete after re-selection keeps authoritative content (and retires protection)", async () => {
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      historyRow("conv-1", `r-${index}`, index)
    );
    const answer = assistantRow("conv-1", "live-answer", "saved ", 400);
    await selectSnapshot("conv-1", {
      messages: [...rows, answer],
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
      runtimeStatus: "running",
      activeRunId: "run-live",
    });
    const store = useSelectedConversationStore();

    store.applyDetailEvent(detailEvent(1, "token", { contentDelta: "resumed" }));
    await flushBatchedDelta();
    store.applyDetailEvent(
      detailEvent(2, "complete", {
        fullContent: "saved resumed final",
      })
    );
    await flushPromises();

    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved resumed final");
    expect(store.runtimeStatus).toBe("idle");
    expect(store.isBusy).toBe(false);

    // After the terminal, history paging may reasonably evict the row; the
    // bound (200) holds and the store stays consistent.
    vi.mocked(loadHistoryPage).mockResolvedValue({
      messages: Array.from({ length: 3 }, (_unused, index) =>
        historyRow("conv-1", `older-${index}`, -1 - index)
      ),
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();
    await store.loadOlder();
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("a restored awaiting_permission snapshot protects its prompt row from its very first eviction", async () => {
    const permission = toolResultRow(
      "conv-1",
      "prompt-1",
      "tp-1",
      0,
      { success: true, needsPermissionPrompt: true }
    );
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      historyRow("conv-1", `r-${index}`, index + 1)
    );
    await selectSnapshot("conv-1", {
      messages: [permission, ...rows],
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
      runtimeStatus: "awaiting_permission",
      activeRunId: "run-p",
    });
    const store = useSelectedConversationStore();
    expect(store.runtimeStatus).toBe("awaiting_permission");

    // A quiet engine serves no new events: paging must not destroy the
    // Grant/Deny affordance (the engine may resolve it at any time).
    vi.mocked(loadHistoryPage).mockResolvedValue({
      messages: Array.from({ length: 3 }, (_unused, index) =>
        historyRow("conv-1", `older-${index}`, -1 - index)
      ),
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();
    await store.loadOlder();
    expect(store.messages.length).toBeLessThanOrEqual(200);
    expect(store.messages.some((m) => m.id === "prompt-1")).toBe(true);
  });
});

describe("one turn beyond the window keeps content, bound and decisions intact (audit R6-03)", () => {
  it("emitting more than 200 rows in one turn preserves the answer text under the mounted bound", async () => {
    await selectSnapshot("conv-1", {});
    const store = useSelectedConversationStore();
    store.applyDetailEvent(detailEvent(1, "start"));
    store.applyDetailEvent(
      detailEvent(2, "token", { contentDelta: "prefix " })
    );
    let sequence = 3;
    for (let i = 0; i < 100; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "tool_call", {
          toolCallId: `t-${i}`,
          toolName: "search",
        })
      );
      store.applyDetailEvent(
        detailEvent(sequence++, "tool_result", {
          toolCallId: `t-${i}`,
          fullContent: "ok",
          toolResult: { success: true },
        })
      );
    }
    // The bound holds UNDER the turn (mounted rows only):
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

  it("a permission prompt raised inside the long turn stays reachable while completed receipts compact", async () => {
    await selectSnapshot("conv-1", {});
    const store = useSelectedConversationStore();
    store.applyDetailEvent(detailEvent(1, "start"));
    let sequence = 2;
    // A permission prompt early in the turn…
    store.applyDetailEvent(
      detailEvent(sequence++, "tool_result", {
        toolCallId: "permission-tool",
        fullContent: "Permission required",
        toolResult: { success: true, needsPermissionPrompt: true },
      })
    );
    // …then heavier growth:
    for (let i = 0; i < 100; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "tool_call", {
          toolCallId: `t-${i}`,
          toolName: "search",
        })
      );
      store.applyDetailEvent(
        detailEvent(sequence++, "tool_result", {
          toolCallId: `t-${i}`,
          fullContent: "ok",
          toolResult: { success: true },
        })
      );
    }
    expect(store.messages.length).toBeLessThanOrEqual(200);
    expect(store.messages.some((m) => m.id === "tool-result-permission-tool")).toBe(
      true
    );
    // The answer itself remains recoverable:
    store.applyDetailEvent(
      detailEvent(sequence++, "token", { contentDelta: "after" })
    );
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("after");
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("paging during the long turn, cancellation and recovery all keep the boundary rules", async () => {
    await selectSnapshot("conv-1", {
      nextBefore: { timestamp: "2026-10-20T08:00:00.000Z", messageId: "c-1" },
      hasOlder: true,
    });
    const store = useSelectedConversationStore();
    store.applyDetailEvent(detailEvent(1, "start"));
    let sequence = 2;
    store.applyDetailEvent(
      detailEvent(sequence++, "token", { contentDelta: "prefix " })
    );
    for (let i = 0; i < 100; i += 1) {
      store.applyDetailEvent(
        detailEvent(sequence++, "tool_call", {
          toolCallId: `t-${i}`,
          toolName: "search",
        })
      );
      store.applyDetailEvent(
        detailEvent(sequence++, "tool_result", {
          toolCallId: `t-${i}`,
          fullContent: "ok",
          toolResult: { success: true },
        })
      );
    }

    // Backward paging while the turn streams retains the requested range
    // and evicts settled history (bounded).
    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [historyRow("conv-1", "paged-older", -1)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();
    expect(store.messages.length).toBeLessThanOrEqual(200);

    // Cancellation materializes the accumulated answer, then paged-back
    // recovery keeps the window.
    store.applyDetailEvent(detailEvent(sequence++, "cancelled"));
    await flushPromises();
    expect(store.runtimeStatus).toBe("idle");
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");

    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [historyRow("conv-1", "paged-older-2", -2)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });

  it("a re-selected quiet RUNNING conversation protects its persisted answer from paging without any engine event", async () => {
    const rows = Array.from({ length: 198 }, (_unused, index) =>
      historyRow("conv-1", `r-${index}`, index + 1)
    );
    const answer = assistantRow("conv-1", "live-answer", "saved ", 400);
    await selectSnapshot("conv-1", {
      messages: [...rows, answer],
      nextBefore: { timestamp: rows[0].timestamp, messageId: rows[0].id },
      hasOlder: true,
      runtimeStatus: "running",
      activeRunId: "run-live",
    });
    const store = useSelectedConversationStore();

    // Quiet engine: no tokens re-attach protection later — hydration
    // already registered the persisted answer row.
    vi.mocked(loadHistoryPage).mockResolvedValue({
      messages: Array.from({ length: 3 }, (_unused, index) =>
        historyRow("conv-1", `older-${index}`, -1 - index)
      ),
      nextBefore: null,
      hasOlder: false,
    } as never);
    await store.loadOlder();
    await store.loadOlder();

    expect(store.messages.length).toBeLessThanOrEqual(200);
    expect(store.messages.some((m) => m.id === "live-answer")).toBe(true);
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved ");

    // The resumed token lands on the PROTECTED row with full content.
    store.applyDetailEvent(detailEvent(1, "token", { contentDelta: " more" }));
    await flushBatchedDelta();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("saved  more");
    expect(store.messages.length).toBeLessThanOrEqual(200);
  });
});
