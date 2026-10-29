import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ConversationSummaryEvent } from "@/entityTypes/aiChatWorkspaceTypes";

const startChatRunMock = vi.fn();

/**
 * Audit R4-03 — the app-scoped image cleanup consumer must consume EVERY
 * run resolution, not just the last one visible after the Vue batched
 * watcher flush. The old consumer watched `lastResolvedReferenceRun`, which
 * the selected store REPLACES for each resolution: two terminal facts
 * published in one synchronous batch collapsed into a single watcher
 * invocation for the newest ordinal only, so the older run's consumed
 * snapshot survived forever and its selected references stayed in the tray.
 * The consumer now rides a synchronous publish dispatch (registry on the
 * selection store) instead of a batched ref watcher — every resolution is
 * dispatched exactly once, in order, and stays idempotent for replays.
 */

type SummaryCallback = (event: ConversationSummaryEvent) => void;
let summaryHandler: SummaryCallback | null = null;

function emitSummary(event: {
  conversationId: string;
  runId: string;
  reason: ConversationSummaryEvent["reason"];
}): void {
  const handler = summaryHandler;
  if (!handler) throw new Error("summary subscription not established");
  handler({
    conversationId: event.conversationId,
    workspaceKey: null,
    runtimeStatus: "idle",
    attention: "none",
    unread: false,
    lastActivityAt: "2026-10-20T10:00:00.000Z",
    reason: event.reason,
    runId: event.runId,
  });
}

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
  createClientRequestId: vi.fn().mockReturnValue("req-r4img"),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import { useComposerDraftStore } from "@/views/store/composerDrafts";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
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
  await useSelectedConversationStore().loadSelection(conversationId);
  await flushPromises();
}

function acceptRun(conversationId: string, runId: string): void {
  startChatRunMock.mockResolvedValue({
    conversationId,
    runId,
    status: "running",
    acceptedAt: "",
  });
}

function trayOf(
  drafts: ReturnType<typeof useComposerDraftStore>,
  key: string
): readonly { messageId: string; imageIndex: number }[] {
  return drafts.getDraft(key)?.generatedImageReferences ?? [];
}

async function submitText(conversationId: string, text: string): Promise<void> {
  const store = useSelectedConversationStore();
  useChatWorkspaceStore().setSelected(conversationId);
  await store.sendMessage(text);
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  startChatRunMock.mockReset();
  summaryHandler = null;
});

