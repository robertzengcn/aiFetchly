import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { createI18n } from "vue-i18n";

const getWorkspaceMock = vi.fn();
const revokeWorkspaceMock = vi.fn();
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
const buildUploadedAttachmentsMock = vi.fn();
const createWorkspaceConversationIdMock = vi.fn();
const startChatRunMock = vi.fn();
const exportGeneratedImageMock = vi.fn();
const recoverPlanContinuationMock = vi.fn();
// The agent-task dialog stub exposes this spy as open() so tests can assert
// the header overflow entry opens the shared task list.
const agentTaskListOpenSpy = vi.fn();

vi.mock("@/views/components/aiChatV2/aiChatV2Attachment", () => ({
  buildUploadedAttachments: (...args: unknown[]) =>
    buildUploadedAttachmentsMock(...args),
}));

vi.mock("@/views/api/workspace", () => ({
  getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  revokeWorkspace: (...args: unknown[]) => revokeWorkspaceMock(...args),
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
  // R12: main-side plan-continuation reconcile (commit-to-response gap).
  recoverChatV2PlanContinuationIntent: (...args: unknown[]) =>
    recoverPlanContinuationMock(...args),
  answerChatV2Question: vi.fn(),
  clearChatV2Conversation: vi.fn(),
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
  // A02: independent rollout adapter flags (design §23.1) — defaults keep
  // adapters on; adapter-off toggles live in dedicated adapter tests.
  fetchWorkspaceRolloutFlags: vi.fn().mockResolvedValue(null),
  setWorkspaceRolloutAdapter: vi.fn().mockResolvedValue(true),
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
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-1"),
}));

import {
  resetWorkspaceRolloutAdaptersForTest,
} from "@/views/composables/aiChatWorkspace/useWorkspaceRolloutAdapters";
import {
  fetchWorkspaceRolloutFlags,
  loadHistoryPage,
} from "@/views/api/aiChatWorkspace";
import {
  selectConversation,
  subscribeSummaryEvents,
} from "@/views/api/aiChatWorkspace";
import type { ConversationSummaryEvent } from "@/entityTypes/aiChatWorkspaceTypes";

