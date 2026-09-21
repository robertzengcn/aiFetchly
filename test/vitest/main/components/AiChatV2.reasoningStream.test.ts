import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import { streamChatV2Message } from "@/views/api/aiChatV2";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";
import { AI_CHAT_REASONING_VISIBLE_STORAGE_KEY } from "@/views/utils/aiChatReasoningPreference";

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
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
  streamChatV2Message: vi.fn(),
  stopChatV2Stream: vi.fn(),
  getChatV2PlanState: vi.fn().mockResolvedValue(null),
  compactChatV2Conversation: vi.fn(),
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

vi.mock("@/views/api/aiContentReport", () => ({
  getAIContentReportCapabilities: vi.fn().mockResolvedValue({
    conversationReporting: { enabled: false },
  }),
  createAIContentReport: vi.fn(),
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

const ComposerStub = defineComponent({
  name: "AiChatV2Composer",
  emits: ["send"],
  template: `<div>
    <button data-testid="send-first" @click="$emit('send', 'hello', [])">
      send
    </button>
    <slot name="prepend" />
  </div>`,
});

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Messages: {
          props: ["messages", "showReasoning"],
          template: `<div data-testid="messages">
            <div
              v-for="m in messages"
              :key="m.id"
              :data-role="m.role"
            >
              <span data-testid="content">{{ m.content }}</span>
              <span
                v-if="showReasoning && m.metadata?.reasoning?.content"
                data-testid="reasoning"
              >{{ m.metadata.reasoning.content }}</span>
            </div>
          </div>`,
        },
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: ComposerStub,
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
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

describe("AiChatV2 live reasoning panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(AI_CHAT_REASONING_VISIBLE_STORAGE_KEY, "true");
  });

  it("keeps streamed reasoning on the assistant message after tokens arrive", async () => {
    vi.mocked(streamChatV2Message).mockImplementation(
      async (request, onChunk, onComplete) => {
        const conversationId = request.conversationId ?? "v2-test";
        const messageId = "asst-live-1";
        const emit = (chunk: ChatV2StreamChunk): void => {
          onChunk(chunk);
        };
        emit({
          eventType: "start",
          conversationId,
          messageId,
        });
        emit({
          eventType: "reasoning_delta",
          conversationId,
          messageId,
          reasoningDelta: "Considering the request...",
        });
        emit({
          eventType: "token",
          conversationId,
          messageId,
          contentDelta: "Final answer.",
        });
        onComplete({
          eventType: "complete",
          conversationId,
          messageId,
          fullContent: "Final answer.",
        });
      }
    );

    const wrapper = mountChat();
    await flushPromises();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();

    expect(streamChatV2Message).toHaveBeenCalledWith(
      expect.objectContaining({
        showReasoning: true,
        reasoning: { enabled: true, summary: "auto" },
      }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
    expect(wrapper.find('[data-testid="reasoning"]').text()).toBe(
      "Considering the request..."
    );
    expect(
      wrapper.find('[data-role="assistant"] [data-testid="content"]').text()
    ).toContain("Final answer.");
  });
});
