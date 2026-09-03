import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";

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
    data: [],
    default_model: undefined,
  }),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 0 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
}));

vi.mock("@/views/api/workspace", () => ({
  getWorkspace: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/views/api/aiChat", () => ({
  subscribeToFileOperations: vi.fn(),
  unsubscribeFromFileOperations: vi.fn(),
}));

// Phase 13 (Plan 04): AiChatV2.vue's onMounted now subscribes to AiFetchly
// config-changed events and seeds a slash-command cache via listSlashCommands.
// Both ultimately call window.api.{receive,invoke} which is undefined in the
// happy-dom test env. Mock the module to keep the existing workspace test
// focused on its own scenario without wiring up a global api mock.
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
      aiChatV2: {
        title: "AI Assistant",
        clear_chat: "Clear chat",
        compact_conversation: "Compact conversation",
        conversation_history: "Conversation history",
        manage_mcp_tools: "Manage MCP Tools",
        new_conversation: "New conversation",
      },
      workspace: {
        badgeLabel: "Workspace",
        notSet: "No workspace set",
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
          emits: ["request-workspace"],
          template:
            '<div><button data-testid="composer-request-workspace" @click="$emit(\'request-workspace\')">Choose workspace</button><slot name="prepend" /></div>',
        },
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        FileOperationBadge: true,
        MCPToolManager: true,
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

describe("AiChatV2 workspace picker", () => {
  it("opens the workspace picker card when the unset badge is clicked", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find(".workspace-badge--unset").trigger("click");
    await flushPromises();

    const card = wrapper.find("[data-testid='workspace-required']");
    expect(card.exists()).toBe(true);
    expect(card.attributes("data-conversation-id")).toMatch(/^v2-/);
  });

  it("opens the workspace picker card when the @-mention dropdown requests a workspace", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper
      .find('[data-testid="composer-request-workspace"]')
      .trigger("click");
    await flushPromises();

    const card = wrapper.find("[data-testid='workspace-required']");
    expect(card.exists()).toBe(true);
    expect(card.attributes("data-conversation-id")).toMatch(/^v2-/);
  });
});