import AiChatCenterSurface from "@/views/components/aiChatWorkspace/AiChatCenterSurface.vue";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { useComposerDraftStore } from "@/views/store/composerDrafts";
import { useHistorySelectionStore } from "@/views/store/historySelection";
import { useAppInspectorStore } from "@/views/store/appInspector";
import {
  approveChatV2Plan,
  isHistoryUiEnabled,
  clearChatV2Conversation,
  steerChatV2PendingMessage,
  subscribeChatV2PendingEvents,
} from "@/views/api/aiChatV2";
import { cancelVoiceJob } from "@/views/api/aiChatV2Voice";
import { planContinuationRequestId } from "@/views/utils/planContinuationIdentity";
import type { PlanContinuationDecision } from "@/views/utils/planContinuationIdentity";
import {
  savePlanContinuationIntent,
  markPlanContinuationDismissed,
  clearPlanContinuationIntent,
  loadPlanContinuationIntent,
} from "@/views/utils/planContinuationStore";
import type {
  ChatToolApprovalMode,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";
import type { ChatV2GeneratedImageExportResult } from "@/views/api/aiChatV2";
import { MessageType } from "@/entityTypes/commonType";
import {
  AI_CHAT_V2_GOAL_CREATE,
  AI_CHAT_V2_GOAL_GET,
  AI_CHAT_V2_GOAL_LOOP_START,
  AI_CHAT_V2_GOAL_LOOP_STOP,
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
          recoveringDetail:
            "Recovering via {layer}: {reason} (attempt {attempt} of {max})",
        },
        command: {
          clearFailed: "Could not clear this chat. Try again.",
          busy: "Commands are unavailable while this chat is running. Wait for it to finish or stop it first.",
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
        reject_failed: "Plan rejection did not complete. Please try again.",
        changes_request_failed:
          "Requesting plan changes did not complete. Please try again.",
        approved_continue_message:
          "Plan approved. Please begin executing the plan now.",
        rejected_continue_message:
          "Plan rejected. Please revise the plan based on the following feedback and resubmit for approval.",
        changes_requested_continue_message:
          "Plan changes requested. Please update the plan based on the following feedback and resubmit for approval.",
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
  props: [
    "title",
    "hasConversation",
    "inspectorOpen",
    "goalObjective",
    "loopStatus",
    "runtimeStatus",
    "recovering",
    "activeToolCount",
  ],
  emits: ["compact", "open-agent-tasks"],
  template:
    '<header data-testid="conversation-header-stub">' +
    '<button data-testid="header-compact-stub" @click="$emit(\'compact\')" />' +
    '<button data-testid="header-agent-tasks-stub" @click="$emit(\'open-agent-tasks\')" />' +
    "<slot /></header>",
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
        WorkspaceBadge: defineComponent({
          name: "WorkspaceBadge",
          props: ["workspace", "memoryCount", "loading", "busy"],
          template:
            '<div data-testid="workspace-badge-stub">{{ workspace ? workspace.rootPath || "unset" : "none" }}</div>',
        }),
        WorkspaceRequiredCard: defineComponent({
          name: "WorkspaceRequiredCard",
          props: ["conversationId"],
          emits: ["approved", "cancel"],
          template: '<div data-testid="workspace-required-stub" />',
        }),
        WorkspaceTrustCard: true,
        WorkspaceMemoryPanel: true,
        AiChatV2ModeSelector: defineComponent({
          name: "AiChatV2ModeSelector",
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: '<div data-testid="mode-selector-stub">{{ modelValue }}</div>',
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
        AiChatV2ToolApprovalModeSelector: defineComponent({
          name: "AiChatV2ToolApprovalModeSelector",
          props: ["modelValue", "disabled"],
          emits: ["update:modelValue"],
          template:
            '<div data-testid="approval-mode-selector-stub">{{ modelValue }}</div>',
        }),
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
          props: ["showActivator", "target"],
          emits: ["cancel-task"],
          setup(_, { expose }) {
            expose({ open: agentTaskListOpenSpy });
          },
          template:
            '<div data-testid="agent-task-dialog-stub" :data-show-activator="String(showActivator)" />',
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
        AIConversationReportDialog: defineComponent({
          name: "AIConversationReportDialog",
          props: ["modelValue", "snapshot"],
          emits: ["submitted", "update:modelValue"],
          template:
            '<div data-testid="conversation-report-dialog-stub" />',
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
  // R12: main reconcile defaults to "nothing recoverable" — every existing
  // selection path then keeps banner-less behavior.
  recoverPlanContinuationMock.mockResolvedValue(null);
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

  // Repair pin: the header "Compact conversation" action must route through
  // the bounded incremental coordinator (compaction-start, §13.1) — the
  // legacy ai-chat-v2:compact-conversation channel had no main-process
  // handler, so the action silently no-oped.
  it("routes the header compact action to the compaction coordinator", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    await wrapper.get('[data-testid="header-compact-stub"]').trigger("click");
    await flushPromises();

    const { startCompaction } = await import("@/views/api/aiChatV2");
    expect(vi.mocked(startCompaction)).toHaveBeenCalledWith("conv-1");
    expect(vi.mocked(startCompaction)).toHaveBeenCalledTimes(1);
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
      strip.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
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
    expect(wrapper.find('[data-testid="workspace-empty-state"]').exists()).toBe(
      true
    );

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

    it("keeps the draft when the registry rejects an unknown slash command (FR-CMD-004 P2)", async () => {
      // R8 P2: a status:false registry result is a FAILURE — the surface
      // consumed the draft (onAccepted) for a command that never ran. It
      // must retain the text exactly like the transport-failure path.
      mockInvokeByChannel({
        [SLASH_COMMAND_DISPATCH]: {
          status: true,
          data: { status: false, msg: "Unknown command" },
        },
      });
      const wrapper = mountSurface();
      await flushPromises();

      const acceptedSpy = vi.fn();
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/nope", [], { onAccepted: acceptedSpy });
      await flushPromises();

      expect(acceptedSpy).not.toHaveBeenCalled();
      // The failure receipt still renders as the local exchange.
      const selected = useSelectedConversationStore();
      const exchange = selected.messages.filter(
        (m: ChatV2MessageView) => m.metadata?.source === "slash-command"
      );
      expect(exchange).toHaveLength(1);
      expect(exchange[0].content).toBe("Unknown command");
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
        wrapper
          .findComponent({ name: "ScheduledLoopToolApprovalDialog" })
          .exists()
      ).toBe(false);
    });

    /**
     * R09-1: staging is NOT acceptance — the workspace keeps the composer
     * draft while the approval dialog is open and clears it exactly once
     * when the staged loop is durably created. Cancel/failed-confirm keep
     * the retryable draft, matching Chat V2's staging-retention semantics.
     */
    it("does not consume the draft when staging opens the approval dialog (R09-1)", async () => {
      mockInvokeByChannel({
        [AI_CHAT_V2_SCHEDULED_LOOP_CREATE]: {
          status: true,
          data: { conversationId: "fresh-chat" },
        },
      });
      const wrapper = mountSurface();
      await flushPromises();

      const acceptedSpy = vi.fn();
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/loop 10m summarize emails", [], {
        onAccepted: acceptedSpy,
      });
      await flushPromises();

      expect(
        wrapper
          .findComponent({ name: "ScheduledLoopToolApprovalDialog" })
          .exists()
      ).toBe(true);
      // Nothing persisted yet AND nothing accepted yet.
      expect(
        invokeMock().mock.calls.filter(
          (call) => call[0] === AI_CHAT_V2_SCHEDULED_LOOP_CREATE
        )
      ).toHaveLength(0);
      expect(acceptedSpy).not.toHaveBeenCalled();
    });

    it("keeps the draft retryable when the approval dialog is cancelled (R09-1)", async () => {
      const wrapper = mountSurface();
      await flushPromises();

      const acceptedSpy = vi.fn();
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/loop 10m summarize emails", [], {
        onAccepted: acceptedSpy,
      });
      await flushPromises();

      const dialog = wrapper.findComponent({
        name: "ScheduledLoopToolApprovalDialog",
      });
      expect(dialog.exists()).toBe(true);
      dialog.vm.$emit("cancel");
      await flushPromises();

      // No create, no acceptance — the user can re-send the /loop draft.
      expect(
        invokeMock().mock.calls.filter(
          (call) => call[0] === AI_CHAT_V2_SCHEDULED_LOOP_CREATE
        )
      ).toHaveLength(0);
      expect(acceptedSpy).not.toHaveBeenCalled();
    });

    it("fires the composer acceptance exactly once when the confirm durably creates the loop (R09-1)", async () => {
      mockInvokeByChannel({
        [AI_CHAT_V2_SCHEDULED_LOOP_CREATE]: {
          status: true,
          data: { conversationId: "fresh-chat" },
        },
      });
      const wrapper = mountSurface();
      await flushPromises();

      const acceptedSpy = vi.fn();
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/loop 10m summarize emails", [], {
        onAccepted: acceptedSpy,
      });
      await flushPromises();
      expect(acceptedSpy).not.toHaveBeenCalled();

      const dialog = wrapper.findComponent({
        name: "ScheduledLoopToolApprovalDialog",
      });
      dialog.vm.$emit("confirm", {
        allowedTools: [],
        autoApproveTools: false,
        allowSkills: false,
        allowMcp: false,
        allowSubagents: false,
      });
      await flushPromises();

      expect(acceptedSpy).toHaveBeenCalledTimes(1);
      expect(
        invokeMock().mock.calls.filter(
          (call) => call[0] === AI_CHAT_V2_SCHEDULED_LOOP_CREATE
        )
      ).toHaveLength(1);
    });

    it("keeps the draft when the confirm fails to create the loop (R09-1)", async () => {
      mockInvokeByChannel({
        // windowInvoke unwraps data — a null payload maps to create null.
        [AI_CHAT_V2_SCHEDULED_LOOP_CREATE]: { status: true, data: null },
      });
      const wrapper = mountSurface();
      await flushPromises();

      const acceptedSpy = vi.fn();
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "/loop 10m summarize emails", [], {
        onAccepted: acceptedSpy,
      });
      await flushPromises();

      const dialog = wrapper.findComponent({
        name: "ScheduledLoopToolApprovalDialog",
      });
      dialog.vm.$emit("confirm", {
        allowedTools: [],
        autoApproveTools: false,
        allowSkills: false,
        allowMcp: false,
        allowSubagents: false,
      });
      await flushPromises();

      // Failure never accepts — the composer draft survives for retry, and
      // the retryable failure notice is visible above the composer.
      expect(acceptedSpy).not.toHaveBeenCalled();
      expect(
        wrapper.find('[data-testid="workspace-command-error"]').exists()
      ).toBe(true);
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

    it("returns the composer selector to chat mode after a successful approval (FR-PLN-006 P2)", async () => {
      vi.mocked(approveChatV2Plan).mockResolvedValueOnce({
        planId: "plan-1",
        currentVersion: 2,
        status: "approved",
      } as never);
      const wrapper = await mountWithPlan();

      // Journey 17.3: the user flips the selector to plan mode before
      // deciding. The approval binds the decision to the selector ONLY
      // while the card is open.
      const selector = wrapper.findComponent({ name: "AiChatV2ModeSelector" });
      selector.vm.$emit("update:modelValue", "plan");
      await flushPromises();
      expect(wrapper.get('[data-testid="mode-selector-stub"]').text()).toBe(
        "plan"
      );

      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      transcript.vm.$emit("approve-plan");
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(1);
      });
      await flushPromises();

      // The continuation rode modeOverride:"chat"; the selector must ALSO
      // return to chat so the user's next manual send is not silently plan
      // mode (the audit defect: only the payload was overridden).
      expect(wrapper.get('[data-testid="mode-selector-stub"]').text()).toBe(
        "chat"
      );
    });

    it("starts exactly one execution continuation after a persisted approval (FR-PLN-006)", async () => {      const approveMock = vi.mocked(approveChatV2Plan);
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
      expect(approveMock.mock.calls[0]).toEqual(["fresh-chat", "plan-1", 2]);
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
        .map((call) => [call[0] as string, call[1]]) as Array<
        [string, unknown]
      >;
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
   * Approval-policy selection scoping (audit R04, FR-SUB-007/FR-PER-004):
   * `getChatV2ToolApprovalMode` replies are selection-generation scoped. A
   * late reply for a PREVIOUS selection — including the A→B→A revisit —
   * must never become the active policy, a pending load must never let the
   * previous policy linger (a send reads the conservative default), and a
   * failed read keeps the default instead of erroring the surface.
   */
  describe("approval-mode loads are selection scoped (audit R04)", () => {
    type ModeAccessory =
      | { reject(reason: unknown): void; resolve(value: string): void }
      | undefined;

    function deferredFor(
      id: string,
      store: Map<string, ModeAccessory>
    ): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        store.set(id, { reject, resolve });
      });
    }

    function shownMode(mounted: ReturnType<typeof mountSurface>): string {
      return mounted
        .get('[data-testid="approval-mode-selector-stub"]')
        .text()
        .trim();
    }

    function switchConversation(conversationId: string): void {
      useChatWorkspaceStore().setSelected(conversationId);
    }

    afterEach(() => {
      // Restore the api-stub default so later suites are unaffected.
      (window.api.invoke as ReturnType<typeof vi.fn>).mockImplementation(() =>
        Promise.resolve(undefined)
      );
    });

    it("ignores a late reply of a superseded load (A→B, late A reply)", async () => {
      const pending = new Map<string, ModeAccessory>();
      const calls: string[] = [];
      getToolApprovalMock.mockImplementation((id: string) => {
        calls.push(id);
        // The FIRST conversation's read hangs until the test lets it settle.
        return calls.length === 1
          ? deferredFor(calls[0], pending)
          : Promise.resolve("ask_for_approval");
      });

      const mounted = mountSurface();
      await flushPromises();

      switchConversation("conv-1");
      await flushPromises();

      switchConversation("conv-2");
      await flushPromises();
      expect(calls).toEqual(["conv-1", "conv-2"]);
      expect(shownMode(mounted)).toBe("ask_for_approval");

      // conv-1's LATE reply races in after conv-2's read settled.
      pending.get("conv-1")?.resolve("auto_approve");
      await flushPromises();

      // The stale conv-1 reply must not flip conv-2's policy.
      expect(shownMode(mounted)).toBe("ask_for_approval");
    });

    it("stale replies never win even when the conversation id matches again (A→B→A)", async () => {
      const pending = new Map<string, ModeAccessory>();
      let counter = 0;
      getToolApprovalMock.mockImplementation((_id: string) => {
        counter += 1;
        const generation = counter;
        // Every read hangs until its explicit release; releases happen in a
        // different order than the reads (the R04 trigger).
        return deferredFor(`gen-${generation}`, pending);
      });

      const mounted = mountSurface();
      await flushPromises();

      switchConversation("conv-1"); // gen-1
      await flushPromises();
      switchConversation("conv-2"); // gen-2
      await flushPromises();
      switchConversation("conv-1"); // gen-3 — same id as gen-1

      // Releasing gen-2 then gen-1 (both staged while gen-3's read is
      // pending) must not override: the later reply belongs to the CURRENT
      // generation only.
      pending.get("gen-2")?.resolve("auto_approve");
      await flushPromises();
      expect(shownMode(mounted)).toBe("ask_for_approval");
      pending.get("gen-1")?.resolve("auto_approve");
      await flushPromises();
      expect(shownMode(mounted)).toBe("ask_for_approval");

      pending.get("gen-3")?.resolve("auto_approve");
      await flushPromises();
      expect(shownMode(mounted)).toBe("auto_approve");
    });

    it("a send while a load is pending submits the conservative policy, never the previous one", async () => {
      const pending = new Map<string, ModeAccessory>();
      let counter = 0;
      getToolApprovalMock.mockImplementation((_id: string) => {
        counter += 1;
        if (counter === 1) return Promise.resolve("auto_approve");
        // conv-2's read never settles — R04's "send-before-load" case.
        return deferredFor("stuck", pending);
      });

      startChatRunMock.mockResolvedValue({
        conversationId: "conv-2",
        runId: "run-1",
        status: "running",
        acceptedAt: "",
      });
      const mounted = mountSurface();
      await flushPromises();

      switchConversation("conv-1");
      await flushPromises();
      expect(shownMode(mounted)).toBe("auto_approve");

      switchConversation("conv-2");
      await flushPromises();
      // The previous conversation's policy does not linger.
      expect(shownMode(mounted)).toBe("ask_for_approval");
      const composer = mounted.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit("send", "hello", []);
      await flushPromises();

      expect(startChatRunMock).toHaveBeenCalledTimes(1);
      const payload = startChatRunMock.mock.calls[0]?.[0] as {
        toolApprovalMode?: string;
      };
      expect(payload.toolApprovalMode).toBe("ask_for_approval");
    });

    it("a failed policy read keeps the conservative default", async () => {
      getToolApprovalMock.mockRejectedValue(new Error("policy read failed"));
      const mounted = mountSurface();
      await flushPromises();

      await switchConversation("conv-1");
      expect(shownMode(mounted)).toBe("ask_for_approval");
    });
  });

  /**
   * Per-output reporting + generated-image batch actions (FR-RPT-001/002/009,
   * FR-IMG-011/012/013): the transcript forwards report, save, stop-batch,
   * and retry-batch tile events; the center owns the dialogs and flows.
   */
  describe("report and generated-image actions", () => {
    /** R9 B04: captured for the remount-preservation test (same session). */
    let pinia: ReturnType<typeof createPinia> | null = null;
    async function mountWithSelection(): Promise<
      ReturnType<typeof mountSurface>
    > {
      pinia = createPinia();
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

    /**
     * R9 B04 (FR-RPT-009): a successful CONVERSATION report marks every
     * selected output reported — the payload is no longer discarded.
     */
    it("marks conversation-report selected outputs as reported (FR-RPT-009 B04)", async () => {
      const wrapper = await mountWithSelection();
      const transcript = wrapper.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      wrapper
        .findComponent({ name: "AIConversationReportButton" })
        .vm.$emit("open");
      await flushPromises();
      const dialog = wrapper.findComponent({
        name: "AIConversationReportDialog",
      });
      expect(dialog.exists()).toBe(true);

      dialog.vm.$emit("submitted", {
        reportId: "air_r9-0001",
        selectedMessageIds: ["output-r9"],
      });
      await flushPromises();
      expect(transcript.props("reportedMessageIds")?.has("output-r9")).toBe(
        true
      );
    });

    /**
     * R9 B04 (AD-005): the reported markers survive a center remount within
     * the session — the set lives in the session-scoped Pinia store.
     */
    it("preserves reported markers across a center remount (AD-005 B04)", async () => {
      const first = await mountWithSelection();
      first
        .findComponent({ name: "AIConversationReportButton" })
        .vm.$emit("open");
      await flushPromises();
      first.findComponent({ name: "AIConversationReportDialog" }).vm.$emit(
        "submitted",
        { reportId: "air_r9-0002", selectedMessageIds: ["m-remount"] }
      );
      await flushPromises();
      first.unmount();

      // A fresh center mount on the SAME pinia (same session).
      const second = mountSurface(pinia!);
      const transcript = second.findComponent({
        name: "AiChatWorkspaceTranscript",
      });
      expect(transcript.props("reportedMessageIds")?.has("m-remount")).toBe(
        true
      );
      // ...and never transfers markers to unrelated messages.
      expect(transcript.props("reportedMessageIds")?.has("m-other")).toBe(
        false
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

    /**
     * R08: a late image-export response belongs to the conversation the save
     * was issued in — never the currently selected chat. Outcomes (notice)
     * and follow-up UI (workspace setup) queue against that captured owner
     * and surface only when it is re-selected (FR-IMG-013/015, FR-SUB-007,
     * FR-LIF-002, FR-INT-002).
     */
    describe("late image-export outcomes after a switch (R08)", () => {
      interface DeferredExport {
        wrapper: ReturnType<typeof mountSurface>;
        chatWorkspace: ReturnType<typeof useChatWorkspaceStore>;
        resolveExport: (result: ChatV2GeneratedImageExportResult) => void;
        rejectExport: (reason?: unknown) => void;
      }

      async function mountWithHangingExport(): Promise<DeferredExport> {
        const pinia = createPinia();
        setActivePinia(pinia);
        const wrapper = mountSurface(pinia);
        const chatWorkspace = useChatWorkspaceStore();
        chatWorkspace.setSelected("conv-a");
        await flushPromises();

        let resolveExport!: (result: ChatV2GeneratedImageExportResult) => void;
        let rejectExport!: (reason?: unknown) => void;
        exportGeneratedImageMock.mockReturnValue(
          new Promise<ChatV2GeneratedImageExportResult>((resolve, reject) => {
            resolveExport = resolve;
            rejectExport = reject;
          })
        );
        const transcript = wrapper.findComponent({
          name: "AiChatWorkspaceTranscript",
        });
        transcript.vm.$emit("save-generated-image", {
          messageId: "m1",
          imageIndex: 0,
        });
        await flushPromises();
        // The export stays addressed to the issuing chat.
        expect(exportGeneratedImageMock).toHaveBeenCalledTimes(1);
        expect(exportGeneratedImageMock).toHaveBeenCalledWith("conv-a", {
          messageId: "m1",
          imageIndex: 0,
        });

        // Switch away while the export hangs: chat B owns none of it.
        chatWorkspace.setSelected("conv-b");
        await flushPromises();
        return { wrapper, chatWorkspace, resolveExport, rejectExport };
      }

      it("surfaces a delayed saved outcome only after re-selecting the exporting chat", async () => {
        const { wrapper, chatWorkspace, resolveExport } =
          await mountWithHangingExport();

        resolveExport({ status: "exported", fileName: "late-image.png" });
        await flushPromises();
        // While chat B is selected it receives no foreign outcome.
        expect(
          wrapper.find('[data-testid="workspace-genimg-notice"]').exists()
        ).toBe(false);
        expect(
          wrapper.find('[data-testid="workspace-required-stub"]').exists()
        ).toBe(false);

        chatWorkspace.setSelected("conv-a");
        await flushPromises();
        const notice = wrapper.get('[data-testid="workspace-genimg-notice"]');
        expect(notice.text()).toContain("late-image.png");
        // Delivered exactly once — a success never retries the export.
        expect(exportGeneratedImageMock).toHaveBeenCalledTimes(1);
      });

      it("defers the workspace_required setup into the exporting chat and completes once there", async () => {
        const { wrapper, chatWorkspace, resolveExport } =
          await mountWithHangingExport();

        resolveExport({ status: "workspace_required" });
        await flushPromises();
        // B opens no setup card for chat A's pending export and shows no
        // foreign notice.
        expect(
          wrapper.find('[data-testid="workspace-required-stub"]').exists()
        ).toBe(false);
        expect(
          wrapper.find('[data-testid="workspace-genimg-notice"]').exists()
        ).toBe(false);

        // Returning to the exporting chat: its queued outcome surfaces and
        // the setup card opens for THIS conversation.
        chatWorkspace.setSelected("conv-a");
        await flushPromises();
        expect(
          wrapper.get('[data-testid="workspace-genimg-notice"]').text()
        ).toContain("approved workspace");
        expect(
          wrapper.find('[data-testid="workspace-required-stub"]').exists()
        ).toBe(true);
        // Still queued behind the (missing) workspace — no auto retry yet.
        expect(exportGeneratedImageMock).toHaveBeenCalledTimes(1);

        // Approving a workspace through the card drains the queued export
        // exactly once and reports the saved outcome back to this chat.
        exportGeneratedImageMock.mockResolvedValue({
          status: "exported",
          fileName: "late-image.png",
        });
        wrapper
          .findComponent({ name: "WorkspaceRequiredCard" })
          .vm.$emit("approved", 7, "/tmp/ws");
        await flushPromises();
        expect(exportGeneratedImageMock).toHaveBeenNthCalledWith(2, "conv-a", {
          messageId: "m1",
          imageIndex: 0,
        });
        expect(
          wrapper.get('[data-testid="workspace-genimg-notice"]').text()
        ).toContain("late-image.png");
      });

      it("shows a late failure notice only inside the exporting chat", async () => {
        const { wrapper, chatWorkspace, rejectExport } =
          await mountWithHangingExport();

        rejectExport(new Error("workspace went away"));
        await flushPromises();
        // While chat B is selected it receives no foreign failure.
        expect(
          wrapper.find('[data-testid="workspace-genimg-notice"]').exists()
        ).toBe(false);
        expect(
          wrapper.find('[data-testid="workspace-required-stub"]').exists()
        ).toBe(false);

        chatWorkspace.setSelected("conv-a");
        await flushPromises();
        const notice = wrapper.get('[data-testid="workspace-genimg-notice"]');
        expect(notice.text()).toContain("Could not save to workspace");
        expect(notice.text()).toContain("workspace went away");
        // A caught failure does not retry the export.
        expect(exportGeneratedImageMock).toHaveBeenCalledTimes(1);
      });
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
      wrapper
        .findComponent({ name: "AiChatHistoryDrawer" })
        .vm.$emit("select", {
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
        wrapper
          .findComponent({ name: "AiChatHistoryDrawer" })
          .props("conversationId")
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

      // Retry/manual compact routes through the bounded coordinator's
      // compaction-start (§13.1) — the legacy ai-chat-v2:compact-conversation
      // channel had no handler and silently no-oped (B05/G02 repair).
      compaction.vm.$emit("retry");
      await flushPromises();
      const { startCompaction } = await import("@/views/api/aiChatV2");
      expect(vi.mocked(startCompaction)).toHaveBeenCalledWith("conv-his");

      compaction.vm.$emit("cancel");
      await flushPromises();
      const { cancelCompaction } = await import("@/views/api/aiChatV2");
      expect(vi.mocked(cancelCompaction)).toHaveBeenCalledWith("conv-his");
    });

    /**
     * R06: route remount restoration. Leaving the chat center unmounts the
     * surface while the app-scoped pinia (and its conversation-keyed
     * history draft) survives; the return mount starts with the conversation
     * ALREADY selected, so it never observes the id transition a
     * non-immediate watcher keys on. The chips must restore at setup from
     * the store draft — invisible chips would also omit the restored
     * references from the next send.
     */
    describe("route remount restoration (R06)", () => {
      async function mountForRemount(conversation: string): Promise<{
        wrapper: ReturnType<typeof mountSurface>;
        pinia: ReturnType<typeof createPinia>;
      }> {
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
        useChatWorkspaceStore().setSelected(conversation);
        await flushPromises();
        return { wrapper, pinia };
      }

      function chipSourceIds(
        wrapper: ReturnType<typeof mountSurface>
      ): string[] {
        const chips = wrapper
          .findComponent({ name: "AiChatSelectedContext" })
          .props("selections") as Array<{ sourceId: string }>;
        return chips.map((c) => c.sourceId);
      }

      it("restores the store's chips when remounting with the conversation already selected", async () => {
        const { wrapper, pinia } = await mountForRemount("conv-rem");
        emitDrawerSelect(wrapper, "src-r1", "restored passage one");
        emitDrawerSelect(wrapper, "src-r2", "restored passage two");
        await flushPromises();
        wrapper.unmount();

        // Route back: fresh mount, same app-scoped pinia, same selection.
        const remounted = mountSurface(pinia);
        await flushPromises();
        expect(chipSourceIds(remounted)).toEqual(["src-r1", "src-r2"]);
      });

      it("submits restored chips with opaque ids and the unchanged submission identity", async () => {
        const { wrapper, pinia } = await mountForRemount("conv-rem");
        emitDrawerSelect(wrapper, "src-r1", "restored passage one");
        await flushPromises();
        const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
        composer.vm.$emit("send", "summarize the passage", []);
        await flushPromises();
        const firstPayload = startChatRunMock.mock.calls[0][0];
        expect(firstPayload.historySelectionIds).toEqual(["src-r1"]);

        wrapper.unmount();
        const remounted = mountSurface(pinia);
        await flushPromises();
        // Pre-fix the working copy starts empty on remount: the chips are
        // invisible AND the next send omits them entirely.
        expect(chipSourceIds(remounted)).toEqual(["src-r1"]);

        const composerAgain = remounted.findComponent({
          name: "AiChatV2Composer",
        });
        composerAgain.vm.$emit("send", "summarize the passage again", []);
        await flushPromises();
        const secondPayload = startChatRunMock.mock.calls[1][0];
        expect(secondPayload.historySelectionIds).toEqual(["src-r1"]);
        // Unchanged retry identity: the remount neither mints nor rotates.
        expect(secondPayload.submissionId).toBe(firstPayload.submissionId);
        // Opaque references only — never the passage body.
        expect(JSON.stringify(secondPayload)).not.toContain("restored passage");
      });

      it("still removes only accepted chips from the restored draft on a mixed ack", async () => {
        const { wrapper, pinia } = await mountForRemount("conv-rem");
        emitDrawerSelect(wrapper, "src-accepted", "accepted passage");
        emitDrawerSelect(wrapper, "src-changed", "changed passage");
        emitDrawerSelect(wrapper, "src-rejected", "rejected passage");
        await flushPromises();
        wrapper.unmount();

        const remounted = mountSurface(pinia);
        await flushPromises();
        expect(chipSourceIds(remounted)).toHaveLength(3);

        useSelectedConversationStore().applyDetailEvent({
          sequence: 1,
          runId: "run-his",
          conversationId: "conv-rem",
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

        const chips = remounted
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
        // The store draft reconciles with the ack for the NEXT remount.
        expect(
          useHistorySelectionStore()
            .getItems("conv-rem")
            .map((i) => i.sourceId)
            .sort()
        ).toEqual(["src-changed", "src-rejected"]);
      });
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
      composer.vm.$emit(
        "send",
        "sharpen image 1, image 2, image 3 and image 4",
        []
      );
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
      composer.vm.$emit(
        "send",
        "sharpen image 1, image 2, image 3 and image 4",
        []
      );
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

    it("discards a pending batch confirm when the conversation switched before the confirm (FR-IMG-015 P1-2)", async () => {
      const wrapper = await mountWithImages(4);
      const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
      composer.vm.$emit(
        "send",
        "sharpen image 1, image 2, image 3 and image 4",
        []
      );
      await flushPromises();
      const confirmDialog = wrapper.findComponent({
        name: "GeneratedImageBatchConfirmDialog",
      });
      expect(confirmDialog.exists()).toBe(true);

      // Switch to another chat and confirm in the SAME synchronous window —
      // the selection watcher flushes on the next tick, which is exactly the
      // race a real confirm click can hit. The confirm must behave like the
      // ambiguity chooser's stale pick: nothing submits into the NEW chat.
      useChatWorkspaceStore().setSelected("conv-other");
      confirmDialog.vm.$emit("confirm");
      await flushPromises();

      // B's queue is untouched and B's image tray stays empty.
      expect(startChatRunMock).not.toHaveBeenCalled();
      const composerStub = wrapper.findComponent({ name: "AiChatV2Composer" });
      const tray = composerStub.props(
        "selectedGeneratedImages"
      ) as unknown[];
      expect(tray).toEqual([]);
      wrapper.unmount();
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
   * agent-task dialog mounts from the default surface. The in-chat
   * "Hide reasoning" button was removed — visibility is controlled from
   * AI provider settings, so the surface only follows the shared
   * preference and its cross-surface change event.
   */
  it("follows the shared persisted reasoning preference without an in-chat toggle (FR-INT-005)", async () => {
    localStorage.setItem("aiChatV2.showReasoning", "true");
    const wrapper = mountSurface();
    useChatWorkspaceStore().setSelected("conv-reasoning");
    await flushPromises();
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    expect(transcript.props("showReasoning")).toBe(true);
    // The in-chat "Hide reasoning" toggle button is gone.
    expect(wrapper.find('[data-testid="toggle-reasoning"]').exists()).toBe(
      false
    );

    // The cross-surface change event (e.g. from AI provider settings)
    // updates the workspace too.
    window.dispatchEvent(
      new CustomEvent("aifetchly:ai-chat-reasoning-visibility-changed", {
        detail: { visible: false },
      })
    );
    await flushPromises();
    expect(transcript.props("showReasoning")).toBe(false);
    localStorage.removeItem("aiChatV2.showReasoning");
  });

  it("mounts the shared agent-task dialog without the bottom activator (FR-INT-004)", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    const dialog = wrapper.findComponent({ name: "AgentTaskListDialog" });
    expect(dialog.exists()).toBe(true);
    // The old bottom-left icon activator is gone on this surface: the task
    // list opens from the header overflow entry, anchored to the "..." menu.
    expect(dialog.attributes("data-show-activator")).toBe("false");
  });

  it("opens the agent-task list from the header overflow entry (FR-INT-004)", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    await wrapper
      .find('[data-testid="header-agent-tasks-stub"]')
      .trigger("click");
    await flushPromises();
    expect(agentTaskListOpenSpy).toHaveBeenCalledTimes(1);
  });

  it("cancels EXACTLY the emitted agent task through the agent-runtime channel (T5/D7)", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    wrapper
      .findComponent({ name: "AgentTaskListDialog" })
      .vm.$emit("cancel-task", "agt-cancel-1");
    await flushPromises();

    const cancelCall = (
      window.api.invoke as ReturnType<typeof vi.fn>
    ).mock.calls.find((c) => c[0] === "agent-runtime:task-cancel");
    expect(cancelCall).toBeTruthy();
    expect(JSON.parse(String(cancelCall?.[1]))).toEqual({
      agentTaskId: "agt-cancel-1",
    });
    // The conversation run was NOT cancelled (no cancelChatRun IPC).
    const { cancelChatRun } = await import("@/views/api/aiChatWorkspace");
    expect(vi.mocked(cancelChatRun)).not.toHaveBeenCalled();
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
    expect(
      wrapper.get('[data-testid="workspace-recovery-detail"]').text()
    ).toContain("Recovering via fallback_model: primary provider rate limited");

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
   * R8 P2-8 (FR-REC-003): recovery shows attempt/max and the safe message,
   * and retry + recovery render together when both are live.
   */
  it("shows the recovery attempt and safe message, with retry staying visible (FR-REC-003 P2)", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mountSurface(pinia);
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-rec2");
    await flushPromises();
    const selected = useSelectedConversationStore();

    const detailEvent = (
      sequence: number,
      eventType: string,
      payload: Record<string, unknown>
    ): unknown => ({
      sequence,
      runId: "run-rec2",
      conversationId: "conv-rec2",
      eventType,
      emittedAt: "2026-10-11T00:00:00.000Z",
      payload: { eventType, ...payload },
    });

    // Transport retry is live…
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

    // …and the recovery layer reports the same window plus a safe message:
    // both must render together, with the attempt AND message on the line.
    selected.applyDetailEvent(
      detailEvent(2, "recovery_status", {
        recoveryLayer: "reactive_compact",
        recoveryReason: "context_overflow",
        recoveryAttempt: 2,
        recoveryMaxAttempts: 5,
        recoveryMessage: "Compaction keeps history within the context window.",
      }) as never
    );
    await flushPromises();
    const combined = wrapper.get('[data-testid="workspace-recovery-detail"]');
    expect(combined.text()).toContain("Reconnecting… attempt 2 of 5");
    expect(combined.text()).toContain("Recovering via reactive_compact");
    expect(combined.text()).toContain("(attempt 2 of 5)");
    expect(combined.text()).toContain(
      "Compaction keeps history within the context window."
    );
  });

  /**
   * R8 P2-8 (FR-REC-004): the transcript banner maps stable error codes the
   * same way Chat V2 does — sentinels (quota/auth/image-edit) and a bare
   * context-window sentinel become localized copy, never raw codes.
   */
  it("maps stable error codes on the transcript banner (FR-REC-004 P2)", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mountSurface(pinia);
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-code");
    await flushPromises();
    const selected = useSelectedConversationStore();

    const detailEvent = (
      sequence: number,
      eventType: string,
      payload: Record<string, unknown>
    ): unknown => ({
      sequence,
      runId: "run-code",
      conversationId: "conv-code",
      eventType,
      emittedAt: "2026-10-11T00:00:00.000Z",
      payload: { eventType, ...payload },
    });

    // Quota sentinel → localized recharge copy (surface→transcript input).
    selected.applyDetailEvent(
      detailEvent(1, "error", { errorMessage: "QUOTA_EXHAUSTED" }) as never
    );
    await flushPromises();
    const stub = wrapper.get('[data-testid="transcript-stub"]');
    const quotaText = String(stub.attributes("error-message"));
    expect(quotaText).not.toContain("QUOTA_EXHAUSTED");
    expect(quotaText).toContain("recharge your account");

    // Context-window sentinel → localized actionable copy.
    selected.applyDetailEvent(
      detailEvent(
        2,
        "error",
        { errorMessage: "CONTEXT_WINDOW_EXCEEDED" }
      ) as never
    );
    await flushPromises();
    const ctxText = String(
      wrapper.get('[data-testid="transcript-stub"]').attributes("error-message")
    );
    expect(ctxText).not.toContain("CONTEXT_WINDOW_EXCEEDED");
    expect(ctxText).toContain("too long for the model's context window");

    // Prefix-less prose passes through byte-identical (unknown fallback).
    selected.applyDetailEvent(
      detailEvent(3, "error", { errorMessage: "something custom" }) as never
    );
    await flushPromises();
    const rawText = String(
      wrapper.get('[data-testid="transcript-stub"]').attributes("error-message")
    );
    expect(rawText).toContain("something custom");
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
   * R12 (FR-PLN-005..008): plan-continuation commit-to-response crash
   * recovery. A decision that committed in main but whose follow-up send
   * never landed must resurface through main's reconcile when nothing was
   * renderer-saved, keep localStorage intents authoritative, and never
   * resurrect a banner the user dismissed (identity-scoped tombstones).
   */
  describe("plan continuation recovery (R12)", () => {
    const savedPlanMessage: ChatV2MessageView = {
      id: "plan-msg-x",
      conversationId: "conv-rec",
      role: "assistant",
      content: "plan",
      timestamp: "2026-10-12T00:00:00.000Z",
      messageType: MessageType.MESSAGE,
      metadata: {
        source: "chat-v2",
        planStateView: {
          planId: "plan-rec",
          conversationId: "conv-rec",
          title: "T",
          objective: "O",
          currentVersion: 2,
          latestVersion: {
            planId: "plan-rec",
            version: 2,
            planMarkdown: "# P",
            createdAt: "2026-10-12T00:00:00.000Z",
            createdBy: "user",
          },
          status: "awaiting_approval",
        },
      },
    };

    async function mountOnConv(
      conversationId: string
    ): Promise<ReturnType<typeof mountSurface>> {
      const pinia = createPinia();
      setActivePinia(pinia);
      const wrapper = mountSurface(pinia);
      useChatWorkspaceStore().setSelected(conversationId);
      await flushPromises();
      return wrapper;
    }

    it("resurfaces a main-recovered intent and retries it with the deterministic identity", async () => {
      const expectedId = await planContinuationRequestId(
        "plan-rec",
        2,
        "approve-plan" as PlanContinuationDecision
      );
      recoverPlanContinuationMock.mockResolvedValue({
        conversationId: "conv-rec",
        planId: "plan-rec",
        version: 2,
        action: "approve-plan",
        feedback: "",
        clientRequestId: expectedId,
        decidedAt: "2026-10-17T00:00:00.000Z",
      });
      const wrapper = await mountOnConv("conv-rec");
      await flushPromises();

      const banner = wrapper.find(
        '[data-testid="workspace-plan-continuation-banner"]'
      );
      expect(banner.exists()).toBe(true);

      startChatRunMock.mockResolvedValue({
        conversationId: "conv-rec",
        runId: "run-rec",
        status: "running",
        acceptedAt: "",
      });
      await wrapper
        .get('[data-testid="workspace-plan-continuation-retry"]')
        .trigger("click");
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(1);
      });
      expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
        conversationId: "conv-rec",
        mode: "chat",
        message: "Plan approved. Please begin executing the plan now.",
        clientRequestId: expectedId,
      });
      // Acceptance clears the durable renderer state...
      expect(loadPlanContinuationIntent("conv-rec")).toBeNull();
      await flushPromises();
      // ...and the banner.
      expect(
        wrapper
          .find('[data-testid="workspace-plan-continuation-banner"]')
          .exists()
      ).toBe(false);
    });

    it("returns the selector to chat mode after a successful continuation retry (FR-PLN-006 B03)", async () => {
      recoverPlanContinuationMock.mockResolvedValue({
        conversationId: "conv-rec",
        planId: "plan-rec",
        version: 2,
        action: "approve-plan",
        feedback: "",
        clientRequestId: "plan-rec-retry",
        decidedAt: "2026-10-17T00:00:00.000Z",
      });
      const wrapper = await mountOnConv("conv-rec");
      await flushPromises();

      // The user flips the selector to plan mode before retrying the saved
      // continuation.
      const selector = wrapper.findComponent({ name: "AiChatV2ModeSelector" });
      selector.vm.$emit("update:modelValue", "plan");
      await flushPromises();
      expect(wrapper.get('[data-testid="mode-selector-stub"]').text()).toBe(
        "plan"
      );

      startChatRunMock.mockResolvedValue({
        conversationId: "conv-rec",
        runId: "run-rec",
        status: "running",
        acceptedAt: "",
      });
      await wrapper
        .get('[data-testid="workspace-plan-continuation-retry"]')
        .trigger("click");
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(1);
      });
      await flushPromises();

      // The retried continuation rode modeOverride:"chat" (the request is
      // correct) AND the visible selector must return to chat mode too —
      // the next manual send must not silently run in plan mode.
      expect(startChatRunMock.mock.calls[0][0].mode).toBe("chat");
      expect(wrapper.get('[data-testid="mode-selector-stub"]').text()).toBe(
        "chat"
      );
    });

    it("preserves recovered rejected/changes feedback in the retry message", async () => {
      const expectedId = await planContinuationRequestId(
        "plan-rec",
        2,
        "reject-plan" as PlanContinuationDecision
      );
      recoverPlanContinuationMock.mockResolvedValue({
        conversationId: "conv-rec",
        planId: "plan-rec",
        version: 2,
        action: "reject-plan",
        feedback: "Too vague",
        clientRequestId: expectedId,
        decidedAt: "2026-10-17T00:00:00.000Z",
      });
      const wrapper = await mountOnConv("conv-rec");
      await flushPromises();
      expect(
        wrapper
          .find('[data-testid="workspace-plan-continuation-banner"]')
          .exists()
      ).toBe(true);

      startChatRunMock.mockResolvedValue({
        conversationId: "conv-rec",
        runId: "run-rec",
        status: "running",
        acceptedAt: "",
      });
      await wrapper
        .get('[data-testid="workspace-plan-continuation-retry"]')
        .trigger("click");
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(1);
      });
      expect(startChatRunMock.mock.calls[0][0].message).toBe(
        "Plan rejected. Please revise the plan based on the following feedback and resubmit for approval.\n\nFeedback: Too vague"
      );
      expect(startChatRunMock.mock.calls[0][0].clientRequestId).toBe(
        expectedId
      );
    });

    it("renderer-saved intents stay authoritative over main reconcile", async () => {
      const savedId = await planContinuationRequestId(
        "plan-rec",
        2,
        "request-plan-changes" as PlanContinuationDecision
      );
      savePlanContinuationIntent({
        conversationId: "conv-rec",
        planId: "plan-rec",
        version: 2,
        action: "request-plan-changes",
        feedback: "From localStorage",
        savedAt: "2026-10-17T00:00:00.000Z",
      });
      // Main contradicting the renderer must never override the saved intent.
      recoverPlanContinuationMock.mockResolvedValue({
        conversationId: "conv-rec",
        planId: "plan-rec",
        version: 2,
        action: "approve-plan",
        feedback: "",
        clientRequestId: "plan-cont-contradicting",
        decidedAt: "2026-10-17T00:00:00.000Z",
      });
      const wrapper = await mountOnConv("conv-rec");
      await flushPromises();
      expect(recoverPlanContinuationMock).not.toHaveBeenCalled();

      startChatRunMock.mockResolvedValue({
        conversationId: "conv-rec",
        runId: "run-rec",
        status: "running",
        acceptedAt: "",
      });
      await wrapper
        .get('[data-testid="workspace-plan-continuation-retry"]')
        .trigger("click");
      await vi.waitFor(() => {
        expect(startChatRunMock).toHaveBeenCalledTimes(1);
      });
      expect(startChatRunMock.mock.calls[0][0].message).toContain(
        "Feedback: From localStorage"
      );
      expect(startChatRunMock.mock.calls[0][0].clientRequestId).toBe(savedId);
      // Acceptance also cleared the (unused) recovery state.
      expect(recoverPlanContinuationMock).not.toHaveBeenCalled();
    });

    it("keeps a dismissed recovered continuation dismissed for its exact identity", async () => {
      const recovered = {
        conversationId: "conv-rec",
        planId: "plan-rec",
        version: 2,
        action: "approve-plan" as const,
        feedback: "",
        clientRequestId: await planContinuationRequestId(
          "plan-rec",
          2,
          "approve-plan" as PlanContinuationDecision
        ),
        decidedAt: "2026-10-17T00:00:00.000Z",
      };
      // Main is conversation-scoped: it reconciles the id you asked about.
      recoverPlanContinuationMock.mockImplementation(async (cid: unknown) =>
        cid === "conv-rec" ? recovered : null
      );
      const wrapper = await mountOnConv("conv-rec");
      await flushPromises();
      const bannerSel = '[data-testid="workspace-plan-continuation-banner"]';
      expect(wrapper.find(bannerSel).exists()).toBe(true);

      await wrapper
        .get('[data-testid="workspace-plan-continuation-dismiss"]')
        .trigger("click");
      await flushPromises();
      expect(wrapper.find(bannerSel).exists()).toBe(false);

      // Reselecting (leave + return) re-runs main's reconcile — main is
      // stateless and still reports the recoverable identity, but the
      // tombstone keeps the banner hidden.
      useChatWorkspaceStore().setSelected("conv-other");
      await flushPromises();
      useChatWorkspaceStore().setSelected("conv-rec");
      await flushPromises();
      // Every selection asks main once (cheap read): leave + return.
      expect(recoverPlanContinuationMock).toHaveBeenCalledTimes(3);
      const replyIds = recoverPlanContinuationMock.mock.calls.map((c) => c[0]);
      expect(replyIds.slice(-2)).toEqual(["conv-other", "conv-rec"]);
      expect(wrapper.find(bannerSel).exists()).toBe(false);
      expect(startChatRunMock).not.toHaveBeenCalled();
    });

    it("does not resurface an already-accepted continuation (main null reconcile)", async () => {
      // Nothing saved, nothing recoverable: the banner must never appear
      // and no continuation send may be triggered by selection alone.
      const wrapper = await mountOnConv("conv-rec");
      await flushPromises();
      expect(recoverPlanContinuationMock).toHaveBeenCalledTimes(1);
      expect(
        wrapper
          .find('[data-testid="workspace-plan-continuation-banner"]')
          .exists()
      ).toBe(false);
      expect(startChatRunMock).not.toHaveBeenCalled();
    });

    it("drops a recovered banner once main reports the continuation accepted", async () => {
      const recovered = {
        conversationId: "conv-rec",
        planId: "plan-rec",
        version: 2,
        action: "approve-plan" as const,
        feedback: "",
        clientRequestId: await planContinuationRequestId(
          "plan-rec",
          2,
          "approve-plan" as PlanContinuationDecision
        ),
        decidedAt: "2026-10-17T00:00:00.000Z",
      };
      recoverPlanContinuationMock.mockImplementation(async (cid: unknown) =>
        cid === "conv-rec" ? recovered : null
      );
      const wrapper = await mountOnConv("conv-rec");
      await flushPromises();
      const bannerSel = '[data-testid="workspace-plan-continuation-banner"]';
      expect(wrapper.find(bannerSel).exists()).toBe(true);

      // The queue accepted the continuation (queue dispatch / retry from
      // elsewhere). Re-selecting asks main again — accepted rows (ANY
      // status) make the reconcile return null and the banner goes away.
      recoverPlanContinuationMock.mockResolvedValue(null);
      useChatWorkspaceStore().setSelected("conv-other");
      await flushPromises();
      useChatWorkspaceStore().setSelected("conv-rec");
      await flushPromises();
      expect(wrapper.find(bannerSel).exists()).toBe(false);
    });

    afterEach(async () => {
      clearPlanContinuationIntent("conv-rec");
      // Drain an in-flight adopt so it cannot leak into the next test.
      await flushPromises();
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
          m.role === "assistant" &&
          m.content.includes("AI features are disabled")
      )
    ).toBe(true);
  });

  it("aborts an attachment send when the selection changes during file encoding (T7/D3, B08)", async () => {
    const wrapper = mountSurface();
    useChatWorkspaceStore().setSelected("conv-a");
    await flushPromises();
    const file = new File(["hello"], "note.pdf", { type: "application/pdf" });
    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "see the attached note", [file]);
    // Switch mid-encode: the emit handler already suspended at the first
    // encode await, so this runs before sendMessage resolves the target.
    useChatWorkspaceStore().setSelected("conv-b");
    await flushPromises();

    expect(startChatRunMock).not.toHaveBeenCalled();
    // B08: the switched conversation shows NO stale notice; the abort
    // feedback is retained under the origin (A) and revealed on return.
    expect(wrapper.find('[data-testid="workspace-command-error"]').exists()).toBe(
      false
    );
    useChatWorkspaceStore().setSelected("conv-a");
    await flushPromises();
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
      strip.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
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

  it("opens the shared memory overlay through the store flag (FR-WSP-007 R8 P2)", async () => {
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

    // Same overlay owner as the Context-inspector entry (adapter bridge):
    // the badge entry flips the store flag, not a surface-local ref.
    wrapper
      .findComponent({ name: "WorkspaceBadge" })
      .vm.$emit("request-open-memory");
    await flushPromises();

    expect(chatWorkspace.memoryOverlayOpen).toBe(true);
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

  it("removes the approved workspace through the canonical revoke channel then refreshes (FR-WSP-002)", async () => {
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
    expect(wrapper.get('[data-testid="workspace-badge-stub"]').text()).toBe(
      "/tmp/project"
    );

    // Next refresh after the revoke resolves null (revoked bindings are no
    // longer active) so the badge must return to its unset state.
    getWorkspaceMock.mockResolvedValueOnce(null);
    wrapper
      .findComponent({ name: "WorkspaceBadge" })
      .vm.$emit("request-remove-workspace");
    await flushPromises();

    expect(revokeWorkspaceMock).toHaveBeenCalledWith(7);
    expect(getWorkspaceMock.mock.calls.length).toBeGreaterThan(1);
    expect(wrapper.get('[data-testid="workspace-badge-stub"]').text()).toBe(
      "none"
    );
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
   * FR-BRW-001..005: the workspace composes the live managed-browser
   * session card as a compact region of the center — NOT inside the
   * inspector, so takeover/approval controls stay reachable with the
   * inspector closed. The start banner was removed from the chat head;
   * sessions start from the Tool Account page / AI browser tools.
   */
  it("renders the managed-browser region without the start banner, outside the inspector (FR-BRW)", async () => {
    const wrapper = mountSurface();
    await selectConversation("conv-1");
    await flushPromises();

    const region = wrapper.get('[data-testid="workspace-browser-region"]');
    // The "Start managed browser" banner is intentionally not part of the chat.
    expect(
      wrapper.findComponent({ name: "ManagedBrowserStartPanel" }).exists()
    ).toBe(false);
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

    // Terminal `complete` — driven through the store's real detail-event
    // path so the draft clear consumes the genuine terminal record (the
    // R05 watcher keys on it, never on raw view states).
    selected.applyDetailEvent({
      conversationId: "conv-1",
      runId: "run-1",
      sequence: 1,
      emittedAt: "2026-10-17T00:00:00.000Z",
      eventType: "complete",
      payload: { eventType: "complete" },
    });
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
    selected.applyDetailEvent({
      conversationId: "conv-1",
      runId: "run-1",
      sequence: 1,
      emittedAt: "2026-10-17T00:00:00.000Z",
      eventType: "error",
      payload: { eventType: "error", errorMessage: "provider busy" },
    });
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

/**
 * Audit R04 (FR-SUB-007 / FR-LIF-002 / FR-PER-004): the tool-approval policy
 * is per conversation. Loading it is scoped to the selection generation
 * observed at load start — a late reply from another chat (reversed
 * completion ordering included, even for the same conversation id) must
 * never overwrite the current conversation's policy, the load is hydration-
 * guarded on mount, and a send issued before the current conversation's
 * policy is known carries the conservative default — never the previous
 * chat's value.
 */
describe("AiChatCenterSurface approval-mode load scoping (audit R04)", () => {
  afterEach(() => {
    // clearAllMocks clears calls but not implementations — restore the
    // module-factory default so later tests see settled approval loads.
    getToolApprovalMock.mockReset();
    getToolApprovalMock.mockResolvedValue("ask_for_approval");
  });

  interface PendingApprovalReply {
    id: string;
    reply: {
      promise: Promise<ChatToolApprovalMode>;
      resolve: (mode: ChatToolApprovalMode) => void;
      reject: (reason?: unknown) => void;
    };
  }

  /** Every approval-mode read waits for manual resolution, in call order. */
  function stageUnsettledReplies(): PendingApprovalReply[] {
    const pending: PendingApprovalReply[] = [];
    getToolApprovalMock.mockImplementation((id: string) => {
      let resolve!: (mode: ChatToolApprovalMode) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<ChatToolApprovalMode>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pending.push({ id, reply: { promise, resolve, reject } });
      return promise;
    });
    return pending;
  }

  function approvalSelector(wrapper: ReturnType<typeof mountSurface>) {
    return wrapper.findComponent({
      name: "AiChatV2ToolApprovalModeSelector",
    });
  }

  function sendViaComposer(
    wrapper: ReturnType<typeof mountSurface>,
    text: string
  ): void {
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", text, []);
  }

  it("drops a late reply from conversation A after B is selected (reversed completion)", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-b",
      runId: "run-b",
      status: "running",
      acceptedAt: "",
    });
    const pending = stageUnsettledReplies();
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();

    // A reads auto-approve, slowly. B reads full_access and settles first.
    chatWorkspace.setSelected("conv-a");
    await flushPromises();
    chatWorkspace.setSelected("conv-b");
    await flushPromises();
    pending[1].reply.resolve("full_access");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe("full_access");

    // A's reply lands LAST — it must never retarget B's policy…
    pending[0].reply.resolve("approve_for_me");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe("full_access");
    // …nor B's request.
    sendViaComposer(wrapper, "hello from B");
    await flushPromises();
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
      conversationId: "conv-b",
      toolApprovalMode: "full_access",
    });
    expect(getToolApprovalMock.mock.calls.map((call) => call[0])).toEqual([
      "conv-a",
      "conv-b",
    ]);
  });

  it("ignores overlapping replies for the same conversation id across generations (A→B→A)", async () => {
    const pending = stageUnsettledReplies();
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();

    chatWorkspace.setSelected("conv-a"); // load A (generation 1)
    await flushPromises();
    chatWorkspace.setSelected("conv-b"); // load B (generation 2)
    await flushPromises();
    chatWorkspace.setSelected("conv-a"); // load A again (generation 3)
    await flushPromises();

    // A's ORIGINAL reply lands — the id matches the selection again, but it
    // belongs to a superseded load for the same conversation.
    pending[0].reply.resolve("approve_for_me");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe(
      "ask_for_approval"
    );

    // B's late reply is stale too — the selection is A again.
    pending[1].reply.resolve("full_access");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe(
      "ask_for_approval"
    );

    // Only the freshly started A load may apply.
    pending[2].reply.resolve("approve_for_me");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe(
      "approve_for_me"
    );
  });

  it("keeps the conservative default when the policy load fails and never sends a stale one", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-b",
      runId: "run-b",
      status: "running",
      acceptedAt: "",
    });
    const pending = stageUnsettledReplies();
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();

    chatWorkspace.setSelected("conv-a"); // A: auto-approve succeeds.
    await flushPromises();
    pending[0].reply.resolve("approve_for_me");
    await flushPromises();

    chatWorkspace.setSelected("conv-b"); // B's read FAILS.
    await flushPromises();
    pending[1].reply.reject(new Error("policy read failed"));
    await flushPromises();

    // Rejection ends the load with A's value nowhere — display…
    expect(approvalSelector(wrapper).props("modelValue")).toBe(
      "ask_for_approval"
    );
    // …or sent request.
    sendViaComposer(wrapper, "hello from B");
    await flushPromises();
    expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
      conversationId: "conv-b",
      toolApprovalMode: "ask_for_approval",
    });
  });

  it("sends the conservative default while the policy is still loading (never the previous chat's)", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-b",
      runId: "run-b",
      status: "running",
      acceptedAt: "",
    });
    const pending = stageUnsettledReplies();
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();

    chatWorkspace.setSelected("conv-a");
    await flushPromises();
    pending[0].reply.resolve("approve_for_me");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe(
      "approve_for_me"
    );

    // Switch to B; its policy read is STILL in flight when the user sends.
    chatWorkspace.setSelected("conv-b");
    await flushPromises();
    sendViaComposer(wrapper, "hello before load");
    await flushPromises();
    expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
      conversationId: "conv-b",
      toolApprovalMode: "ask_for_approval",
    });

    // B's own policy settles afterwards and takes over the display.
    pending[1].reply.resolve("full_access");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe("full_access");
  });

  it("prefers a manual policy change over the still-in-flight persisted load", async () => {
    const { setChatV2ToolApprovalMode } = await import("@/views/api/aiChatV2");
    const pending = stageUnsettledReplies();
    const wrapper = mountSurface();
    await flushPromises();

    useChatWorkspaceStore().setSelected("conv-b"); // persisted value pending
    await flushPromises();

    // The user picks a policy before the persisted load resolves.
    approvalSelector(wrapper).vm.$emit("update:modelValue", "full_access");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe("full_access");
    expect(setChatV2ToolApprovalMode).toHaveBeenCalledWith(
      "conv-b",
      "full_access"
    );

    // The stale persisted reply must not clobber the user's choice.
    pending[0].reply.resolve("ask_for_approval");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe("full_access");
  });

  it("hydrates the policy on mount and drops the hydration reply when the selection changes mid-flight", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatWorkspaceStore().setSelected("conv-a");
    const pending = stageUnsettledReplies(); // armed BEFORE mount
    const wrapper = mountSurface(pinia);
    await flushPromises();

    // Mount hydration starts for the conversation that was already selected.
    expect(getToolApprovalMock.mock.calls.map((call) => call[0])).toEqual([
      "conv-a",
    ]);

    // The user switches while the mount hydration is still in flight.
    useChatWorkspaceStore().setSelected("conv-b");
    await flushPromises();
    pending[0].reply.resolve("approve_for_me");
    await flushPromises();
    // The stale mount reply must not describe B.
    expect(approvalSelector(wrapper).props("modelValue")).toBe(
      "ask_for_approval"
    );

    pending[1].reply.resolve("full_access");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe("full_access");
  });

  it("hydrates the selected conversation's persisted policy when mounting without a race", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatWorkspaceStore().setSelected("conv-a");
    const pending = stageUnsettledReplies();
    const wrapper = mountSurface(pinia);
    await flushPromises();
    pending[0].reply.resolve("full_access");
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe("full_access");
  });

  it("resets the policy on deselection so a fresh-chat send never inherits it", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "fresh-chat",
      runId: "run-fresh",
      status: "running",
      acceptedAt: "",
    });
    const pending = stageUnsettledReplies();
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();

    chatWorkspace.setSelected("conv-a");
    await flushPromises();
    pending[0].reply.resolve("approve_for_me");
    await flushPromises();

    chatWorkspace.setSelected(null);
    await flushPromises();
    expect(approvalSelector(wrapper).props("modelValue")).toBe(
      "ask_for_approval"
    );

    // The empty-state send creates a NEW chat — it must not inherit A's mode.
    sendViaComposer(wrapper, "hello fresh chat");
    await flushPromises();
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(startChatRunMock.mock.calls[0][0]).toMatchObject({
      conversationId: "fresh-chat",
      toolApprovalMode: "ask_for_approval",
    });
  });
});

