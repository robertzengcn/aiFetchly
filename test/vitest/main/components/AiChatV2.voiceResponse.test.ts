import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import AiChatVoiceSettingsPanel from "@/views/components/settings/AiChatVoiceSettingsPanel.vue";
import { streamChatV2Message } from "@/views/api/aiChatV2";
import {
  downloadVoiceModel,
  getVoiceSettings,
  getVoiceStatus,
  setVoiceSettings,
  synthesizeVoice,
} from "@/views/api/aiChatV2Voice";
import { prepareLocalAiRuntimeInstall } from "@/views/api/localAiRuntime";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";
import type { AiChatVoiceSettingsView } from "@/entityTypes/aiChatVoiceTypes";

const defaultVoiceSettings: AiChatVoiceSettingsView = {
  inputMode: "push_to_talk",
  ttsMode: "all_assistant_messages",
  autoSendTranscript: false,
  sttLanguage: "auto",
  ttsLanguage: "auto",
  sttModelId: "sherpa-onnx:stt:auto",
  ttsModelId: "sherpa-onnx:tts:auto",
  ttsSpeed: 1,
  maxRecordingMs: 60_000,
};

type StreamChatArgs = Parameters<typeof streamChatV2Message>;
type StreamChunkHandler = StreamChatArgs[1];
type StreamCompleteHandler = StreamChatArgs[2];

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 0 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
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
  getVoiceSettings: vi.fn(),
  getVoiceStatus: vi.fn().mockResolvedValue({
    sttState: "ready",
    ttsState: "ready",
  }),
  listVoiceModels: vi.fn().mockResolvedValue([]),
  notifyVoiceModelsChanged: vi.fn(),
  onVoiceModelDownloadProgress: vi.fn().mockReturnValue(() => undefined),
  setVoiceSettings: vi.fn(
    async (settings: AiChatVoiceSettingsView) => settings
  ),
  synthesizeVoice: vi.fn().mockResolvedValue({
    audioBase64: "d2F2",
    mimeType: "audio/wav",
  }),
}));

vi.mock("@/views/api/localAiRuntime", () => ({
  prepareLocalAiRuntimeInstall: vi.fn().mockResolvedValue({
    operationId: "op-1",
    runtimeId: "voice-sherpa",
    runtimeVersion: "1.0.0",
    archiveSizeBytes: 5_000_000,
    installedSizeBytes: 12_000_000,
    consentToken: "consent",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
  installLocalAiRuntime: vi.fn().mockResolvedValue(undefined),
  // AiChatV2.loadVoiceSettings calls getLocalAiRuntimeStatus(voice-sherpa) in
  // its onMounted Promise.all; leaving it unmocked makes that Promise.all
  // throw (undefined is not a function) and fall into the catch, which nulls
  // voiceSettings and breaks every spoken-response assertion. Return a ready
  // runtime so isLocalAiRuntimeUsable(state) is true and the voice path is
  // not spuriously blocked.
  getLocalAiRuntimeStatus: vi.fn().mockResolvedValue({
    runtimeId: "voice-sherpa",
    state: "ready",
    platform: process.platform,
    arch: process.arch,
  }),
  onLocalAiRuntimeProgress: vi.fn().mockReturnValue(() => undefined),
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
          settings_title: "Voice",
          runtime_unavailable: "Local voice runtime is unavailable.",
          enable_input: "Enable voice input",
          enable_spoken_responses: "Enable spoken responses",
          disable_spoken_responses: "Disable spoken responses",
          speak_after_voice_input: "Speak only after voice input",
          auto_send: "Send voice transcript automatically",
          stt_language: "Speech recognition language",
          tts_language: "Speech response language",
          stt_model: "Speech recognition model",
          tts_model: "Speech response model",
          speech_speed: "Speech speed",
          max_recording_duration: "Max recording duration",
          voice_models: "Voice Models",
          tts_model_missing:
            "Spoken responses need a speech model. Install it to enable.",
          install_tts_model: "Install speech model",
          tts_runtime_missing: "Spoken responses need the local voice runtime.",
        },
      },
      common: {
        loading: "Loading…",
      },
      workspace: {
        badgeLabel: "Workspace",
        notSet: "No workspace set",
      },
      aiProvider: {
        title: "AI Provider",
      },
    },
  },
});

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Messages: true,
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: {
          emits: ["send", "stop"],
          template:
            '<div><button data-testid="send" @click="$emit(\'send\', \'please speak\', [])">send</button><button data-testid="stop" @click="$emit(\'stop\')">stop</button><slot name="prepend" /></div>',
        },
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        AgentTaskListDialog: true,
        WorkspaceRequiredCard: true,
        WorkspaceBadge: true,
        WorkspaceMemoryPanel: true,
        VAlert: true,
        VBtn: {
          emits: ["click"],
          template:
            '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
        },
        VCard: true,
        VCardText: true,
        VCardTitle: true,
        VChip: true,
        VDialog: true,
        VDivider: true,
        VIcon: { template: "<span><slot /></span>" },
        VList: true,
        VListItem: true,
        VListItemSubtitle: true,
        VListItemTitle: true,
        VProgressCircular: true,
        VProgressLinear: true,
        VSnackbar: true,
        VSpacer: true,
        VTextField: true,
        VTooltip: true,
      },
    },
  });
}