describe("composerDrafts reference resolution consumption (audit R4-03)", () => {
  it("consumes every reference resolution in a synchronous burst", async () => {
    await selectId("conv-1");
    const drafts = useComposerDraftStore();
    const refs = [
      { messageId: "image-one", imageIndex: 0 },
      { messageId: "image-two", imageIndex: 0 },
    ];
    drafts.setGeneratedImageReferences("conv-1", refs);
    acceptRun("conv-1", "run-one");
    await submitText("conv-1", "one");
    drafts.storeReferenceClear("conv-1", {
      runOrdinal: 1,
      references: [refs[0]],
    });
    acceptRun("conv-1", "run-two");
    await submitText("conv-1", "two");
    drafts.storeReferenceClear("conv-1", {
      runOrdinal: 2,
      references: [refs[1]],
    });
    // Both terminals delivered through the real summary channel in one
    // synchronous burst — no Vue flush between them.
    emitSummary({ conversationId: "conv-1", runId: "run-one", reason: "run_completed" });
    emitSummary({ conversationId: "conv-1", runId: "run-two", reason: "run_completed" });
    await flushPromises();
    expect(trayOf(drafts, "conv-1")).toEqual([]);
  });

  it("completion mixed with cancel/error in one burst each dispatches on its own kind", async () => {
    await selectId("conv-1");
    const drafts = useComposerDraftStore();
    const refs = [
      { messageId: "image-complete", imageIndex: 0 },
      { messageId: "image-will-fail", imageIndex: 0 },
      { messageId: "image-will-cancel", imageIndex: 0 },
    ];
    drafts.setGeneratedImageReferences("conv-1", refs);
    acceptRun("conv-1", "run-a");
    await submitText("conv-1", "a");
    drafts.storeReferenceClear("conv-1", {
      runOrdinal: 1,
      references: [refs[0]],
    });
    acceptRun("conv-1", "run-b");
    await submitText("conv-1", "b");
    drafts.storeReferenceClear("conv-1", {
      runOrdinal: 2,
      references: [refs[1]],
    });
    acceptRun("conv-1", "run-c");
    await submitText("conv-1", "c");
    drafts.storeReferenceClear("conv-1", {
      runOrdinal: 3,
      references: [refs[2]],
    });
    emitSummary({ conversationId: "conv-1", runId: "run-a", reason: "run_completed" });
    emitSummary({ conversationId: "conv-1", runId: "run-b", reason: "run_failed" });
    emitSummary({ conversationId: "conv-1", runId: "run-c", reason: "run_cancelled" });
    await flushPromises();
    // The completion's references are consumed; the failed/cancelled
    // snapshots are dequeued but their references stay in the tray.
    expect(drafts.getDraft("conv-1")?.generatedImageReferences).toEqual([
      refs[1],
      refs[2],
    ]);
  });

  it("burst resolutions for different conversations touch only their own tray", async () => {
    await selectId("conv-x");
    const drafts = useComposerDraftStore();
    drafts.setGeneratedImageReferences("conv-x", [
      { messageId: "image-x", imageIndex: 0 },
    ]);
    drafts.setGeneratedImageReferences("conv-y", [
      { messageId: "image-y", imageIndex: 0 },
    ]);
    acceptRun("conv-x", "run-x");
    await submitText("conv-x", "x");
    drafts.storeReferenceClear("conv-x", {
      runOrdinal: 1,
      references: [{ messageId: "image-x", imageIndex: 0 }],
    });
    acceptRun("conv-y", "run-y");
    await submitText("conv-y", "y");
    drafts.storeReferenceClear("conv-y", {
      runOrdinal: 1,
      references: [{ messageId: "image-y", imageIndex: 0 }],
    });
    emitSummary({ conversationId: "conv-x", runId: "run-x", reason: "run_completed" });
    emitSummary({ conversationId: "conv-y", runId: "run-y", reason: "run_completed" });
    await flushPromises();
    expect(drafts.getDraft("conv-x")).toBeNull();
    expect(drafts.getDraft("conv-y" as string)).toBeNull();
  });

  it("the D01 acceptance-before-snapshot replay still converges after the snapshot is stored", async () => {
    await selectId("conv-1");
    const drafts = useComposerDraftStore();
    const selected = useSelectedConversationStore();
    const refs = [{ messageId: "image-reply", imageIndex: 0 }];
    drafts.setGeneratedImageReferences("conv-1", refs);
    acceptRun("conv-1", "run-reply");
    await submitText("conv-1", "reply");
    // The buffered terminal fact replayed inside the acceptance — its
    // resolution published BEFORE the surface stored the snapshot, so the
    // first dispatch found nothing registered.
    emitSummary({ conversationId: "conv-1", runId: "run-reply", reason: "run_completed" });
    expect(trayOf(drafts, "conv-1")).toEqual(refs);
    // The accepted-send branch registers the snapshot afterwards…
    drafts.storeReferenceClear("conv-1", {
      runOrdinal: 1,
      references: refs,
    });
    expect(trayOf(drafts, "conv-1")).toEqual(refs);
    // …and the re-publish consumes it idempotently.
    selected.republishResolvedRun("conv-1", 1);
    expect(trayOf(drafts, "conv-1")).toEqual([]);
  });

  it("duplicate detail and summary terminals for one ordinal consume once", async () => {
    await selectId("conv-1");
    const drafts = useComposerDraftStore();
    const selected = useSelectedConversationStore();
    const refs = [{ messageId: "image-dup", imageIndex: 0 }];
    drafts.setGeneratedImageReferences("conv-1", refs);
    acceptRun("conv-1", "run-dup");
    await submitText("conv-1", "dup");
    drafts.storeReferenceClear("conv-1", {
      runOrdinal: 1,
      references: refs,
    });
    // Summary terminal binds and resolves the row (deselected run)…
    emitSummary({ conversationId: "conv-1", runId: "run-dup", reason: "run_completed" });
    expect(trayOf(drafts, "conv-1")).toEqual([]);
    // …and any duplicate resolution of the same ordinal is a no-op: the
    // snapshot was dequeued already, so the replay consumed nothing.
    selected.republishResolvedRun("conv-1", 1);
    expect(trayOf(drafts, "conv-1")).toEqual([]);
  });
});
