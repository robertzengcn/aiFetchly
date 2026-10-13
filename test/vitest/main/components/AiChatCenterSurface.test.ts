import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { createI18n } from "vue-i18n";

const getWorkspaceMock = vi.fn();
const workspaceMemoryListMock = vi.fn();
const acquireWorkspaceWatchMock = vi.fn();
const releaseWorkspaceWatchMock = vi.fn();
const previewWorkspaceAgentsMock = vi.fn();
const getOpenAIChatModelsMock = vi.fn();
const getToolApprovalMock = vi.fn();
const getVoiceSettingsMock = vi.fn();
const setVoiceSettingsMock = vi.fn();
const getVoiceStatusMock = vi.fn();
const getLocalAiRuntimeStatusMock = vi.fn();
const createWorkspaceConversationIdMock = vi.fn();
const startChatRunMock = vi.fn();
const exportGeneratedImageMock = vi.fn();

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

vi.mock("@/views/api/aiChatV2", () => ({
  subscribeCompactionProgress: vi.fn().mockReturnValue(() => undefined),
  unsubscribeCompactionProgress: vi.fn(),
  getCompactionStatus: vi.fn().mockResolvedValue(null),
  startCompaction: vi.fn().mockResolvedValue({ started: true }),
  cancelCompaction: vi.fn().mockResolvedValue(false),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  denyChatV2ToolPermission: vi.fn().mockResolvedValue({ ok: true }),
  steerChatV2PendingMessage: vi.fn(),
  cancelChatV2PendingMessage: vi.fn(),
  resumeChatV2PendingQueue: vi.fn().mockResolvedValue(true),
  getChatV2History: vi.fn().mockResolvedValue({ messages: [] }),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getOpenAIChatModels: (...args: unknown[]) => getOpenAIChatModelsMock(...args),
  getChatV2ToolApprovalMode: (...args: unknown[]) =>
    getToolApprovalMock(...args),
  setChatV2ToolApprovalMode: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  answerChatV2Question: vi.fn(),
  clearChatV2Conversation: vi.fn(),
  compactChatV2Conversation: vi.fn(),
  // Pending-message queue store contract (message-queue §7)
  listChatV2PendingMessages: vi.fn().mockResolvedValue([]),
  subscribeChatV2PendingEvents: vi.fn(() => () => undefined),
  exportGeneratedImage: (...args: unknown[]) =>
    exportGeneratedImageMock(...args),
  isHistoryUiEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/views/api/aiChatV2Voice", () => ({
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT: "voice-settings-changed",
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT: "voice-models-changed",
  cancelVoiceJob: vi.fn().mockResolvedValue({ ok: true }),
  downloadVoiceModel: vi.fn(),
  getVoiceSettings: (...args: unknown[]) => getVoiceSettingsMock(...args),
  getVoiceStatus: (...args: unknown[]) => getVoiceStatusMock(...args),
  notifyVoiceModelsChanged: vi.fn(),
  onVoiceModelDownloadProgress: vi.fn().mockReturnValue(() => undefined),
  setVoiceSettings: (...args: unknown[]) => setVoiceSettingsMock(...args),
  synthesizeVoice: vi.fn(),
  transcribeVoice: vi.fn(),
}));

vi.mock("@/views/api/localAiRuntime", () => ({
  getLocalAiRuntimeStatus: (...args: unknown[]) =>
    getLocalAiRuntimeStatusMock(...args),
  prepareLocalAiRuntimeInstall: vi.fn(),
  installLocalAiRuntime: vi.fn(),
  onLocalAiRuntimeProgress: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("@/views/utils/localAiRuntimeUi", () => ({
  isLocalAiRuntimeUsable: (state: unknown) => state === "installed",
}));

vi.mock("@/views/api/managedBrowser", () => ({
  listEligibleAccounts: vi.fn().mockResolvedValue([]),
  listActiveSessions: vi.fn().mockResolvedValue([]),
  startManagedBrowser: vi.fn(),
  getManagedBrowserStatus: vi.fn().mockResolvedValue(null),
  requestHandoff: vi.fn(),
  verifyManualLogin: vi.fn(),
  resumeAfterHandoff: vi.fn(),
  stopManagedBrowser: vi.fn(),
  approveBrowserAction: vi.fn(),
  captureSessionScreenshot: vi.fn(),
  cancelActiveBrowserRequest: vi.fn(),
  extendHandoff: vi.fn(),
  getEffectiveBrowserSettings: vi.fn(),
  updateBrowserPreferences: vi.fn(),
  getCacheStatus: vi.fn(),
  issueClearConfirmation: vi.fn(),
  clearCache: vi.fn(),
  onManagedBrowserStatusChanged: vi.fn(() => () => undefined),
  onManagedBrowserChatNotice: vi.fn(() => () => undefined),
  onManagedBrowserProgress: vi.fn(() => () => undefined),
  onManagedBrowserApprovalRequired: vi.fn(() => () => undefined),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  createWorkspaceConversationId: (...args: unknown[]) =>
    createWorkspaceConversationIdMock(...args),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  duplicateConversation: vi.fn(),
  exportConversation: vi.fn(),
  isWorkspaceRedesignEnabled: vi.fn(),
  setWorkspaceRedesignEnabled: vi.fn(),
  // selectedConversation store contract
  selectConversation: vi.fn().mockResolvedValue({
    acceptedGeneration: 1,
    messages: [],
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "idle",
    activeRunId: null,
    title: "Selected chat",
  }),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-1"),
}));

import AiChatCenterSurface from "@/views/components/aiChatWorkspace/AiChatCenterSurface.vue";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { useAppInspectorStore } from "@/views/store/appInspector";
import { approveChatV2Plan, isHistoryUiEnabled } from "@/views/api/aiChatV2";
import { selectConversation } from "@/views/api/aiChatWorkspace";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";
import {
  AI_CHAT_V2_GOAL_CREATE,
  AI_CHAT_V2_GOAL_GET,
  AI_CHAT_V2_GOAL_LOOP_START,
  AI_CHAT_V2_SCHEDULED_LOOP_CREATE,
  PROMPT_SKILL_INVOKE,
  SLASH_COMMAND_DISPATCH,
} from "@/config/channellist";

interface RouterLike {
  push: (location: unknown) => Promise<unknown> | unknown;
}

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: {
        loading: "Loading…",
        cancel: "Cancel",
        ok: "OK",
        retry: "Retry",
      },
      workspaceChat: {
        newChat: "New chat",
        loadOlder: "Load older messages",
        recovery: {
          retry:
            "Reconnecting… attempt {attempt} of {max} (waiting ~{seconds}s)",
          recovering: "Recovering via {layer}: {reason}",
        },
        command: {
          busy:
            "Commands are unavailable while this chat is running. Wait for it to finish or stop it first.",
          staleAborted: "Selection changed — the command was not run.",
          noConversation: "No chat is selected — the command was not run.",
        },
        plan: {
          continuationAborted:
            "Selection changed — the plan decision was saved, but its follow-up message was not sent. Reopen the conversation to continue.",
        },
        empty: { title: "Ask anything, or pick a conversation on the left." },
        sidebar: { region: "Chat workspaces" },
        inspector: { context: "Context" },
      },
      workspaceMemory: { panelTitle: "Workspace memory" },
      workspace: {
        loadFailed: "Couldn't load the workspace.",
        retry: "Retry",
        pathUnavailable: "Workspace folder is not accessible right now.",
        busyReason: "Available after current run",
      },
      aiChatV2: {
        permission_resume_failed:
          "Could not continue the tool after permission was granted.",
        voice: {
          settings_save_failed: "Couldn't save the spoken-response preference.",
          retry: "Retry",
          open_model_settings: "Open settings",
        },
        skillSlash: {
          notFound: "No installed prompt skill matches '{name}'.",
        },
        artifactExport: {
          savedToWorkspace: "Saved {fileName} to your workspace.",
          saveFailed: "Could not save to workspace.",
        },
        imageTool: {
          errors: {
            workspaceRequired: "An approved workspace is required first.",
          },
        },
      },
      aiChatV2Plan: {
        approve_failed: "Plan approval did not complete. Please try again.",
        approved_continue_message:
          "Plan approved. Please begin executing the plan now.",
      },

    },
  },
});

/** Composer stub renders its lower slots so control placement is testable. */
const ComposerStub = defineComponent({
  name: "AiChatV2Composer",
  props: [
    "isStreaming",
    "conversationId",
    "voiceEnabled",
    "voiceSettingsUnavailable",
    "draftKey",
    "selectedGeneratedImages",
    "generatedImageReferenceLimit",
    "generatedImageFocusSignal",
  ],
  emits: ["send", "stop"],
  template:
    '<div class="composer-stub" data-testid="composer-stub">' +
    '<div data-testid="composer-textarea"></div>' +
    '<div class="composer-stub__slots"><slot name="controls" /><slot name="toolbar-actions" /></div>' +
    "</div>",
});

const HeaderStub = defineComponent({
  name: "AiChatConversationHeader",
  props: ["title", "hasConversation", "inspectorOpen"],
  template: '<header data-testid="conversation-header-stub"><slot /></header>',
});

