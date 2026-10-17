import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import { streamChatV2Message } from "@/views/api/aiChatV2";
import { installQueueSendBridge } from "./helpers/queueSendBridge";

installQueueSendBridge();

vi.mock("@/views/components/aiChatV2/aiChatV2Attachment", () => ({
  buildUploadedAttachments: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  cancelCompaction: vi.fn().mockResolvedValue(false),
  denyChatV2ToolPermission: vi.fn().mockResolvedValue({ ok: true }),
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
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  getCompactionStatus: vi.fn().mockResolvedValue(null),
  subscribeCompactionProgress: vi.fn(),
  unsubscribeCompactionProgress: vi.fn(),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getChatV2History: vi.fn().mockResolvedValue({
    messages: [],
    runtimeStatus: "idle",
  }),
  streamChatV2Message: vi.fn(),
  stopChatV2Stream: vi.fn(),
  getChatV2PlanState: vi.fn().mockResolvedValue(null),
  startCompaction: vi.fn().mockResolvedValue({ started: true }),
  isHistoryUiEnabled: vi.fn().mockResolvedValue(true),
  answerChatV2Question: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  getOpenAIChatModels: vi.fn().mockResolvedValue({
    data: [{ id: "test-model", name: "Test Model" }],
    default_model: "test-model",
  }),
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue("ask_for_approval"),
  setChatV2ToolApprovalMode: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2Voice", () => ({
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT:
    "aifetchly:ai-chat-v2-voice-settings-changed",
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT:
    "aifetchly:ai-chat-v2-voice-models-changed",
  cancelVoiceJob: vi.fn().mockResolvedValue({ ok: true }),
  cancelVoiceModelDownload: vi.fn().mockResolvedValue(undefined),
  downloadVoiceModel: vi.fn().mockResolvedValue(undefined),
  getVoiceSettings: vi.fn().mockResolvedValue({
    spokenResponsesEnabled: false,
    spokenResponsePolicy: "off",
  }),
  getVoiceStatus: vi.fn().mockResolvedValue({
    sttState: "ready",
    ttsState: "ready",
  }),
  listVoiceModels: vi.fn().mockResolvedValue([]),
  notifyVoiceModelsChanged: vi.fn(),
  onVoiceModelDownloadProgress: vi.fn().mockReturnValue(() => undefined),
  setVoiceSettings: vi.fn(async (settings: unknown) => settings),
  synthesizeVoice: vi.fn(),
}));

vi.mock("@/views/api/aiProvider", () => ({
  AI_PROVIDER_SETTINGS_CHANGED_EVENT: "aifetchly:ai-provider-settings-changed",
  getAIProviderSettings: vi.fn().mockResolvedValue({
    provider: "openai",
    baseUrl: "",
    apiKeySet: true,
    model: "test-model",
  }),
}));

vi.mock("@/views/api/workspace", () => ({
  getWorkspace: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/views/api/aiWorkspaceMemory", () => ({
  workspaceMemoryApi: {
    getSummary: vi.fn().mockResolvedValue({ count: 0 }),
    list: vi.fn().mockResolvedValue({ status: true, data: [] }),
  },
}));

vi.mock("@/views/api/aiChat", () => ({
  subscribeToFileOperations: vi.fn(),
  unsubscribeFromFileOperations: vi.fn(),
}));

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn().mockResolvedValue({
    status: true,
    commands: [],
    diagnostics: [],
    msg: "",
  }),
  dispatchSlashCommand: vi.fn(),
  reloadAifetchlyConfig: vi.fn(),
  getAifetchlyConfigStatus: vi.fn(),
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("@/views/api/aiChatGoal", () => ({
  createGoal: vi.fn().mockResolvedValue(null),
  getActiveGoal: vi.fn().mockResolvedValue(null),
  startGoalLoop: vi.fn().mockResolvedValue(null),
  stopGoalLoop: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/views/api/aiChatScheduledLoop", () => ({
  getScheduledLoopStatus: vi.fn().mockResolvedValue(null),
  createScheduledLoop: vi.fn(),
  controlScheduledLoop: vi.fn(),
  onScheduledLoopEvent: vi.fn().mockReturnValue(() => undefined),
  subscribeConversationUpdated: vi.fn(),
  unsubscribeConversationUpdated: vi.fn(),
  subscribeScheduledStream: vi.fn(),
  unsubscribeScheduledStream: vi.fn(),
}));

