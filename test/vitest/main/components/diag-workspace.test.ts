import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
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
  getOpenAIChatModels: vi
    .fn()
    .mockResolvedValue({ data: [], default_model: undefined }),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 0 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue("ask_for_approval"),
  setChatV2ToolApprovalMode: vi.fn(),
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

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: { title: "AI Assistant" },
      workspace: { badgeLabel: "Workspace", notSet: "No workspace set" },
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
        AiChatV2Composer: { template: '<div><slot name="prepend" /></div>' },
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        AgentTaskListDialog: true,
        WorkspaceRequiredCard: {
          props: ["conversationId"],
          template:
            '<div data-testid="workspace-required" :data-conversation-id="conversationId" />',
        },
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

describe("diag-emit", () => {
  it("check if AiChatV2 listens to request-set-workspace", async () => {
    const wrapper = mountChat();
    await flushPromises();
    const badgeComp = wrapper.find(".workspace-badge--unset");
    console.log(
      "BEFORE click: html has workspace-required?",
      wrapper.html().includes("workspace-required")
    );
    await badgeComp.trigger("click");
    await flushPromises();
    console.log(
      "AFTER click: html has workspace-required?",
      wrapper.html().includes("workspace-required")
    );
    // Inspect the WorkspaceBadge component instance to see what listeners it has
    const wb = wrapper.findComponent({ name: "WorkspaceBadge" });
    console.log("WorkspaceBadge vm exists:", wb.exists());
    expect(true).toBe(true);
  });
});