function mountSurface(pinia: ReturnType<typeof createPinia> = createPinia()) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/aiworkspace",
        name: "AI_Chat_Workspace",
        component: AiChatCenterSurface,
      },
      { path: "/", redirect: "/aiworkspace" },
    ],
  });
  const wrapper = mount(AiChatCenterSurface, {
    global: {
      plugins: [pinia, i18n, router],
      stubs: {
        AiChatV2Composer: ComposerStub,
        AiChatConversationHeader: HeaderStub,
        AiChatWorkspaceTranscript: defineComponent({
          name: "AiChatWorkspaceTranscript",
          props: [
            "messages",
            "streamStatus",
            "pendingMessages",
            "planDecisionInFlight",
            "planDecisionError",
            "reportedMessageIds",
            "showReasoning",
          ],
          template: '<div data-testid="transcript-stub" />',
        }),
        AiChatRunStrip: true,
        WorkspaceBadge: defineComponent({
          name: "WorkspaceBadge",
          props: ["workspace", "memoryCount", "loading", "busy"],
          template:
            '<div data-testid="workspace-badge-stub">{{ workspace ? workspace.rootPath || "unset" : "none" }}</div>',
        }),
        WorkspaceRequiredCard: defineComponent({
          props: ["conversationId"],
          template: '<div data-testid="workspace-required-stub" />',
        }),
        WorkspaceTrustCard: true,
        WorkspaceMemoryPanel: true,
        AiChatV2ModeSelector: defineComponent({
          template: '<div data-testid="mode-selector-stub" />',
        }),
        AiChatV2ModelSelector: defineComponent({
          name: "AiChatV2ModelSelector",
          props: [
            "modelValue",
            "items",
            "defaultModel",
            "disabled",
            "loading",
            "noModels",
          ],
          template: '<div data-testid="model-selector-stub" />',
        }),
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2ContextBadge: true,
        AiChatVoiceOutputToggle: defineComponent({
          name: "AiChatVoiceOutputToggle",
          template: '<div data-testid="voice-toggle-stub" />',
        }),
        AiChatVoiceRuntimeInstallDialog: true,
        AiChatHistoryDrawer: defineComponent({
          name: "AiChatHistoryDrawer",
          props: ["modelValue", "conversationId"],
          emits: ["select", "navigate", "update:modelValue"],
          template: '<div data-testid="history-drawer-stub" />',
        }),
        AiChatSelectedContext: defineComponent({
          name: "AiChatSelectedContext",
          props: ["selections"],
          emits: ["remove", "clear"],
          template: '<div data-testid="selected-context-stub" />',
        }),
        AgentTaskListDialog: defineComponent({
          name: "AgentTaskListDialog",
          emits: ["cancel-task"],
          template: '<div data-testid="agent-task-dialog-stub" />',
        }),
        AiChatCompactionStatus: defineComponent({
          name: "AiChatCompactionStatus",
          props: ["status", "busy"],
          emits: ["retry", "cancel", "openHistory"],
          template: '<div data-testid="compaction-status-stub" />',
        }),
        AIContentReportDialog: defineComponent({
          name: "AIContentReportDialog",
          props: ["modelValue", "descriptor"],
          emits: ["submitted", "update:modelValue"],
          template: '<div data-testid="single-report-dialog-stub" />',
        }),
        ScheduledLoopToolApprovalDialog: defineComponent({
          name: "ScheduledLoopToolApprovalDialog",
          props: ["modelValue", "rawCommand", "prompt"],
          emits: ["confirm", "cancel", "update:modelValue"],
          template: '<div data-testid="scheduled-loop-approval-stub" />',
        }),
        "v-btn": { template: '<button class="stub-btn"><slot /></button>' },
        "v-icon": true,
        "v-dialog": { template: '<div class="stub-dialog"><slot /></div>' },
        "v-card": { template: "<div><slot /></div>" },
        "v-card-title": { template: "<div><slot /></div>" },
        "v-card-text": { template: "<div><slot /></div>" },
        "v-card-actions": { template: "<div><slot /></div>" },
        "v-text-field": true,
        "v-divider": true,
        "v-spacer": true,
      },
    },
  });
  // Make the mounted app's pinia the active one so test-scope store calls
  // observe the same instances the component uses.
  setActivePinia(pinia);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getWorkspaceMock.mockResolvedValue(null);
  workspaceMemoryListMock.mockResolvedValue({ status: true, data: [] });
  acquireWorkspaceWatchMock.mockResolvedValue(null);
  releaseWorkspaceWatchMock.mockResolvedValue(undefined);
  previewWorkspaceAgentsMock.mockResolvedValue("");
  getOpenAIChatModelsMock.mockResolvedValue({
    data: [{ id: "m1" }],
    default_model: "m1",
  });
  getToolApprovalMock.mockResolvedValue("ask_for_approval");
  getVoiceSettingsMock.mockResolvedValue({
    inputMode: "disabled",
    ttsMode: "disabled",
    autoSendTranscript: false,
    sttLanguage: "auto",
    ttsLanguage: "auto",
    sttModelId: "stt",
    ttsModelId: "tts",
    ttsSpeed: 1,
    maxRecordingMs: 60000,
  });
  getVoiceStatusMock.mockResolvedValue({
    sttState: "ready",
    ttsState: "ready",
  });
  getLocalAiRuntimeStatusMock.mockResolvedValue({ state: "installed" });
  createWorkspaceConversationIdMock.mockReturnValue("fresh-chat");
});

