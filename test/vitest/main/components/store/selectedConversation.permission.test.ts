import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION } from "@/config/channellist";
import { AI_CHAT_V2_DENY_TOOL_PERMISSION } from "@/config/channellist";

const windowInvokeMock = vi.fn();
const cancelChatRunMock = vi.fn();

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: (...args: unknown[]) => windowInvokeMock(...args),
  windowReceive: vi.fn().mockReturnValue(() => undefined),
  windowRemoveListener: vi.fn(),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  // chatWorkspace store contract
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
  // selectedConversation store contract
  cancelChatRun: (...args: unknown[]) => cancelChatRunMock(...args),
  createClientRequestId: vi.fn().mockReturnValue("req-1"),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  selectConversation: vi.fn(),
  startChatRun: vi.fn(),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
}));

import {
  useChatWorkspaceStore,
  type WorkspaceInspectorTab,
} from "@/views/store/chatWorkspace";
import {
  useSelectedConversationStore,
  type PermissionActionTexts,
} from "@/views/store/selectedConversation";
import { selectConversation } from "@/views/api/aiChatWorkspace";

const TEXTS: PermissionActionTexts = {
  deniedText: "Permission denied.",
  resumeFailedText: "Could not resume the tool.",
  noToolIdText: "Missing tool call information.",
  denyFailedText: "Could not deny the tool. It is still paused for permission.",
};

function msg(
  messageType: MessageType,
  metadata: Record<string, unknown>,
  id: string,
  content = ""
): ChatV2MessageView {
  return {
    id,
    conversationId: "conv-1",
    role: "assistant",
    content,
    timestamp: new Date(2026, 7, 20, 10, 0, 0).toISOString(),
    messageType,
    metadata: { source: "chat-v2", ...metadata },
  };
}

/** Permission-parked TOOL_RESULT row, with or without a direct toolCallId. */
function permissionResult(
  id: string,
  extra: Record<string, unknown> = {}
): ChatV2MessageView {
  return msg(
    MessageType.TOOL_RESULT,
    {
      toolName: "file_read",
      toolResult: {
        needsPermissionPrompt: true,
        permissionCategory: "filesystem",
        success: true,
      },
      ...extra,
    },
    id
  );
}

/**
 * Seed the store's presenter through the real selection handshake so the
 * permission actions operate on presenter-owned rows (design §15.5).
 */
async function seedStore(messages: ChatV2MessageView[]): Promise<void> {
  vi.mocked(selectConversation).mockResolvedValue({
    conversationId: "conv-1",
    acceptedGeneration: 1,
    messages,
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "awaiting_permission",
    activeRunId: "run-1",
    title: "Permission chat",
  });
  await useSelectedConversationStore().loadSelection("conv-1");
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  windowInvokeMock.mockReset();
  cancelChatRunMock.mockReset();
  useChatWorkspaceStore().setInspectorTab("activity" as WorkspaceInspectorTab);
});

