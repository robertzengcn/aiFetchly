import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { createI18n } from "vue-i18n";
import { useChatModelsStore } from "@/views/store/chatModels";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { createAndSelectWorkspaceChat } from "@/views/composables/chatWorkspaceSelection";

const getOpenAIChatModelsMock = vi.fn();
const createWorkspaceConversationIdMock = vi.fn();

vi.mock("@/views/api/aiChatV2", () => ({
  getOpenAIChatModels: (...args: unknown[]) => getOpenAIChatModelsMock(...args),
  getChatV2History: vi.fn().mockResolvedValue({ messages: [] }),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue("ask_for_approval"),
  setChatV2ToolApprovalMode: vi.fn(),
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
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  recoverChatV2PlanContinuationIntent: vi.fn().mockResolvedValue(null),
  answerChatV2Question: vi.fn(),
  clearChatV2Conversation: vi.fn(),
  listChatV2PendingMessages: vi.fn().mockResolvedValue([]),
  subscribeChatV2PendingEvents: vi.fn(() => () => undefined),
  exportGeneratedImage: vi.fn(),
  isHistoryUiEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  createWorkspaceConversationId: (...args: unknown[]) =>
    createWorkspaceConversationIdMock(...args),
  bootstrapWorkspace: vi.fn().mockResolvedValue({ workspaces: [], unassigned: [] }),
  subscribeSummaryEvents: vi.fn(() => () => undefined),
  subscribeTitleEvents: vi.fn(() => () => undefined),
  subscribeDetailEvents: vi.fn(() => () => undefined),
  unsubscribeDetail: vi.fn(),
  selectConversation: vi.fn().mockResolvedValue(null),
  startChatRun: vi.fn(),
  cancelChatRun: vi.fn(),
  loadHistoryPage: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-1"),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/views/api/workspace", () => ({
  getWorkspace: vi.fn().mockResolvedValue(null),
  revokeWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/views/api/workspaceWatch", () => ({
  acquireWorkspaceWatch: vi.fn().mockResolvedValue(null),
  releaseWorkspaceWatch: vi.fn().mockResolvedValue(undefined),
  previewWorkspaceAgents: vi.fn().mockResolvedValue(""),
}));

vi.mock("@/views/api/aiWorkspaceMemory", () => ({
  workspaceMemoryApi: {
    list: vi.fn().mockResolvedValue({ status: true, data: [] }),
  },
}));

vi.mock("@/views/api/aiChatV2Voice", () => ({
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT: "voice-settings-changed",
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT: "voice-models-changed",
  cancelVoiceJob: vi.fn().mockResolvedValue({ ok: true }),
  downloadVoiceModel: vi.fn(),
  getVoiceSettings: vi.fn().mockResolvedValue({
    inputMode: "disabled",
    ttsMode: "disabled",
    autoSendTranscript: false,
    sttLanguage: "auto",
    ttsLanguage: "auto",
    sttModelId: "stt",
    ttsModelId: "tts",
    ttsSpeed: 1,
    maxRecordingMs: 60000,
  }),
  getVoiceStatus: vi.fn().mockResolvedValue({
    sttState: "ready",
    ttsState: "ready",
  }),
  notifyVoiceModelsChanged: vi.fn(),
  onVoiceModelDownloadProgress: vi.fn().mockReturnValue(() => undefined),
  setVoiceSettings: vi.fn(),
  synthesizeVoice: vi.fn(),
  transcribeVoice: vi.fn(),
}));

import AiChatCenterSurface from "@/views/components/aiChatWorkspace/AiChatCenterSurface.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        newChat: "New chat",
        empty: {
          title: "Ask anything, or pick a conversation on the left.",
        },
        header: {
          overflow: "Conversation menu",
          rename: "Rename chat",
          export: "Export conversation",
          duplicate: "Duplicate conversation",
          compact: "Compact conversation",
          backgroundAgents: "Background Agents",
        },
        inspector: {
          context: "Context",
        },
      },
    },
  },
});