describe("AiChatCenterSurface (chat-first shell design §8–§9)", () => {
  it("renders without a sidebar or full-window shell wrapper", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    expect(wrapper.find('[data-testid="chat-center-surface"]').exists()).toBe(
      true
    );
    // The extracted surface must NOT carry the standalone shell's fixtures.
    expect(wrapper.find('[data-testid="workspace-shell"]').exists()).toBe(
      false
    );
    expect(
      wrapper.find('[data-testid="workspace-sidebar-toggle"]').exists()
    ).toBe(false);
  });

  it("places the workspace strip above the composer and below the transcript", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    const strip = wrapper.get('[data-testid="chat-workspace-strip"]').element;
    const transcript = wrapper.get('[data-testid="transcript-stub"]').element;
    const composer = wrapper.get('[data-testid="composer-stub"]').element;
    expect(
      transcript.compareDocumentPosition(strip) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      strip.compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows the empty new-chat state when no conversation is selected", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    const empty = wrapper.get('[data-testid="workspace-empty-state"]');
    expect(empty.text()).toContain("Ask anything");
  });

  it("creates and selects a chat from the empty state via the fallback path", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    const selected = useSelectedConversationStore();
    await flushPromises();

    await wrapper
      .get('[data-testid="workspace-empty-new-chat"]')
      .trigger("click");
    await flushPromises();

    expect(createWorkspaceConversationIdMock).toHaveBeenCalled();
    expect(chatWorkspace.selectedConversationId).toBe("fresh-chat");
    expect(selected.messages).toEqual([]);
  });

  it("creates and selects a chat when sending from the empty state", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "fresh-chat",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    await flushPromises();
    // Empty state: no conversation selected — the composer is still mounted.
    expect(
      wrapper.find('[data-testid="workspace-empty-state"]').exists()
    ).toBe(true);

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "hello from empty state", []);
    await flushPromises();

    // The send must ensure a conversation first (legacy-dock parity):
    // a fresh chat is created + selected and the run starts against it.
    expect(createWorkspaceConversationIdMock).toHaveBeenCalled();
    expect(useChatWorkspaceStore().selectedConversationId).toBe("fresh-chat");
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
      conversationId: "fresh-chat",
      message: "hello from empty state",
    });
  });

  /**
   * FR-SUB-004 (capability parity PRD): the composer's pasted-content map
   * must reach the workspace start-run IPC — the same engine request
   * behavior Chat V2 provides. A surface that drops the map would let the
   * model see only the placeholder text.
   */
  it("forwards the composer pastedContents map through the workspace send", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "fresh-chat",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    await flushPromises();

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "see pasted block 1", [], {
      pastedContents: { "1": "the full pasted body text" },
    });
    await flushPromises();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
      conversationId: "fresh-chat",
      pastedContents: { "1": "the full pasted body text" },
    });
  });

  /**
   * FR-SUB-002/003: a rejected submission must never invoke the composer's
   * acceptance callback (draft retention) — pasted bodies included.
   */
  it("keeps the draft when the workspace send is rejected (no acceptance callback)", async () => {
    startChatRunMock.mockRejectedValue(new Error("queue limit reached"));
    const wrapper = mountSurface();
    await flushPromises();

    const acceptedSpy = vi.fn();
    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "retry me", [], {
      pastedContents: { "1": "pasted body" },
      onAccepted: acceptedSpy,
    });
    await flushPromises();

    expect(acceptedSpy).not.toHaveBeenCalled();
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Command routing (capability-parity FR-CMD-001..009, FR-SKL-005): the
   * workspace routes '/…' input through the shared router BEFORE ordinary
   * submission — the raw command text never reaches the model.
   */
  type InvokeMock = ReturnType<typeof vi.fn>;

  function invokeMock(): InvokeMock {
    return window.api.invoke as InvokeMock;
  }

  /**
   * Route per-channel responses through the global window.api stub.
   * Unmapped channels keep the stub default (undefined envelope) so
   * capability fetches and other mounts are not poisoned.
   */
  function mockInvokeByChannel(handlers: Record<string, unknown>): void {
    invokeMock().mockImplementation((channel: string) => {
      if (channel in handlers) {
        return Promise.resolve(handlers[channel]);
      }
      return Promise.resolve(undefined);
    });
  }

  describe("command routing", () => {
    it("dispatches a generic slash command through the registry and renders the local exchange (FR-CMD-001)", async () => {
      mockInvokeByChannel({
        // windowInvoke unwraps the CommonMessage envelope — return it whole.
        [SLASH_COMMAND_DISPATCH]: {
          status: true,
          data: {
            status: true,
            action: "show_result",
            content: "Review started for Acme.",
            commandId: "plugin:review",
          },
        },
      });
      const wrapper = mountSurface();
      await flushPromises();

      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/review Acme", []);
      await flushPromises();

      // The registry handled it; the model never saw the raw command.
      expect(startChatRunMock).not.toHaveBeenCalled();
      const dispatchCall = invokeMock().mock.calls.find(
        (call) => call[0] === SLASH_COMMAND_DISPATCH
      );
      // windowInvoke serializes the payload — parse it back for assertion.
      expect(JSON.parse(String(dispatchCall?.[1]))).toMatchObject({
        rawInput: "/review Acme",
      });
      // The local receipt renders as a non-persisted transcript exchange.
      const selected = useSelectedConversationStore();
      const exchange = selected.messages.filter(
        (m: ChatV2MessageView) => m.metadata?.source === "slash-command"
      );
      expect(exchange).toHaveLength(1);
      expect(exchange[0].content).toBe("Review started for Acme.");
    });

    it("routes /goal to goal creation and submits the plan prompt in plan mode (FR-CMD-005)", async () => {
      startChatRunMock.mockResolvedValue({
        conversationId: "fresh-chat",
        runId: "run-goal",
        status: "running",
        acceptedAt: "",
      });
      mockInvokeByChannel({
        [AI_CHAT_V2_GOAL_CREATE]: {
          status: true,
          data: {
            conversationId: "fresh-chat",
            goalId: "goal-9",
            planPrompt: "Plan prompt for growing the newsletter",
          },
        },
      });
      const wrapper = mountSurface();
      await flushPromises();

      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/goal grow the newsletter", []);
      await flushPromises();

      const goalCall = invokeMock().mock.calls.find(
        (call) => call[0] === AI_CHAT_V2_GOAL_CREATE
      );
      expect(JSON.parse(String(goalCall?.[1]))).toMatchObject({
        objective: "grow the newsletter",
        replace: true,
      });
      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
        message: "Plan prompt for growing the newsletter",
        mode: "plan",
      });
    });

    it("keeps the draft and shows a safe error when /skill lookup fails (FR-SKL-005)", async () => {
      // No handler for PROMPT_SKILL_INVOKE → resolves undefined → api maps
      // to a null ack (skill not found).
      mockInvokeByChannel({});
      const wrapper = mountSurface();
      await flushPromises();

      const acceptedSpy = vi.fn();
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/skill missing-skill do things", [], {
        onAccepted: acceptedSpy,
      });
      await flushPromises();

      // A failed lookup must NOT fall through to ordinary model text.
      expect(startChatRunMock).not.toHaveBeenCalled();
      expect(acceptedSpy).not.toHaveBeenCalled();
      const notice = wrapper.get('[data-testid="workspace-command-error"]');
      expect(notice.text()).toContain("missing-skill");
    });

    it("stages a scheduled loop for approval and persists it only on confirm (FR-CMD-007)", async () => {
      mockInvokeByChannel({
        [AI_CHAT_V2_SCHEDULED_LOOP_CREATE]: {
          status: true,
          data: { conversationId: "fresh-chat" },
        },
      });
      const wrapper = mountSurface();
      await flushPromises();

      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/loop 10m summarize emails", []);
      await flushPromises();

      // Staged, not persisted: no create call until the user approves.
      const createCallsBefore = invokeMock().mock.calls.filter(
        (call) => call[0] === AI_CHAT_V2_SCHEDULED_LOOP_CREATE
      );
      expect(createCallsBefore).toHaveLength(0);
      const dialog = wrapper.findComponent({
        name: "ScheduledLoopToolApprovalDialog",
      });
      expect(dialog.exists()).toBe(true);
      expect(dialog.props("rawCommand")).toBe("/loop 10m summarize emails");

      dialog.vm.$emit("confirm", {
        allowedTools: ["read_emails"],
        autoApproveTools: false,
        allowSkills: false,
        allowMcp: false,
        allowSubagents: false,
      });
      await flushPromises();

      const createCall = invokeMock().mock.calls.find(
        (call) => call[0] === AI_CHAT_V2_SCHEDULED_LOOP_CREATE
      );
      expect(JSON.parse(String(createCall?.[1]))).toMatchObject({
        rawCommand: "/loop 10m summarize emails",
        intervalMs: 600_000,
        prompt: "summarize emails",
      });
      // The dialog closed (and unmounted) after the decision.
      expect(
        wrapper.findComponent({ name: "ScheduledLoopToolApprovalDialog" }).exists()
      ).toBe(false);
    });

    it("rejects command input while the selected conversation is busy (FR-SUB-009)", async () => {
      startChatRunMock.mockResolvedValue({
        conversationId: "fresh-chat",
        runId: "run-1",
        status: "running",
        acceptedAt: "",
      });
      mockInvokeByChannel({});
      const wrapper = mountSurface();
      await flushPromises();

      // Ordinary text is accepted and the run starts...
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "first message", []);
      await flushPromises();
      expect(startChatRunMock).toHaveBeenCalledTimes(1);

      // ...but commands are blocked while the turn runs.
      composer.vm.$emit("send", "/loop status", []);
      await flushPromises();
      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      const notice = wrapper.get('[data-testid="workspace-command-error"]');
      expect(notice.text()).toContain("Commands are unavailable");
    });
  });

  /**
   * Plan decisions (FR-PLN-003..008): validate the returned plan state
   * before starting any continuation — a null response must NEVER trigger
   * the "begin executing" turn, and a successful decision starts exactly
   * one continuation through the ordinary send path.
   */
  describe("plan decisions", () => {
    afterEach(() => {
      // vi.clearAllMocks() does not reset implementations — restore the
      // module-factory default so later tests see an empty selection.
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
    });

    const planMessage: ChatV2MessageView = {
      id: "plan-msg-1",
      conversationId: "fresh-chat",
      role: "assistant",
      content: "plan body",
      timestamp: "2026-10-11T00:00:00.000Z",
      messageType: MessageType.MESSAGE,
      metadata: {
        source: "chat-v2",
        planStateView: {
          planId: "plan-1",
          conversationId: "fresh-chat",
          title: "Campaign plan",
          objective: "Grow the newsletter",
          currentVersion: 2,
          latestVersion: {
            planId: "plan-1",
            version: 2,
            planMarkdown: "# Plan",
            createdAt: "2026-10-11T00:00:00.000Z",
            createdBy: "user",
          },
          status: "awaiting_approval",
        },
      },
    };

    async function mountWithPlan(): Promise<ReturnType<typeof mountSurface>> {
      const pinia = createPinia();
      setActivePinia(pinia);
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [planMessage],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
      startChatRunMock.mockResolvedValue({
        conversationId: "fresh-chat",
        runId: "run-plan",
        status: "running",
        acceptedAt: "",
      });
      const wrapper = mountSurface(pinia);
      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected("fresh-chat");
      // The shell owns selection loading in the real app — drive it here so
      // the store's message window (and planStateView) is populated.
      await useSelectedConversationStore().loadSelection("fresh-chat");
      await flushPromises();
      return wrapper;
    }

    it("starts exactly one execution continuation after a persisted approval (FR-PLN-006)", async () => {
      const approveMock = vi.mocked(approveChatV2Plan);
      approveMock.mockResolvedValueOnce({
        planId: "plan-1",
        currentVersion: 2,
        status: "approved",
      } as never);
      const wrapper = await mountWithPlan();

      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("approve-plan");
      // The continuation id awaits crypto.subtle.digest (macrotask) — poll,
      // don't flush microtasks, or the continuation leaks into the next test.
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(1);
      });

      expect(approveMock).toHaveBeenCalledTimes(1);
      expect(approveMock.mock.calls[0]).toEqual([
        "fresh-chat",
        "plan-1",
        2,
      ]);
      // Exactly one continuation turn, in chat mode, with the shared text.
      expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
        conversationId: "fresh-chat",
        mode: "chat",
        message: "Plan approved. Please begin executing the plan now.",
      });
    });

    it("derives the SAME continuation clientRequestId for a replayed approval (T2/D6, AD-007)", async () => {
      vi.mocked(approveChatV2Plan).mockResolvedValue({
        planId: "plan-1",
        currentVersion: 2,
        status: "approved",
      } as never);
      const wrapper = await mountWithPlan();
      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });

      // First approval. The continuation id awaits crypto.subtle.digest,
      // which resolves on a MACROTASK — drain with a poll, not microtasks.
      transcript.vm.$emit("approve-plan");
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(1);
      });
      const firstId = startChatRunMock.mock.calls[0][0].clientRequestId;
      expect(firstId).toMatch(/^plan-cont-[a-f0-9]{48}$/);

      // A REPLAY (reload + re-click on the persisted approved state, or a
      // double-fire) must resubmit the identical identity — never mint a
      // second job.
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [planMessage],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
      await useSelectedConversationStore().loadSelection("fresh-chat");
      await flushPromises();
      // loadSelection toggles `loading`, which unmounts/remounts the
      // transcript stub — re-find the LIVE instance before replaying.
      wrapper
        .findComponent({ name: "AiChatWorkspaceTranscript" })
        .vm.$emit("approve-plan");
      // Fully drain the replayed continuation BEFORE the test ends so it
      // cannot leak into the next test's assertions.
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(2);
      });
      expect(startChatRunMock.mock.calls[1][0].clientRequestId).toBe(firstId);
    });

    it("keeps the decision actionable and starts NO continuation on a null approval (FR-PLN-005)", async () => {
      vi.mocked(approveChatV2Plan).mockResolvedValueOnce(null);
      const wrapper = await mountWithPlan();

      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("approve-plan");
      await flushPromises();

      expect(approveChatV2Plan).toHaveBeenCalledTimes(1);
      expect(startChatRunMock).not.toHaveBeenCalled();
      // The safe retry error reaches the decision card through the transcript.
      expect(transcript.props("planDecisionError")).toBe(
        "Plan approval did not complete. Please try again."
      );
      // In-flight lock released — a retry is possible.
      expect(transcript.props("planDecisionInFlight")).toBe(false);
    });

    it("issues exactly one decision IPC for a double click while in flight (FR-PLN-003)", async () => {
      const approvalResolver: {
        resolve: ((value: unknown) => void) | null;
      } = { resolve: null };
      vi.mocked(approveChatV2Plan).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            approvalResolver.resolve = resolve;
          }) as never
      );

      const wrapper = await mountWithPlan();

      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("approve-plan");
      await flushPromises();
      // Second click while the first decision is still in flight.
      transcript.vm.$emit("approve-plan");
      await flushPromises();
      expect(approveChatV2Plan).toHaveBeenCalledTimes(1);

      approvalResolver.resolve?.({
        planId: "plan-1",
        currentVersion: 2,
        status: "approved",
      });
      // Drain the digest macrotask so the continuation cannot leak onward.
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  /**
   * Permission grant characterization (FR-PER-003/005, design §12.2): the
   * shared SkillApprovalCard persists the grant through its own
   * `skill:grant-permission` IPC BEFORE emitting; the surface's job is to
   * resume the parked tool exactly once. Grant-once and persistent grants
   * resume identically, and a failed resume keeps the decision actionable
   * for a retry.
   */
  describe("permission grants", () => {
    afterEach(() => {
      // Restore the global window.api stub default (undefined envelope) —
      // clearAllMocks clears calls but not implementations.
      (window.api.invoke as ReturnType<typeof vi.fn>).mockImplementation(() =>
        Promise.resolve(undefined)
      );
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
    });

    const permissionMessage: ChatV2MessageView = {
      id: "perm-msg-1",
      conversationId: "fresh-chat",
      role: "assistant",
      content: "",
      timestamp: "2026-10-11T00:00:00.000Z",
      messageType: MessageType.TOOL_RESULT,
      metadata: {
        source: "chat-v2",
        toolCallId: "tool-77",
        toolName: "run_command",
        toolResult: { needsPermissionPrompt: true },
      },
    };

    function resumeCalls(): Array<[string, unknown]> {
      return (window.api.invoke as ReturnType<typeof vi.fn>).mock.calls
        .filter((call) => call[0] === "ai-chat-v2:resume-tool-after-permission")
        .map((call) => [call[0] as string, call[1]]) as Array<[string, unknown]>;
    }

    async function mountWithPermission(): Promise<
      ReturnType<typeof mountSurface>
    > {
      const pinia = createPinia();
      setActivePinia(pinia);
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [permissionMessage],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "running",
        activeRunId: "run-perm",
        title: "Selected chat",
      } as never);
      const wrapper = mountSurface(pinia);
      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected("fresh-chat");
      await useSelectedConversationStore().loadSelection("fresh-chat");
      await flushPromises();
      return wrapper;
    }

    it("resumes the parked tool once for a grant-once choice", async () => {
      mockInvokeByChannel({
        "ai-chat-v2:resume-tool-after-permission": {
          status: true,
          data: { ok: true },
        },
      });
      const wrapper = await mountWithPermission();

      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("grant-permission", permissionMessage, {
        persistent: false,
      });
      await flushPromises();

      const calls = resumeCalls();
      expect(calls).toHaveLength(1);
      expect(JSON.parse(String(calls[0][1]))).toEqual({
        toolId: "tool-77",
        conversationId: "fresh-chat",
      });
    });

    it("resumes the parked tool once for a persistent choice (persistence already happened in-card)", async () => {
      mockInvokeByChannel({
        "ai-chat-v2:resume-tool-after-permission": {
          status: true,
          data: { ok: true },
        },
      });
      const wrapper = await mountWithPermission();

      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("grant-permission", permissionMessage, {
        persistent: true,
      });
      await flushPromises();

      // Same single resume as grant-once: the SkillApprovalCard's own
      // `skill:grant-permission` IPC owns storing the persistent grant
      // (covered by the SkillApprovalCard suites).
      expect(resumeCalls()).toHaveLength(1);
    });

    it("keeps the decision actionable and retries after a failed resume (FR-PER-005/007)", async () => {
      mockInvokeByChannel({
        "ai-chat-v2:resume-tool-after-permission": {
          status: true,
          data: { ok: false, error: "engine gone" },
        },
      });
      const wrapper = await mountWithPermission();
      const selected = useSelectedConversationStore();

      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("grant-permission", permissionMessage, {
        persistent: false,
      });
      await flushPromises();

      // Failed resume surfaces the safe error on the row (the backend's
      // user-safe message when provided, else the localized fallback).
      const row = selected.messages.find(
        (m: ChatV2MessageView) => m.id === "perm-msg-1"
      );
      expect(row?.content).toBe("engine gone");
      // T4/D1 (audit): the failed resume RESTORES the prompt metadata — the
      // rendered-card proof lives in AiChatWorkspaceTranscript.test.ts (the
      // center stubs the transcript; asserting the DOM here would be vacuous).
      expect(row?.metadata?.toolResult?.needsPermissionPrompt).toBe(true);
      expect(row?.metadata?.toolResult?.executionPending).toBe(false);
      // The in-flight guard released — a retry click resumes again.
      transcript.vm.$emit("grant-permission", permissionMessage, {
        persistent: false,
      });
      await flushPromises();
      expect(resumeCalls()).toHaveLength(2);
    });
  });

  /**
   * Per-output reporting + generated-image batch actions (FR-RPT-001/002/009,
   * FR-IMG-011/012/013): the transcript forwards report, save, stop-batch,
   * and retry-batch tile events; the center owns the dialogs and flows.
   */
  describe("report and generated-image actions", () => {
    async function mountWithSelection(): Promise<
      ReturnType<typeof mountSurface>
    > {
      const pinia = createPinia();
      setActivePinia(pinia);
      const wrapper = mountSurface(pinia);
      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected("conv-1");
      await flushPromises();
      return wrapper;
    }

    it("opens the single-output report dialog and marks the output reported (FR-RPT-002/009)", async () => {
      const wrapper = await mountWithSelection();
      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      const descriptor = {
        context: { conversationId: "conv-1", messageId: "m-report" },
        kind: "text",
      };
      transcript.vm.$emit("report", descriptor);
      await flushPromises();

      const dialog = wrapper.findComponent({ name: "AIContentReportDialog" });
      expect(dialog.exists()).toBe(true);
      expect(dialog.props("descriptor")).toEqual(descriptor);

      dialog.vm.$emit("submitted");
      await flushPromises();
      // Session-only reported set flows back to reportable tiles.
      expect(transcript.props("reportedMessageIds")?.has("m-report")).toBe(
        true
      );
    });

    it("saves a generated image to the trusted workspace (FR-IMG-013)", async () => {
      exportGeneratedImageMock.mockResolvedValue({
        status: "saved",
        fileName: "image-1.png",
      });
      const wrapper = await mountWithSelection();
      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("save-generated-image", {
        messageId: "m1",
        imageIndex: 0,
      });
      await flushPromises();

      expect(exportGeneratedImageMock).toHaveBeenCalledWith("conv-1", {
        messageId: "m1",
        imageIndex: 0,
      });
      const notice = wrapper.get('[data-testid="workspace-genimg-notice"]');
      expect(notice.text()).toContain("image-1.png");
    });

    it("routes a workspace_required save into the workspace setup flow (FR-INT-002)", async () => {
      exportGeneratedImageMock.mockResolvedValue({
        status: "workspace_required",
      });
      const wrapper = await mountWithSelection();
      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("save-generated-image", {
        messageId: "m1",
        imageIndex: 0,
      });
      await flushPromises();

      expect(
        wrapper.find('[data-testid="workspace-load-error"]').exists()
      ).toBe(false);
      const notice = wrapper.get('[data-testid="workspace-genimg-notice"]');
      expect(notice.text()).toContain("approved workspace");
      // Setup surfaced: the required card opens for the conversation.
      await flushPromises();
      expect(
        wrapper.find('[data-testid="workspace-required-stub"]').exists()
      ).toBe(true);
    });

    it("stops a running batch through the active-run cancel (FR-IMG-012)", async () => {
      const wrapper = await mountWithSelection();
      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("stop-batch");
      await flushPromises();
      // selectedStore.stopActiveRun() -> cancelChatRun IPC (module mock).
      const { cancelChatRun } = await import("@/views/api/aiChatWorkspace");
      expect(vi.mocked(cancelChatRun)).toHaveBeenCalled();
    });

    it("retries only the failed references through the trusted confirmed-batch channel (FR-IMG-011)", async () => {
      startChatRunMock.mockResolvedValue({
        conversationId: "conv-1",
        runId: "run-retry",
        status: "running",
        acceptedAt: "",
      });
      const wrapper = await mountWithSelection();
      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("retry-generated-image-batch", {
        references: [
          { messageId: "m2", imageIndex: 0 },
          { messageId: "m3", imageIndex: 1 },
        ],
        instruction: "Regenerate both logos",
      });
      await flushPromises();

      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      const payload = startChatRunMock.mock.calls[0][0];
      expect(payload.message).toBe("Regenerate both logos");
      expect(payload.confirmedGeneratedImageBatch).toEqual({
        references: [
          { messageId: "m2", imageIndex: 0 },
          { messageId: "m3", imageIndex: 1 },
        ],
      });
      // The direct reference channel stays empty for a trusted resend.
      expect(payload.generatedImageReferences).toBeUndefined();
    });
  });

  /**
   * FR-INT-002 / FR-WSP-003: a filesystem-dependent tool with no usable
   * workspace asks the composer for one — the request must reach the
   * existing workspace setup flow, and the FR-WS-007 busy gate still holds.
   */
  it("routes composer request-workspace events into the workspace setup flow (FR-INT-002)", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mountSurface(pinia);
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-ws");
    await flushPromises();

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("request-workspace");
    await flushPromises();

    expect(
      wrapper.find('[data-testid="workspace-required-stub"]').exists()
    ).toBe(true);
  });

  /**
   * Recoverable history + compaction (FR-HIS-001..005): under the rollout
   * flag the center exposes the archive drawer, per-conversation context
   * chips, opaque-reference submission, and compaction controls; with the
   * flag off, none of the surfaces mount and no references submit.
   */
  describe("recoverable history", () => {
    afterEach(() => {
      // clearAllMocks does not reset implementations — restore the
      // fail-closed default for tests after this describe.
      vi.mocked(isHistoryUiEnabled).mockResolvedValue(false);
    });

    async function mountWithHistory(
      conversation: string
    ): Promise<ReturnType<typeof mountSurface>> {
      const pinia = createPinia();
      setActivePinia(pinia);
      vi.mocked(isHistoryUiEnabled).mockResolvedValue(true);
      startChatRunMock.mockResolvedValue({
        conversationId: conversation,
        runId: "run-his",
        status: "running",
        acceptedAt: "",
      });
      const wrapper = mountSurface(pinia);
      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected(conversation);
      await flushPromises();
      return wrapper;
    }

    function emitDrawerSelect(
      wrapper: ReturnType<typeof mountSurface>,
      sourceId: string,
      text: string
    ): void {
      wrapper.findComponent({ name: "AiChatHistoryDrawer" }).vm.$emit("select", {
        sourceId,
        messageId: `msg-${sourceId}`,
        role: "user",
        timestamp: "2026-10-11T00:00:00.000Z",
        text,
        exact: true,
        redacted: false,
        hasMore: false,
      });
    }

    it("hides every history surface when the rollout flag is off (FR-HIS-001 fail-closed)", async () => {
      vi.mocked(isHistoryUiEnabled).mockResolvedValue(false);
      const pinia = createPinia();
      setActivePinia(pinia);
      const wrapper = mountSurface(pinia);
      useChatWorkspaceStore().setSelected("conv-his");
      await flushPromises();

      expect(
        wrapper.find('[data-testid="workspace-history-toggle"]').exists()
      ).toBe(false);
      expect(
        wrapper.findComponent({ name: "AiChatHistoryDrawer" }).exists()
      ).toBe(false);
      expect(
        wrapper.findComponent({ name: "AiChatSelectedContext" }).exists()
      ).toBe(false);
    });

    it("mounts the drawer toggle and drawer under the flag (FR-HIS-001)", async () => {
      const wrapper = await mountWithHistory("conv-his");
      expect(
        wrapper.get('[data-testid="workspace-history-toggle"]')
      ).toBeTruthy();
      expect(
        wrapper.findComponent({ name: "AiChatHistoryDrawer" }).props(
          "conversationId"
        )
      ).toBe("conv-his");
    });

    it("submits opaque historySelectionIds with a stable submissionId (FR-HIS-002)", async () => {
      const wrapper = await mountWithHistory("conv-his");
      emitDrawerSelect(wrapper, "src-1", "the original passage text");
      await flushPromises();

      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "summarize the selected passage", []);
      await flushPromises();

      const payload = startChatRunMock.mock.calls[0][0];
      expect(payload.historySelectionIds).toEqual(["src-1"]);
      expect(typeof payload.submissionId).toBe("string");
      expect(payload.submissionId.length).toBeGreaterThanOrEqual(8);
      // Never the passage body.
      expect(JSON.stringify(payload)).not.toContain("the original passage");
    });

    it("clears only ACCEPTED chips on the engine start ack (FR-HIS-003)", async () => {
      const wrapper = await mountWithHistory("conv-his");
      const selected = useSelectedConversationStore();
      emitDrawerSelect(wrapper, "src-accepted", "accepted passage");
      emitDrawerSelect(wrapper, "src-changed", "changed passage");
      emitDrawerSelect(wrapper, "src-rejected", "rejected passage");
      await flushPromises();

      // Engine start ack routed through the store's presenter sink.
      selected.applyDetailEvent({
        sequence: 1,
        runId: "run-his",
        conversationId: "conv-his",
        eventType: "start",
        emittedAt: "2026-10-11T00:00:00.000Z",
        payload: {
          eventType: "start",
          messageId: "a-1",
          historySelectionAcceptedIds: ["src-accepted"],
          historySelectionChangedIds: ["src-changed"],
          historySelectionRejectedIds: ["src-rejected"],
        },
      });
      await flushPromises();

      const chips = wrapper
        .findComponent({ name: "AiChatSelectedContext" })
        .props("selections") as Array<{
        sourceId: string;
        refreshed?: boolean;
        rejected?: boolean;
      }>;
      expect(chips.map((c) => c.sourceId).sort()).toEqual([
        "src-changed",
        "src-rejected",
      ]);
      expect(chips.find((c) => c.sourceId === "src-changed")?.refreshed).toBe(
        true
      );
      expect(chips.find((c) => c.sourceId === "src-rejected")?.rejected).toBe(
        true
      );
    });

    it("keeps each conversation's chip draft isolated across switches (FR-HIS-002/004)", async () => {
      const wrapper = await mountWithHistory("conv-a");
      emitDrawerSelect(wrapper, "src-a", "passage a");
      await flushPromises();

      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected("conv-b");
      await flushPromises();
      let chips = wrapper
        .findComponent({ name: "AiChatSelectedContext" })
        .props("selections") as Array<{ sourceId: string }>;
      expect(chips).toEqual([]);

      chatWorkspace.setSelected("conv-a");
      await flushPromises();
      chips = wrapper
        .findComponent({ name: "AiChatSelectedContext" })
        .props("selections") as Array<{ sourceId: string }>;
      expect(chips.map((c) => c.sourceId)).toEqual(["src-a"]);
    });

    it("surfaces compaction controls under the flag (FR-HIS-005)", async () => {
      const wrapper = await mountWithHistory("conv-his");
      const compaction = wrapper.findComponent({
        name: "AiChatCompactionStatus",
      });
      expect(compaction.exists()).toBe(true);
      expect(compaction.props("busy")).toBe(false);

      compaction.vm.$emit("cancel");
      await flushPromises();
      const { cancelCompaction } = await import("@/views/api/aiChatV2");
      expect(vi.mocked(cancelCompaction)).toHaveBeenCalledWith("conv-his");
    });
  });

  /**
   * Generated-image inference preflight (FR-IMG-005..009): deterministic
   * inference over the visible window, ambiguity chooser, and batch
   * confirmation — mirrors the Chat V2 reference flows through the shared
   * dialog components.
   */
  describe("generated-image inference", () => {
    function imageAssistantMessage(
      id: string,
      count: number
    ): ChatV2MessageView {
      return {
        id,
        conversationId: "conv-img",
        role: "assistant",
        content: "here are the logos",
        timestamp: "2026-10-11T00:00:00.000Z",
        messageType: MessageType.MESSAGE,
        metadata: {
          source: "chat-v2",
          generatedImages: Array.from({ length: count }, (_, i) => ({
            type: "image" as const,
            file_name: `logo-${i + 1}.png`,
            url: `file://logo-${i + 1}.png`,
          })),
        },
      };
    }

    async function mountWithImages(
      imageCount: number
    ): Promise<ReturnType<typeof mountSurface>> {
      const pinia = createPinia();
      setActivePinia(pinia);
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [imageAssistantMessage("m-img", imageCount)],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
      startChatRunMock.mockResolvedValue({
        conversationId: "conv-img",
        runId: "run-img",
        status: "running",
        acceptedAt: "",
      });
      const wrapper = mountSurface(pinia);
      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected("conv-img");
      await useSelectedConversationStore().loadSelection("conv-img");
      await flushPromises();
      return wrapper;
    }

    afterEach(() => {
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
    });

    it("opens the ambiguity chooser for singular wording over multiple images; nothing submits (FR-IMG-006)", async () => {
      const wrapper = await mountWithImages(3);
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "recolor the image", []);
      await flushPromises();

      expect(startChatRunMock).not.toHaveBeenCalled();
      const chooser = wrapper.findComponent({
        name: "GeneratedImageChooserDialog",
      });
      expect(chooser.exists()).toBe(true);
      expect(chooser.props("modelValue")).toBe(true);
      const candidates = chooser.props("candidates") as Array<{
        fileName?: string;
      }>;
      expect(candidates.map((c) => c.fileName)).toEqual([
        "logo-1.png",
        "logo-2.png",
        "logo-3.png",
      ]);
    });

    it("picking a candidate sends it as the sole reference (FR-IMG-006)", async () => {
      const wrapper = await mountWithImages(3);
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "recolor the image", []);
      await flushPromises();

      const chooser = wrapper.findComponent({
        name: "GeneratedImageChooserDialog",
      });
      const candidates = chooser.props("candidates") as Array<{
        reference: { messageId: string; imageIndex: number };
      }>;
      chooser.vm.$emit("select", candidates[1]);
      await flushPromises();

      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
        message: "recolor the image",
        generatedImageReferences: [{ messageId: "m-img", imageIndex: 1 }],
      });
    });

    it("numbered references above the direct limit open batch confirmation, never silent truncation (FR-IMG-008)", async () => {
      const wrapper = await mountWithImages(4);
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "sharpen image 1, image 2, image 3 and image 4", []);
      await flushPromises();

      expect(startChatRunMock).not.toHaveBeenCalled();
      const confirmDialog = wrapper.findComponent({
        name: "GeneratedImageBatchConfirmDialog",
      });
      expect(confirmDialog.exists()).toBe(true);
      expect(confirmDialog.props("count")).toBe(4);

      confirmDialog.vm.$emit("confirm");
      await flushPromises();

      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      const payload = startChatRunMock.mock.calls[0][0];
      expect(payload.message).toBe(
        "sharpen image 1, image 2, image 3 and image 4"
      );
      // Trusted channel, user-selected order preserved.
      expect(payload.confirmedGeneratedImageBatch?.references).toHaveLength(4);
      expect(payload.generatedImageReferences).toBeUndefined();
    });

    it("declining the batch confirmation sends nothing", async () => {
      const wrapper = await mountWithImages(4);
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "sharpen image 1, image 2, image 3 and image 4", []);
      await flushPromises();

      wrapper
        .findComponent({ name: "GeneratedImageBatchConfirmDialog" })
        .vm.$emit("decline");
      await flushPromises();
      expect(startChatRunMock).not.toHaveBeenCalled();
    });

    it("discards a pending chooser send when the conversation switches (FR-IMG-015)", async () => {
      const wrapper = await mountWithImages(3);
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "recolor the image", []);
      await flushPromises();

      useChatWorkspaceStore().setSelected("conv-other");
      await flushPromises();
      const chooser = wrapper.findComponent({
        name: "GeneratedImageChooserDialog",
      });
      const candidates = chooser.props("candidates") as Array<{
        reference: { messageId: string; imageIndex: number };
      }>;
      chooser.vm.$emit("select", candidates[0]);
      await flushPromises();

      // The stale pick must NOT replay into the newly selected conversation.
      expect(startChatRunMock).not.toHaveBeenCalled();
    });

    it("resolves an unambiguous numbered reference directly (FR-IMG-005)", async () => {
      const wrapper = await mountWithImages(3);
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "recolor image 2", []);
      await flushPromises();

      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
        generatedImageReferences: [{ messageId: "m-img", imageIndex: 1 }],
      });
    });
  });

  /**
   * FR-INT-003 (capability parity): a live tool result carrying a navigation
   * command routes through the trusted renderer handler exactly once for
   * the SELECTED conversation; foreign-conversation events and sequence
   * replays never navigate.
   */
  it("navigates once for a live selected-conversation navigation result and never for replays", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mountSurface(pinia);
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-nav");
    await flushPromises();
    const selected = useSelectedConversationStore();

    // Exact open_app_page navigate-result contract (success + action +
    // routeName), targeting the test router's registered workspace route.
    const navigationResult = {
      success: true,
      action: "navigate",
      routeName: "AI_Chat_Workspace",
    };
    const navEvent = (sequence: number, conversationId: string): unknown => ({
      sequence,
      runId: "run-nav",
      conversationId,
      eventType: "tool_result",
      emittedAt: "2026-10-11T00:00:00.000Z",
      payload: {
        eventType: "tool_result",
        toolCallId: "tc-nav",
        toolResult: navigationResult,
      },
    });

    const router = (wrapper.vm as unknown as { $router: RouterLike }).$router;
    const pushSpy = vi.spyOn(router, "push");
    selected.applyDetailEvent(navEvent(1, "conv-nav") as never);
    await flushPromises();
    // The trusted handler pushed the validated route exactly once.
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0][0]).toEqual({ name: "AI_Chat_Workspace" });
    pushSpy.mockClear();

    // Sequence replay of the same event must not re-navigate or throw.
    selected.applyDetailEvent(navEvent(1, "conv-nav") as never);
    await flushPromises();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  /**
   * FR-INT-004/005: the shared reasoning-visibility preference drives the
   * transcript (persisted + cross-surface change event), and the shared
   * agent-task dialog mounts from the default surface.
   */
  it("toggles reasoning visibility through the shared persisted preference (FR-INT-005)", async () => {
    localStorage.setItem("aiChatV2.showReasoning", "true");
    const wrapper = mountSurface();
    useChatWorkspaceStore().setSelected("conv-reasoning");
    await flushPromises();
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    expect(transcript.props("showReasoning")).toBe(true);

    await wrapper.get('[data-testid="toggle-reasoning"]').trigger("click");
    await flushPromises();
    expect(transcript.props("showReasoning")).toBe(false);
    expect(localStorage.getItem("aiChatV2.showReasoning")).toBe("false");

    // The cross-surface change event updates the workspace too.
    window.dispatchEvent(
      new CustomEvent("aifetchly:ai-chat-reasoning-visibility-changed", {
        detail: { visible: true },
      })
    );
    await flushPromises();
    expect(transcript.props("showReasoning")).toBe(true);
    localStorage.removeItem("aiChatV2.showReasoning");
  });

  it("mounts the shared agent-task dialog (FR-INT-004)", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "AgentTaskListDialog" }).exists()
    ).toBe(true);
  });

  /**
   * FR-REC-001..003: the run strip keeps the high-level state; the center
   * exposes transport-retry (attempt/max/bounded delay) and recovery
   * (layer/reason) detail, and both clear once real content arrives.
   */
  it("surfaces retry and recovery detail from live stream events (FR-REC-002/003)", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mountSurface(pinia);
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-rec");
    await flushPromises();
    const selected = useSelectedConversationStore();

    const detailEvent = (
      sequence: number,
      eventType: string,
      payload: Record<string, unknown>
    ): unknown => ({
      sequence,
      runId: "run-rec",
      conversationId: "conv-rec",
      eventType,
      emittedAt: "2026-10-11T00:00:00.000Z",
      payload: { eventType, ...payload },
    });

    // Transport retry: attempt 2 of 5 with a bounded delay.
    selected.applyDetailEvent(
      detailEvent(1, "retry_connect", {
        retryAttempt: 2,
        retryMaxAttempts: 5,
        retryDelayMs: 3000,
      }) as never
    );
    await flushPromises();
    const detail = wrapper.get('[data-testid="workspace-recovery-detail"]');
    expect(detail.text()).toContain("attempt 2 of 5");
    expect(detail.text()).toContain("~3s");

    // Recovery layer takes over the line once retry stops reporting.
    selected.applyDetailEvent(
      detailEvent(2, "recovery_status", {
        recoveryLayer: "fallback_model",
        recoveryReason: "primary provider rate limited",
      }) as never
    );
    await flushPromises();
    expect(wrapper.get('[data-testid="workspace-recovery-detail"]').text()).toContain(
      "Recovering via fallback_model: primary provider rate limited"
    );

    // Real content resolves both — the detail line disappears.
    selected.applyDetailEvent(
      detailEvent(3, "token", {
        messageId: "a-rec",
        contentDelta: "hello",
      }) as never
    );
    await flushPromises();
    expect(
      wrapper.find('[data-testid="workspace-recovery-detail"]').exists()
    ).toBe(false);
  });

  /**
   * Review-fix regressions (Codex P1/P2 + adversarial): continuations are
   * bound to the originating conversation; goal state hydrates from the
   * backend; staged image sends keep their submission options.
   */
  describe("review-fix regressions", () => {
    it("aborts the plan continuation when the selection changes mid-decision (Codex P1)", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const approveDeferred: {
        resolve: ((v: unknown) => void) | null;
      } = { resolve: null };
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [
          {
            id: "plan-msg-x",
            conversationId: "conv-plan-x",
            role: "assistant",
            content: "plan",
            timestamp: "2026-10-12T00:00:00.000Z",
            messageType: MessageType.MESSAGE,
            metadata: {
              source: "chat-v2",
              planStateView: {
                planId: "plan-x",
                conversationId: "conv-plan-x",
                title: "T",
                objective: "O",
                currentVersion: 1,
                latestVersion: {
                  planId: "plan-x",
                  version: 1,
                  planMarkdown: "# P",
                  createdAt: "2026-10-12T00:00:00.000Z",
                  createdBy: "user",
                },
                status: "awaiting_approval",
              },
            },
          },
        ],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
      vi.mocked(approveChatV2Plan).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            approveDeferred.resolve = resolve;
          }) as never
      );
      const wrapper = mountSurface(pinia);
      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected("conv-plan-x");
      await useSelectedConversationStore().loadSelection("conv-plan-x");
      await flushPromises();

      wrapper
        .findComponent({ name: "AiChatWorkspaceTranscript" })
        .vm.$emit("approve-plan");
      await flushPromises();
      // User switches to another conversation while the decision IPC runs.
      chatWorkspace.setSelected("conv-other");
      await flushPromises();
      approveDeferred.resolve?.({
        planId: "plan-x",
        currentVersion: 1,
        status: "approved",
      });
      await flushPromises();

      // The decision persisted for conv-plan-x, but the continuation must
      // NOT fire into the newly selected conversation.
      expect(startChatRunMock).not.toHaveBeenCalled();
      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      expect(transcript.props("planDecisionError")).toContain(
        "Selection changed"
      );
    });

    it("hydrates the persisted goal from the backend so /loop finds it after a reload (Codex P2)", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      mockInvokeByChannel({
        [AI_CHAT_V2_GOAL_GET]: {
          status: true,
          data: {
            goalId: "goal-hydrated",
            conversationId: "conv-goal",
            objective: "grow",
            status: "active",
            iterationCount: 0,
            criteria: [],
          },
        },
        [AI_CHAT_V2_GOAL_LOOP_START]: { status: true, data: {} },
      });
      const wrapper = mountSurface(pinia);
      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected("conv-goal");
      await flushPromises();

      expect(useSelectedConversationStore().goal?.goalId).toBe("goal-hydrated");

      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/loop 3", []);
      await flushPromises();
      const loopStart = (
        window.api.invoke as ReturnType<typeof vi.fn>
      ).mock.calls.find((c) => c[0] === AI_CHAT_V2_GOAL_LOOP_START);
      expect(loopStart).toBeTruthy();
      expect(JSON.parse(String(loopStart?.[1]))).toMatchObject({
        goalId: "goal-hydrated",
        maxIterations: 3,
      });
    });

    it("staged image sends keep pasted contents and acceptance through the chooser (Codex P2)", async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [
          {
            id: "m-img-2",
            conversationId: "conv-img-x",
            role: "assistant",
            content: "logos",
            timestamp: "2026-10-12T00:00:00.000Z",
            messageType: MessageType.MESSAGE,
            metadata: {
              source: "chat-v2",
              generatedImages: [
                { type: "image", file_name: "a.png", url: "file://a.png" },
                { type: "image", file_name: "b.png", url: "file://b.png" },
              ],
            },
          },
        ],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
      startChatRunMock.mockResolvedValue({
        conversationId: "conv-img-x",
        runId: "run-img-x",
        status: "running",
        acceptedAt: "",
      });
      const wrapper = mountSurface(pinia);
      const chatWorkspace = useChatWorkspaceStore();
      chatWorkspace.setSelected("conv-img-x");
      await useSelectedConversationStore().loadSelection("conv-img-x");
      await flushPromises();

      const acceptedSpy = vi.fn();
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "recolor the image", [], {
        pastedContents: { "1": "pasted body" },
        onAccepted: acceptedSpy,
      });
      await flushPromises();

      const chooser = wrapper.findComponent({
        name: "GeneratedImageChooserDialog",
      });
      expect(chooser.props("modelValue")).toBe(true);
      // The draft is NOT cleared while the dialog waits (FR-SUB-002).
      expect(acceptedSpy).not.toHaveBeenCalled();

      const candidates = chooser.props("candidates") as Array<{
        reference: { messageId: string; imageIndex: number };
      }>;
      chooser.vm.$emit("select", candidates[0]);
      await flushPromises();

      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      const payload = startChatRunMock.mock.calls[0][0];
      expect(payload.pastedContents).toEqual({ "1": "pasted body" });
      expect(payload.generatedImageReferences).toEqual([
        { messageId: "m-img-2", imageIndex: 0 },
      ]);
      expect(acceptedSpy).toHaveBeenCalledTimes(1);
    });

    afterEach(() => {
      vi.mocked(selectConversation).mockResolvedValue({
        acceptedGeneration: 1,
        messages: [],
        nextBefore: null,
        hasOlder: false,
        runtimeStatus: "idle",
        activeRunId: null,
        title: "Selected chat",
      } as never);
    });
  });

  /**
   * T7/D3 (audit): an ordinary send with attachments must not follow a
   * conversation switch that happens while files encode — the message
   * belongs to the conversation selected when the user pressed Send.
   */
  /**
   * T8/D5 (audit): a REJECTED send removes its optimistic transcript row —
   * the draft stays in the composer, so keeping the row showed the text
   * twice. The error bubble alone remains.
   */
  it("removes the optimistic transcript row when the send is rejected (T8/D5)", async () => {
    startChatRunMock.mockRejectedValue(new Error("AI features are disabled"));
    const wrapper = mountSurface();
    useChatWorkspaceStore().setSelected("conv-reject");
    await flushPromises();
    const selected = useSelectedConversationStore();

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "retry me later", []);
    await flushPromises();

    const userRows = selected.messages.filter(
      (m: ChatV2MessageView) =>
        m.role === "user" && m.content === "retry me later"
    );
    expect(userRows).toHaveLength(0);
    // The denial bubble is still visible (pre-V2 parity).
    expect(
      selected.messages.some(
        (m: ChatV2MessageView) =>
          m.role === "assistant" && m.content.includes("AI features are disabled")
      )
    ).toBe(true);
  });

  it("aborts an attachment send when the selection changes during file encoding (T7/D3)", async () => {
    const wrapper = mountSurface();
    useChatWorkspaceStore().setSelected("conv-a");
    await flushPromises();
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "see the attached note", [file]);
    // Switch mid-encode: the emit handler already suspended at the first
    // encode await, so this runs before sendMessage resolves the target.
    useChatWorkspaceStore().setSelected("conv-b");
    await flushPromises();

    expect(startChatRunMock).not.toHaveBeenCalled();
    const notice = wrapper.get('[data-testid="workspace-command-error"]');
    expect(notice.text()).toContain("Selection changed");
  });

  it("shows the workspace chooser above the composer with no conversation selected", async () => {
    const wrapper = mountSurface();
    await flushPromises();

    // Empty state — the badge (unset → Choose action) still renders and the
    // strip sits above the composer input, never hidden.
    expect(wrapper.findComponent({ name: "WorkspaceBadge" }).exists()).toBe(
      true
    );
    const strip = wrapper.get('[data-testid="chat-workspace-strip"]').element;
    const composer = wrapper.get('[data-testid="composer-stub"]').element;
    expect(
      strip.compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("creates a chat when choosing a workspace with no conversation selected", async () => {
    const wrapper = mountSurface();
    await flushPromises();

    wrapper
      .findComponent({ name: "WorkspaceBadge" })
      .vm.$emit("request-set-workspace");
    await flushPromises();

    expect(createWorkspaceConversationIdMock).toHaveBeenCalled();
    expect(useChatWorkspaceStore().selectedConversationId).toBe("fresh-chat");
  });

  it("renders the approved workspace through the shared composable", async () => {
    getWorkspaceMock.mockResolvedValue({
      id: 7,
      conversationId: "conv-1",
      rootPath: "/tmp/project",
      label: "project",
      approvalState: "approved",
    });
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    const badge = wrapper.get('[data-testid="workspace-badge-stub"]');
    expect(badge.text()).toBe("/tmp/project");
  });

  it("keeps next-message selectors below the composer textarea in DOM order", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    const textarea = wrapper.get('[data-testid="composer-textarea"]').element;
    const modeSelector = wrapper.get(
      '[data-testid="mode-selector-stub"]'
    ).element;
    const voiceToggle = wrapper.get(
      '[data-testid="voice-toggle-stub"]'
    ).element;
    expect(
      textarea.compareDocumentPosition(modeSelector) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      modeSelector.compareDocumentPosition(voiceToggle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("opens the chat inspector through the typed application inspector store", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    const inspector = useAppInspectorStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    chatWorkspace.openInspector("activity");
    await flushPromises();

    expect(inspector.target).toEqual({
      kind: "chat",
      ownerRoute: "/aiworkspace",
      conversationId: "conv-1",
      tab: "activity",
    });
    wrapper.unmount();
  });

  it("closes the inspector target when the preference clears", async () => {
    mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    const inspector = useAppInspectorStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    chatWorkspace.openInspector("artifacts");
    await flushPromises();
    expect(inspector.target?.kind).toBe("chat");

    chatWorkspace.setInspectorOpen(false);
    await flushPromises();
    expect(inspector.target).toBeNull();
  });
});

describe("AiChatCenterSurface generated-image reference drafts (legacy parity)", () => {
  /** Tray references currently bound to the composer stub, order preserved. */
  function trayReferences(wrapper: ReturnType<typeof mountSurface>): unknown[] {
    return wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .props("selectedGeneratedImages")
      .map((v: { reference: unknown }) => v.reference);
  }

  /** Select a conversation and let the surface re-render. */
  async function selectConversation(conversationId: string): Promise<void> {
    useChatWorkspaceStore().setSelected(conversationId);
    await flushPromises();
  }

  /**
   * FR-BRW-001..005: the workspace composes the shared managed-browser
   * panels (start + live session) as a compact region of the center — NOT
   * inside the inspector, so takeover/approval controls stay reachable with
   * the inspector closed.
   */
  it("renders the managed-browser region with a conversation selected, outside the inspector (FR-BRW)", async () => {
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    await flushPromises();

    const region = wrapper.get('[data-testid="workspace-browser-region"]');
    expect(
      wrapper.findComponent({ name: "ManagedBrowserStartPanel" }).exists()
    ).toBe(true);
    expect(
      wrapper.findComponent({ name: "ManagedBrowserSessionCard" }).exists()
    ).toBe(true);
    // The region sits in the center column — reachable while the inspector
    // is closed (the store defaults to closed).
    const inspector = useAppInspectorStore();
    expect(inspector.target).toBeNull();
    expect(region.element.closest(".chat-center")).not.toBeNull();
  });

  it("hides the managed-browser region when no conversation is selected", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    expect(
      wrapper.find('[data-testid="workspace-browser-region"]').exists()
    ).toBe(false);
  });

  it("toggles tray selections from use-generated-image events and forwards them as composer props", async () => {
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    await flushPromises();

    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    expect(composer.props("generatedImageReferenceLimit")).toBe(3);
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);

    // A distinct reference adds alongside.
    transcript.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 1,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 1 },
    ]);

    // The SAME reference again toggles it OFF (toggle, not a duplicate add).
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m2", imageIndex: 1 },
    ]);
  });

  it("edit-generated-image replaces the tray with exactly that image and signals composer focus", async () => {
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 0,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toHaveLength(2);

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    const signalBefore: number = composer.props("generatedImageFocusSignal");

    transcript.vm.$emit("edit-generated-image", {
      messageId: "m3",
      imageIndex: 1,
    });
    await flushPromises();

    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m3", imageIndex: 1 },
    ]);
    expect(composer.props("generatedImageFocusSignal")).toBe(signalBefore + 1);
  });

  it("applies composer tray remove/reorder/clear events to the conversation draft", async () => {
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 0,
    });
    await flushPromises();

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("remove-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m2", imageIndex: 0 },
    ]);

    // Re-add (appends), then reorder swaps the order.
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();
    composer.vm.$emit("reorder-generated-images", [
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 0 },
    ]);
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 0 },
    ]);

    composer.vm.$emit("clear-generated-images");
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([]);
  });

  it("keeps tray selections isolated per conversation across switches", async () => {
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);

    // Switching conversations shows the OTHER conversation's (empty) tray…
    useChatWorkspaceStore().setSelected("conv-2");
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([]);

    // …and building a selection there does not leak into the first.
    transcript.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 0,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m2", imageIndex: 0 },
    ]);

    // Switching back restores the first conversation's selection.
    useChatWorkspaceStore().setSelected("conv-1");
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);
  });

  /**
   * FR-IMG-008 (capability parity): explicit independent selections above
   * the direct maximum open BATCH CONFIRMATION rather than hard-blocking —
   * the pre-parity behavior aborted with a toast only. Decline aborts with
   * no run and the selection kept; fusion wording still toast-aborts.
   */
  it("opens batch confirmation for an over-limit reference send; decline keeps the selection and starts no run", async () => {
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    for (let i = 0; i < 4; i += 1) {
      transcript.vm.$emit("use-generated-image", {
        messageId: `over-${i}`,
        imageIndex: 0,
      });
    }
    await flushPromises();
    expect(trayReferences(wrapper)).toHaveLength(4);

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "hello", []);
    await flushPromises();

    // No silent truncation and no toast-abort: the user decides.
    expect(startChatRunMock).not.toHaveBeenCalled();
    const confirmDialog = wrapper.findComponent({
      name: "GeneratedImageBatchConfirmDialog",
    });
    expect(confirmDialog.props("modelValue")).toBe(true);

    confirmDialog.vm.$emit("decline");
    await flushPromises();
    // The over-limit selection is kept so the user can deselect and retry.
    expect(trayReferences(wrapper)).toHaveLength(4);
    expect(startChatRunMock).not.toHaveBeenCalled();
  });

  it("still toast-aborts fusion wording above the direct limit (FR-IMG-007)", async () => {
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    for (let i = 0; i < 4; i += 1) {
      transcript.vm.$emit("use-generated-image", {
        messageId: `over-${i}`,
        imageIndex: 0,
      });
    }
    await flushPromises();

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "combine all of these please", []);
    await flushPromises();

    expect(startChatRunMock).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="workspace-genimg-notice"]').exists()
    ).toBe(true);
    // The over-limit selection is kept so the user can deselect and retry.
    expect(trayReferences(wrapper)).toHaveLength(4);

    await wrapper
      .get('[data-testid="workspace-genimg-notice-dismiss"]')
      .trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="workspace-genimg-notice"]').exists()
    ).toBe(false);
  });

  it("sends a reference-only message with the fallback prompt and clears the draft on accepted completion", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "", []);
    await flushPromises();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
      conversationId: "conv-1",
      message: "Describe the selected image.",
      generatedImageReferences: [{ messageId: "m1", imageIndex: 0 }],
    });

    const selected = useSelectedConversationStore();
    expect(selected.streamStatus).toBe("streaming");
    // While the turn streams, the tray keeps the selection.
    expect(trayReferences(wrapper)).toHaveLength(1);

    // Terminal `complete` (presenter → "idle") clears the sent draft.
    selected.streamStatus = "idle";
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([]);
  });

  it("keeps the draft when the turn errors so the user can retry the same selection", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();

    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "edit this image", []);
    await flushPromises();
    expect(startChatRunMock).toHaveBeenCalledTimes(1);

    const selected = useSelectedConversationStore();
    selected.streamStatus = "error";
    await flushPromises();
    // Error keeps the selection (legacy parity) — no data loss on failure.
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);
  });
});

