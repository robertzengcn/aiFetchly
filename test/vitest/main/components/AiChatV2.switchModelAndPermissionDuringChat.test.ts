import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import {
  streamChatV2Message,
  setChatV2ToolApprovalMode,
} from "@/views/api/aiChatV2";

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  // Incremental-compaction + recoverable-history APIs (added on test branch).
  // Mocked here so the merged component can mount: the switch-model /
  // tool-approval assertions below do not exercise compaction, they only
  // need these imports to exist.
  startCompaction: vi.fn().mockResolvedValue({ started: true }),
  getCompactionStatus: vi.fn().mockResolvedValue(null),
  cancelCompaction: vi.fn().mockResolvedValue({ cancelled: false }),
  subscribeCompactionProgress: vi.fn(),
  unsubscribeCompactionProgress: vi.fn(),
  detachChatV2ConversationStreamListeners: vi.fn(),
  isHistoryUiEnabled: vi.fn().mockResolvedValue(false),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getChatV2History: vi.fn().mockResolvedValue({
    messages: [],
    runtimeStatus: "idle",
  }),
  // Never-resolving stream keeps conversation A in isStreaming=true for the
  // duration of the test so chatIsRunning is true while we assert on selectors.
  streamChatV2Message: vi.fn(
    () =>
      new Promise(() => {
        /* intentionally never resolves */
      })
  ),
  stopChatV2Stream: vi.fn(),
  getChatV2PlanState: vi.fn().mockResolvedValue(null),
  compactChatV2Conversation: vi.fn(),
  answerChatV2Question: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  getOpenAIChatModels: vi.fn().mockResolvedValue({
    data: [
      { id: "test-model-a", name: "Test Model A" },
      { id: "test-model-b", name: "Test Model B" },
    ],
    default_model: "test-model-a",
  }),
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue("ask_for_approval"),
  setChatV2ToolApprovalMode: vi
    .fn()
    .mockImplementation(async (_convId: string, mode: string) => mode),
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
    model: "test-model-a",
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

vi.mock("@/views/api/workspaceWatch", () => ({
  acquireWorkspaceWatch: vi.fn(),
  releaseWorkspaceWatch: vi.fn(),
  previewWorkspaceAgents: vi.fn(),
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
        tool_approval_mode_ask: "Ask for approval",
        tool_approval_mode_auto: "Approve for me",
        tool_approval_mode_full: "Full access",
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

/**
 * Composer stub that exposes a send button. The real composer is not needed
 * here — we only need to drive AiChatV2's onSend to start a stream.
 */
const ComposerStub = defineComponent({
  name: "AiChatV2Composer",
  emits: ["send"],
  template: `<div>
    <button data-testid="send-first" @click="$emit('send', 'hello', [])">send</button>
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
          template: '<div data-testid="messages"></div>',
        },
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: ComposerStub,
        AiChatV2ModeSelector: true,
        // AiChatV2ModelSelector and AiChatV2ToolApprovalModeSelector are
        // intentionally NOT stubbed — these tests assert their real enabled
        // state mid-stream (both selectors stay editable while a stream runs).
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        // Recoverable-history components (added on test branch). Stubbed —
        // these tests assert the model / tool-approval selectors only.
        AiChatCompactionStatus: true,
        AiChatHistoryDrawer: true,
        AiChatSelectedContext: true,
        AiChatHistoryMessage: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        AgentTaskListDialog: true,
        WorkspaceRequiredCard: true,
        WorkspaceBadge: true,
        WorkspaceMemoryPanel: true,
        WorkspaceMemoryStatusBadge: true,
        ScheduledLoopToolApprovalDialog: true,
        AIConversationReportButton: true,
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
        VSelect: {
          inheritAttrs: false,
          props: ["modelValue", "items", "disabled", "loading"],
          emits: ["update:modelValue"],
          template: `<select data-testid="v-select" :disabled="disabled" @change="$emit('update:modelValue', $event.target.value)"><option v-for="i in items" :key="i.value" :value="i.value">{{ i.title }}</option></select>`,
        },
        VSheet: true,
        VSnackbar: true,
        VSpacer: true,
        VTextField: true,
        VTooltip: true,
      },
    },
  });
}

describe("AiChatV2 switch model & permission during chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the model selector and tool-approval selector enabled while a stream is running", async () => {
    const wrapper = mountChat();
    await flushPromises();

    // Start a never-resolving stream → chatIsRunning becomes true for the
    // duration of the test (streamChatV2Message never resolves, so the
    // terminal chunk never flips isStreaming back to false).
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();

    expect(streamChatV2Message).toHaveBeenCalledTimes(1);

    // The model selector stays enabled mid-stream: a model switch only
    // affects the next send (resolveModelForRequest() reads fresh on send
    // and the backend snapshots the model per stream), so it is safe to
    // change while streaming.
    const modelSelect = wrapper
      .findComponent({ name: "AiChatV2ModelSelector" })
      .find('[data-testid="v-select"]');
    expect(modelSelect.exists()).toBe(true);
    expect(modelSelect.attributes("disabled")).toBeFalsy();
    expect((modelSelect.element as HTMLSelectElement).disabled).toBe(false);

    // The tool-approval selector stays enabled mid-stream too. The user must
    // be able to change AI permissions during a chat — e.g. escalate to
    // "Approve for me" / "Full access" when a permission prompt is blocking
    // the in-flight turn, or lock back down to "Ask for approval". The
    // backend re-reads the persisted approval mode on EVERY tool call inside
    // a stream (ai-chat-v2-ipc.ts executeTool → AIChatToolApprovalModule
    // .getMode), so a mid-stream change takes effect on the next tool
    // execution in the same turn. "Full access" stays guarded by its own
    // confirmation dialog; the selector itself must not be greyed out.
    const toolSelect = wrapper
      .findComponent({ name: "AiChatV2ToolApprovalModeSelector" })
      .find('[data-testid="v-select"]');
    expect(toolSelect.exists()).toBe(true);
    expect(toolSelect.attributes("disabled")).toBeFalsy();
    expect((toolSelect.element as HTMLSelectElement).disabled).toBe(false);
  });

  it("persists a tool-approval-mode change mid-stream so it applies to the in-flight turn", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();

    expect(streamChatV2Message).toHaveBeenCalledTimes(1);

    // The selector is enabled mid-stream (previous test), so the user can
    // switch the mode through the UI. Drive the real
    // AiChatV2ToolApprovalModeSelector's v-select to "Approve for me".
    // "approve_for_me" is chosen (not "full_access") so the selector emits
    // immediately without routing through the full-access confirmation
    // dialog.
    const toolSelect = wrapper
      .findComponent({ name: "AiChatV2ToolApprovalModeSelector" })
      .find('[data-testid="v-select"]');
    (toolSelect.element as HTMLSelectElement).value = "approve_for_me";
    await toolSelect.trigger("change");
    await flushPromises();

    // The change must persist immediately via IPC so the next tool execution
    // in the running stream observes the new mode.
    expect(setChatV2ToolApprovalMode).toHaveBeenCalledWith(
      expect.any(String),
      "approve_for_me"
    );
  });
});
