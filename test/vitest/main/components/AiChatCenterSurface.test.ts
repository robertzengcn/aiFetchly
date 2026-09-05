import { beforeEach, describe, expect, it, vi } from "vitest";
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
  setVoiceSettings: vi.fn(),
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
        empty: { title: "Ask anything, or pick a conversation on the left." },
        sidebar: { region: "Chat workspaces" },
        inspector: { context: "Context" },
      },
      workspaceMemory: { panelTitle: "Workspace memory" },
      aiChatV2: { voice: {} },
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

function mountSurface() {
  const pinia = createPinia();
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
          template: '<div data-testid="transcript-stub" />',
        }),
        AiChatRunStrip: true,
        WorkspaceBadge: defineComponent({
          name: "WorkspaceBadge",
          props: ["workspace", "memoryCount"],
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
        AiChatV2ModelSelector: true,
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2ContextBadge: true,
        AiChatVoiceOutputToggle: defineComponent({
          template: '<div data-testid="voice-toggle-stub" />',
        }),
        AiChatVoiceRuntimeInstallDialog: true,
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

  it("places the workspace strip below the header and above the transcript", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    chatWorkspace.setSelected("conv-1");
    await flushPromises();

    const header = wrapper.get(
      '[data-testid="conversation-header-stub"]'
    ).element;
    const strip = wrapper.get('[data-testid="chat-workspace-strip"]').element;
    const transcript = wrapper.get('[data-testid="transcript-stub"]').element;
    expect(
      header.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      strip.compareDocumentPosition(transcript) &
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