/**
 * Audit R05 (FR-SUB-002/003, FR-IMG-002/015, FR-LIF-002): the generated-
 * image reference tray clears ONLY against the accepted submission's own
 * snapshot, when THAT conversation's run completes while selected. Arming
 * before acceptance (or clearing on any streaming→idle transition — a
 * selection switch included) destroyed newer or rejected drafts. These
 * tests drive the REAL selection handshake and the REAL presenter through
 * `applyDetailEvent` so terminal transitions match production exactly.
 *
 * Placed LAST: `vi.clearAllMocks()` in the root beforeEach clears call
 * history but not mock implementations, so earlier describes' mocked
 * snapshots would otherwise leak into these assertions.
 */
describe("AiChatCenterSurface image-reference draft clears (audit R05)", () => {
  /** Tray references currently bound to the composer stub, order preserved. */
  function trayReferences(wrapper: ReturnType<typeof mountSurface>): unknown[] {
    return wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .props("selectedGeneratedImages")
      .map((v: { reference: unknown }) => v.reference);
  }

  /** Draft references persisted for one conversation (app-scoped state). */
  function draftReferences(conversationId: string): unknown[] {
    return [
      ...(useComposerDraftStore().getDraft(conversationId)
        ?.generatedImageReferences ?? []),
    ];
  }

  /** Select a conversation and let the surface re-render. */
  async function selectConversationId(conversationId: string): Promise<void> {
    useChatWorkspaceStore().setSelected(conversationId);
    await flushPromises();
  }

  /** Switch through the REAL selection handshake (dispose + snapshot). */
  async function loadConversation(conversationId: string): Promise<void> {
    await useSelectedConversationStore().loadSelection(conversationId);
    await flushPromises();
  }

  /** Point the snapshot API at an idle (or custom) persisted state. */
  function mockSelectionSnapshot(
    runtimeStatus: "idle" | "running" = "idle",
    activeRunId: string | null = null
  ): void {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus,
      activeRunId,
      title: "Selected chat",
    } as never);
  }

  /** A send accepted straight into a running turn. */
  function acceptRun(conversationId: string, runId: string): void {
    startChatRunMock.mockResolvedValue({
      conversationId,
      runId,
      status: "running",
      acceptedAt: "",
    });
  }

  /** Drive the engine's terminal `complete` through the real presenter. */
  async function completeRun(
    conversationId: string,
    runId: string,
    sequence = 1
  ): Promise<void> {
    useSelectedConversationStore().applyDetailEvent({
      conversationId,
      runId,
      sequence,
      emittedAt: "2026-10-17T00:00:00.000Z",
      eventType: "complete",
      payload: { eventType: "complete" },
    });
    await flushPromises();
  }

  it("removes only the submitted snapshot when its run completes; references added during the run survive", async () => {
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectConversationId("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();

    // Submit [m1] — accepted, streams.
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "", []);
    await flushPromises();
    expect(useSelectedConversationStore().streamStatus).toBe("streaming");

    // While run-1 streams the user stages the NEXT draft's reference.
    transcript.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 1,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 1 },
    ]);

    // run-1 completes: only ITS snapshot ([m1]) may be removed.
    await completeRun("conv-1", "run-1");
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m2", imageIndex: 1 },
    ]);
  });

  it("keeps the tray when an image send is rejected while another turn streams and the user switches away", async () => {
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectConversationId("conv-1");

    // First send (plain text) streams.
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "first turn", []);
    await flushPromises();
    expect(useSelectedConversationStore().streamStatus).toBe("streaming");

    // The user stages an image reference and sends it while the turn
    // streams — but the queue REJECTS it, slowly (never accepted).
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();
    let rejectImageSend: (reason?: unknown) => void = () => undefined;
    startChatRunMock.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectImageSend = reject;
        })
    );
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "edit this image", []);
    await flushPromises(); // the send is parked on the slow rejection
    expect(startChatRunMock).toHaveBeenCalledTimes(2);

    // …then the user switches to an idle conversation while the rejection
    // is still in flight.
    await loadConversation("conv-2");

    // The switch must NOT clear conv-1's tray: the send was never accepted.
    expect(draftReferences("conv-1")).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);

    // The rejection lands afterwards — still no destruction.
    rejectImageSend(new Error("queue limit reached"));
    await flushPromises();
    expect(draftReferences("conv-1")).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);
  });

  it("keeps the tray when a send is rejected while idle and recovers on the next accepted send", async () => {
    mockSelectionSnapshot();
    const wrapper = mountSurface();
    await selectConversationId("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();

    // The image send is rejected while the conversation is idle.
    startChatRunMock.mockRejectedValueOnce(new Error("queue limit reached"));
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "edit this image", []);
    await flushPromises();
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    // FR-SUB-003: the rejection retains the draft.
    expect(draftReferences("conv-1")).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);

    // The user stages one more reference and recovers with an ordinary
    // send — the staged references ride along with it (tray semantics).
    transcript.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 0,
    });
    await flushPromises();
    acceptRun("conv-1", "run-recovery");
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "hello", []);
    await flushPromises();
    await completeRun("conv-1", "run-recovery");

    // The recovery run submitted exactly the staged snapshot ([m1, m2]) —
    // its completion removes exactly that, and nothing more.
    expect(trayReferences(wrapper)).toEqual([]);
  });

  it("does not clear either tray on a streaming→idle selection switch; a delayed completion clears only its snapshot", async () => {
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectConversationId("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();

    // Submit [m1] in A — accepted, streams.
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "", []);
    await flushPromises();
    expect(useSelectedConversationStore().streamStatus).toBe("streaming");

    // Switch A → B while run-1 streams remotely.
    await loadConversation("conv-2");

    // A's tray must survive the switch…
    expect(draftReferences("conv-1")).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);

    // …B stages its own reference, untouched by A's transition. The real
    // handshake remounts the transcript (loading state) — re-find it.
    const transcriptB = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcriptB.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 0,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m2", imageIndex: 0 },
    ]);

    // Return to A, whose turn is still running remotely (snapshot says so).
    mockSelectionSnapshot("running", "run-1");
    await loadConversation("conv-1");
    const transcriptA = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });

    // Stage the next draft's reference while run-1 finishes remotely. The
    // accepted snapshot [m1] survived BOTH switches.
    transcriptA.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 0,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 0 },
    ]);

    // run-1 completes: its snapshot clears, the later addition stays.
    await completeRun("conv-1", "run-1");
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m2", imageIndex: 0 },
    ]);
  });

  it("clears each accepted submission's own snapshot across queued, overlapping runs", async () => {
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectConversationId("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();

    // Submit [m1] → run-1 streams.
    const composer = wrapper.findComponent({ name: "AiChatV2Composer" });
    composer.vm.$emit("send", "", []);
    await flushPromises();

    // Stage a second reference and submit BOTH while run-1 streams —
    // the coordinator QUEUES the second send (never rejects).
    transcript.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 0,
    });
    await flushPromises();
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "pending-run-2",
      status: "queued",
      acceptedAt: "",
    });
    composer.vm.$emit("send", "another edit", []);
    await flushPromises();

    // Queue acceptance itself clears nothing.
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 0 },
    ]);

    // run-1 completes → only ITS snapshot ([m1]) is removed.
    await completeRun("conv-1", "run-1");
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m2", imageIndex: 0 },
    ]);

    // run-2 drains and completes → its own submitted snapshot ([m1, m2]) clears.
    useSelectedConversationStore().applyDetailEvent({
      conversationId: "conv-1",
      runId: "run-2",
      sequence: 1,
      emittedAt: "2026-10-17T00:00:01.000Z",
      eventType: "start",
      payload: { eventType: "start", messageId: "a-2" },
    });
    await flushPromises();
    await completeRun("conv-1", "run-2", 2);
    expect(trayReferences(wrapper)).toEqual([]);
  });

  it("keeps never-submitted tray selections across an unrelated turn's completion", async () => {
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectConversationId("conv-1");

    // A plain text turn streams.
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "plain text turn", []);
    await flushPromises();

    // The user stages references mid-run but never sends them.
    wrapper
      .findComponent({ name: "AiChatWorkspaceTranscript" })
      .vm.$emit("use-generated-image", { messageId: "m1", imageIndex: 0 });
    await flushPromises();

    // The text turn completes — nothing was armed, so nothing is cleared.
    await completeRun("conv-1", "run-1");
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);
  });

  it("keeps the armed snapshot when a mid-run tool event follows an A→B→A re-selection; only the real terminal clears it", async () => {
    mockSelectionSnapshot(); // conv-1 selected while idle.
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectConversationId("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();

    // Submit [m1] — accepted, streams.
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "", []);
    await flushPromises();
    expect(useSelectedConversationStore().streamStatus).toBe("streaming");

    // A → B → A through the real handshake while run-1 streams remotely.
    mockSelectionSnapshot("running", "run-1");
    await loadConversation("conv-2");
    await loadConversation("conv-1");
    const store = useSelectedConversationStore();

    // Audit R6-01: the re-selection snapshot is now HYDRATED into the
    // presenter instead of being clobbered onto the disposed (idle, null)
    // view — a quiet running engine presents running, with the run strip
    // and Stop affordance, until the genuine terminal clears it. A mere
    // mid-run event cannot be mistaken for a completion because the
    // hydration state is the state the engine itself reported.
    expect(store.streamStatus).toBe("streaming");
    expect(store.runtimeStatus).toBe("running");
    expect(store.activeRunId).toBe("run-1");

    // Stage the next draft's reference while run-1 continues.
    const transcriptA = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcriptA.vm.$emit("use-generated-image", {
      messageId: "m2",
      imageIndex: 0,
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 0 },
    ]);

    // A MID-RUN tool event arrives (the run is still live): the view must
    // re-attach to the live turn, and the armed snapshot must survive.
    store.applyDetailEvent({
      conversationId: "conv-1",
      runId: "run-1",
      sequence: 2,
      emittedAt: "2026-10-17T00:00:02.000Z",
      eventType: "tool_call",
      payload: {
        eventType: "tool_call",
        toolCallId: "t-1",
        toolName: "search",
      },
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
      { messageId: "m2", imageIndex: 0 },
    ]);
    expect(store.streamStatus).toBe("streaming");
    expect(store.runtimeStatus).toBe("running");
    expect(store.activeRunId).toBe("run-1");

    // The REAL terminal — a genuine event, sequence beyond the tool event —
    // is the only transition allowed to pop the armed snapshot.
    await completeRun("conv-1", "run-1", 3);
    expect(trayReferences(wrapper)).toEqual([
      { messageId: "m2", imageIndex: 0 },
    ]);
  });
});