describe("AiChatCenterSurface workspace chooser states (FR-WS-002/007)", () => {
  /** Untyped stub accessor: the stub's props/emits are asserted dynamically. */
  function badgeStub(wrapper: ReturnType<typeof mountSurface>) {
    return wrapper.findComponent({ name: "WorkspaceBadge" }) as unknown as {
      props: (name: string) => unknown;
      vm: { $emit: (event: string, ...args: unknown[]) => void };
    };
  }

  it("sanitizes refresh failures and retries through the composable", async () => {
    getWorkspaceMock.mockRejectedValue(
      new Error("ENOENT: /home/robertzeng/secret-path/db.sqlite")
    );
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    const notice = wrapper.find('[data-testid="workspace-load-error"]');
    expect(notice.exists()).toBe(true);
    // Localized generic message — the raw exception never reaches the DOM.
    expect(notice.text()).toContain("Couldn't load the workspace.");
    expect(wrapper.text()).not.toContain("secret-path");
    expect(wrapper.text()).not.toContain("ENOENT");

    expect(getWorkspaceMock).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-testid="workspace-retry"]').trigger("click");
    await flushPromises();
    expect(getWorkspaceMock).toHaveBeenCalledTimes(2);
    // Still failing: the sanitized notice stays actionable.
    expect(wrapper.find('[data-testid="workspace-load-error"]').exists()).toBe(
      true
    );
  });

  it("shows an unavailable-path notice with retry when the approved root cannot be watched", async () => {
    getWorkspaceMock.mockResolvedValue({
      id: 7,
      conversationId: "conv-1",
      rootPath: "/tmp/project",
      label: "project",
      approvalState: "approved",
    });
    acquireWorkspaceWatchMock.mockResolvedValue(null); // resolver miss
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    const notice = wrapper.find('[data-testid="workspace-path-unavailable"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain(
      "Workspace folder is not accessible right now."
    );

    await wrapper.get('[data-testid="workspace-path-retry"]').trigger("click");
    await flushPromises();
    expect(getWorkspaceMock).toHaveBeenCalledTimes(2);
  });

  it("passes busy to the badge and blocks setup while a run is active (FR-WS-007)", async () => {
    getWorkspaceMock.mockResolvedValue(null);
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    const selected = useSelectedConversationStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    // Safe state: not busy, request opens the setup card.
    expect(badgeStub(wrapper).props("busy")).toBe(false);
    badgeStub(wrapper).vm.$emit("request-set-workspace");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="workspace-required-stub"]').exists()
    ).toBe(true);

    // Busy state: badge disabled and the setup gate refuses to open a second
    // flow (the already-open card from the safe state stays as-is).
    selected.streamStatus = "streaming";
    await flushPromises();
    expect(badgeStub(wrapper).props("busy")).toBe(true);
    badgeStub(wrapper).vm.$emit("request-set-workspace");
    await flushPromises();
    // No crash, no duplicate surfaces: exactly one setup card region.
    expect(
      wrapper.find('[data-testid="workspace-required-stub"]').exists()
    ).toBe(true);
  });
});