vi.mock("@/views/api/localAiRuntime", () => ({
  getLocalAiRuntimeStatus: vi.fn().mockResolvedValue(null),
  installLocalAiRuntime: vi.fn(),
  onLocalAiRuntimeProgress: vi.fn().mockReturnValue(() => undefined),
  prepareLocalAiRuntimeInstall: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        title: "AI Assistant",
        clear_chat: "Clear chat",
        compact_conversation: "Compact conversation",
        conversation_history: "Conversation history",
        manage_mcp_tools: "Manage MCP Tools",
        new_conversation: "New conversation",
        voice: {
          enable_spoken_responses: "Enable spoken responses",
          disable_spoken_responses: "Disable spoken responses",
        },
      },
      workspace: {
        badgeLabel: "Workspace",
        notSet: "No workspace set",
      },
    },
  },
});

const TEST_IMAGE_FILE = new File(["x"], "a.png", { type: "image/png" });

const ComposerStub = defineComponent({
  name: "AiChatV2Composer",
  emits: ["send"],
  data: () => ({ accepted: false, testFile: TEST_IMAGE_FILE }),
  methods: {
    send(text: string, files?: File[], options?: Record<string, unknown>): void {
      this.accepted = false;
      this.$emit("send", text, files ?? [], {
        ...options,
        onAccepted: () => {
          this.accepted = true;
        },
      });
    },
  },
  template: `<div>
    <button data-testid="send" @click="send('hello world')">send</button>
    <button data-testid="send-file" @click="send('with file', [testFile])">file</button>
    <button data-testid="send-goal" @click="send('/goal')">goal</button>
    <button data-testid="send-loop" @click="send('/loop')">loop</button>
    <button data-testid="send-slash" @click="send('/plugin:thing')">slash</button>
    <span data-testid="accepted">{{ accepted }}</span>
    <slot name="prepend" />
  </div>`,
});

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Messages: {
          props: ["messages"],
          template:
            '<div data-testid="messages">{{ messages.map((m) => `${m.content}|${m.timestamp}`).join("\\n") }}</div>',
        },
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: ComposerStub,
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        AiChatV2ToolApprovalModeSelector: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        AgentTaskListDialog: true,
        WorkspaceRequiredCard: true,
        WorkspaceBadge: true,
        WorkspaceMemoryPanel: true,
        WorkspaceMemoryStatusBadge: true,
        ScheduledLoopToolApprovalDialog: true,
        VBtn: {
          template:
            '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
        },
        VAlert: true,
        VCard: true,
        VCardActions: true,
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
        VSelect: true,
        VSheet: true,
        VSnackbar: true,
        VSpacer: true,
        VTextField: true,
        VTooltip: true,
      },
    },
  });
}

describe("AiChatV2 accepted-send contract (R11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installQueueSendBridge();
    // The bridge drives streamChatV2Message with .then(...) — a bare vi.fn()
    // returns undefined and would throw inside createChatV2PendingMessage.
    vi.mocked(streamChatV2Message).mockImplementation(async () => undefined);
  });

  async function acceptedText(wrapper: ReturnType<typeof mountChat>) {
    await flushPromises();
    return wrapper.find('[data-testid="accepted"]').text();
  }

  it("accepts an ordinary send only after the durable enqueue (bridge receipt)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.find('[data-testid="send"]').trigger("click");
    expect(await acceptedText(wrapper)).toBe("true");
    wrapper.unmount();
  });

  it("retains the draft when the durable enqueue is rejected (null receipt)", async () => {
    const { createChatV2PendingMessage } = await import("@/views/api/aiChatV2");
    vi.mocked(createChatV2PendingMessage).mockResolvedValueOnce(null);
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.find('[data-testid="send"]').trigger("click");
    expect(await acceptedText(wrapper)).toBe("false");
    wrapper.unmount();
  });

  it("retains the draft when /goal has no objective (validation failure)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.find('[data-testid="send-goal"]').trigger("click");
    expect(await acceptedText(wrapper)).toBe("false");
    wrapper.unmount();
  });

  it("retains the draft when /loop has no count (validation failure)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.find('[data-testid="send-loop"]').trigger("click");
    expect(await acceptedText(wrapper)).toBe("false");
    wrapper.unmount();
  });

  it("retains the draft when attachment preparation fails", async () => {
    const { buildUploadedAttachments } = await import(
      "@/views/components/aiChatV2/aiChatV2Attachment"
    );
    vi.mocked(buildUploadedAttachments).mockRejectedValueOnce(
      new Error("attachment too large")
    );
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.find('[data-testid="send-file"]').trigger("click");
    expect(await acceptedText(wrapper)).toBe("false");
    wrapper.unmount();
  });

  it("retains the draft when a slash command is denied by the registry", async () => {
    const { dispatchSlashCommand } = await import("@/views/api/slashCommands");
    vi.mocked(dispatchSlashCommand).mockResolvedValueOnce({
      status: false,
      msg: "not available",
    });
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.find('[data-testid="send-slash"]').trigger("click");
    expect(await acceptedText(wrapper)).toBe("false");
    wrapper.unmount();
  });
});
