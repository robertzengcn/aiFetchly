import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";
import type { ConversationSummaryEvent } from "@/entityTypes/aiChatWorkspaceTypes";

const startChatRunMock = vi.fn();

/**
 * Audit R2 N04 — durable run identity resolution. Old contract defect: the
 * accepted-send registry paired one ordinal counter for acceptances with an
 * INDEPENDENT counter of terminals consumed through the selected-only
 * detail stream, so a run completing while its conversation was deselected
 * desynchronized the pairing and let an old snapshot consume a newer run's
 * terminal. The fixed contract: every accepted send registers the durable
 * run identity returned by the queue (real run id, or `pending-…` when
 * queued) in an accept-ordered ledger; terminals resolve by identity, with
 * background terminals arriving through the redacted summary channel.
 */
type SummaryCallback = (event: ConversationSummaryEvent) => void;
let summaryHandler: SummaryCallback | null = null;

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: (
    callback: SummaryCallback
  ): (() => void) => {
    summaryHandler = callback;
    return () => {
      if (summaryHandler === callback) summaryHandler = null;
    };
  },
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-n04"),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { selectConversation } from "@/views/api/aiChatWorkspace";

async function selectId(conversationId: string): Promise<void> {
  vi.mocked(selectConversation).mockResolvedValue({
    acceptedGeneration: 1,
    messages: [
      {
        id: `m-${conversationId}`,
        conversationId,
        role: "assistant",
        content: "seed",
        timestamp: new Date(2026, 9, 20, 9, 0, 0).toISOString(),
        messageType: MessageType.MESSAGE,
        metadata: { source: "chat-v2" },
      },
    ],
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "idle",
    activeRunId: null,
    title: conversationId,
  } as never);
  const store = useSelectedConversationStore();
  await store.loadSelection(conversationId);
  await flushPromises();
}

function acceptRun(
  conversationId: string,
  runId: string,
  status: "running" | "queued" = "running"
): void {
  startChatRunMock.mockResolvedValue({
    conversationId,
    runId,
    status,
    acceptedAt: "",
  });
}

async function submitText(
  conversationId: string,
  text: string
): Promise<boolean> {
  const store = useSelectedConversationStore();
  useChatWorkspaceStore().setSelected(conversationId);
  const accepted = await store.sendMessage(text);
  await flushPromises();
  return accepted;
}

function detailEvent(
  conversationId: string,
  runId: string,
  eventType: ChatRunDetailEvent["eventType"],
  sequence = 1
): void {
  useSelectedConversationStore().applyDetailEvent({
    conversationId,
    runId,
    sequence,
    emittedAt: "2026-10-20T10:00:00.000Z",
    eventType,
    payload: { eventType },
  });
}

function summaryEvent(event: {
  conversationId: string;
  runId?: string;
  reason: ConversationSummaryEvent["reason"];
  runtimeStatus?: ConversationSummaryEvent["runtimeStatus"];
}): void {
  const handler = summaryHandler;
  if (!handler) throw new Error("summary subscription not established");
  handler({
    conversationId: event.conversationId,
    workspaceKey: null,
    runtimeStatus: event.runtimeStatus ?? "idle",
      attention: "none",
    unread: false,
    lastActivityAt: "2026-10-20T10:00:00.000Z",
    reason: event.reason,
    runId: event.runId,
  });
}

function lastResolution(): {
  conversationId: string;
  runId: string;
  kind: string;
  ordinal: number;
} | null {
  return useSelectedConversationStore().lastResolvedReferenceRun;
}

beforeEach(() => {
  setActivePinia(createPinia());
  startChatRunMock.mockReset();
  summaryHandler = null;
});

