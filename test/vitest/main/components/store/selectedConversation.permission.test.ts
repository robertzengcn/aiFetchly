import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION } from "@/config/channellist";

const windowInvokeMock = vi.fn();
const cancelChatRunMock = vi.fn();

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: (...args: unknown[]) => windowInvokeMock(...args),
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

  it("grantToolPermission surfaces a resume failure on the row and as errorMessage", async () => {
    const perm = permissionResult("m-perm-3", { toolCallId: "tc-fail" });
    await seedStore([perm]);
    windowInvokeMock.mockResolvedValue({ ok: false, error: "Engine busy" });

    await useSelectedConversationStore().grantToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-perm-3");
    expect(row?.content).toBe("Engine busy");
    expect(row?.metadata?.toolResult?.error).toBe("Engine busy");
    expect(row?.metadata?.success).toBe(false);
    expect(store.errorMessage).toBe("Engine busy");
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

  it("denyToolPermission rewrites the row to a denied receipt and stops the run", async () => {
    const perm = permissionResult("m-perm-6", { toolCallId: "tc-deny" });
    await seedStore([perm]);
    cancelChatRunMock.mockResolvedValue(undefined);

    useSelectedConversationStore().denyToolPermission(perm, TEXTS);
    await flushPromises();

    const store = useSelectedConversationStore();
    const row = store.messages.find((m) => m.id === "m-perm-6");
    expect(row?.content).toBe(TEXTS.deniedText);
    expect(row?.metadata?.toolResult).toBeUndefined();
    expect(row?.metadata?.success).toBe(false);
    // Deny settles the parked run through the normal cancel path.
    expect(cancelChatRunMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
    });
  });
});
