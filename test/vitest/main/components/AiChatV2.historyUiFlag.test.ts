import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";

const mockIsHistoryUiEnabled = vi.hoisted(() =>
  vi.fn().mockResolvedValue(true)
);

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  getCompactionStatus: vi.fn().mockResolvedValue(null),
  subscribeCompactionProgress: vi.fn(),
  unsubscribeCompactionProgress: vi.fn(),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getChatV2History: vi.fn().mockResolvedValue({ messages: [] }),
  streamChatV2Message: vi.fn(),
  stopChatV2Stream: vi.fn(),
  getChatV2PlanState: vi.fn().mockResolvedValue(null),
  answerChatV2Question: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  getOpenAIChatModels: vi.fn().mockResolvedValue({
    data: [],
    default_model: undefined,
  }),
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue("ask_for_approval"),
  setChatV2ToolApprovalMode: vi.fn(),
  startCompaction: vi.fn().mockResolvedValue({ started: true }),
  isHistoryUiEnabled: mockIsHistoryUiEnabled,
}));

vi.mock("@/views/api/workspace", () => ({
  getWorkspace: vi.fn().mockResolvedValue(null),
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

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Messages: true,
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatHistoryDrawer: true,
        AiChatSelectedContext: true,
        AiChatV2Composer: { template: "<div />" },
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        AiChatCompactionStatus: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        AgentTaskListDialog: true,
        WorkspaceRequiredCard: true,
        WorkspaceBadge: true,
        WorkspaceMemoryPanel: true,
        VBtn: true,
        VCard: true,
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
        VSnackbar: true,
        VSpacer: true,
        VTextField: true,
      },
    },
  });
}

describe("AiChatV2 history-UI rollout flag (C-6/§18 stage 3)", () => {
  beforeEach(() => {
    mockIsHistoryUiEnabled.mockReset().mockResolvedValue(true);
  });

  it("hides the history drawer toggle when the flag is off", async () => {
    mockIsHistoryUiEnabled.mockResolvedValue(false);
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('[data-testid="ai-history-drawer-toggle"]').exists()
    ).toBe(false);
    wrapper.unmount();
  });

  it("shows the history drawer toggle when the flag is on", async () => {
    mockIsHistoryUiEnabled.mockResolvedValue(true);
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('[data-testid="ai-history-drawer-toggle"]').exists()
    ).toBe(true);
    wrapper.unmount();
  });

  it("fails closed when the flag read rejects", async () => {
    mockIsHistoryUiEnabled.mockRejectedValue(new Error("store hiccup"));
    const wrapper = mountChat();
    await flushPromises();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('[data-testid="ai-history-drawer-toggle"]').exists()
    ).toBe(false);
    wrapper.unmount();
  });
});