describe("AiChatCenterSurface durable drafts (FR-COMP-011)", () => {
  it("moves focus into the composer on conversation selection (PRD §19.1)", async () => {
    const wrapper = mountSurface();
    useChatWorkspaceStore().setSelected("conv-1");
    await flushPromises();
    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    // Initial selection bumped the focus signal exactly once (not on mount).
    const afterFirst: number = composer.props("generatedImageFocusSignal");
    expect(afterFirst).toBe(1);

    // Switching to another conversation bumps it again; re-asserting the
    // same conversation does not (no id change).
    useChatWorkspaceStore().setSelected("conv-2");
    await flushPromises();
    expect(composer.props("generatedImageFocusSignal")).toBe(afterFirst + 1);
    useChatWorkspaceStore().setSelected("conv-2");
    await flushPromises();
    expect(composer.props("generatedImageFocusSignal")).toBe(afterFirst + 1);
  });

  it("binds the per-conversation draft key to the composer", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    await flushPromises();
    // No conversation selected → pending sentinel key.
    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    expect(composer.props("draftKey")).toBe("__pending_conversation__");

    chatWorkspace.setSelected("conv-9");
    await flushPromises();
    expect(
      wrapper.findComponent({ name: "AiChatV2Composer" }).props("draftKey")
    ).toBe("conv-9");
  });

  it("restores the generated-image tray after the surface unmounts and remounts", async () => {
    // One pinia across both mounts — the app-scoped store outlives the route.
    const pinia = createPinia();
    const first = mountSurface(pinia);
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    first
      .findComponent({ name: "AiChatWorkspaceTranscript" })
      .vm.$emit("use-generated-image", { messageId: "m1", imageIndex: 0 });
    await flushPromises();
    const composer = first.findComponent({ name: "AiChatV2Composer" });
    expect(composer.props("selectedGeneratedImages")).toHaveLength(1);
    first.unmount();

    const second = mountSurface(pinia);
    useChatWorkspaceStore().setSelected("conv-1");
    await flushPromises();
    const restored = second.findComponent({ name: "AiChatV2Composer" });
    expect(restored.props("selectedGeneratedImages")).toHaveLength(1);
    expect(
      (
        restored.props("selectedGeneratedImages") as {
          reference: { messageId: string; imageIndex: number };
        }[]
      ).map((v) => v.reference)
    ).toEqual([{ messageId: "m1", imageIndex: 0 }]);
  });

  it("clears the composer draft through the accepted-send rule only", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    const onAccepted = vi.fn();
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "hello", [], { onAccepted });
    await flushPromises();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledTimes(1); // run accepted → draft clears
  });

  it("keeps the composer draft when the send fails (no run id)", async () => {
    startChatRunMock.mockRejectedValue(new Error("start failed"));
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    const onAccepted = vi.fn();
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "hello", [], { onAccepted });
    await flushPromises();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(onAccepted).not.toHaveBeenCalled(); // failed send keeps the draft
  });

  it("forwards recoverable voice-settings failure to the composer (FR-VOICE-005)", async () => {
    getVoiceSettingsMock.mockRejectedValue(new Error("settings ipc failed"));
    const wrapper = mountSurface();
    await flushPromises();

    expect(
      wrapper
        .findComponent({ name: "AiChatV2Composer" })
        .props("voiceSettingsUnavailable")
    ).toBe(true);

    // A later successful load clears the recoverable state.
    getVoiceSettingsMock.mockResolvedValue({
      inputMode: "disabled",
      ttsMode: "disabled",
      autoSendTranscript: false,
      sttLanguage: "auto",
      ttsLanguage: "auto",
      sttModelId: "stt",
      ttsModelId: "tts",
      ttsSpeed: 1,
      maxRecordingMs: 60000,
    });
    getVoiceStatusMock.mockResolvedValue({
      sttState: "ready",
      ttsState: "ready",
    });
    // The composable reloads on the voice-settings-changed event; drive the
    // surface's settings reload via a fresh mount instead.
    const second = mountSurface();
    await flushPromises();
    expect(
      second
        .findComponent({ name: "AiChatV2Composer" })
        .props("voiceSettingsUnavailable")
    ).toBe(false);
  });
});