function mountSurface() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/aiworkspace",
        name: "AI_Chat_Workspace",
        component: { template: "<div />" },
      },
      {
        path: "/system-setting/ai-provider",
        name: "system_setting_ai_provider",
        component: { template: "<div />" },
      },
    ],
  });

  return mount(AiChatCenterSurface, {
    global: {
      plugins: [i18n, router],
      stubs: {
        AiChatWorkspaceTranscript: true,
        AiChatWorkspaceSidebar: true,
        AiChatConversationHeader: true,
        AiChatV2Composer: defineComponent({
          name: "AiChatV2Composer",
          template: '<div data-testid="composer-stub"><slot name="controls" /></div>',
        }),
        AiChatV2ModelSelector: defineComponent({
          name: "AiChatV2ModelSelector",
          props: ["modelValue", "items", "defaultModel", "disabled", "loading", "noModels"],
          emits: ["update:modelValue"],
          template: `
            <div data-testid="model-selector-stub" :data-model="modelValue ?? ''">
              <button
                data-testid="set-model-m2"
                @click="$emit('update:modelValue', 'm2')"
              >set m2</button>
            </div>
          `,
        }),
        AiChatV2ModeSelector: true,
        AiChatV2ToolApprovalModeSelector: true,
        AiChatVoiceOutputToggle: true,
        AiChatVoiceRuntimeInstallDialog: true,
        AiChatVoiceTtsModelInstallDialog: true,
        AiChatHistoryDrawer: true,
        AiChatSelectedContext: true,
        AiChatEmailReplyReviewCard: true,
        AiChatOutboundBatchReviewCard: true,
        AiChatRenameDialog: true,
        AgentTaskListDialog: true,
        WorkspaceBadge: true,
        WorkspaceRequiredCard: true,
        WorkspaceTrustCard: true,
        WorkspaceMemoryPanel: true,
        ScheduledLoopToolApprovalDialog: true,
        SkillApprovalCard: true,
        VBtn: {
          template: '<button><slot /></button>',
        },
        VIcon: true,
        VMenu: true,
        VList: true,
        VListItem: true,
        VDivider: true,
      },
    },
  });
}

describe("AiChatCenterSurface new chat model refresh", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
    createWorkspaceConversationIdMock.mockReturnValue("fresh-chat");
    getOpenAIChatModelsMock.mockResolvedValue({
      data: [{ id: "m1" }, { id: "m2" }],
      default_model: "m1",
    });
  });

  it("re-queries the model list when New chat is clicked from the empty state", async () => {
    const wrapper = mountSurface();
    await flushPromises();

    // 1 call from initial mount.
    expect(getOpenAIChatModelsMock).toHaveBeenCalledTimes(1);

    // Click 'New chat' button in empty state
    const newChatBtn = wrapper.find('[data-testid="workspace-empty-new-chat"]');
    expect(newChatBtn.exists()).toBe(true);
    await newChatBtn.trigger("click");
    await flushPromises();

    // Model list was re-queried on New chat click
    expect(getOpenAIChatModelsMock).toHaveBeenCalledTimes(2);
  });

  it("re-queries the model list when a new workspace chat is created", async () => {
    mountSurface();
    await flushPromises();

    // 1 call from initial mount.
    expect(getOpenAIChatModelsMock).toHaveBeenCalledTimes(1);

    // Call createAndSelectWorkspaceChat (as triggered by sidebar "New chat" button)
    await createAndSelectWorkspaceChat();
    await flushPromises();

    // Model list was re-queried
    expect(getOpenAIChatModelsMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the user's chosen model across the new chat refresh", async () => {
    const wrapper = mountSurface();
    await flushPromises();

    expect(getOpenAIChatModelsMock).toHaveBeenCalledTimes(1);

    // User selects model "m2"
    const setBtn = wrapper.find('[data-testid="set-model-m2"]');
    expect(setBtn.exists()).toBe(true);
    await setBtn.trigger("click");
    await flushPromises();

    const selector = wrapper.find('[data-testid="model-selector-stub"]');
    expect(selector.attributes("data-model")).toBe("m2");

    // Server now has a newly added model m3 as well
    getOpenAIChatModelsMock.mockResolvedValue({
      data: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      default_model: "m1",
    });

    // Click 'New chat'
    const newChatBtn = wrapper.find('[data-testid="workspace-empty-new-chat"]');
    await newChatBtn.trigger("click");
    await flushPromises();

    expect(getOpenAIChatModelsMock).toHaveBeenCalledTimes(2);
    // User's chosen model m2 is preserved, not reset to default m1
    expect(selector.attributes("data-model")).toBe("m2");
  });
});