/**
 * Audit R2 N04 — background identity reconciliation for the image-
 * reference draft registry. Fixed contract: the registry lives in the
 * app-scoped composer draft store (route remounts no longer lose it), and
 * consumption is driven by the selected-conversation store's durable
 * identity resolutions — which include the redacted summary channel, so a
 * run that completes while its conversation is deselected consumes the
 * EXACT snapshot submitted for it (the R2 repro had a background gap
 * desynchronize two independent ordinal counters and mispair the old
 * snapshot with a newer run's terminal).
 */
describe("AiChatCenterSurface image-reference identity resolution (audit R2 N04)", () => {
  let summaryHandler: ((event: ConversationSummaryEvent) => void) | null = null;

  /** Tray references currently bound to the composer stub, order preserved. */
  function trayN04References(
    wrapper: ReturnType<typeof mountSurface>
  ): unknown[] {
    return [
      ...(useComposerDraftStore()
        .getDraft("conv-1")
        ?.generatedImageReferences ?? []),
    ];
  }

  function emitSummary(event: {
    reason: ConversationSummaryEvent["reason"];
    runId: string;
  }): void {
    if (!summaryHandler) throw new Error("no summary handler captured");
    summaryHandler({
      conversationId: "conv-1",
      workspaceKey: null,
      runtimeStatus: "idle",
      attention: "none",
      unread: false,
      lastActivityAt: "2026-10-20T10:00:00.000Z",
      reason: event.reason,
      runId: event.runId,
    });
  }

  function armSubmittedSnapshot(): void {
    useComposerDraftStore().setGeneratedImageReferences("conv-1", [
      { messageId: "m1", imageIndex: 0 },
    ]);
  }

  function summaryCaptureMock(): void {
    vi.mocked(subscribeSummaryEvents).mockImplementation((callback) => {
      summaryHandler = callback;
      return () => {
        summaryHandler = null;
      };
    });
  }

  /** Select a conversation and let the surface re-render. */
  async function selectN04Conversation(conversationId: string): Promise<void> {
    useChatWorkspaceStore().setSelected(conversationId);
    await flushPromises();
    await useSelectedConversationStore().loadSelection(conversationId);
    await flushPromises();
  }

  /** Switch through the REAL selection handshake (dispose + snapshot). */
  async function loadConversation(conversationId: string): Promise<void> {
    await useSelectedConversationStore().loadSelection(conversationId);
    await flushPromises();
  }

  /** Point the snapshot API at an idle persisted state. */
  function mockSelectionSnapshot(): void {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "Selected chat",
    } as never);
  }

  /** A send accepted straight into a running turn. */
  function acceptRun(conversationId: string, runId: string): void {
    startChatRunMock.mockResolvedValue({
      conversationId,
      runId,
      status: "running",
      acceptedAt: "",
    });
  }

  /** Drive the engine's terminal `complete` through the real presenter. */
  async function completeRun(
    conversationId: string,
    runId: string,
    sequence = 1
  ): Promise<void> {
    useSelectedConversationStore().applyDetailEvent({
      conversationId,
      runId,
      sequence,
      emittedAt: "2026-10-20T00:00:00.000Z",
      eventType: "complete",
      payload: { eventType: "complete" },
    });
    await flushPromises();
  }

  it("clears the accepted snapshot through the summary channel when the run completes in the background (repro)", async () => {
    summaryCaptureMock();
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectN04Conversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();
    wrapper.findComponent({ name: "AiChatV2Composer" }).vm.$emit("send", "", []);
    await flushPromises();
    expect(trayN04References(wrapper)).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);

    // Switch to B while run-1 executes. No detail terminal for conv-1 can
    // arrive (selected-only stream) — the completion comes as a summary.
    mockSelectionSnapshot();
    await loadConversation("conv-2");

    emitSummary({ reason: "run_completed", runId: "run-1" });
    await flushPromises();
    // The registry entry was consumed by identity even while deselected…
    expect(trayN04References(wrapper)).toEqual([]);

    // …and returning to A shows the cleared tray (nothing stale to resend).
    await loadConversation("conv-1");
    expect(trayN04References(wrapper)).toEqual([]);

    wrapper.unmount();
    vi.mocked(subscribeSummaryEvents).mockReturnValue(() => undefined);
    summaryHandler = null;
  });

  it("AUDIT3 completion while center is unmounted reconciles the stored image draft", async () => {
    summaryCaptureMock();
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const pinia = createPinia();
    const wrapper = mountSurface(pinia);
    await selectN04Conversation("conv-1");
    wrapper.findComponent({ name: "AiChatWorkspaceTranscript" }).vm.$emit("use-generated-image", { messageId: "m1", imageIndex: 0 });
    await flushPromises();
    wrapper.findComponent({ name: "AiChatV2Composer" }).vm.$emit("send", "edit", []);
    await flushPromises();
    expect(trayN04References(wrapper)).toEqual([{ messageId: "m1", imageIndex: 0 }]);
    wrapper.unmount();
    emitSummary({ reason: "run_completed", runId: "run-1" });
    await flushPromises();
    expect(useSelectedConversationStore().lastResolvedReferenceRun?.runId).toBe("run-1");
    const restored = mountSurface(pinia);
    await flushPromises();
    const refs = trayN04References(restored);
    restored.unmount();
    expect(refs).toEqual([]);
  });

  it("survives a route remount: the registry rides the app-scoped store and is consumed by a later terminal", async () => {
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectN04Conversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();
    wrapper.findComponent({ name: "AiChatV2Composer" }).vm.$emit("send", "", []);
    await flushPromises();

    // Route destruction: unmount and remount a fresh surface.
    wrapper.unmount();
    const wrapper2 = mountSurface();
    await selectN04Conversation("conv-1");
    await flushPromises();

    // The registered snapshot survived the remount and is consumed by ITS
    // run's terminal (acceptance ledger resolution) exactly once.
    await completeRun("conv-1", "run-1", 1);
    expect(trayN04References(wrapper2)).toEqual([]);

    // A duplicate terminal for the resolved run cannot double-consume.
    armSubmittedSnapshot();
    await completeRun("conv-1", "run-1", 9);
    expect(trayN04References(wrapper2)).toEqual([{ messageId: "m1", imageIndex: 0 }]);

    wrapper2.unmount();
  });

  it("dequeues but deliberately retains the submitted references when the run fails in the background", async () => {
    summaryCaptureMock();
    mockSelectionSnapshot();
    acceptRun("conv-1", "run-1");
    const wrapper = mountSurface();
    await selectN04Conversation("conv-1");
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("use-generated-image", {
      messageId: "m1",
      imageIndex: 0,
    });
    await flushPromises();
    wrapper.findComponent({ name: "AiChatV2Composer" }).vm.$emit("send", "", []);
    await flushPromises();

    mockSelectionSnapshot();
    await loadConversation("conv-2");
    emitSummary({ reason: "run_failed", runId: "run-1" });
    await flushPromises();

    // error: the entry dequeues (no double-consumption later) but the tray
    // keeps the references for deliberate retry (legacy parity).
    expect(trayN04References(wrapper)).toEqual([{ messageId: "m1", imageIndex: 0 }]);

    wrapper.unmount();
    vi.mocked(subscribeSummaryEvents).mockReturnValue(() => undefined);
    summaryHandler = null;
  });
});

