import { describe, expect, it, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";

const getWorkspaceMock = vi.fn();
const acquireWorkspaceWatchMock = vi.fn();
const releaseWorkspaceWatchMock = vi.fn();
const previewWorkspaceAgentsMock = vi.fn();
const workspaceMemoryListMock = vi.fn();

vi.mock("@/views/api/workspace", () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
}));

vi.mock("@/views/api/workspaceWatch", () => ({
  acquireWorkspaceWatch: (...args: unknown[]) =>
    acquireWorkspaceWatchMock(...args),
  releaseWorkspaceWatch: (...args: unknown[]) =>
    releaseWorkspaceWatchMock(...args),
  previewWorkspaceAgents: (...args: unknown[]) =>
    previewWorkspaceAgentsMock(...args),
}));

vi.mock("@/views/api/aiWorkspaceMemory", () => ({
  workspaceMemoryApi: {
    list: (...args: unknown[]) => workspaceMemoryListMock(...args),
  },
}));

import { useConversationWorkspace } from "@/views/composables/useConversationWorkspace";

function resolvedWorkspace(
  overrides: Partial<Parameters<typeof getWorkspaceMock>[0]> = {}
) {
  return {
    id: 11,
    conversationId: "conv-1",
    rootPath: "/tmp/ws",
    label: "demo",
    approvalState: "approved",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useConversationWorkspace (chat-first shell design §9.1)", () => {
  it("refresh resolves the workspace summary for the conversation", async () => {
    getWorkspaceMock.mockResolvedValue(resolvedWorkspace());
    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    await state.refresh();

    expect(getWorkspaceMock).toHaveBeenCalledWith("conv-1");
    expect(state.workspace.value?.rootPath).toBe("/tmp/ws");
    expect(state.workspace.value?.approvalState).toBe("approved");
    expect(state.errorMessage.value).toBeNull();
    expect(state.loading.value).toBe(false);
  });

  it("null conversation clears workspace state without an IPC call", async () => {
    const conversationId = ref<string | null>(null);
    const state = useConversationWorkspace(conversationId);

    await state.refresh();

    expect(getWorkspaceMock).not.toHaveBeenCalled();
    expect(state.workspace.value).toBeNull();
    expect(state.setupOpen.value).toBe(false);
  });

  it("treats a failed refresh as an error and never widens trust", async () => {
    getWorkspaceMock.mockRejectedValue(new Error("ipc down"));
    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    await state.refresh();

    expect(state.errorMessage.value).toBe("ipc down");
    expect(state.workspace.value).toBeNull();
  });

  it("rejects stale workspace responses when the conversation changes quickly", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    getWorkspaceMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    getWorkspaceMock.mockResolvedValueOnce(
      resolvedWorkspace({ id: 2, rootPath: "/tmp/second" })
    );
    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    const first = state.refresh();
    conversationId.value = "conv-2";
    await nextTick();
    resolveFirst(resolvedWorkspace({ id: 1, rootPath: "/tmp/first" }));
    await first;

    // The stale conv-1 reply must NOT overwrite the conv-2 summary.
    await vi.waitFor(() => {
      expect(state.workspace.value?.rootPath).toBe("/tmp/second");
    });
  });

  it("counts active workspace memories only for approved workspaces", async () => {
    getWorkspaceMock.mockResolvedValue(resolvedWorkspace());
    workspaceMemoryListMock.mockResolvedValue({
      status: true,
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    await state.refresh();
    await state.refreshMemoryCount();

    expect(workspaceMemoryListMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
      status: "active",
      limit: 200,
    });
    expect(state.memoryCount.value).toBe(3);
  });

  it("setup card opens on request and closes on cancel", () => {
    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    state.requestSetup();
    expect(state.setupOpen.value).toBe(true);

    state.closeSetup();
    expect(state.setupOpen.value).toBe(false);
  });

  it("applyApprovedWorkspace adopts the approved summary without a refetch", () => {
    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    state.requestSetup();
    state.applyApprovedWorkspace(31, "/tmp/newly-approved");

    expect(state.workspace.value).toEqual({
      id: 31,
      conversationId: "conv-1",
      rootPath: "/tmp/newly-approved",
      label: null,
      approvalState: "approved",
    });
    expect(state.setupOpen.value).toBe(false);
    expect(getWorkspaceMock).not.toHaveBeenCalled();
  });

  it("acquires a watch for approved workspaces and releases on conversation change", async () => {
    getWorkspaceMock.mockResolvedValue(resolvedWorkspace());
    acquireWorkspaceWatchMock.mockResolvedValue({ workspaceId: "ws-11" });
    previewWorkspaceAgentsMock.mockResolvedValue("some AGENTS.md content");
    releaseWorkspaceWatchMock.mockResolvedValue(undefined);
    workspaceMemoryListMock.mockResolvedValue({ status: true, data: [] });

    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    await state.refresh();
    // The workspace watcher fires on the material change.
    await nextTick();
    await vi.waitFor(() => {
      expect(acquireWorkspaceWatchMock).toHaveBeenCalledWith({
        conversationId: "conv-1",
      });
    });
    await vi.waitFor(() => {
      expect(state.watchId.value).toBe("ws-11");
    });
    // AGENTS.md content was found → trust card is eligible.
    expect(state.trustCardVisible.value).toBe(true);

    // Switching conversations releases the previous watch.
    conversationId.value = "conv-2";
    await nextTick();
    await vi.waitFor(() => {
      expect(releaseWorkspaceWatchMock).toHaveBeenCalledWith({
        conversationId: "conv-1",
        workspaceId: "ws-11",
      });
    });
  });

  it("hides the trust card after dismissal for the session", async () => {
    getWorkspaceMock.mockResolvedValue(resolvedWorkspace());
    acquireWorkspaceWatchMock.mockResolvedValue({ workspaceId: "ws-11" });
    previewWorkspaceAgentsMock.mockResolvedValue("content");
    releaseWorkspaceWatchMock.mockResolvedValue(undefined);
    workspaceMemoryListMock.mockResolvedValue({ status: true, data: [] });

    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    await state.refresh();
    await vi.waitFor(() => {
      expect(state.trustCardVisible.value).toBe(true);
    });

    state.trustDismissed();
    expect(state.trustCardVisible.value).toBe(false);
  });

  it("does not acquire a watch for unapproved workspaces", async () => {
    getWorkspaceMock.mockResolvedValue(
      resolvedWorkspace({ approvalState: "pending_approval" })
    );
    workspaceMemoryListMock.mockResolvedValue({ status: true, data: [] });

    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    await state.refresh();
    await nextTick();
    await vi.waitFor(() => {
      expect(state.workspace.value?.approvalState).toBe("pending_approval");
    });
    expect(acquireWorkspaceWatchMock).not.toHaveBeenCalled();
    expect(state.watchId.value).toBeNull();
  });

  it("dispose releases the active watch", async () => {
    getWorkspaceMock.mockResolvedValue(resolvedWorkspace());
    acquireWorkspaceWatchMock.mockResolvedValue({ workspaceId: "ws-11" });
    previewWorkspaceAgentsMock.mockResolvedValue("");
    releaseWorkspaceWatchMock.mockResolvedValue(undefined);
    workspaceMemoryListMock.mockResolvedValue({ status: true, data: [] });

    const conversationId = ref<string | null>("conv-1");
    const state = useConversationWorkspace(conversationId);

    await state.refresh();
    await vi.waitFor(() => {
      expect(state.watchId.value).toBe("ws-11");
    });

    await state.dispose();
    expect(releaseWorkspaceWatchMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
      workspaceId: "ws-11",
    });
    expect(state.watchId.value).toBeNull();
  });
});