describe("selectedConversation durable run identity (audit R2 N04)", () => {
  it("resolves an accepted run by its real run id without registering it first (acceptance precedes the start fact)", async () => {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "conv-1",
    } as never);
    await selectId("conv-1");
    acceptRun("conv-1", "run-1");
    await submitText("conv-1", "message one");
    expect(lastResolution()).toBeNull();
    detailEvent("conv-1", "run-1", "complete");
    const resolution = lastResolution();
    expect(resolution).toEqual({
      conversationId: "conv-1",
      runId: "run-1",
      kind: "complete",
      ordinal: 1,
    });
  });

  it("does not resolve any entry for an unrelated terminal identity (identity replaces counter pairing)", async () => {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "conv-1",
    } as never);
    await selectId("conv-1");
    acceptRun("conv-1", "run-2");
    await submitText("conv-1", "message two");
    // A terminal for a DIFFERENT run (e.g. a pre-ledger run completing late,
    // reported only through the redacted background channel) must not
    // consume the entry registered for run-2.
    summaryEvent({ conversationId: "conv-1", reason: "run_completed", runId: "run-stale" });
    expect(lastResolution()).toBeNull();
    detailEvent("conv-1", "run-2", "complete");
    expect(lastResolution()).toEqual({
      conversationId: "conv-1",
      runId: "run-2",
      kind: "complete",
      ordinal: 1,
    });
  });

  it("resolves a run that completed in the background through the summary channel — no selected terminal exists", async () => {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "conv-1",
    } as never);
    await selectId("conv-1");
    acceptRun("conv-1", "run-1");
    await submitText("conv-1", "message one");
    // The user switches away; the run completes while deselected. The
    // selected-only detail stream never delivers its terminal.
    await selectId("conv-2");
    detailEvent("conv-2", "other-run", "complete");
    // conv-2 never accepted a send: nothing may resolve for it.
    expect(lastResolution()).toBeNull();

    summaryEvent({ conversationId: "conv-1", reason: "run_completed", runId: "run-1" });
    expect(lastResolution()).toEqual({
      conversationId: "conv-1",
      runId: "run-1",
      kind: "complete",
      ordinal: 1,
    });
  });

  it("rebinds a queued acceptance on its run_started fact so the background terminal resolves by identity", async () => {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "conv-1",
    } as never);
    await selectId("conv-1");
    acceptRun("conv-1", "pending-p1", "queued");
    await submitText("conv-1", "queued message");
    // Deselected; the queued row drains and starts while B is selected.
    await selectId("conv-2");
    summaryEvent({ conversationId: "conv-1", reason: "run_started", runId: "run-real" });
    expect(lastResolution()).toBeNull();
    summaryEvent({ conversationId: "conv-1", reason: "run_completed", runId: "run-real" });
    expect(lastResolution()).toEqual({
      conversationId: "conv-1",
      runId: "run-real",
      kind: "complete",
      ordinal: 1,
    });
  });

  it("publishes error and cancelled kinds from summary facts (references dequeue and can be retained)", async () => {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "conv-1",
    } as never);
    await selectId("conv-1");
    acceptRun("conv-1", "run-f");
    await submitText("conv-1", "message");
    summaryEvent({ conversationId: "conv-1", reason: "run_failed", runId: "run-f" });
    expect(lastResolution()).toMatchObject({ kind: "error", runId: "run-f", ordinal: 1 });

    acceptRun("conv-1", "run-c");
    await submitText("conv-1", "second");
    summaryEvent({ conversationId: "conv-1", reason: "run_cancelled", runId: "run-c" });
    expect(lastResolution()).toMatchObject({ kind: "cancelled", runId: "run-c", ordinal: 2 });
  });

  it("keeps accept ordinals continuous past background completions so a fresh send resolves against its OWN run (repro)", async () => {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "conv-1",
    } as never);
    await selectId("conv-1");
    acceptRun("conv-1", "run-1");
    await submitText("conv-1", "m1");
    // m1 completes in the background (B selected) — resolution via summary.
    await selectId("conv-2");
    summaryEvent({ conversationId: "conv-1", reason: "run_completed", runId: "run-1" });
    // Return to A; submit m2. The repro made this send ordinal 2 while its
    // VISIBLE terminal was counted as ordinal 1 — the identity-ledger model
    // resolves the fresh send against its own run id instead.
    await selectId("conv-1");
    acceptRun("conv-1", "run-2");
    await submitText("conv-1", "m2");
    detailEvent("conv-1", "run-2", "start");
    detailEvent("conv-1", "run-2", "complete", 2);
    expect(lastResolution()).toEqual({
      conversationId: "conv-1",
      runId: "run-2",
      kind: "complete",
      ordinal: 2,
    });
  });

  describe("AUDIT3 durable identity edge ordering", () => {
    it("AUDIT3 preserves a run-start fact arriving before its acceptance reply", async () => {
      await selectId("conv-1");
      let reply: (value: unknown) => void = () => undefined;
      startChatRunMock.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
      const sent = submitText("conv-1", "first");
      await flushPromises();
      summaryEvent({ conversationId: "conv-1", runId: "real-1", reason: "run_started" });
      reply({ conversationId: "conv-1", runId: "pending-p1", status: "queued" });
      await sent;
      summaryEvent({ conversationId: "conv-1", runId: "real-1", reason: "run_completed" });
      expect(lastResolution()?.ordinal).toBe(1);
    });
    it("AUDIT3 duplicate starts and terminals never consume the next pending identity", async () => {
      await selectId("conv-1");
      acceptRun("conv-1", "pending-p1", "queued");
      await submitText("conv-1", "first");
      acceptRun("conv-1", "pending-p2", "queued");
      await submitText("conv-1", "second");
      summaryEvent({ conversationId: "conv-1", runId: "real-1", reason: "run_started" });
      summaryEvent({ conversationId: "conv-1", runId: "real-1", reason: "run_started" });
      summaryEvent({ conversationId: "conv-1", runId: "real-1", reason: "run_completed" });
      expect(lastResolution()?.ordinal).toBe(1);
      summaryEvent({ conversationId: "conv-1", runId: "real-1", reason: "run_completed" });
      expect(lastResolution()?.ordinal).toBe(1);
    });
  });
});
