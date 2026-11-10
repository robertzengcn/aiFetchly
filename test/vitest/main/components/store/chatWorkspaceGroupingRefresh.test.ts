import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  ConversationSummaryEvent,
  WorkspaceConversationSummary,
  WorkspaceGroupSummary,
} from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * BUGFIX 2026-11-02 — left menu never shows the new chat's workspace folder.
 *
 * Root cause layer 4 (renderer): `applySummaryEvent` only replaced summary
 * rows in place. An unseen conversation ALWAYS landed under "Other chats",
 * and a conversation whose workspace was bound later never moved into its
 * folder — the code merely left a comment "until the next bootstrap
 * refresh", and nothing ever scheduled one. With the main-side fixes
 * (key-at-bind resolution, scheduled-run broadcast stamps, AI_WORKSPACE_SET
 * assignment broadcast), a non-null workspaceKey now legitimately arrives on
 * summary events; the store must react to a grouping change by scheduling
 * the authoritative re-projection (bootstrap), and the row then regroups
 * into its folder.
 */

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
  subscribeTitleEvents: vi.fn().mockReturnValue(() => undefined),
}));

import { bootstrapWorkspace, subscribeSummaryEvents } from "@/views/api/aiChatWorkspace";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";

const bootstrapWorkspaceMock = vi.mocked(bootstrapWorkspace);
const subscribeSummaryEventsMock = vi.mocked(subscribeSummaryEvents);

const subscriptionCalls: Array<(event: ConversationSummaryEvent) => void> = [];

function subscriptionCallback():
  | ((event: ConversationSummaryEvent) => void)
  | undefined {
  return subscriptionCalls[subscriptionCalls.length - 1];
}

function summary(
  conversationId: string,
  overrides: Partial<WorkspaceConversationSummary> = {}
): WorkspaceConversationSummary {
  return {
    conversationId,
    workspaceKey: null,
    title: `Title ${conversationId}`,
    titleRevision: 0,
    preview: "",
    lastActivityAt: "2026-11-02T00:00:00.000Z",
    unread: false,
    attention: "none",
    runtimeStatus: "idle",
    activeRunId: null,
    ...overrides,
  };
}

function group(
  workspaceKey: string,
  conversations: WorkspaceConversationSummary[]
): WorkspaceGroupSummary {
  return {
    workspaceKey,
    displayName: "Demo",
    canonicalRootPath: "/tmp/demo",
    approvalState: "approved",
    conversations,
  };
}

function event(overrides: Partial<ConversationSummaryEvent>): ConversationSummaryEvent {
  return {
    conversationId: "v2-evt",
    workspaceKey: null,
    runtimeStatus: "idle",
    attention: "none",
    unread: false,
    lastActivityAt: "2026-11-02T00:00:00.000Z",
    reason: "conversation_updated",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  bootstrapWorkspaceMock.mockReset();
  bootstrapWorkspaceMock.mockResolvedValue({
    workspaces: [],
    unassigned: [],
    selectedConversationId: null,
  });
  subscribeSummaryEventsMock.mockReset();
  subscribeSummaryEventsMock.mockImplementation((cb) => {
    subscriptionCalls.push(cb);
    return () => undefined;
  });
  subscriptionCalls.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sidebar grouping refresh on summary events (bugfix 2026-11-02)", () => {
  it("refreshes and regroups an unseen conversation whose event carries a workspace key", async () => {
    bootstrapWorkspaceMock.mockResolvedValueOnce({
      workspaces: [],
      unassigned: [],
      selectedConversationId: null,
    });
    const store = useChatWorkspaceStore();
    await store.bootstrap();
    expect(bootstrapWorkspaceMock).toHaveBeenCalledTimes(1);

    const refreshRow = summary("v2-new", { workspaceKey: "ws_folder1" });
    bootstrapWorkspaceMock.mockResolvedValueOnce({
      workspaces: [group("ws_folder1", [refreshRow])],
      unassigned: [],
      selectedConversationId: null,
    });

    subscriptionCallback()?.(
      event({ conversationId: "v2-new", workspaceKey: "ws_folder1" })
    );

    await vi.advanceTimersByTimeAsync(600);

    expect(bootstrapWorkspaceMock).toHaveBeenCalledTimes(2);
    // The authoritative re-projection regrouped the row: it now lives in
    // the folder and is gone from "Other chats".
    expect(store.visibleWorkspaceGroups[0]?.conversations).toHaveLength(1);
    expect(store.unassigned).toHaveLength(0);
  });

  it("refreshes when an existing unassigned row gains a workspace key", async () => {
    bootstrapWorkspaceMock.mockResolvedValueOnce({
      workspaces: [],
      unassigned: [summary("v2-late")],
      selectedConversationId: null,
    });
    const store = useChatWorkspaceStore();
    await store.bootstrap();

    const refreshRow = summary("v2-late", { workspaceKey: "ws_folder2" });
    bootstrapWorkspaceMock.mockResolvedValueOnce({
      workspaces: [group("ws_folder2", [refreshRow])],
      unassigned: [],
      selectedConversationId: null,
    });

    subscriptionCallback()?.(
      event({ conversationId: "v2-late", workspaceKey: "ws_folder2" })
    );

    await vi.advanceTimersByTimeAsync(600);

    expect(bootstrapWorkspaceMock).toHaveBeenCalledTimes(2);
    expect(store.visibleWorkspaceGroups[0]?.conversations).toHaveLength(1);
    expect(store.unassigned).toHaveLength(0);
  });

  it("does not refresh for events without a grouping change", async () => {
    bootstrapWorkspaceMock.mockResolvedValueOnce({
      workspaces: [],
      unassigned: [summary("v2-idle")],
      selectedConversationId: null,
    });
    const store = useChatWorkspaceStore();
    await store.bootstrap();

    // Unseen conversation WITHOUT a key lands in Other chats only — no
    // grouping change is possible, so no refresh is scheduled.
    subscriptionCallback()?.(
      event({ conversationId: "v2-unassigned2", workspaceKey: null })
    );
    // Same-key status update on an existing row — placement is unchanged.
    subscriptionCallback()?.(
      event({ conversationId: "v2-idle", workspaceKey: null, unread: true })
    );

    await vi.advanceTimersByTimeAsync(600);
    expect(bootstrapWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes a burst of grouping-change events into one refresh", async () => {
    bootstrapWorkspaceMock.mockResolvedValueOnce({
      workspaces: [],
      unassigned: [],
      selectedConversationId: null,
    });
    const store = useChatWorkspaceStore();
    await store.bootstrap();

    subscriptionCallback()?.(
      event({ conversationId: "v2-b1", workspaceKey: "ws_g1" })
    );
    subscriptionCallback()?.(
      event({ conversationId: "v2-b2", workspaceKey: "ws_g2" })
    );

    await vi.advanceTimersByTimeAsync(600);
    expect(bootstrapWorkspaceMock).toHaveBeenCalledTimes(2);
  });
});