describe("AiChatCenterSurface spoken-response save failure (FR-VOICE-004)", () => {
  it("shows a localized recoverable notice with retry and never renders the raw error", async () => {
    setVoiceSettingsMock.mockRejectedValue(
      new Error("sqlite:/home/robertzeng/secret.db LOCKED api_key=sk-123")
    );
    const wrapper = mountSurface();
    await flushPromises();

    expect(wrapper.find('[data-testid="voice-save-error"]').exists()).toBe(
      false
    );

    // Toggle spoken response on (settings default to disabled, runtime ready).
    wrapper
      .findComponent({ name: "AiChatVoiceOutputToggle" })
      .vm.$emit("toggle");
    await flushPromises();

    const notice = wrapper.get('[data-testid="voice-save-error"]');
    expect(notice.attributes("role")).toBe("alert");
    expect(notice.text()).toContain(
      "Couldn't save the spoken-response preference."
    );
    expect(notice.text()).toContain("Retry");
    // Sanitized: the raw exception never reaches the DOM.
    expect(wrapper.text()).not.toContain("secret");
    expect(wrapper.text()).not.toContain("sqlite");
    expect(wrapper.text()).not.toContain("sk-123");

    // Retry re-attempts the save through the composable.
    setVoiceSettingsMock.mockClear();
    setVoiceSettingsMock.mockResolvedValue({
      inputMode: "disabled",
      ttsMode: "all_assistant_messages",
      autoSendTranscript: false,
      sttLanguage: "auto",
      ttsLanguage: "auto",
      sttModelId: "stt",
      ttsModelId: "tts",
      ttsSpeed: 1,
      maxRecordingMs: 60000,
    });
    await wrapper.get('[data-testid="voice-save-retry"]').trigger("click");
    await flushPromises();
    expect(setVoiceSettingsMock).toHaveBeenCalledTimes(1);
    // A successful retry clears the recoverable failure.
    expect(wrapper.find('[data-testid="voice-save-error"]').exists()).toBe(
      false
    );
  });
});