/**
 * R07 (audit 2026-10-17, FR-VOI-008/009): spoken output is conversation-
 * bound. Switching the selected conversation or pressing Stop must cancel
 * playback AND the pending synthesis job; a stale terminal projection of
 * the old conversation must not flush speech into the new one.
 */
/**
 * Audit 2026-10-21-r3 D01 — queued generated-image sends that never own a
 * run (steered, or cancelled before the scheduling claim) must not leave an
 * unresolved ledger row: the next run's terminal would publish the orphan's
 * ordinal and the reference watcher would clear the tray's images. The
 * retirement publishes a non-clearing resolution; a later ordinary run
 * resolves its own ordinal.
 */
describe("AiChatCenterSurface queued image sends survive steer and cancel (audit D01)", () => {
  // Every subscriber sees the pending broadcast (production behavior):
  // the surface's delivered-row swap, the pending-rows store, and the
  // selected-conversation ledger all register — dispatch to ALL of them.
  let pendingHandlers: Array<(event: unknown) => void> = [];
  let summaryHandler: ((event: ConversationSummaryEvent) => void) | null = null;

  function trayReferences(wrapper: ReturnType<typeof mountSurface>): unknown[] {
    return [
      ...(useComposerDraftStore()
        .getDraft("conv-1")
        ?.generatedImageReferences ?? []),
    ];
  }

  function mockSelectionSnapshot(): void {
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "Selected chat",
    } as never);
  }

  async function selectConv1(): Promise<void> {
    useChatWorkspaceStore().setSelected("conv-1");
    await flushPromises();
    await useSelectedConversationStore().loadSelection("conv-1");
    await flushPromises();
  }

  async function acceptImageSend(wrapper: ReturnType<typeof mountSurface>): Promise<void> {
    useComposerDraftStore().setGeneratedImageReferences("conv-1", [
      { messageId: "m1", imageIndex: 0 },
    ]);
    wrapper.findComponent({ name: "AiChatV2Composer" }).vm.$emit(
      "send",
      "edit this",
      []
    );
    await flushPromises();
    // The tray snapshot is armed against THIS send's ordinal and stays
    // visible until its own run completes.
    expect(trayReferences(wrapper)).toEqual([{ messageId: "m1", imageIndex: 0 }]);
    expect(startChatRunMock.mock.calls.at(-1)?.[0]).toMatchObject({
      generatedImageReferences: [{ messageId: "m1", imageIndex: 0 }],
    });
  }

  function emitPending(event: {
    conversationId: string;
    pendingMessageId: string;
    status: string;
  }): void {
    if (pendingHandlers.length === 0)
      throw new Error("no pending handler captured");
    [...pendingHandlers].forEach((handler) => {
      handler({
        conversationId: event.conversationId,
        pendingMessageId: event.pendingMessageId,
        status: event.status,
        occurredAt: "2026-10-20T10:00:00.000Z",
      });
    });
  }

  function emitSummary(event: ConversationSummaryEvent["reason"], runId: string): void {
    if (!summaryHandler) throw new Error("no summary handler captured");
    summaryHandler({
      conversationId: "conv-1",
      workspaceKey: null,
      runtimeStatus: "idle",
      attention: "none",
      unread: false,
      lastActivityAt: "2026-10-20T10:00:00.000Z",
      reason: event,
      runId,
    });
  }

  function emitDetail(
    conversationId: string,
    runId: string,
    eventType: "start" | "complete",
    sequence: number,
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

  beforeEach(() => {
    mockSelectionSnapshot();
    startChatRunMock.mockReset();
    pendingHandlers = [];
    vi.mocked(subscribeChatV2PendingEvents).mockImplementation((callback) => {
      const handler = callback as unknown as (event: unknown) => void;
      pendingHandlers = [...pendingHandlers, handler];
      return () => {
        pendingHandlers = pendingHandlers.filter((h) => h !== handler);
      };
    });
    vi.mocked(subscribeSummaryEvents).mockImplementation((callback) => {
      summaryHandler = callback;
      return () => {
        summaryHandler = null;
      };
    });
  });

  /** Each send resolves its own durable acceptance in call order. */
  function enqueueRun(
    conversationId: string,
    runId: string,
    status: "running" | "queued"
  ): void {
    startChatRunMock.mockResolvedValueOnce({
      conversationId,
      runId,
      status,
      acceptedAt: "",
    });
  }

  it("cancel of a queued image send keeps the tray, and the next run's terminal resolves its own ordinal", async () => {
    enqueueRun("conv-1", "pending-p1", "queued");
    enqueueRun("conv-1", "run-c", "running");
    const wrapper = mountSurface();
    await selectConv1();
    await acceptImageSend(wrapper);

    // Cancel the queued row before it is ever claimed (no run envelope).
    emitPending({
      conversationId: "conv-1",
      pendingMessageId: "p1",
      status: "cancelled",
    });
    await flushPromises();
    // B's selected images SURVIVE (retirement publishes a non-clearing
    // resolution; only kind === "complete" removes tray references).
    expect(trayReferences(wrapper)).toEqual([{ messageId: "m1", imageIndex: 0 }]);

    // A later ordinary send C starts and completes (no reference tray).
    useComposerDraftStore().setGeneratedImageReferences("conv-1", []);
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "later ordinary send", []);
    await flushPromises();
    // detail-before-summary: C carries its own durable source identity.
    emitDetail("conv-1", "run-c", "start", 1, "run-c");
    emitDetail("conv-1", "run-c", "complete", 2, "run-c");
    await flushPromises();
    // C's terminal resolves C's ordinal — never the retired B row (1).
    expect(
      useSelectedConversationStore().lastResolvedReferenceRun
    ).toMatchObject({ runId: "run-c", ordinal: 2, kind: "complete" });
    // C had no submitted reference snapshot: its completion removed nothing
    // (the tray refs were released before C; no re-consumption of B's row).
    expect(trayReferences(wrapper)).toEqual([]);
    wrapper.unmount();
  });

  it("a steer attempt of a trusted-reference queued row is rejected and retires nothing", async () => {
    enqueueRun("conv-1", "pending-p1", "queued");
    vi.mocked(steerChatV2PendingMessage).mockRejectedValueOnce(
      new Error("ATTACHMENTS_NOT_STEERABLE: cannot steer reference rows")
    );
    const wrapper = mountSurface();
    await selectConv1();
    await acceptImageSend(wrapper);

    // The steer click hits the module guard (no claimation happens).
    const transcript = wrapper.findComponent({
      name: "AiChatWorkspaceTranscript",
    });
    transcript.vm.$emit("steer-pending", "p1");
    await flushPromises();
    expect(steerChatV2PendingMessage).toHaveBeenCalledWith(
      "conv-1",
      "p1"
    );
    // Nothing was retired: the queued row keeps the ledger alive until its
    // own normal dispatch (duration box — steering does not clear the tray).
    expect(trayReferences(wrapper)).toEqual([{ messageId: "m1", imageIndex: 0 }]);
    expect(useSelectedConversationStore().lastResolvedReferenceRun).toBeNull();

    // The row still dispatches normally later: its start/terminal resolve
    // ordinal 1 (the retirement never fired, the terminal claims ordinal 1).
    emitDetail("conv-1", "real-1", "start", 1, "pending-p1");
    emitDetail("conv-1", "real-1", "complete", 2, "pending-p1");
    await flushPromises();
    expect(
      useSelectedConversationStore().lastResolvedReferenceRun
    ).toMatchObject({ runId: "real-1", ordinal: 1, kind: "complete" });
    expect(trayReferences(wrapper)).toEqual([]);
    wrapper.unmount();
  });

  it("summary-before-detail: buffered summary facts resolve C's own ordinal once its acceptance lands", async () => {
    enqueueRun("conv-1", "pending-p1", "queued");
    const wrapper = mountSurface();
    await selectConv1();
    await acceptImageSend(wrapper);

    // Cancel B, then start C with a DEFERRED acceptance reply so the
    // redacted summary channel produces C's facts first (summary-before-
    // detail) while the acceptance is still in flight.
    emitPending({
      conversationId: "conv-1",
      pendingMessageId: "p1",
      status: "cancelled",
    });
    await flushPromises();
    expect(trayReferences(wrapper)).toEqual([{ messageId: "m1", imageIndex: 0 }]);
    let replyC: (value: unknown) => void = () => undefined;
    startChatRunMock.mockImplementationOnce(
      () => new Promise((resolve) => { replyC = resolve; })
    );
    wrapper.findComponent({ name: "AiChatV2Composer" }).vm.$emit(
      "send",
      "later ordinary send",
      []
    );
    await flushPromises();
    emitSummary("run_started", "run-c");
    emitSummary("run_completed", "run-c");
    replyC({ conversationId: "conv-1", runId: "run-c", status: "running", acceptedAt: "" });
    await flushPromises();
    // The buffered facts replayed on the acceptance and resolved C's row —
    // ordinal 2, never the retired B row (1).
    expect(
      useSelectedConversationStore().lastResolvedReferenceRun
    ).toMatchObject({ runId: "run-c", ordinal: 2, kind: "complete" });
    // C carried its own snapshot (the tray refs were still armed, B never
    // completed): C's terminal removed them (B's row stays retired).
    expect(trayReferences(wrapper)).toEqual([]);
    // C's own detail facts arrive later — duplicates of an already-resolved
    // row must not publish a second resolution or double-clear anything.
    emitDetail("conv-1", "run-c", "start", 3, "run-c");
    emitDetail("conv-1", "run-c", "complete", 4, "run-c");
    await flushPromises();
    expect(
      useSelectedConversationStore().lastResolvedReferenceRun
    ).toMatchObject({ runId: "run-c", ordinal: 2, kind: "complete" });
    expect(trayReferences(wrapper)).toEqual([]);
    wrapper.unmount();
  });
});

