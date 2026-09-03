// test/vitest/main/components/AiChatV2.generatedImageEditing.test.ts
//
// Component tests for conversation-scoped generated-image selection wiring in
// AiChatV2.vue: message-event -> composer tray, per-conversation isolation,
// deterministic inference preflight (ambiguity chooser / batch confirmation /
// fusion guard), generatedImageReferences on the stream request, draft
// clearing on accepted turns, and localized generated_image_* error codes.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { computed, defineComponent } from "vue";
import type { PropType } from "vue";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import { streamChatV2Message } from "@/views/api/aiChatV2";
import { installQueueSendBridge } from "./helpers/queueSendBridge";

installQueueSendBridge();
import type {
  ChatV2StreamRequest,
} from "@/entityTypes/aiChatV2Types";
import type { GeneratedImageReferenceView } from "@/views/components/aiChatV2/generatedImageReferenceView";

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
        cancel: "Cancel",
        input_placeholder: "Send a message",
        empty_title: "Start a conversation",
        empty_description: "Ask anything.",
        thinking: "AI is thinking",
        generatedImageRefs: {
          useAsReference: "Use as reference",
          edit: "Edit",
          remove: "Remove",
          clearAll: "Clear all",
          moveUp: "Move up",
          moveDown: "Move down",
          referenceTrayTitle: "Reference images",
          limitReached: "You can reference up to 3 images per request.",
          batchOffer:
            "More than 3 images were selected. Run them as a batch of independent edits instead?",
          batchConfirmTitle: "Process as batch?",
          batchConfirmBody:
            "Each selected image will be edited independently in a background batch. This may take a while.",
          send: "Send",
          errors: {
            generated_image_reference_invalid:
              "This image reference is no longer valid. Select the image again.",
            generated_image_not_owned:
              "You can only reference images generated in this conversation.",
            generated_image_missing:
              "The original image is no longer available. Regenerate it or choose another reference.",
            generated_image_outside_store:
              "The image source is outside the trusted storage area and cannot be used.",
            generated_image_symlink_rejected:
              "This file is not a regular stored image. Choose another generated artifact.",
            generated_image_unsupported_type:
              "Unsupported image type. Choose a PNG, JPEG, or WebP image.",
            generated_image_too_large:
              "This image exceeds the size limit. Try fewer or smaller images.",
            generated_image_dimension_limit:
              "This image exceeds the dimension limit. Resize it or regenerate at a smaller size.",
            generated_image_reference_limit:
              "Too many referenced images for one request. Use batch processing for independent edits.",
            generated_image_ambiguous:
              "Several images could match your request. Select the intended one.",
            generated_image_fusion_limit:
              "Combining images is limited to 3 at a time. Edit the rest separately or as a batch.",
            generated_image_batch_partial:
              "Some batch items failed. Keep the successes and retry the failed items.",
            generated_image_batch_cancelled:
              "Batch stopped. Completed results are kept; you can resume the remaining items.",
          },
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
  template: `<div v-if="modelValue" data-testid="dialog-root"><slot /></div>`,
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

// Pass-through implementations registered as GLOBAL components so the
// unresolved `<v-*>` tags in AiChatV2.vue resolve to real components and
// their default slots render inside dialogs/snackbars.
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
      type: Array as PropType<readonly GeneratedImageReferenceView[]>,
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
  setup(props, { emit }) {
    const trayCount = computed<number>(
      () => props.selectedGeneratedImages.length
    );
    const trayRefs = computed<string>(() =>
      JSON.stringify(
        props.selectedGeneratedImages.map((item) => item.reference)
      )
    );
    const sendText = (value: string): void => {
      emit("send", value, []);
    };
    const removeFirst = (): void => {
      const first: GeneratedImageReferenceView | undefined =
        props.selectedGeneratedImages[0];
      if (first) emit("remove-generated-image", first.reference);
    };
    const clearAll = (): void => {
      emit("clear-generated-images");
    };
    const reorderReverse = (): void => {
      emit(
        "reorder-generated-images",
        [...props.selectedGeneratedImages]
          .map((item) => item.reference)
          .reverse()
      );
    };
    return {
      trayCount,
      trayRefs,
      sendText,
      removeFirst,
      clearAll,
      reorderReverse,
    };
  },
  template: `<div data-testid="composer">
    <span data-testid="tray-count">{{ trayCount }}</span>
    <span data-testid="tray-refs">{{ trayRefs }}</span>
    <button data-testid="composer-send-singular" @click="sendText('edit the image')">s</button>
    <button data-testid="composer-send-plural" @click="sendText('edit all of them')">p</button>
    <button data-testid="composer-send-fusion" @click="sendText('combine all of them into one')">f</button>
    <button data-testid="tray-remove-first" @click="removeFirst">rm</button>
    <button data-testid="tray-clear" @click="clearAll">clear</button>
    <button data-testid="tray-reorder" @click="reorderReverse">rev</button>
    <slot name="prepend" />
  </div>`,
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
    "grant-permission",
    "deny-permission",
    "approve-plan",
    "reject-plan",
    "request-plan-changes",
    "open-artifact",
    "copy-artifact-html",
  ],
  setup(_, { emit }) {
    const useImage = (): void =>
      emit("use-generated-image", { messageId: "m1", imageIndex: 0 });
    const editImage = (): void =>
      emit("edit-generated-image", { messageId: "m1", imageIndex: 1 });
    return { useImage, editImage };
  },
  template: `<div data-testid="messages">
    <span data-testid="messages-error">{{ errorMessage ?? "" }}</span>
    <button data-testid="msg-use-img" @click="useImage">use</button>
    <button data-testid="msg-edit-img" @click="editImage">edit</button>
  </div>`,
});