describe("AiChatV2 spoken responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVoiceSettings).mockResolvedValue({ ...defaultVoiceSettings });
    vi.mocked(getVoiceStatus).mockResolvedValue({
      sttState: "ready",
      ttsState: "ready",
    });
    vi.mocked(streamChatV2Message).mockImplementation(
      async (
        request: ChatV2StreamRequest,
        onChunk: StreamChunkHandler,
        onComplete: StreamCompleteHandler
      ): Promise<void> => {
        const conversationId = request.conversationId ?? "v2-test";
        onChunk({
          eventType: "token",
          conversationId,
          contentDelta:
            "This is a complete sentence that should be spoken aloud.",
        });
        onComplete({
          eventType: "complete",
          conversationId,
          fullContent:
            "This is a complete sentence that should be spoken aloud.",
        });
      }
    );
  });

  it("re-arms speech playback for the next assistant reply after Stop", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="stop"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="send"]').trigger("click");

    await vi.waitFor(() => expect(synthesizeVoice).toHaveBeenCalled());
  });

  it("speaks assistant text that arrives only in the complete event", async () => {
    const completeOnlyText =
      "This complete-only response should still be spoken aloud.";
    vi.mocked(streamChatV2Message).mockImplementationOnce(
      async (
        request: ChatV2StreamRequest,
        _onChunk: StreamChunkHandler,
        onComplete: StreamCompleteHandler
      ): Promise<void> => {
        onComplete({
          eventType: "complete",
          conversationId: request.conversationId ?? "v2-test",
          fullContent: completeOnlyText,
        });
      }
    );
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send"]').trigger("click");

    await vi.waitFor(() => expect(synthesizeVoice).toHaveBeenCalled());
    expect(vi.mocked(synthesizeVoice).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ text: completeOnlyText })
    );
  });

  it("uses complete text for speech after whitespace-only token deltas", async () => {
    const completeText =
      "Whitespace-only streaming tokens should not mute this final reply.";
    vi.mocked(streamChatV2Message).mockImplementationOnce(
      async (
        request: ChatV2StreamRequest,
        onChunk: StreamChunkHandler,
        onComplete: StreamCompleteHandler
      ): Promise<void> => {
        const conversationId = request.conversationId ?? "v2-test";
        onChunk({
          eventType: "token",
          conversationId,
          contentDelta: "\n ",
        });
        onComplete({
          eventType: "complete",
          conversationId,
          fullContent: completeText,
        });
      }
    );
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send"]').trigger("click");

    await vi.waitFor(() => expect(synthesizeVoice).toHaveBeenCalled());
    expect(vi.mocked(synthesizeVoice).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ text: completeText })
    );
  });

  it("does not speak complete fullContent twice when token deltas were already spoken", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send"]').trigger("click");

    await vi.waitFor(() => expect(synthesizeVoice).toHaveBeenCalledTimes(1));
  });

  it("shows a header speaker button that enables spoken responses for all assistant messages", async () => {
    vi.mocked(getVoiceSettings).mockResolvedValueOnce({
      ...defaultVoiceSettings,
      ttsMode: "disabled",
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper
      .find('[data-testid="spoken-response-toggle"]')
      .trigger("click");

    await vi.waitFor(() =>
      expect(setVoiceSettings).toHaveBeenCalledWith(
        expect.objectContaining({ ttsMode: "all_assistant_messages" })
      )
    );
  });

  it("does not enable spoken responses when the TTS model is missing; offers to install the speech model", async () => {
    vi.mocked(getVoiceSettings).mockResolvedValue({
      ...defaultVoiceSettings,
      ttsMode: "disabled",
    });
    vi.mocked(getVoiceStatus).mockResolvedValue({
      sttState: "ready",
      ttsState: "missing_model",
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper
      .find('[data-testid="spoken-response-toggle"]')
      .trigger("click");
    await flushPromises();

    // Must NOT persist an enablement that would silently fail every reply.
    expect(setVoiceSettings).not.toHaveBeenCalled();

    // Guidance is surfaced with an install affordance in the chat surface.
    const installBtn = wrapper.find('[data-testid="install-tts-model"]');
    expect(installBtn.exists()).toBe(true);
    await installBtn.trigger("click");
    await flushPromises();

    await vi.waitFor(() =>
      expect(downloadVoiceModel).toHaveBeenCalledWith("sherpa-onnx:tts:auto")
    );
  });

  it("does not enable spoken responses when the TTS runtime is unavailable; opens the runtime installer", async () => {
    vi.mocked(getVoiceSettings).mockResolvedValue({
      ...defaultVoiceSettings,
      ttsMode: "disabled",
    });
    vi.mocked(getVoiceStatus).mockResolvedValue({
      sttState: "unavailable",
      ttsState: "unavailable",
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper
      .find('[data-testid="spoken-response-toggle"]')
      .trigger("click");
    await flushPromises();

    expect(setVoiceSettings).not.toHaveBeenCalled();
    expect(prepareLocalAiRuntimeInstall).toHaveBeenCalledWith("voice-sherpa");
  });
});

function mountVoiceSettingsPanel() {
  return mount(AiChatVoiceSettingsPanel, {
    global: {
      plugins: [i18n],
      stubs: {
        VAlert: { template: "<div><slot /></div>" },
        VBtn: true,
        VChip: true,
        VCol: true,
        VDivider: true,
        VIcon: true,
        VProgressCircular: true,
        VRow: true,
        VSelect: true,
        VSlider: true,
        VSwitch: {
          props: ["label"],
          emits: ["update:modelValue"],
          template:
            '<button class="voice-switch" :data-label="label" @click="$emit(\'update:modelValue\', true)">{{ label }}</button>',
        },
        VTextField: true,
      },
    },
  });
}

describe("AiChatVoiceSettingsPanel spoken response mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVoiceSettings).mockResolvedValue({
      ...defaultVoiceSettings,
      ttsMode: "disabled",
    });
    vi.mocked(getVoiceStatus).mockResolvedValue({
      sttState: "ready",
      ttsState: "ready",
    });
  });

  it("enables spoken responses for normal assistant messages by default", async () => {
    const wrapper = mountVoiceSettingsPanel();
    await flushPromises();

    const spokenSwitch = wrapper
      .findAll(".voice-switch")
      .find((button) =>
        button.attributes("data-label")?.includes("spoken responses")
      );
    expect(spokenSwitch?.exists()).toBe(true);
    await spokenSwitch?.trigger("click");

    await vi.waitFor(() =>
      expect(setVoiceSettings).toHaveBeenCalledWith(
        expect.objectContaining({ ttsMode: "all_assistant_messages" })
      )
    );
  });

  it("does not enable spoken responses when the TTS model is missing; shows an error", async () => {
    vi.mocked(getVoiceSettings).mockResolvedValue({
      ...defaultVoiceSettings,
      ttsMode: "disabled",
    });
    vi.mocked(getVoiceStatus).mockResolvedValue({
      sttState: "ready",
      ttsState: "missing_model",
    });
    const wrapper = mountVoiceSettingsPanel();
    await flushPromises();

    const spokenSwitch = wrapper
      .findAll(".voice-switch")
      .find((button) =>
        button.attributes("data-label")?.includes("spoken responses")
      );
    await spokenSwitch?.trigger("click");
    await flushPromises();

    expect(setVoiceSettings).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("speech model");
  });
});
