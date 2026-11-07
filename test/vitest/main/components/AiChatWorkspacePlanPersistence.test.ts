/**
 * Reproduction + regression suite for the plan lifecycle surfaces:
 *
 * 1. (Bug A) Clicking "Review full plan" on the pinned plan decision card
 *    must open the chat inspector on the Activity tab (typed app-inspector
 *    target) — the user reported "no response".
 * 2. (Bug B) The plan decision card must survive a selection re-seed: the
 *    card reads planStateView from message metadata, but those rows exist
 *    only in the live presenter buffer, so every re-seed (reload, restore,
 *    reopen) wipes the card until the plan lifecycle rows become durable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatRunDetailEvent,
} from "@/entityTypes/aiChatWorkspaceTypes";
import type {
  AIChatPlanStateView,
} from "@/entityTypes/aiChatPlanTypes";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
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
const recoverPlanContinuationMock = vi.fn();

// The select snapshot the main process would return for a conversation whose
// messages are persisted WITHOUT plan lifecycle metadata (today's behavior:
// plan transitions are streamed to the renderer only, never saved as rows).
const selectSnapshotMessages = vi.fn()

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
  getChatV2ToolApprovalMode: (...args: unknown[]) => getToolApprovalMock(...args),
  setChatV2ToolApprovalMode: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  recoverChatV2PlanContinuationIntent: (...args: unknown[]) =>
    recoverPlanContinuationMock(...args),
  answerChatV2Question: vi.fn(),
  clearChatV2Conversation: vi.fn(),
  listChatV2PendingMessages: vi.fn().mockResolvedValue([]),
  subscribeChatV2PendingEvents: vi.fn(() => () => undefined),
  exportGeneratedImage: vi.fn(),
  isHistoryUiEnabled: vi.fn().mockResolvedValue(false),
  getChatV2PlanVersions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/views/api/aiChatWorkspace", () => ({
  createWorkspaceConversationId: vi.fn().mockReturnValue("fresh-chat"),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  duplicateConversation: vi.fn(),
  exportConversation: vi.fn(),
  isWorkspaceRedesignEnabled: vi.fn(),
  setWorkspaceRedesignEnabled: vi.fn(),
  fetchWorkspaceRolloutFlags: vi.fn().mockResolvedValue(null),
  setWorkspaceRolloutAdapter: vi.fn().mockResolvedValue(true),
  listWorkspaceActivity: vi.fn().mockResolvedValue({ runs: [] }),
  selectConversation: (...args: unknown[]) => selectSnapshotMessages(...args),
  subscribeDetailEvents: vi.fn().mockReturnValue(() => undefined),
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
  subscribeTitleEvents: vi.fn().mockReturnValue(() => undefined),
  unsubscribeDetail: vi.fn(),
  loadHistoryPage: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  startChatRun: vi.fn(),
  cancelChatRun: vi.fn(),
  createClientRequestId: vi.fn().mockReturnValue("req-1"),
  getScheduledLoopStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/views/api/aiChatV2Voice", () => ({
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT: "voice-settings-changed",
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT: "voice-models-changed",
  cancelVoiceJob: vi.fn().mockResolvedValue({ ok: true }),
  downloadVoiceModel: vi.fn(),
  getVoiceSettings: (...args: unknown[]) => getVoiceSettingsMock(...args),
  getVoiceStatus: vi.fn().mockResolvedValue({ sttState: "ready", ttsState: "ready" }),
  notifyVoiceModelsChanged: vi.fn(),
  onVoiceModelDownloadProgress: vi.fn().mockReturnValue(() => undefined),
  setVoiceSettings: (...args: unknown[]) => setVoiceSettingsMock(...args),
  synthesizeVoice: vi.fn(),
  transcribeVoice: vi.fn(),
}));

vi.mock("@/views/api/localAiRuntime", () => ({
  getLocalAiRuntimeStatus: vi.fn().mockResolvedValue({ state: "installed" }),
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

import AiChatCenterSurface from "@/views/components/aiChatWorkspace/AiChatCenterSurface.vue";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { useAppInspectorStore } from "@/views/store/appInspector";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { loading: "Loading…", cancel: "Cancel", ok: "OK", retry: "Retry" },
      workspaceChat: {
        newChat: "New chat",
        loadOlder: "Load older messages",
        empty: { title: "Ask anything, or pick a conversation on the left." },
        inspector: { region: "Inspector", activity: "Activity", artifacts: "Artifacts", context: "Context" },
        plan: {
          readyForReview: "Plan ready for review",
          approve: "Approve plan",
          requestChanges: "Request changes",
          reviewFullPlan: "Review full plan",
          steps: "{count} steps",
          moreActions: "More actions",
        },
        activity: { runs: "Runs", noRuns: "No activity yet" },
      },
      aiChatV2: {},
    },
  },
});

/** The real transcript — the click chain under test must never be stubbed. */
const ComposerStub = defineComponent({
  name: "AiChatV2Composer",
  props: [
    "isStreaming", "conversationId", "voiceEnabled", "voiceSettingsUnavailable",
    "draftKey", "selectedGeneratedImages", "generatedImageReferenceLimit",
    "generatedImageFocusSignal",
  ],
  emits: ["send", "stop"],
  template: '<div data-testid="composer-stub"><slot name="controls" /><slot name="toolbar-actions" /></div>',
});