interface MountChatOptions {
  openConversationRequest?: { id: number; conversationId: string };
}

function mountChat(options: MountChatOptions = {}) {
  return mount(AiChatV2, {
    props: options.openConversationRequest
      ? { openConversationRequest: options.openConversationRequest }
      : {},
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

interface StreamCallbacks {
  onChunk: (chunk: { eventType: string }) => void;
  onComplete: (chunk: { eventType: string; fullContent?: string }) => void;
  onError: (error: Error) => void;
}

function lastStreamCall(): {
  request: ChatV2StreamRequest;
  callbacks: StreamCallbacks;
} {
  const mock = vi.mocked(streamChatV2Message);
  const call = mock.mock.calls[mock.mock.calls.length - 1];
  if (!call) throw new Error("streamChatV2Message was not called");
  return {
    request: call[0],
    callbacks: {
      onChunk: call[1] as StreamCallbacks["onChunk"],
      onComplete: call[2] as StreamCallbacks["onComplete"],
      onError: call[3] as StreamCallbacks["onError"],
    },
  };
}

function assistantMessagesWithImages(
  conversationId: string,
  messageId: string,
  imageCount: number
): Array<Record<string, unknown>> {
  return [
    {
      id: messageId,
      conversationId,
      role: "assistant",
      content: "generated",
      timestamp: new Date().toISOString(),
      messageType: "message",
      metadata: {
        source: "chat-v2",
        generatedImages: Array.from({ length: imageCount }, (_v, i) => ({
          type: "image",
          url: `blob://img-${i}`,
          file_name: `image-${i + 1}.png`,
        })),
      },
    },
  ];
}

async function mockHistoryWithImages(imageCount: number): Promise<void> {
  const apiModule = await import("@/views/api/aiChatV2");
  vi.mocked(apiModule.getChatV2History).mockImplementation(
    async (conversationId: string) => ({
      conversationId,
      messages:
        conversationId === "conv-A"
          ? (assistantMessagesWithImages(
              "conv-A",
              "m1",
              imageCount
            ) as never)
          : [],
      totalMessages: 1,
      runtimeStatus: "idle",
    })
  );
}

describe("AiChatV2 generated-image editing wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installQueueSendBridge();
    vi.mocked(streamChatV2Message).mockImplementation(
      async (
        _request: ChatV2StreamRequest,
        _onChunk: unknown,
        _onComplete: unknown,
        _onError: unknown
      ) => {}
    );
  });

  it("adds and toggles a reference via message events (tray updates)", async () => {
    const wrapper = mountChat();
    await flushPromises();

    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("0");

    await wrapper.find('[data-testid="msg-use-img"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("1");
    expect(wrapper.find('[data-testid="tray-refs"]').text()).toBe(
      JSON.stringify([{ messageId: "m1", imageIndex: 0 }])
    );

    // Toggling the same reference removes it again.
    await wrapper.find('[data-testid="msg-use-img"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("0");
  });

  it("replaces the selection with a single reference on edit event", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="msg-use-img"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("1");

    await wrapper.find('[data-testid="msg-edit-img"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="tray-refs"]').text()).toBe(
      JSON.stringify([{ messageId: "m1", imageIndex: 1 }])
    );
  });

  it("isolates selections per conversation and restores them on switch back", async () => {
    await mockHistoryWithImages(2);

    const wrapper = mountChat();
    await flushPromises();

    // Open conversation A and pick an image there.
    let openRequestId = 0;
    openRequestId += 1;
    await wrapper.setProps({
      openConversationRequest: { id: openRequestId, conversationId: "conv-A" },
    });
    await flushPromises();
    await wrapper.find('[data-testid="msg-use-img"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("1");

    // Switch to conversation B: its tray starts empty.
    openRequestId += 1;
    await wrapper.setProps({
      openConversationRequest: { id: openRequestId, conversationId: "conv-B" },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("0");

    // Back to A: the selection was restored.
    openRequestId += 1;
    await wrapper.setProps({
      openConversationRequest: { id: openRequestId, conversationId: "conv-A" },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("1");
    expect(wrapper.find('[data-testid="tray-refs"]').text()).toBe(
      JSON.stringify([{ messageId: "m1", imageIndex: 0 }])
    );
  });

  it("attaches generatedImageReferences to the request and clears the draft after completion", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="msg-use-img"]').trigger("click");
    await flushPromises();
    await wrapper
      .find('[data-testid="composer-send-singular"]')
      .trigger("click");
    await flushPromises();

    expect(streamChatV2Message).toHaveBeenCalledTimes(1);
    const { request, callbacks } = lastStreamCall();
    expect(request.generatedImageReferences).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);
    expect(request.message.length).toBeGreaterThan(0);

    callbacks.onComplete({ eventType: "complete", fullContent: "done" });
    await flushPromises();

    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("0");
  });

  it("keeps the draft when the stream fails and localizes generated_image_* error codes", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="msg-use-img"]').trigger("click");
    await flushPromises();
    await wrapper
      .find('[data-testid="composer-send-singular"]')
      .trigger("click");
    await flushPromises();

    const { callbacks } = lastStreamCall();
    const error: Error & { errorCode?: string } = new Error("denied");
    error.errorCode = "generated_image_not_owned";
    callbacks.onError(error);
    await flushPromises();

    expect(wrapper.find('[data-testid="messages-error"]').text()).toContain(
      "You can only reference images generated in this conversation."
    );
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("1");
  });

  it("opens the ambiguity chooser; picking a candidate sends it as the sole reference", async () => {
    await mockHistoryWithImages(2);

    const wrapper = mountChat();
    await flushPromises();
    await wrapper.setProps({
      openConversationRequest: { id: 1, conversationId: "conv-A" },
    });
    await flushPromises();

    await wrapper
      .find('[data-testid="composer-send-singular"]')
      .trigger("click");
    await flushPromises();

    expect(streamChatV2Message).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="ai-chat-generated-chooser"]').exists()
    ).toBe(true);

    await wrapper
      .find('[data-testid="ai-chat-generated-candidate-0"]')
      .trigger("click");
    await flushPromises();

    expect(streamChatV2Message).toHaveBeenCalledTimes(1);
    const { request } = lastStreamCall();
    expect(request.generatedImageReferences).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);
  });

  it("discards a pending chooser send when the active conversation switches", async () => {
    await mockHistoryWithImages(2);

    const wrapper = mountChat();
    await flushPromises();
    await wrapper.setProps({
      openConversationRequest: { id: 1, conversationId: "conv-A" },
    });
    await flushPromises();

    // Open the chooser: ambiguous singular wording over multiple images.
    await wrapper
      .find('[data-testid="composer-send-singular"]')
      .trigger("click");
    await flushPromises();
    expect(streamChatV2Message).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="ai-chat-generated-chooser"]').exists()
    ).toBe(true);

    // Switch to conv-B while the chooser is still up.
    await wrapper.setProps({
      openConversationRequest: { id: 2, conversationId: "conv-B" },
    });
    await flushPromises();

    // The chooser closed with the switch and conv-B's tray stayed empty.
    expect(
      wrapper.find('[data-testid="ai-chat-generated-chooser"]').exists()
    ).toBe(false);
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("0");
    expect(streamChatV2Message).not.toHaveBeenCalled();

    // Defense in depth: even a late click on a stale candidate must not
    // replay conv-A's send into the newly active conversation.
    const chatVm = wrapper.vm as unknown as {
      chooseAmbiguityCandidate?: (
        view: GeneratedImageReferenceView
      ) => void;
    };
    expect(typeof chatVm.chooseAmbiguityCandidate).toBe("function");
    chatVm.chooseAmbiguityCandidate?.({
      reference: { messageId: "m1", imageIndex: 1 },
      fileName: "image-2.png",
    });
    await flushPromises();
    expect(streamChatV2Message).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("0");
  });

  it("cancel keeps the selection untouched and does not stream", async () => {
    await mockHistoryWithImages(2);

    const wrapper = mountChat();
    await flushPromises();
    await wrapper.setProps({
      openConversationRequest: { id: 1, conversationId: "conv-A" },
    });
    await flushPromises();

    await wrapper
      .find('[data-testid="composer-send-singular"]')
      .trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="ai-chat-generated-chooser"]').exists()
    ).toBe(true);

    await wrapper
      .find('[data-testid="ai-chat-generated-chooser-cancel"]')
      .trigger("click");
    await flushPromises();

    expect(streamChatV2Message).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="ai-chat-generated-chooser"]').exists()
    ).toBe(false);
    expect(wrapper.find('[data-testid="tray-count"]').text()).toBe("0");
  });

  it("batch confirmation gates the send; confirming sends plain text without references", async () => {
    await mockHistoryWithImages(4);

    const wrapper = mountChat();
    await flushPromises();
    await wrapper.setProps({
      openConversationRequest: { id: 1, conversationId: "conv-A" },
    });
    await flushPromises();

    await wrapper.find('[data-testid="composer-send-plural"]').trigger("click");
    await flushPromises();

    expect(streamChatV2Message).not.toHaveBeenCalled();
    const confirmDialog = wrapper.find(
      '[data-testid="ai-chat-generated-batch-confirm"]'
    );
    expect(confirmDialog.exists()).toBe(true);
    expect(confirmDialog.text()).toContain("Process as batch?");

    await wrapper
      .find('[data-testid="ai-chat-generated-batch-confirm-accept"]')
      .trigger("click");
    await flushPromises();

    expect(streamChatV2Message).toHaveBeenCalledTimes(1);
    const { request } = lastStreamCall();
    expect(request.generatedImageReferences).toBeUndefined();
    expect(request.message).toContain("all of them");
  });

  it("declining the batch confirmation aborts the send", async () => {
    await mockHistoryWithImages(4);

    const wrapper = mountChat();
    await flushPromises();
    await wrapper.setProps({
      openConversationRequest: { id: 1, conversationId: "conv-A" },
    });
    await flushPromises();

    await wrapper.find('[data-testid="composer-send-plural"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="ai-chat-generated-batch-confirm"]').exists()
    ).toBe(true);

    await wrapper
      .find('[data-testid="ai-chat-generated-batch-decline"]')
      .trigger("click");
    await flushPromises();

    expect(streamChatV2Message).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="ai-chat-generated-batch-confirm"]').exists()
    ).toBe(false);
  });

  it("fusion wording with more than 3 candidates shows the toast and aborts the send", async () => {
    await mockHistoryWithImages(4);

    const wrapper = mountChat();
    await flushPromises();
    await wrapper.setProps({
      openConversationRequest: { id: 1, conversationId: "conv-A" },
    });
    await flushPromises();

    await wrapper
      .find('[data-testid="composer-send-fusion"]')
      .trigger("click");
    await flushPromises();

    expect(streamChatV2Message).not.toHaveBeenCalled();
    const toast = wrapper.find('[data-testid="ai-chat-generated-error-toast"]');
    expect(toast.exists()).toBe(true);
    expect(toast.text()).toContain("Combining images is limited to 3");
    expect(
      wrapper.find('[data-testid="ai-chat-generated-batch-confirm"]').exists()
    ).toBe(false);
  });
});