describe("selectedConversation permission actions (design §15.5)", () => {
  it("grantToolPermission marks the prompt executing and resumes via IPC", async () => {
    const perm = permissionResult("m-perm", { toolCallId: "tc-perm" });
    await seedStore([perm]);
    windowInvokeMock.mockResolvedValue({ ok: true });

    await useSelectedConversationStore().grantToolPermission(perm, TEXTS);
    await flushPromises();

    expect(windowInvokeMock).toHaveBeenCalledTimes(1);
    expect(windowInvokeMock).toHaveBeenCalledWith(
      AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
      { toolId: "tc-perm", conversationId: "conv-1" }
    );

    // The parked row flips to executing: no prompt flag, pending marker set.
    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-perm");
    expect(row?.content).toBe("");
    expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(false);
    expect(row?.metadata?.toolResult?.executionPending).toBe(true);
    expect(store.errorMessage).toBeNull();
  });

  it("grantToolPermission resolves the tool id from the preceding TOOL_CALL when the result row has none", async () => {
    const call = msg(
      MessageType.TOOL_CALL,
      { toolCallId: "tc-derived", toolName: "file_read" },
      "m-call"
    );
    const perm = permissionResult("m-perm-2"); // no toolCallId metadata
    await seedStore([call, perm]);
    windowInvokeMock.mockResolvedValue({ ok: true });

    await useSelectedConversationStore().grantToolPermission(perm, TEXTS);

    expect(windowInvokeMock).toHaveBeenCalledWith(
      AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
      { toolId: "tc-derived", conversationId: "conv-1" }
    );
  });

  it("grantToolPermission surfaces a resume failure AND restores the decision card (T4/D1)", async () => {
    const perm = permissionResult("m-perm-3", { toolCallId: "tc-fail" });
    await seedStore([perm]);
    windowInvokeMock.mockResolvedValue({ ok: false, error: "Engine busy" });

    await useSelectedConversationStore().grantToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-perm-3");
    expect(row?.content).toBe("Engine busy");
    expect(store.errorMessage).toBe("Engine busy");
    // The failed resume RESTORES the prompt (FR-PER-007): Grant/Deny stay
    // mounted and actionable; the executing flag is cleared.
    expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
    expect(row?.metadata?.toolResult?.executionPending).toBe(false);
  });

  it("grantToolPermission without any resolvable tool id reports and never invokes IPC", async () => {
    const perm = permissionResult("m-perm-4"); // no call row seeded either
    await seedStore([perm]);

    await useSelectedConversationStore().grantToolPermission(perm, TEXTS);

    expect(windowInvokeMock).not.toHaveBeenCalled();
    expect(useSelectedConversationStore().errorMessage).toBe(
      TEXTS.noToolIdText
    );
  });

  it("a second grant while the first resume is in flight is a no-op", async () => {
    const perm = permissionResult("m-perm-5", { toolCallId: "tc-double" });
    await seedStore([perm]);
    let resolveInvoke: ((value: unknown) => void) | undefined;
    windowInvokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        })
    );

    const first = useSelectedConversationStore().grantToolPermission(
      perm,
      TEXTS
    );
    const second = useSelectedConversationStore().grantToolPermission(
      perm,
      TEXTS
    );
    await flushPromises();
    expect(windowInvokeMock).toHaveBeenCalledTimes(1);

    resolveInvoke?.({ ok: true });
    await Promise.allSettled([first, second]);
    expect(windowInvokeMock).toHaveBeenCalledTimes(1);
  });

  it("R8 P2-5: a settled duplicate grant does not restore Grant/Deny on a running tool", async () => {
    const perm = permissionResult("m-perm-9", { toolCallId: "tc-dupe" });
    await seedStore([perm]);
    cancelChatRunMock.mockClear();

    // First grant succeeds: the executing rewrite stays until the resumed
    // tool_result event replaces the row.
    windowInvokeMock.mockResolvedValue({ ok: true });
    await useSelectedConversationStore().grantToolPermission(perm, TEXTS);
    await flushPromises();
    const store = useSelectedConversationStore();
    expect(
      store.messages.find((m) => m.id === "m-perm-9")?.metadata?.toolResult
        ?.executionPending
    ).toBe(true);

    // A second click after the in-flight lock dropped: the pending
    // permission is already consumed (coordinator's stale/claimed error).
    // Treating it as failure would put Grant/Deny back on a running tool.
    windowInvokeMock.mockResolvedValue({
      ok: false,
      error: "No pending action for this run (stale or already consumed).",
    });
    await store.grantToolPermission(perm, TEXTS);
    await flushPromises();

    const row = store.messages.find((m) => m.id === "m-perm-9");
    expect(row?.metadata?.toolResult?.executionPending).toBe(true);
    expect(row?.content).toBe("");
    expect(store.errorMessage).toBeNull();
  });

  it("denyToolPermission rewrites the row to a denied receipt and stops the run", async () => {
    const perm = permissionResult("m-perm-6", { toolCallId: "tc-deny" });
    await seedStore([perm]);
    cancelChatRunMock.mockResolvedValue(undefined);
    // No scheduled owner: the continuation API reports handled:false.
    windowInvokeMock.mockResolvedValue({ ok: true, handled: false });

    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-perm-6");
    expect(row?.content).toBe(TEXTS.deniedText);
    expect(row?.metadata?.toolResult).toBeUndefined();
    expect(row?.metadata?.success).toBe(false);
    // R10 B01: the interactive stop is bound to the CAPTURED claim — the
    // conversation and run identity at action time, never the current
    // selection's run.
    expect(cancelChatRunMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
      runId: "run-1",
    });
  });

  it("B12: scheduled-owner denial honors handled and never stops the run", async () => {
    const perm = permissionResult("m-perm-7", { toolCallId: "tc-sched" });
    await seedStore([perm]);
    cancelChatRunMock.mockClear();
    // The scheduled-loop engine owns the paused turn: it synthesizes the
    // denied tool_result and the run continues.
    windowInvokeMock.mockResolvedValue({ ok: true, handled: true });

    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    expect(windowInvokeMock).toHaveBeenCalledWith(
      AI_CHAT_V2_DENY_TOOL_PERMISSION,
      { toolId: "tc-sched", conversationId: "conv-1" }
    );
    const row = useSelectedConversationStore().messages.find(
      (m) => m.id === "m-perm-7"
    );
    expect(row?.content).toBe(TEXTS.deniedText);
    // Never stops an unrelated task: no interactive cancel.
    expect(cancelChatRunMock).not.toHaveBeenCalled();
  });

  it("B02 (R10): a denial IPC failure keeps the decision actionable and never cancels", async () => {
    // R10 B01/B02 contract correction: a transport failure is NOT success —
    // the old expectation (fall through to the interactive stop) converted a
    // failed denial into a generic cancellation and displayed a receipt.
    // FR-PER-007: the decision stays available and the error is announced.
    const perm = permissionResult("m-perm-8", { toolCallId: "tc-err" });
    await seedStore([perm]);
    cancelChatRunMock.mockClear();
    cancelChatRunMock.mockResolvedValue(undefined);
    windowInvokeMock.mockRejectedValue(new Error("ipc down"));

    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-perm-8");
    expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
    expect(row?.metadata?.toolResult?.executionPending).toBe(false);
    expect(row?.content).toBe(TEXTS.denyFailedText);
    expect(store.errorMessage).toBe(TEXTS.denyFailedText);
    expect(cancelChatRunMock).not.toHaveBeenCalled();
  });

  it("B12: stale tool id denies via the interactive stop without a continuation call", async () => {
    // Result row with NO resolvable tool id (no direct id, no preceding
    // TOOL_CALL row): straight to the interactive stop, no continuation IPC.
    const perm = permissionResult("m-perm-9");
    await seedStore([perm]);
    cancelChatRunMock.mockClear();
    cancelChatRunMock.mockResolvedValue(undefined);
    windowInvokeMock.mockClear();

    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    // No resolvable tool id: no continuation IPC, straight to the captured
    // claim (conversation + run identity at action time).
    expect(windowInvokeMock).not.toHaveBeenCalled();
    expect(cancelChatRunMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
      runId: "run-1",
    });
  });
});

