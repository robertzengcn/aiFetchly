// test/vitest/main/components/AiChatV2.workspaceTrust.test.ts
// Phase 14 (Plan 14-04) — Task 2 integration tests on AiChatV2.vue.
//
// Covers the three renderer-side behaviors the plan adds:
//   (a) Subscriber filter (D-04): AIFETCHLY_CONFIG_CHANGED events refresh
//       the local command cache only when:
//         - event.source === "user" (global event — always refreshes), OR
//         - event.workspaceId === the active workspace's watch id.
//   (b) WorkspaceTrustCard mount condition: an approved workspace with
//       AGENTS.md content (preview returns non-empty) that the user has
//       not yet dismissed this session renders the trust card inline;
//       empty-preview or already-dismissed workspaces do NOT render it.
//   (c) acquire/release lifecycle: onMounted with an approved workspace
//       calls acquireWorkspaceWatch; onBeforeUnmount calls
//       releaseWorkspaceWatch.
//
// Live-app UX (real chokidar file events, real dismissal persistence
// across app restarts, real Electron IPC) is covered by Task 3's
// human-verify checkpoint.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { AifetchlyConfigChangedEvent } from "@/views/api/slashCommands";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";

// --- Mocks ---------------------------------------------------------------

const getWorkspaceMock = vi.fn();
const acquireWorkspaceWatchMock = vi.fn();
const releaseWorkspaceWatchMock = vi.fn();
const previewWorkspaceAgentsMock = vi.fn();
const setWorkspaceTrustMock = vi.fn();
const listSlashCommandsMock = vi.fn();
let configChangedCallback:
  | ((event: AifetchlyConfigChangedEvent) => void)
  | null = null;
const onAifetchlyConfigChangedMock = vi.fn((cb) => {
  configChangedCallback = cb;
  return () => {
    configChangedCallback = null;
  };
});

vi.mock("@/views/api/workspace", () => ({
  getWorkspace: (...a: unknown[]) => getWorkspaceMock(...a),
}));

vi.mock("@/views/api/workspaceWatch", () => ({
  acquireWorkspaceWatch: (...a: unknown[]) => acquireWorkspaceWatchMock(...a),
  releaseWorkspaceWatch: (...a: unknown[]) => releaseWorkspaceWatchMock(...a),
  previewWorkspaceAgents: (...a: unknown[]) => previewWorkspaceAgentsMock(...a),
  setWorkspaceTrust: (...a: unknown[]) => setWorkspaceTrustMock(...a),
}));

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: (...a: unknown[]) => listSlashCommandsMock(...a),
  dispatchSlashCommand: vi.fn(),
  reloadAifetchlyConfig: vi.fn(),
  getAifetchlyConfigStatus: vi.fn(),
  onAifetchlyConfigChanged: (
    cb: (event: AifetchlyConfigChangedEvent) => void
  ) => onAifetchlyConfigChangedMock(cb),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  awaitChatV2Turn: vi.fn(() => ({
    promise: Promise.resolve(),
    detach: vi.fn(),
  })),
  createChatV2PendingMessage: vi.fn().mockResolvedValue(null),
  steerChatV2PendingMessage: vi.fn().mockResolvedValue(null),
  cancelChatV2PendingMessage: vi.fn().mockResolvedValue(null),
  resumeChatV2PendingQueue: vi.fn().mockResolvedValue(true),
  listChatV2PendingMessages: vi.fn().mockResolvedValue([]),
  subscribeChatV2PendingEvents: vi.fn(() => () => undefined),
  clearChatV2StreamListeners: vi.fn(),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getChatV2History: vi.fn().mockResolvedValue({ messages: [] }),
  streamChatV2Message: vi.fn(),
  stopChatV2Stream: vi.fn(),
  getChatV2PlanState: vi.fn().mockResolvedValue(null),
  compactChatV2Conversation: vi.fn(),
  answerChatV2Question: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  getOpenAIChatModels: vi
    .fn()
    .mockResolvedValue({ data: [], default_model: undefined }),
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue("ask_for_approval"),
  setChatV2ToolApprovalMode: vi.fn(),
  clearChatV2Conversation: vi.fn(),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
}));

