// test/vitest/main/components/AiChatV2.generatedImageExport.test.ts
//
// Component tests for the save-to-workspace action wiring in AiChatV2.vue:
// message-event -> IPC invoke payload correctness, workspace_required
// surfacing the request-workspace flow with a queued automatic retry once a
// workspace is approved, translated success toast (artifactExport strings),
// and the failure toast path.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import type { PropType } from "vue";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import {
  exportGeneratedImage,
  streamChatV2Message,
} from "@/views/api/aiChatV2";
import type {
  ChatV2GeneratedImageExportResult,
} from "@/views/api/aiChatV2";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
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
  exportGeneratedImage: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2Voice", () => ({
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT:
    "aifetchly:ai-chat-v2-voice-settings-changed",
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT:
    "aifetchly:ai-chat-v2-voice-models-changed",
  cancelVoiceJob: vi.fn().mockResolvedValue({ ok: true }),
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

const SAVE_SUCCESS_TEXT = "Saved image-1.png to your workspace.";
const WORKSPACE_REQUIRED_TEXT = "An approved workspace is required first.";
const SAVE_FAILED_TEXT = "Could not save to workspace.";

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
        cancel: "Cancel",
        input_placeholder: "Send a message",
        empty_title: "Start a conversation",
        empty_description: "Ask anything.",
        thinking: "AI is thinking",
        artifactExport: {
          permissionTitle: "Export generated artifacts",
          permissionDescription:
            "Copy these AiFetchly-generated artifacts into {destination}.",
          savedToWorkspace: "Saved {fileName} to your workspace.",
          saveFailed: "Could not save to workspace.",
        },
        imageTool: {
          errors: {
            workspaceRequired: WORKSPACE_REQUIRED_TEXT,
          },
        },
        generatedImageRefs: {
          useAsReference: "Use as reference",
          edit: "Edit",
          saveToWorkspace: "Save to workspace",
          send: "Send",
        },
      },
      workspace: {
        badgeLabel: "Workspace",
        notSet: "No workspace set",
      },
    },
  },
});

const DialogStub = defineComponent({
  name: "VDialog",
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  template: `<div v-if="modelValue"><slot /></div>`,
});

const SnackbarStub = defineComponent({
  name: "VSnackbar",
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  template: `<div v-if="modelValue" data-testid="snackbar-root"><slot /></div>`,
});

const ButtonStub = defineComponent({
  name: "VBtn",
  inheritAttrs: false,
  props: { disabled: { type: Boolean, default: false } },
  emits: ["click"],
  template:
    '<button type="button" :disabled="disabled" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
});

const CardStub = defineComponent({
  name: "VCard",
  template: "<div><slot /></div>",
});

const SlotPassThrough = (name: string): ReturnType<typeof defineComponent> =>
  defineComponent({
    name,
    template: "<div><slot /></div>",
  });

const GlobalVuetifyStubs: Record<string, ReturnType<typeof defineComponent>> =
  {
    VIcon: SlotPassThrough("VIcon"),
    VChip: SlotPassThrough("VChip"),
    VSpacer: SlotPassThrough("VSpacer"),
    VCardTitle: SlotPassThrough("VCardTitle"),
    VCardText: SlotPassThrough("VCardText"),
    VCardActions: SlotPassThrough("VCardActions"),
    VProgressLinear: SlotPassThrough("VProgressLinear"),
    VProgressCircular: SlotPassThrough("VProgressCircular"),
    VDivider: SlotPassThrough("VDivider"),
    VAlert: SlotPassThrough("VAlert"),
    VTooltip: SlotPassThrough("VTooltip"),
    VTextField: SlotPassThrough("VTextField"),
    VSheet: SlotPassThrough("VSheet"),
    VList: SlotPassThrough("VList"),
    VListItem: SlotPassThrough("VListItem"),
    VListItemTitle: SlotPassThrough("VListItemTitle"),
    VListItemSubtitle: SlotPassThrough("VListItemSubtitle"),
    VDialog: DialogStub,
    VSnackbar: SnackbarStub,
    VBtn: ButtonStub,
    VCard: CardStub,
  };

const ComposerStub = defineComponent({
  name: "AiChatV2Composer",
  props: {
    selectedGeneratedImages: {
      type: Array as PropType<readonly unknown[]>,
      default: () => [],
    },
    isStreaming: { type: Boolean, default: false },
    conversationId: {
      type: String as PropType<string | null>,
      default: null,
    },
  },
  emits: [
    "send",
    "stop",
    "request-workspace",
    "remove-generated-image",
    "clear-generated-images",
    "reorder-generated-images",
  ],
  template: `<div data-testid="composer"></div>`,
});