/**
 * R10 audit regressions (B01/B02/B03 — permission action ownership).
 * Each test binds a delayed permission decision to the conversation it was
 * captured in: a failure must stay retryable with its own conversation and
 * must never mutate the currently selected one, and a cancellation must
 * carry the captured claim instead of the current selection's identity.
 */
describe("R10 permission ownership (B01/B02/B03)", () => {
  /** A second, currently-running conversation the user switches to. */
  const OTHER = {
    conversationId: "conv-2",
    acceptedGeneration: 2,
    messages: [],
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "running" as const,
    activeRunId: "run-2",
    title: "Other chat",
  };

  async function switchToRunningB(): Promise<void> {
    vi.mocked(selectConversation).mockResolvedValue(OTHER);
    await useSelectedConversationStore().loadSelection("conv-2");
    await flushPromises();
  }

  // --- B02: failed authoritative denial is never displayed as success -------

  it("B02: a failed scheduled denial keeps the decision actionable and announces the error", async () => {
    const perm = permissionResult("m-r10-b02a", { toolCallId: "tc-r10-b02a" });
    await seedStore([perm]);
    cancelChatRunMock.mockClear();
    // The scheduled engine failed to apply the denial: {handled:true} with
    // ok:false is a FAILURE, not a denied receipt.
    windowInvokeMock.mockResolvedValue({
      ok: false,
      handled: true,
      error: "Cancellation failed",
    });

    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-r10-b02a");
    // FR-PER-007: the decision stays mounted and actionable for retry.
    expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
    expect(row?.metadata?.toolResult?.executionPending).toBe(false);
    expect(row?.content).toBe("Cancellation failed");
    expect(store.errorMessage).toBe("Cancellation failed");
    // A failed denial must never convert into a generic cancellation.
    expect(cancelChatRunMock).not.toHaveBeenCalled();
  });

  it("B02: a failed owner cancellation without an error body falls back to the localized copy", async () => {
    const perm = permissionResult("m-r10-b02b", { toolCallId: "tc-r10-b02b" });
    await seedStore([perm]);
    // Coordinator-owned deny whose cancelOwnedRun reported cancelled:false.
    windowInvokeMock.mockResolvedValue({ ok: false, handled: true });

    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-r10-b02b");
    expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
    expect(row?.content).toBe(TEXTS.denyFailedText);
    expect(store.errorMessage).toBe(TEXTS.denyFailedText);
    expect(cancelChatRunMock).not.toHaveBeenCalled();
  });

  it("B02: a null deny response is not a confirmed denial", async () => {
    const perm = permissionResult("m-r10-b02c", { toolCallId: "tc-r10-b02c" });
    await seedStore([perm]);
    windowInvokeMock.mockResolvedValue(null);

    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-r10-b02c");
    expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
    expect(store.errorMessage).toBe(TEXTS.denyFailedText);
    expect(cancelChatRunMock).not.toHaveBeenCalled();
  });

  it("B02: an idempotent stale deny rewrites the receipt without stopping a run", async () => {
    const perm = permissionResult("m-r10-b02d", { toolCallId: "tc-r10-b02d" });
    await seedStore([perm]);
    cancelChatRunMock.mockClear();
    // First deny succeeds (idempotent stale no-op from the owner); a second
    // click on the receipt row must never touch a live run.
    windowInvokeMock.mockResolvedValue({ ok: true, handled: true });

    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    const row = useSelectedConversationStore().messages.find(
      (m) => m.id === "m-r10-b02d"
    );
    expect(row?.content).toBe(TEXTS.deniedText);
    expect(row?.metadata?.toolResult).toBeUndefined();
    expect(cancelChatRunMock).not.toHaveBeenCalled();
  });

  // --- B01: delayed denial never borrows the current selection's identity ---

  it("B01: a delayed denial rejection never cancels another conversation's run", async () => {
    const perm = permissionResult("m-r10-b01a", { toolCallId: "tc-r10-b01a" });
    await seedStore([perm]);
    cancelChatRunMock.mockClear();
    let rejectInvoke!: (reason: Error) => void;
    windowInvokeMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectInvoke = reject;
        })
    );
    const pending = useSelectedConversationStore().denyToolPermission(
      perm,
      TEXTS
    );
    await switchToRunningB();
    rejectInvoke(new Error("ipc down"));
    await pending;
    await flushPromises();

    // The failure belongs to A: no cancellation of B and no error banner on B.
    expect(cancelChatRunMock).not.toHaveBeenCalled();
    expect(useSelectedConversationStore().errorMessage).toBeNull();
    expect(useSelectedConversationStore().activeRunId).toBe("run-2");
  });

  it("B01: a handled:false denial stops the captured claim, not the current selection", async () => {
    const perm = permissionResult("m-r10-b01b", { toolCallId: "tc-r10-b01b" });
    await seedStore([perm]);
    cancelChatRunMock.mockClear();
    cancelChatRunMock.mockResolvedValue({ cancelled: true });
    let resolveInvoke!: (value: unknown) => void;
    windowInvokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        })
    );
    const pending = useSelectedConversationStore().denyToolPermission(
      perm,
      TEXTS
    );
    await switchToRunningB();
    resolveInvoke({ ok: true, handled: false });
    await pending;
    await flushPromises();

    // Deny-equals-stop still applies, but the stop targets A's captured
    // claim (conversation + run id) — never B's currently selected run.
    expect(cancelChatRunMock).toHaveBeenCalledTimes(1);
    expect(cancelChatRunMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
      runId: "run-1",
    });
    // B's transcript carries no denied receipt from A's decision.
    expect(
      useSelectedConversationStore().messages.some(
        (m) => m.content === TEXTS.deniedText
      )
    ).toBe(false);
  });

  // --- B03: grant failures stay with the originating conversation -----------

  it("B03: a failed grant response after switching does not write A's error into B", async () => {
    const perm = permissionResult("m-r10-b03a", { toolCallId: "tc-r10-b03a" });
    await seedStore([perm]);
    let resolveInvoke!: (value: unknown) => void;
    windowInvokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        })
    );
    const pending = useSelectedConversationStore().grantToolPermission(
      perm,
      TEXTS
    );
    await switchToRunningB();
    resolveInvoke({ ok: false, error: "Conversation A permission failed" });
    await pending;
    await flushPromises();

    // B's banner and transcript stay untouched by A's failure.
    expect(useSelectedConversationStore().errorMessage).toBeNull();
    expect(
      useSelectedConversationStore().messages.some(
        (m) => m.content === "Conversation A permission failed"
      )
    ).toBe(false);
  });

  it("B03: a rejected grant after switching does not write A's error into B", async () => {
    const perm = permissionResult("m-r10-b03b", { toolCallId: "tc-r10-b03b" });
    await seedStore([perm]);
    let rejectInvoke!: (reason: Error) => void;
    windowInvokeMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectInvoke = reject;
        })
    );
    const pending = useSelectedConversationStore().grantToolPermission(
      perm,
      TEXTS
    );
    await switchToRunningB();
    rejectInvoke(new Error("resume transport down"));
    await pending;
    await flushPromises();

    expect(useSelectedConversationStore().errorMessage).toBeNull();
    expect(
      useSelectedConversationStore().messages.some(
        (m) => m.content === "resume transport down"
      )
    ).toBe(false);
  });

  it("B03: a successful grant after switching leaves B's banner untouched", async () => {
    const perm = permissionResult("m-r10-b03c", { toolCallId: "tc-r10-b03c" });
    await seedStore([perm]);
    let resolveInvoke!: (value: unknown) => void;
    windowInvokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        })
    );
    const pending = useSelectedConversationStore().grantToolPermission(
      perm,
      TEXTS
    );
    await switchToRunningB();
    resolveInvoke({ ok: true });
    await pending;
    await flushPromises();

    expect(useSelectedConversationStore().errorMessage).toBeNull();
  });

  it("B03: returning to A restores the decision and announces the grant failure there", async () => {
    const perm = permissionResult("m-r10-b03d", { toolCallId: "tc-r10-b03d" });
    await seedStore([perm]);
    let resolveInvoke!: (value: unknown) => void;
    windowInvokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        })
    );
    const pending = useSelectedConversationStore().grantToolPermission(
      perm,
      TEXTS
    );
    await switchToRunningB();
    // Back on A: the snapshot still carries the parked permission card.
    vi.mocked(selectConversation).mockResolvedValue({
      conversationId: "conv-1",
      acceptedGeneration: 3,
      messages: [perm],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "awaiting_permission",
      activeRunId: "run-1",
      title: "Permission chat",
    });
    await useSelectedConversationStore().loadSelection("conv-1");
    await flushPromises();
    resolveInvoke({ ok: false, error: "Conversation A permission failed" });
    await pending;
    await flushPromises();

    const store = useSelectedConversationStore();
    // The failure is announced on A and the decision is restored actionable.
    expect(store.errorMessage).toBe("Conversation A permission failed");
    const row = store.messages.find((m) => m.id === "m-r10-b03d");
    expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
    expect(row?.metadata?.toolResult?.executionPending).toBe(false);
  });

  it("B03: a grant rejection while A stays selected restores the decision card", async () => {
    const perm = permissionResult("m-r10-b03e", { toolCallId: "tc-r10-b03e" });
    await seedStore([perm]);
    windowInvokeMock.mockRejectedValue(new Error("resume transport down"));

    await useSelectedConversationStore().grantToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    expect(store.errorMessage).toBe("resume transport down");
    const row = store.messages.find((m) => m.id === "m-r10-b03e");
    expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
    expect(row?.metadata?.toolResult?.executionPending).toBe(false);
  });
});