vi.mock("@/views/api/aiChat", () => ({
  subscribeToFileOperations: vi.fn(),
  unsubscribeFromFileOperations: vi.fn(),
}));

// AiChatV2 is statically imported above. vitest hoists vi.mock calls above
// all static imports, so the mocked modules are in place before AiChatV2's
// setup wiring runs.

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: { title: "AI Assistant" },
      workspace: { badgeLabel: "Workspace", notSet: "No workspace set" },
    },
  },
});

const APPROVED_WS: WorkspaceSummary = {
  id: 42,
  conversationId: "v2-conv-1",
  rootPath: "/tmp/ws",
  label: null,
  approvalState: "approved",
};

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Messages: true,
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: { template: '<div><slot name="prepend" /></div>' },
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        // NOTE: WorkspaceBadge is intentionally NOT stubbed — clicking the
        // "unset" badge is the simplest way to drive the existing
        // handleWorkspaceSetupRequest flow, which calls
        // ensureWorkspaceConversationId() and so populates
        // activeConversationId. Without that, refreshWorkspace never runs
        // and the workspace-watch acquire path is unreachable from a
        // fresh mount.
        WorkspaceRequiredCard: true,
        WorkspaceTrustCard: {
          props: ["workspaceId", "conversationId"],
          emits: ["trusted", "dismissed"],
          template:
            '<div data-testid="workspace-trust-card" :data-workspace-id="workspaceId" :data-conversation-id="conversationId" />',
        },
        VBtn: true,
        VCard: true,
        VCardText: true,
        VCardTitle: true,
        VChip: true,
        VDialog: true,
        VDivider: true,
        VIcon: true,
        VList: true,
        VListItem: true,
        VListItemSubtitle: true,
        VListItemTitle: true,
        VProgressCircular: true,
        VProgressLinear: true,
        VSnackbar: true,
        VSpacer: true,
        VTextField: true,
      },
    },
  });
}

/**
 * Drive the existing "click the unset workspace badge" flow so an active
 * conversation exists and refreshWorkspace runs. Without this, the workspace
 * + watcher state never initializes on a fresh mount and the trust-card /
 * acquire paths are unreachable from the test.
 */
async function mountChatWithActiveWorkspace(): Promise<
  ReturnType<typeof mount>
> {
  const wrapper = mountChat();
  await flushPromises();
  await wrapper.find(".workspace-badge--unset").trigger("click");
  await flushPromises();
  return wrapper;
}

function resetMocks(opts?: { previewContent?: string }) {
  getWorkspaceMock.mockReset();
  acquireWorkspaceWatchMock.mockReset();
  releaseWorkspaceWatchMock.mockReset();
  previewWorkspaceAgentsMock.mockReset();
  setWorkspaceTrustMock.mockReset();
  listSlashCommandsMock.mockReset();
  configChangedCallback = null;

  listSlashCommandsMock.mockResolvedValue({
    status: true,
    commands: [],
    diagnostics: [],
    msg: "",
  });
  getWorkspaceMock.mockResolvedValue(APPROVED_WS);
  acquireWorkspaceWatchMock.mockResolvedValue({ workspaceId: "42" });
  previewWorkspaceAgentsMock.mockResolvedValue(
    opts?.previewContent ?? "# AGENTS\nbody"
  );
  releaseWorkspaceWatchMock.mockResolvedValue(undefined);
  setWorkspaceTrustMock.mockResolvedValue({ ok: true });
}