const MessagesStub = defineComponent({
  name: "AiChatV2Messages",
  props: {
    messages: { type: Array as PropType<unknown[]>, default: () => [] },
    errorMessage: {
      type: String as PropType<string | undefined>,
      required: false,
    },
  },
  emits: [
    "use-generated-image",
    "edit-generated-image",
    "save-generated-image",
    "grant-permission",
    "deny-permission",
    "approve-plan",
    "reject-plan",
    "request-plan-changes",
    "open-artifact",
    "copy-artifact-html",
  ],
  setup(_, { emit }) {
    const saveImage = (): void =>
      emit("save-generated-image", { messageId: "m1", imageIndex: 0 });
    return { saveImage };
  },
  template: `<div data-testid="messages">
    <button data-testid="msg-save-img" @click="saveImage">save</button>
  </div>`,
});

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      components: GlobalVuetifyStubs,
      stubs: {
        AiChatV2Messages: MessagesStub,
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
        SkillApprovalCard: true,
      },
    },
  });
}

/**
 * Text of the dedicated generated-image notice snackbar. Its own
 * data-testid survives stubbing via attribute fallthrough, so we can target
 * it precisely instead of matching any open snackbar.
 */
function noticeToastText(
  wrapper: ReturnType<typeof mountChat>
): string {
  const toast = wrapper.find('[data-testid="ai-chat-generated-error-toast"]');
  return toast.exists() ? toast.text() : "";
}

describe("AiChatV2 save-to-workspace wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(streamChatV2Message).mockImplementation(
      async (
        _request: ChatV2StreamRequest,
        _onChunk: unknown,
        _onComplete: unknown,
        _onError: unknown
      ) => {}
    );
  });

  it("invokes the IPC with the active conversationId and the exact opaque reference", async () => {
    vi.mocked(exportGeneratedImage).mockResolvedValueOnce({
      status: "exported",
      destinationPath: "/tmp/ws/generated-artifacts/image-1.png",
      relativeDestinationPath: "generated-artifacts/image-1.png",
      fileName: "image-1.png",
    } satisfies ChatV2GeneratedImageExportResult);

    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="msg-save-img"]').trigger("click");
    await flushPromises();

    expect(exportGeneratedImage).toHaveBeenCalledTimes(1);
    const [conversationId, reference] = vi.mocked(exportGeneratedImage).mock
      .calls[0];
    expect(typeof conversationId).toBe("string");
    expect(conversationId.startsWith("v2-")).toBe(true);
    expect(reference).toEqual({ messageId: "m1", imageIndex: 0 });
    expect(Object.keys(reference ?? {}).sort()).toEqual([
      "imageIndex",
      "messageId",
    ]);
  });

  it("shows the translated success toast reusing artifactExport strings", async () => {
    vi.mocked(exportGeneratedImage).mockResolvedValueOnce({
      status: "exported",
      destinationPath: "/tmp/ws/generated-artifacts/image-1.png",
      relativeDestinationPath: "generated-artifacts/image-1.png",
      fileName: "image-1.png",
    } satisfies ChatV2GeneratedImageExportResult);

    const wrapper = mountChat();
    await flushPromises();
    await wrapper.find('[data-testid="msg-save-img"]').trigger("click");
    await flushPromises();

    expect(noticeToastText(wrapper)).toContain(SAVE_SUCCESS_TEXT);
  });

  it("on workspace_required surfaces the request-workspace flow and retries automatically after approval", async () => {
    // First call: no approved workspace yet. Retry after approval succeeds.
    vi.mocked(exportGeneratedImage)
      .mockResolvedValueOnce({ status: "workspace_required" })
      .mockResolvedValueOnce({
        status: "exported",
        destinationPath: "/tmp/ws/generated-artifacts/image-1.png",
        relativeDestinationPath: "generated-artifacts/image-1.png",
        fileName: "image-1.png",
      } satisfies ChatV2GeneratedImageExportResult);

    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="msg-save-img"]').trigger("click");
    await flushPromises();

    // Guidance toast shown; the workspace-required card flow opened.
    expect(noticeToastText(wrapper)).toContain(
      WORKSPACE_REQUIRED_TEXT
    );
    expect(
      wrapper.findComponent({ name: "WorkspaceRequiredCard" }).exists()
    ).toBe(true);
    expect(exportGeneratedImage).toHaveBeenCalledTimes(1);

    // Approving a workspace completes the queued export without another click.
    const chatVm = wrapper.vm as unknown as {
      onWorkspaceApproved?: (workspaceId: number, rootPath: string) => void;
    };
    expect(typeof chatVm.onWorkspaceApproved).toBe("function");
    chatVm.onWorkspaceApproved?.(7, "/tmp/approved-ws");
    await flushPromises();

    const calls = vi.mocked(exportGeneratedImage).mock.calls;
    expect(calls).toHaveLength(2);
    // Same conversation and same reference are retried verbatim.
    expect(calls[1][0]).toBe(calls[0][0]);
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(noticeToastText(wrapper)).toContain(SAVE_SUCCESS_TEXT);
  });

  it("shows the failure toast when the IPC rejects", async () => {
    vi.mocked(exportGeneratedImage).mockRejectedValueOnce(
      new Error("generated_image_not_owned")
    );

    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="msg-save-img"]').trigger("click");
    await flushPromises();

    expect(noticeToastText(wrapper)).toContain(SAVE_FAILED_TEXT);
    expect(noticeToastText(wrapper)).toContain(
      "generated_image_not_owned"
    );
  });
});