/**
 * Audit 2026-10-21-r3 D02: the G01 journey's click stamp must anchor at the
 * composer click, NOT inside the store's sendMessage — attachment encoding
 * and command expansion both run BEFORE that point and would truncate (or
 * hide) long click→acceptance journeys.
 */
describe("AiChatCenterSurface submit click journey anchor (D02)", () => {
  beforeEach(() => {
    buildUploadedAttachmentsMock.mockReset();
    startChatRunMock.mockReset();
  });

  it("stamps the click boundary before attachment encoding finishes", async () => {
    const beforeClick = Date.now();
    let encodeFinishedAt = 0;
    buildUploadedAttachmentsMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      encodeFinishedAt = Date.now();
      return [];
    });
    startChatRunMock.mockReset();
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    await flushPromises();
    useChatWorkspaceStore().setSelected("conv-1");
    await flushPromises();

    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "explain this", [new File(["x"], "a.txt")]);
    // Encoding takes ~60 ms; give the pipeline the chance to finish.
    await new Promise((resolve) => setTimeout(resolve, 160));
    await flushPromises();

    const request = startChatRunMock.mock.calls.at(-1)?.[0] as
      | { journeyStart?: { clickAtEpochMs?: number } }
      | undefined;
    expect(request?.journeyStart?.clickAtEpochMs).toBeTruthy();
    // The click anchor is OLDER than the encoding completion point: the
    // journey includes the encode stage by construction.
    expect(request?.journeyStart?.clickAtEpochMs ?? 0).toBeLessThan(
      encodeFinishedAt
    );
    // And still anchored to THIS session (a plausible clock, no far past).
    expect(request?.journeyStart?.clickAtEpochMs ?? 0).toBeGreaterThan(
      beforeClick - 1_000
    );
    wrapper.unmount();
  });
});