describe("AiChatCenterSurface model availability states (PRD §13.4)", () => {
  it("distinguishes bounded loading from the actionable no-model state", async () => {
    // A settled catalog response with an EMPTY list must not spin forever.
    getOpenAIChatModelsMock.mockResolvedValue({
      data: [],
      default_model: undefined,
    });
    const wrapper = mountSurface();
    await flushPromises();

    const selector = wrapper.findComponent({ name: "AiChatV2ModelSelector" });
    expect(selector.props("loading")).toBe(false); // loading ended
    expect(selector.props("noModels")).toBe(true); // actionable empty state
  });

  it("keeps loading true only until the catalog settles with models", async () => {
    let releaseModels: (value: {
      data: unknown[];
      default_model?: string;
    }) => void = () => undefined;
    getOpenAIChatModelsMock.mockReturnValue(
      new Promise((resolve) => {
        releaseModels = resolve;
      })
    );
    const wrapper = mountSurface();
    await flushPromises();
    const selector = wrapper.findComponent({ name: "AiChatV2ModelSelector" });
    expect(selector.props("loading")).toBe(true); // bounded: request in flight
    expect(selector.props("noModels")).toBe(false);

    releaseModels({ data: [{ id: "m1" }], default_model: "m1" });
    await flushPromises();
    expect(selector.props("loading")).toBe(false);
    expect(selector.props("noModels")).toBe(false);
  });
});