describe("AiChatV2 workspace-trust integration (Plan 14-04 Task 2)", () => {
  beforeEach(() => resetMocks());

  describe("(c) acquire/release lifecycle", () => {
    it("onMounted with approved workspace calls acquireWorkspaceWatch", async () => {
      resetMocks();
      await mountChatWithActiveWorkspace();

      expect(acquireWorkspaceWatchMock).toHaveBeenCalledTimes(1);
      // consumerId conversationId matches the conversation in the workspace
      // record; the request never carries a workspaceRoot (CFG-02).
      const call = acquireWorkspaceWatchMock.mock.calls[0][0] as {
        conversationId: string;
        workspaceId?: string;
        workspaceRoot?: unknown;
      };
      expect(typeof call.conversationId).toBe("string");
      expect(call.conversationId.length).toBeGreaterThan(0);
      expect(call.workspaceRoot).toBeUndefined();
    });

    it("onBeforeUnmount calls releaseWorkspaceWatch for the active workspace", async () => {
      resetMocks();
      const wrapper = await mountChatWithActiveWorkspace();
      // Acquire must have run before unmount so release has a target.
      expect(acquireWorkspaceWatchMock).toHaveBeenCalled();

      wrapper.unmount();
      await flushPromises();

      expect(releaseWorkspaceWatchMock).toHaveBeenCalled();
      const lastCall = releaseWorkspaceWatchMock.mock.calls[
        releaseWorkspaceWatchMock.mock.calls.length - 1
      ][0] as { conversationId?: string };
      expect(typeof lastCall.conversationId).toBe("string");
    });

    it("does NOT call acquire when no approved workspace exists", async () => {
      resetMocks();
      getWorkspaceMock.mockResolvedValue(null);
      await mountChatWithActiveWorkspace();

      expect(acquireWorkspaceWatchMock).not.toHaveBeenCalled();
    });
  });

  describe("(b) WorkspaceTrustCard mount condition", () => {
    it("renders the trust card when approved + preview has AGENTS content + not dismissed", async () => {
      resetMocks({ previewContent: "# AGENTS\nTrust me" });
      const wrapper = await mountChatWithActiveWorkspace();

      const card = wrapper.find('[data-testid="workspace-trust-card"]');
      expect(card.exists()).toBe(true);
      expect(card.attributes("data-workspace-id")).toBe("42");
    });

    it("does NOT render the trust card when preview is empty (no .aifetchly)", async () => {
      resetMocks({ previewContent: "" });
      const wrapper = await mountChatWithActiveWorkspace();

      expect(
        wrapper.find('[data-testid="workspace-trust-card"]').exists()
      ).toBe(false);
    });

    it("does NOT render the trust card when acquire returned null (not approved / not watched)", async () => {
      resetMocks();
      acquireWorkspaceWatchMock.mockResolvedValue(null);
      const wrapper = await mountChatWithActiveWorkspace();

      expect(
        wrapper.find('[data-testid="workspace-trust-card"]').exists()
      ).toBe(false);
    });
  });

  describe("(a) subscriber filter (D-04)", () => {
    async function fireAndGetRefreshCount(
      event: AifetchlyConfigChangedEvent
    ): Promise<number> {
      const before = listSlashCommandsMock.mock.calls.length;
      expect(configChangedCallback).not.toBeNull();
      configChangedCallback!(event);
      await flushPromises();
      return listSlashCommandsMock.mock.calls.length - before;
    }

    it("refreshes when event.source === 'user' (global events always refresh)", async () => {
      resetMocks();
      await mountChatWithActiveWorkspace();

      const delta = await fireAndGetRefreshCount({
        source: "user",
        summary: {
          commandCount: 0,
          diagnosticCount: 0,
          lastReloadAt: 0,
          instructionsChanged: false,
        },
      });
      expect(delta).toBeGreaterThan(0);
    });

    it("refreshes when event.workspaceId matches the active watch id", async () => {
      resetMocks();
      await mountChatWithActiveWorkspace();
      // The active watch id was set by acquire → "42".
      const delta = await fireAndGetRefreshCount({
        source: "workspace",
        workspaceId: "42",
        summary: {
          commandCount: 1,
          diagnosticCount: 0,
          lastReloadAt: 0,
          instructionsChanged: false,
        },
      });
      expect(delta).toBeGreaterThan(0);
    });

    it("does NOT refresh when event.workspaceId differs from the active watch id", async () => {
      resetMocks();
      await mountChatWithActiveWorkspace();

      const delta = await fireAndGetRefreshCount({
        source: "workspace",
        workspaceId: "999-other-workspace",
        summary: {
          commandCount: 1,
          diagnosticCount: 0,
          lastReloadAt: 0,
          instructionsChanged: false,
        },
      });
      expect(delta).toBe(0);
    });
  });
});