const HeaderStub = defineComponent({
  name: "AiChatConversationHeader",
  props: ["title", "hasConversation", "inspectorOpen", "runtimeStatus", "recovering"],
  emits: ["compact", "open-agent-tasks", "report", "open-status"],
  template: '<header data-testid="conversation-header-stub"><slot /></header>',
});

function planStateView(
  overrides: Partial<AIChatPlanStateView> = {}
): AIChatPlanStateView {
  return {
    planId: "plan-1",
    conversationId: "v2-conv-1",
    status: "awaiting_approval",
    title: "Newsletter campaign",
    objective: "Ship the newsletter campaign",
    currentVersion: 1,
    ...overrides,
  };
}

function planStateDetailEvent(
  overrides: Partial<AIChatPlanStateView> = {},
  eventType: ChatRunDetailEvent["eventType"] = "plan_state",
  sequence = 2
): ChatRunDetailEvent {
  return {
    conversationId: "v2-conv-1",
    runId: "run-1",
    sequence,
    emittedAt: new Date().toISOString(),
    eventType,
    payload: { eventType, planState: planStateView(overrides) },
  };
}

/** Plain persisted rows (what the snapshot returns for the conversation). */
function seedRows(planRow?: ChatV2MessageView): ChatV2MessageView[] {
  const rows: ChatV2MessageView[] = [
    {
      id: "user-1",
      conversationId: "v2-conv-1",
      role: "user",
      content: "plan the campaign",
      timestamp: new Date(2026, 7, 20, 10, 0, 1).toISOString(),
      messageType: MessageType.MESSAGE,
      metadata: { source: "chat-v2" },
    },
    {
      id: "assistant-1",
      conversationId: "v2-conv-1",
      role: "assistant",
      content: "Working on the plan.",
      timestamp: new Date(2026, 7, 20, 10, 0, 2).toISOString(),
      messageType: MessageType.MESSAGE,
      metadata: { source: "chat-v2" },
    },
  ];
  if (planRow) rows.push(planRow);
  return rows;
}

/**
 * The durable plan lifecycle row the main process writes on every plan
 * transition (savePlanEventMessage contract): metadata-identical to the
 * workspace presenter's live rows so seeded history classifies the same.
 */
function persistedPlanRow(
  overrides: Partial<AIChatPlanStateView> = {}
): ChatV2MessageView {
  const planState = planStateView(overrides);
  const planEventType =
    planState.status === "approved" ? "plan_approved" : undefined;
  return {
    id: `plan-event-${planState.planId}-v${planState.currentVersion}-${
      planEventType ?? "plan_state"
    }`,
    conversationId: "v2-conv-1",
    role: "assistant",
    content: "",
    timestamp: new Date(2026, 7, 20, 10, 0, 3).toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: {
      source: "chat-v2",
      planId: planState.planId,
      ...(planEventType ? { planEventType } : {}),
      planStateView: planState,
    },
  };
}

function mountSurface(pinia: ReturnType<typeof createPinia> = createPinia()) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/aiworkspace", name: "AI_Chat_Workspace", component: AiChatCenterSurface },
      { path: "/", redirect: "/aiworkspace" },
    ],
  });
  const wrapper = mount(AiChatCenterSurface, {
    global: {
      plugins: [pinia, i18n, router],
      stubs: {
        AiChatV2Composer: ComposerStub,
        AiChatConversationHeader: HeaderStub,
        ManagedBrowserSessionCard: true,
        WorkspaceBadge: true,
        WorkspaceRequiredCard: true,
        WorkspaceTrustCard: true,
        AiChatV2QueuedMessages: true,
        AiChatSelectedContext: true,
        AiChatCompactionStatus: true,
        AiChatHistoryDrawer: true,
        SkillApprovalCard: true,
        AiChatV2QuestionCard: true,
        "v-btn": { template: '<button class="stub-btn"><slot /></button>' },
        "v-icon": true,
        "v-menu": { template: "<div><slot name=\"activator\" /><slot /></div>" },
        "v-list": { template: "<div><slot /></div>" },
        "v-list-item": { template: "<div><slot /></div>" },
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
  setActivePinia(pinia);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
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
    ttsSpeed: 1,
    maxRecordingMs: 60000,
  });
  selectSnapshotMessages.mockResolvedValue({
    acceptedGeneration: 1,
    conversationId: "v2-conv-1",
    messages: seedRows(),
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "idle",
    activeRunId: null,
    title: "Selected chat",
  });
});

