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
type PendingCallback = (event: AIChatPendingMessageEvent) => void;
let pendingHandler: PendingCallback | null = null;

function emitPendingEvent(event: {
  conversationId: string;
  pendingMessageId: string;
  status: AIChatPendingMessageEvent["status"];
}): void {
  const handler = pendingHandler;
  if (!handler) throw new Error("pending subscription not established");
  handler({
    conversationId: event.conversationId,
    pendingMessageId: event.pendingMessageId,
    status: event.status,
    occurredAt: "2026-10-20T10:00:00.000Z",
  });
}

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  denyChatV2ToolPermission: vi.fn(),
  subscribeChatV2PendingEvents: (callback: PendingCallback) => {
    pendingHandler = callback;
    return () => {
      if (pendingHandler === callback) pendingHandler = null;
    };
  },
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
import type { AIChatPendingMessageEvent } from "@/entityTypes/aiChatV2Types";

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
  sequence = 1,
  sourceRunId?: string | null
): void {
  useSelectedConversationStore().applyDetailEvent({
    conversationId,
    runId,
    sequence,
    emittedAt: "2026-10-20T10:00:00.000Z",
    eventType,
    payload: { eventType },
    ...(sourceRunId !== undefined ? { sourceRunId } : {}),
  });
}

function summaryEvent(event: {
  conversationId: string;
  runId?: string;
  reason: ConversationSummaryEvent["reason"];
  runtimeStatus?: ConversationSummaryEvent["runtimeStatus"];
  sourceRunId?: string | null;
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
    ...(event.sourceRunId !== undefined
      ? { sourceRunId: event.sourceRunId }
      : {}),
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
  pendingHandler = null;
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
    it("AUDIT3 changed attachment bytes receive a new request identity after transport ambiguity", async () => {
      const api = await import("@/views/api/aiChatWorkspace");
      vi.mocked(api.createClientRequestId).mockReturnValueOnce("req-original").mockReturnValueOnce("req-new");
      await selectId("conv-1");
      const store = useSelectedConversationStore();
      const attachment = { fileName: "note.txt", mimeType: "text/plain", sizeBytes: 3, kind: "document" as const, contentBase64: "QUFB" };
      startChatRunMock.mockRejectedValueOnce(new Error("reply lost"));
      await store.sendMessage("read this", { attachments: [attachment] });
      acceptRun("conv-1", "pending-p2", "queued");
      await store.sendMessage("read this", { attachments: [{ ...attachment, contentBase64: "QkJC" }] });
      expect(startChatRunMock.mock.calls[1][0].clientRequestId).not.toBe(startChatRunMock.mock.calls[0][0].clientRequestId);
    });
    it("G01 stamps the submit-click journey boundary on every send", async () => {
      await selectId("conv-1");
      const store = useSelectedConversationStore();
      await store.sendMessage("hello journey");
      const payload = startChatRunMock.mock.calls[0][0] as {
        journeyStart: { clickAtEpochMs: number };
      };
      expect(payload.journeyStart.clickAtEpochMs).toBeLessThanOrEqual(Date.now());
      expect(payload.journeyStart.clickAtEpochMs).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  describe("AUDIT3 detail-envelope source identity (audit 2026-10-21-r3 D01)", () => {
    it("a later ordinary run binds to its own acceptance, not the orphaned queued row, when detail carries the source", async () => {
      await selectId("conv-1");
      acceptRun("conv-1", "pending-p1", "queued");
      await submitText("conv-1", "queued image edit");
      // Audit D01: the queued row never gets a run (steered or cancelled —
      // the retirement path is covered below). A later ordinary send runs:
      acceptRun("conv-1", "run-c");
      await submitText("conv-1", "later ordinary send");
      // Detail start of run-c carries its accepted source identity now.
      detailEvent("conv-1", "run-c", "start", 1, "run-c");
      detailEvent("conv-1", "run-c", "complete", 2, "run-c");
      // C's terminal resolves C's ordinal (2), never the orphaned row (1).
      expect(lastResolution()).toEqual({
        conversationId: "conv-1",
        runId: "run-c",
        kind: "complete",
        ordinal: 2,
      });
    });

    it("a summary-section source mismatch cannot hide behind the already-bound guard (reordered exact-first)", async () => {
      await selectId("conv-1");
      acceptRun("conv-1", "pending-p1", "queued");
      await submitText("conv-1", "first");
      acceptRun("conv-1", "pending-p2", "queued");
      await submitText("conv-1", "second");
      // A sourceless (legacy) start fact binds FIFO onto p1's row…
      summaryEvent(
        {
          conversationId: "conv-1",
          runId: "real-1",
          reason: "run_started",
        },
      );
      // …then the source-bearing fact for the SAME real run arrives and must
      // bind p1's row idempotently instead of failing on the bound guard.
      summaryEvent({
        conversationId: "conv-1",
        runId: "real-1",
        reason: "run_started",
        sourceRunId: "pending-p1",
      });
      summaryEvent({
        conversationId: "conv-1",
        runId: "real-1",
        reason: "run_completed",
        sourceRunId: "pending-p1",
      });
      expect(lastResolution()?.ordinal).toBe(1);
    });

    it("source-bearing facts bind their own row when a stale wrong FIFO bind exists", async () => {
      await selectId("conv-1");
      acceptRun("conv-1", "pending-p1", "queued");
      await submitText("conv-1", "first");
      acceptRun("conv-1", "pending-p2", "queued");
      await submitText("conv-1", "second");
      // Legacy start for real-1 wrongly binds p1 (p2 is the real source).
      summaryEvent(
        {
          conversationId: "conv-1",
          runId: "real-1",
          reason: "run_started",
        },
      );
      // The source-bearing fact corrects to p2's row.
      summaryEvent({
        conversationId: "conv-1",
        runId: "real-1",
        reason: "run_started",
        sourceRunId: "pending-p2",
      });
      detailEvent("conv-1", "real-1", "complete", 1, "pending-p2");
      expect(lastResolution()?.ordinal).toBe(2);
    });

    it("a detail start whose acceptance is still in flight buffers and replays exactly", async () => {
      await selectId("conv-1");
      let reply: (value: unknown) => void = () => undefined;
      startChatRunMock.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
      const sent = submitText("conv-1", "first");
      await flushPromises();
      // Detail start arrives before the acceptance reply — buffered.
      detailEvent("conv-1", "real-1", "start", 1, "pending-p1");
      reply({ conversationId: "conv-1", runId: "pending-p1", status: "queued" });
      await sent;
      detailEvent("conv-1", "real-1", "complete", 2, "pending-p1");
      expect(lastResolution()?.ordinal).toBe(1);
    });

    it("a source-bearing terminal resolves its row even after an unmatched early start", async () => {
      await selectId("conv-1");
      acceptRun("conv-1", "pending-p1", "queued");
      await submitText("conv-1", "first");
      detailEvent("conv-1", "real-1", "start", 1, "pending-p1");
      detailEvent("conv-1", "real-1", "complete", 2, "pending-p1");
      expect(lastResolution()?.ordinal).toBe(1);
    });

    it("a cancelled queued acceptance is retired immediately (before any run facts)", async () => {
      await selectId("conv-1");
      acceptRun("conv-1", "pending-p1", "queued");
      await submitText("conv-1", "queued image edit");
      emitPendingEvent({
        conversationId: "conv-1",
        pendingMessageId: "p1",
        status: "cancelled",
      });
      // Retirement publishes a non-clearing resolution for the queued row.
      expect(lastResolution()).toMatchObject({
        conversationId: "conv-1",
        runId: "pending-p1",
        kind: "cancelled",
        ordinal: 1,
      });
      // A later ordinary run binds and resolves on its OWN ordinal.
      acceptRun("conv-1", "run-c");
      await submitText("conv-1", "later ordinary");
      detailEvent("conv-1", "run-c", "start", 1, "run-c");
      detailEvent("conv-1", "run-c", "complete", 2, "run-c");
      expect(lastResolution()).toEqual({
        conversationId: "conv-1",
        runId: "run-c",
        kind: "complete",
        ordinal: 2,
      });
    });

    it("a steered queued acceptance is retired, and its summary facts can no longer bind the next row", async () => {
      await selectId("conv-1");
      acceptRun("conv-1", "pending-p1", "queued");
      await submitText("conv-1", "queued text");
      emitPendingEvent({
        conversationId: "conv-1",
        pendingMessageId: "p1",
        status: "applied",
      });
      expect(lastResolution()).toMatchObject({
        runId: "pending-p1",
        kind: "cancelled",
        ordinal: 1,
      });
      // Facts that arrive later for that retired identity resolve nothing.
      summaryEvent({
        conversationId: "conv-1",
        runId: "ghost-1",
        reason: "run_started",
        sourceRunId: "pending-p1",
      });
      expect(lastResolution()?.ordinal).toBe(1);
    });

    it("pending retirement only retires unresolved unbound rows", async () => {
      await selectId("conv-1");
      acceptRun("conv-1", "pending-p1", "queued");
      await submitText("conv-1", "queued");
      // The row already started and bound its real run — a late cancel
      // event must not retire that row anymore.
      detailEvent("conv-1", "real-1", "start", 1, "pending-p1");
      emitPendingEvent({
        conversationId: "conv-1",
        pendingMessageId: "p1",
        status: "cancelled",
      });
      // No retirement was published: a bound row is a run-owning row.
      expect(lastResolution()).toBeNull();
      // The bound row still resolves through its own run's terminal.
      detailEvent("conv-1", "real-1", "complete", 2, "pending-p1");
      expect(lastResolution()).toEqual({
        conversationId: "conv-1",
        runId: "real-1",
        kind: "complete",
        ordinal: 1,
      });
    });
  });
});