describe("AiChatCenterSurface speech cancellation (R07)", () => {
  beforeEach(() => {
    vi.mocked(cancelVoiceJob).mockClear();
  });

  it("cancels the voice job when the selection changes conversation", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-a");
    await flushPromises();
    // null→A is itself a selection change (cancels any prior speech); the
    // assertion is that switching A→B cancels AGAIN.
    const afterFirstSelect = vi.mocked(cancelVoiceJob).mock.calls.length;
    expect(afterFirstSelect).toBeGreaterThanOrEqual(0);

    chatWorkspace.setSelected("conv-b");
    await flushPromises();
    expect(vi.mocked(cancelVoiceJob).mock.calls.length).toBe(
      afterFirstSelect + 1
    );

    wrapper.unmount();
  });

  it("cancels the voice job when the COMPOSER Stop fires (audit B06)", async () => {
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-a");
    await flushPromises();
    const beforeStop = vi.mocked(cancelVoiceJob).mock.calls.length;

    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("stop");
    await flushPromises();
    // Single-primary-stop (PRD §13): the composer Stop is the same primary
    // stop affordance as the run strip — stopping the turn also stops the
    // spoken output (queued synthesis jobs cancelled, playing speech stopped).
    expect(vi.mocked(cancelVoiceJob).mock.calls.length).toBe(beforeStop + 1);

    wrapper.unmount();
  });
});

/**
 * R10 (audit 2026-10-17): /clear must not reload the OLD conversation into
 * a newly selected surface, and a denied/failed clear surfaces retryable
 * feedback instead of silently consuming the command.
 */
describe("AiChatCenterSurface /clear ownership after awaits (R10)", () => {
  beforeEach(() => {
    // The REAL dispatchSlashCommand runs — route the registry channel
    // through the global window.api stub (production path, like FR-CMD-001).
    const invoke = window.api.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
    invoke.mockImplementation((channel: string) => {
      if (channel === SLASH_COMMAND_DISPATCH) {
        return Promise.resolve({
          status: true,
          data: {
            status: true,
            action: "show_result",
            content: "",
            commandId: "built-in:command:clear",
          },
        });
      }
      return Promise.resolve(undefined);
    });
    vi.mocked(clearChatV2Conversation).mockReset();
  });

  function sendClear(wrapper: ReturnType<typeof mountSurface>): void {
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "/clear", []);
  }

  it("does not reload the cleared conversation after the selection moved on", async () => {
    vi.mocked(clearChatV2Conversation).mockResolvedValue({ deleted: 5 });
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-a");
    await flushPromises();
    expect(clearChatV2Conversation).not.toHaveBeenCalled();

    // The clear IPC resolves slowly; the user switches to B mid-flight.
    let resolveClear!: (value: { deleted: number } | null) => void;
    vi.mocked(clearChatV2Conversation).mockImplementationOnce(
      () =>
        new Promise<{ deleted: number } | null>((res) => {
          resolveClear = res;
        })
    );
    sendClear(wrapper);
    await flushPromises();
    chatWorkspace.setSelected("conv-b");
    await flushPromises();
    resolveClear({ deleted: 5 });
    await flushPromises();

    // The clear RAN for A, but A must not be re-loaded into the selected
    // store after B was chosen.
    expect(clearChatV2Conversation).toHaveBeenCalledWith("conv-a");
    expect(selectConversation).not.toHaveBeenCalledWith(
      "conv-a",
      expect.anything()
    );

    wrapper.unmount();
  });

  it("surfaces retryable feedback and reports non-acceptance when the clear is denied", async () => {
    vi.mocked(clearChatV2Conversation).mockResolvedValue(null);
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-a");
    await flushPromises();

    sendClear(wrapper);
    await flushPromises();

    expect(clearChatV2Conversation).toHaveBeenCalledWith("conv-a");
    expect(wrapper.text()).toContain("Could not clear this chat");

    wrapper.unmount();
  });
});

/**
 * Audit 2026-10-20 B04: a registry-resolved expanded prompt must fire the
 * composer acceptance callback EXACTLY once. Before the fix the expanded
 * send fired it (performOrdinarySend's accepted-send rule) and the
 * disposition's completed branch fired it again (acceptedSend !== false),
 * double-consuming the composer draft clear.
 */