describe("plan decision card persistence (workspace chat §12)", () => {
  it("shows the pinned plan decision card from the live plan_state row", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    const selectedStore = useSelectedConversationStore();
    chatWorkspace.setSelected("v2-conv-1");
    await selectedStore.loadSelection("v2-conv-1");
    await flushPromises();

    // A run streams plan_state — the awaiting-approval card pins.
    selectedStore.applyDetailEvent(planStateDetailEvent());
    await flushPromises();
    expect(chatWorkspace.selectedConversationId).toBe("v2-conv-1");
    const applied = selectedStore.messages.some(
      (m: ChatV2MessageView) => m.metadata?.planStateView?.planId === "plan-1"
    );
    expect(applied).toBe(true);

    const card = wrapper.find('[data-testid="workspace-plan-decision-card"]');
    expect(card.exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps the Review full plan click wired: click opens the chat inspector on Activity", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    const selectedStore = useSelectedConversationStore();
    const inspector = useAppInspectorStore();
    chatWorkspace.setSelected("v2-conv-1");
    await selectedStore.loadSelection("v2-conv-1");
    await flushPromises();
    selectedStore.applyDetailEvent(planStateDetailEvent());
    await flushPromises();

    const button = wrapper.get('[data-testid="workspace-plan-review-full"]');
    await button.trigger("click");
    await flushPromises();

    expect(chatWorkspace.inspectorOpen).toBe(true);
    expect(chatWorkspace.inspectorTab).toBe("activity");
    expect(inspector.target).toEqual({
      kind: "chat",
      ownerRoute: "/aiworkspace",
      conversationId: "v2-conv-1",
      tab: "activity",
    });
    wrapper.unmount();
  });

  it("SURVIVES a selection re-seed: the awaiting-approval card is rebuilt from durable plan state after reload/restore", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    const selectedStore = useSelectedConversationStore();
    chatWorkspace.setSelected("v2-conv-1");
    await selectedStore.loadSelection("v2-conv-1");
    await flushPromises();
    selectedStore.applyDetailEvent(planStateDetailEvent());
    await flushPromises();
    expect(
      wrapper.find('[data-testid="workspace-plan-decision-card"]').exists()
    ).toBe(true);

    // Leave + return (any re-selection handshake: reload restore, notify
    // click, reopen). The snapshot now carries the durable plan row the main
    // process writes on every transition (savePlanEventMessage), so the
    // awaiting-approval card is rebuilt instead of vanishing.
    selectSnapshotMessages.mockResolvedValue({
      acceptedGeneration: 1,
      conversationId: "v2-conv-1",
      messages: seedRows(persistedPlanRow()),
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "Selected chat",
    });
    await selectedStore.loadSelection("v2-conv-1");
    await flushPromises();

    const card = wrapper.find('[data-testid="workspace-plan-decision-card"]');
    // PRD §12.4: an awaiting-approval decision must never disappear on
    // navigation — the card is rebuilt from the durable snapshot.
    expect(card.exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps the reviewed receipt readable after the decision + re-seed", async () => {
    const wrapper = mountSurface();
    const chatWorkspace = useChatWorkspaceStore();
    const selectedStore = useSelectedConversationStore();
    chatWorkspace.setSelected("v2-conv-1");
    await selectedStore.loadSelection("v2-conv-1");
    await flushPromises();
    selectedStore.applyDetailEvent(planStateDetailEvent());
    await flushPromises();
    // The user approves — the plan turns approved in the live view.
    selectedStore.applyDetailEvent(
      planStateDetailEvent(
        { status: "approved", planId: "plan-1", currentVersion: 1 },
        "plan_approved",
        3
      )
    );
    await flushPromises();
    expect(
      wrapper
        .find('[data-testid^="workspace-plan-receipt-"]')
        .exists()
    ).toBe(true);

    // Approving commits a durable plan_approved row in main; the re-seeded
    // snapshot carries it, so the receipt is still anchored in history.
    selectSnapshotMessages.mockResolvedValue({
      acceptedGeneration: 1,
      conversationId: "v2-conv-1",
      messages: seedRows(persistedPlanRow({ status: "approved" })),
      nextBefore: null,
      hasOlder: false,
      runtimeStatus: "idle",
      activeRunId: null,
      title: "Selected chat",
    });
    await selectedStore.loadSelection("v2-conv-1");
    await flushPromises();

    // After the re-seed the approved receipt must still be reconstructible.
    const receiptExists = wrapper
      .find('[data-testid^="workspace-plan-receipt-"]')
      .exists();
    expect(receiptExists).toBe(true);
    wrapper.unmount();
  });
});
