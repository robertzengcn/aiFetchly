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
import { approveChatV2Plan } from "@/views/api/aiChatV2";
import { selectConversation } from "@/views/api/aiChatWorkspace";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";
import {
  AI_CHAT_V2_GOAL_CREATE,
  AI_CHAT_V2_SCHEDULED_LOOP_CREATE,
  PROMPT_SKILL_INVOKE,
  SLASH_COMMAND_DISPATCH,
} from "@/config/channellist";

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
        command: {
          busy:
            "Commands are unavailable while this chat is running. Wait for it to finish or stop it first.",
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
        (m) => m.metadata?.source === "slash-command"
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
      await flushPromises();

      expect(approveMock).toHaveBeenCalledTimes(1);
      expect(approveMock.mock.calls[0]).toEqual([
        "fresh-chat",
        "plan-1",
        2,
      ]);
      // Exactly one continuation turn, in chat mode, with the shared text.
      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
        conversationId: "fresh-chat",
        mode: "chat",
        message: "Plan approved. Please begin executing the plan now.",
      });
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
      await flushPromises();
      // The completed decision still starts exactly one continuation.
      expect(startChatRunMock).toHaveBeenCalledTimes(1);
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
      const row = selected.messages.find((m) => m.id === "perm-msg-1");
      expect(row?.content).toBe("engine gone");
      // The in-flight guard released — a retry click resumes again.
      transcript.vm.$emit("grant-permission", permissionMessage, {
        persistent: false,
      });
      await flushPromises();
      expect(resumeCalls()).toHaveLength(2);
    });
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

  it("aborts an over-limit reference send with a dismissible notice and no run", async () => {
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