describe("AiChatCenterSurface expanded-command acceptance single-fire (B04)", () => {
  beforeEach(() => {
    // The REAL dispatchSlashCommand runs — the registry channel resolves an
    // expansion into a prompt send (production path, like FR-CMD-003).
    const invoke = window.api.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
    invoke.mockImplementation((channel: string) => {
      if (channel === SLASH_COMMAND_DISPATCH) {
        return Promise.resolve({
          status: true,
          data: {
            status: true,
            action: "submit_prompt",
            commandId: "plugin:p:command:slashexpand",
            prompt: "expanded prompt body",
          },
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it("fires the acceptance callback once for an immediately accepted expanded send", async () => {
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    await flushPromises();
    useChatWorkspaceStore().setSelected("conv-1");
    await flushPromises();

    const onAccepted = vi.fn();
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "/expand", [], { onAccepted });
    await flushPromises();

    // Exactly one provider submission and ONE acceptance.
    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("fires the acceptance callback zero times when the expanded send is rejected", async () => {
    startChatRunMock.mockRejectedValue(new Error("start failed"));
    const wrapper = mountSurface();
    await flushPromises();
    useChatWorkspaceStore().setSelected("conv-1");
    await flushPromises();

    const onAccepted = vi.fn();
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "/expand", [], { onAccepted });
    await flushPromises();

    expect(startChatRunMock).toHaveBeenCalledTimes(1);
    expect(onAccepted).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});

/**
 * Audit 2026-10-20 B07: with the shared-orchestration adapter rolled back,
 * slash-shaped input must STILL be intercepted by the command router — PRD
 * §97 precludes raw command text reaching the model on any path, and a
 * stop/control command must not appear accepted without performing its
 * control action. Presentation flags choose dispatch adapters, never the
 * interception contract (design §23.1).
 */
describe("AiChatCenterSurface rollback keeps command interception (B07)", () => {
  beforeEach(() => {
    // The REAL dispatchSlashCommand runs; the registry resolves /clear.
    const invoke = window.api.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
    invoke.mockImplementation((channel: string) => {
      if (channel === SLASH_COMMAND_DISPATCH) {
        return Promise.resolve({
          status: true,
          data: {
            status: true,
            action: "show_result",
            content: "",
            commandId: "built-in:command:clear",
          },
        });
      }
      return Promise.resolve(undefined);
    });
    vi.mocked(clearChatV2Conversation).mockReset();
    vi.mocked(clearChatV2Conversation).mockResolvedValue({ deleted: 1 });
    // ROLLBACK: shared orchestration explicitly off (operator action).
    vi.mocked(fetchWorkspaceRolloutFlags).mockResolvedValue({
      adapters: { sharedOrchestration: false, specializedResults: true, voiceMemory: true },
    } as never);
  });

  it("runs /clear through the command router instead of submitting it as raw model text", async () => {
    resetWorkspaceRolloutAdaptersForTest();
    startChatRunMock.mockReset();
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-1",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    await flushPromises();
    useChatWorkspaceStore().setSelected("conv-1");
    await flushPromises();

    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "/clear", []);
    await flushPromises();

    // The command dispatched and the control action ran...
    expect(vi.mocked(clearChatV2Conversation)).toHaveBeenCalledWith("conv-1");
    // ...and the raw command text never reached the model.
    expect(startChatRunMock).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});

/**
 * Audit 2026-10-20 B08: late operation failures must be scoped to their
 * originating conversation. A failure that resolves after the user switched
 * must not change the currently selected conversation's notice; the retained
 * failure is revealed (bounded localized text) when the user selects the
 * originating conversation again.
 */
describe("AiChatCenterSurface late-error ownership (B08)", () => {
  beforeEach(() => {
    vi.mocked(clearChatV2Conversation).mockReset();
    buildUploadedAttachmentsMock.mockReset();
  });

  it("shows an attachment preparation failure in the origin conversation when the user stayed there", async () => {
    buildUploadedAttachmentsMock.mockRejectedValue(
      new Error("attachment invalid")
    );
    startChatRunMock.mockReset();
    startChatRunMock.mockResolvedValue({
      conversationId: "conv-a",
      runId: "run-1",
      status: "running",
      acceptedAt: "",
    });
    const wrapper = mountSurface();
    await flushPromises();
    useChatWorkspaceStore().setSelected("conv-a");
    await flushPromises();

    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "explain this", [new File(["x"], "a.txt")]);
    await flushPromises();

    expect(wrapper.text()).toContain("attachment invalid");
    wrapper.unmount();
  });

  it("retains a late attachment failure under its origin and never shows it in the switched conversation", async () => {
    let rejectAttachment!: (err: Error) => void;
    buildUploadedAttachmentsMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectAttachment = reject;
        })
    );
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-a");
    await flushPromises();

    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "explain this", [new File(["x"], "a.txt")]);
    await flushPromises();
    // The user switches to B before the preparation fails.
    chatWorkspace.setSelected("conv-b");
    await flushPromises();
    rejectAttachment(new Error("attachment invalid"));
    await flushPromises();

    // B's notice and content are untouched...
    expect(wrapper.text()).not.toContain("attachment invalid");
    // ...and the failure is retained for A, revealed on return.
    chatWorkspace.setSelected("conv-a");
    await flushPromises();
    expect(wrapper.text()).toContain("attachment invalid");

    wrapper.unmount();
  });

  it("retains a denied /clear under its origin when the selection moved (R10 + B08)", async () => {
    // The real dispatchSlashCommand runs; registry resolves /clear.
    const invoke = window.api.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
    invoke.mockImplementation((channel: string) => {
      if (channel === SLASH_COMMAND_DISPATCH) {
        return Promise.resolve({
          status: true,
          data: {
            status: true,
            action: "show_result",
            content: "",
            commandId: "built-in:command:clear",
          },
        });
      }
      return Promise.resolve(undefined);
    });
    let resolveClear!: (value: { deleted: number } | null) => void;
    vi.mocked(clearChatV2Conversation).mockImplementationOnce(
      () =>
        new Promise<{ deleted: number } | null>((res) => {
          resolveClear = res;
        })
    );
    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-a");
    await flushPromises();

    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "/clear", []);
    await flushPromises();
    chatWorkspace.setSelected("conv-b");
    await flushPromises();
    // Denial envelope arrives while B is selected.
    resolveClear(null);
    await flushPromises();

    // B shows no clear failure...
    expect(wrapper.text()).not.toContain("Could not clear this chat");
    // ...and A's return reveals the retained retryable feedback.
    chatWorkspace.setSelected("conv-a");
    await flushPromises();
    expect(wrapper.text()).toContain("Could not clear this chat");

    wrapper.unmount();
  });
});

/**
 * Audit R2 G02: the shared-orchestration rollout adapter gets a documented,
 * SAFE rollback effect. Disabled it hides the shared command orchestration
 * state (goal objective + scheduled-loop status) from the header — a
 * presentation rollback only: command interception, the stop precedence
 * (goal → loop → run, unchanged durable behavior), and every durable
 * identity stay intact. Raw slash-command fallback is NOT restored.
 */
describe("AiChatCenterSurface shared-orchestration rollback (audit R2 G02)", () => {
  const ROLLBACK_FLAGS = {
    enabled: true,
    explicit: true,
    adapters: {
      sharedOrchestration: false,
      specializedResults: true,
      voiceMemory: true,
    },
  };

  it.each([[undefined], [{ enabled: true, adapters: undefined }]])(
    "renders goal/loop orchestration state in the header by default (%#)",
    async (flags) => {
      vi.mocked(fetchWorkspaceRolloutFlags).mockResolvedValue(
        flags as never
      );
      resetWorkspaceRolloutAdaptersForTest();
      const wrapper = mountSurface();
      await flushPromises();
      useChatWorkspaceStore().setSelected("conv-g02");
      await flushPromises();
      useSelectedConversationStore().seedGoal({
        goalId: "goal-1",
        objective: "Ship the parity suite",
        status: "running",
        iterationCount: 2,
      });
      await flushPromises();
      // Run-strip removal: the header now owns the goal/loop chips.
      const header = wrapper.findComponent({
        name: "AiChatConversationHeader",
      });
      expect(header.props("goalObjective")).toBe("Ship the parity suite");

      wrapper.unmount();
    }
  );

  it("adapter off hides the goal/loop state while runtime status remains", async () => {
    vi.mocked(fetchWorkspaceRolloutFlags).mockResolvedValue(
      ROLLBACK_FLAGS as never
    );
    resetWorkspaceRolloutAdaptersForTest();
    const wrapper = mountSurface();
    await flushPromises();
    useChatWorkspaceStore().setSelected("conv-g02");
    await flushPromises();
    useSelectedConversationStore().seedGoal({
      goalId: "goal-1",
      objective: "Ship the parity suite",
      status: "running",
      iterationCount: 2,
    });
    await flushPromises();

    // Presentation rollback: the shared orchestration surfaces dim out —
    // the header receives null goal/loop state.
    const header = wrapper.findComponent({
      name: "AiChatConversationHeader",
    });
    expect(header.props("goalObjective")).toBeNull();
    expect(header.props("loopStatus")).toBeNull();
    // Removing the goal (live events still reconcile the store) keeps a
    // rollback-free view in sync for adapter-on surfaces.
    useSelectedConversationStore().seedGoal(null);
    await flushPromises();
    expect(header.props("goalObjective")).toBeNull();

    wrapper.unmount();
  });

  it("rollback keeps command interception + durable stop precedence intact", async () => {
    vi.mocked(fetchWorkspaceRolloutFlags).mockResolvedValue(
      ROLLBACK_FLAGS as never
    );
    resetWorkspaceRolloutAdaptersForTest();
    const invoke = window.api.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
    invoke.mockImplementation((channel: string) => {
      if (channel === SLASH_COMMAND_DISPATCH) {
        return Promise.resolve({
          status: true,
          data: {
            status: true,
            action: "show_result",
            content: "",
            commandId: "built-in:command:clear",
          },
        });
      }
      if (channel === AI_CHAT_V2_GOAL_LOOP_STOP) {
        return Promise.resolve({
          status: true,
          data: { cancelled: true },
        });
      }
      return Promise.resolve(undefined);
    });
    vi.mocked(clearChatV2Conversation).mockResolvedValue({ deleted: 3 });

    const wrapper = mountSurface();
    await flushPromises();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-g02");
    await flushPromises();
    // A live goal exists even though the adapter hides its state.
    useSelectedConversationStore().seedGoal({
      goalId: "goal-1",
      objective: "Ship the parity suite",
      status: "running",
      iterationCount: 2,
    });
    await flushPromises();

    // 1) Stop precedence unchanged (run BEFORE /clear: clearing resets the
    //    selection): the composer stop is now the ONE primary stop affordance
    //    and still targets the (hidden) goal first — durable orchestration
    //    behavior spared even with the strip gone.
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("stop");
    await flushPromises();
    const goalStopCall = invoke.mock.calls.find(
      (call: unknown[]) => call[0] === AI_CHAT_V2_GOAL_LOOP_STOP
    );
    expect(goalStopCall).toBeDefined();
    // Preload serializes invoke payloads — parse before identity asserting.
    expect(JSON.parse(goalStopCall![1] as string)).toEqual({
      conversationId: "conv-g02",
    });

    // 2) Command interception unchanged: /clear still routes through the
    //    shared dispatcher and runs the SAME command (no raw fallback).
    wrapper
      .findComponent({ name: "AiChatV2Composer" })
      .vm.$emit("send", "/clear", []);
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith(
      SLASH_COMMAND_DISPATCH,
      expect.anything()
    );
    expect(clearChatV2Conversation).toHaveBeenCalledWith("conv-g02");

    wrapper.unmount();
  });
});

describe("load-older visible states (audit R5-03)", () => {
  it("hides the load-older control while a snapshot is pending and re-enables it from each conversation's own paging state", async () => {
    // Conversation A: its snapshot carries historical paging state.
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [],
      nextBefore: {
        timestamp: "2026-10-19T00:00:00.000Z",
        messageId: "cursor-a",
      },
      hasOlder: true,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "A",
    } as never);
    const wrapper = mountSurface();
    await useSelectedConversationStore().loadSelection("conv-a");
    await flushPromises();
    let loadOlder = wrapper.find('[data-testid="workspace-load-older"]');
    expect(loadOlder.exists()).toBe(true);
    expect((loadOlder.element as HTMLButtonElement).disabled).toBe(false);

    // Switching to B: while B's snapshot is pending the control must be
    // GONE — never a stale proposal to page B with A's cursor.
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(selectConversation).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never
    );
    const selection = useSelectedConversationStore().loadSelection("conv-b");
    await flushPromises();
    expect(wrapper.find('[data-testid="workspace-load-older"]').exists()).toBe(
      false
    );

    finish({
      acceptedGeneration: 2,
      messages: [],
      nextBefore: {
        timestamp: "2026-10-19T01:00:00.000Z",
        messageId: "cursor-b",
      },
      hasOlder: true,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "B",
    } as never);
    await selection;
    await flushPromises();
    // B's own snapshot re-establishes the control with availability.
    loadOlder = wrapper.find('[data-testid="workspace-load-older"]');
    expect(loadOlder.exists()).toBe(true);

    // While an older page loads the control is disabled; afterwards the
    // next round-trip decides its availability again.
    let finishPage: (value: unknown) => void = () => undefined;
    vi.mocked(loadHistoryPage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPage = resolve;
        }) as never
    );
    const pageLoad = useSelectedConversationStore().loadOlder();
    await flushPromises();
    expect((loadOlder.element as HTMLButtonElement).disabled).toBe(true);

    finishPage({ messages: [], nextBefore: null, hasOlder: false });
    await Promise.all([pageLoad, flushPromises()]);
    expect(wrapper.find('[data-testid="workspace-load-older"]').exists()).toBe(
      false
    );

    wrapper.unmount();
  });
});

describe("streaming answer survives paging (audit R5-01)", () => {
  /** Mirrors the store suite's row factory for the component flow. */
  function surfaceHistoryRow(id: string, offsetMinutes: number): ChatV2MessageView {
    return {
      id,
      conversationId: "conv-1",
      role: "user",
      content: `row ${id}`,
      timestamp: new Date(2026, 9, 20, 8, offsetMinutes).toISOString(),
      messageType: MessageType.MESSAGE,
      metadata: { source: "chat-v2" },
    };
  }

  it("pages while a response streams and keeps the active answer's full text to its final completion", async () => {
    const rows = Array.from({ length: 199 }, (_unused, index) =>
      surfaceHistoryRow(`recent-${index}`, 400 - index)
    );
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: rows,
      nextBefore: {
        timestamp: rows[0].timestamp,
        messageId: rows[0].id,
      },
      hasOlder: true,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "conv-1",
    } as never);
    const wrapper = mountSurface();
    await useSelectedConversationStore().loadSelection("conv-1");
    await flushPromises();
    const store = useSelectedConversationStore();

    const detailEvent = (
      sequence: number,
      eventType: "start" | "token" | "complete",
      extra: Record<string, unknown> = {}
    ): void => {
      store.applyDetailEvent({
        conversationId: "conv-1",
        runId: "run-live",
        sequence,
        emittedAt: "2026-10-20T10:00:00.000Z",
        eventType,
        payload: {
          eventType,
          messageId: "live-answer",
          ...extra,
        },
      } as never);
    };

    detailEvent(1, "start");
    detailEvent(2, "token", { contentDelta: "prefix " });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix ");

    // Page through the REAL control while the response streams. The full
    // window overflows → the prepend pushes the streamed row past the
    // bound, and the pinned active row must survive it.
    vi.mocked(loadHistoryPage).mockResolvedValueOnce({
      messages: [surfaceHistoryRow("old-row", -1)],
      nextBefore: null,
      hasOlder: false,
    } as never);
    await wrapper
      .find('[data-testid="workspace-load-older"]')
      .trigger("click");
    await flushPromises();
    expect(store.messages.some((m) => m.id === "old-row")).toBe(true);

    detailEvent(3, "token", { contentDelta: "suffix" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("prefix suffix");

    // The authoritative completion is the mounted final answer.
    detailEvent(4, "complete", { fullContent: "full final answer" });
    await flushPromises();
    expect(
      store.messages.find((m) => m.id === "live-answer")?.content
    ).toBe("full final answer");

    wrapper.unmount();
  });
});

/**
 * P1-1 (audit 2026-10-22, FR-LIF-005): while a permission or question card is
 * parked the conversation can still receive writes, so the header Clear must
 * not reach the clear IPC. The main process refuses it too (delete-guard
 * parity); this proves the renderer-side guard.
 */
describe("AiChatCenterSurface clear refused while parked (P1-1)", () => {
  const permissionMessage: ChatV2MessageView = {
    id: "perm-row-1",
    conversationId: "conv-a",
    role: "assistant",
    content: "",
    timestamp: "2026-10-22T08:00:00.000Z",
    messageType: MessageType.TOOL_RESULT,
    metadata: {
      source: "chat-v2",
      toolCallId: "tool-p1",
      toolName: "run_command",
      toolResult: { needsPermissionPrompt: true },
    },
  };

  async function mountParked(
    runtimeStatus: "awaiting_permission" | "awaiting_user"
  ): Promise<ReturnType<typeof mountSurface>> {
    const pinia = createPinia();
    setActivePinia(pinia);
    vi.mocked(selectConversation).mockResolvedValue({
      acceptedGeneration: 1,
      messages: [permissionMessage],
      nextBefore: null,
      hasOlder: false,
      runtimeStatus,
      activeRunId: "run-parked",
      title: "Selected chat",
    } as never);
    const wrapper = mountSurface(pinia);
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-a");
    await useSelectedConversationStore().loadSelection("conv-a");
    await flushPromises();
    return wrapper;
  }

  beforeEach(() => {
    // jsdom's confirm may be undefined (custom element env) — force "OK" so
    // the ONLY thing standing between the click and the IPC is the parked
    // guard. Restored in afterEach (jsdom does not define confirm here).
    window.confirm = () => true;
    vi.mocked(clearChatV2Conversation).mockReset();
    vi.mocked(clearChatV2Conversation).mockResolvedValue({ deleted: 4 });
  });

  afterEach(() => {
    const win = window as unknown as { confirm?: unknown };
    delete win.confirm;
  });

  it("does not clear while a permission card is parked (awaiting_permission)", async () => {
    const wrapper = await mountParked("awaiting_permission");
    const selected = useSelectedConversationStore();
    expect(selected.isBusy).toBe(false);
    expect(selected.runtimeStatus).toBe("awaiting_permission");

    // The header is stubbed in this harness; emit the same event the real
    // Clear v-list-item emits.
    wrapper
      .findComponent({ name: "AiChatConversationHeader" })
      .vm.$emit("clear");
    await flushPromises();

    expect(clearChatV2Conversation).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does not clear while a question card is parked (awaiting_user)", async () => {
    const wrapper = await mountParked("awaiting_user");
    const selected = useSelectedConversationStore();
    expect(selected.isBusy).toBe(false);

    wrapper
      .findComponent({ name: "AiChatConversationHeader" })
      .vm.$emit("clear");
    await flushPromises();

    expect(clearChatV2Conversation).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
