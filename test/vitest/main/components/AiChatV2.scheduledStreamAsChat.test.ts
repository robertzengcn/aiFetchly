import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import type { ChatV2ScheduledStreamEvent } from "@/entityTypes/aiChatScheduledLoopTypes";

const {
  getChatV2HistoryMock,
  subscribeScheduledStreamMock,
  subscribeConversationUpdatedMock,
} = vi.hoisted(() => ({
  getChatV2HistoryMock: vi.fn().mockResolvedValue({ messages: [], runtimeStatus: "idle" }),
  subscribeScheduledStreamMock: vi.fn(),
  subscribeConversationUpdatedMock: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 0 }),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getChatV2History: getChatV2HistoryMock,
  streamChatV2Message: vi.fn(),
  stopChatV2Stream: vi.fn(),
  getChatV2PlanState: vi.fn().mockResolvedValue(null),
  startCompaction: vi.fn().mockResolvedValue({ started: true }),
  isHistoryUiEnabled: vi.fn().mockResolvedValue(true),
  answerChatV2Question: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  getOpenAIChatModels: vi.fn().mockResolvedValue({
    data: [{ id: "gpt-test", object: "model", created: 0, owned_by: "test" }],
    default_model: "gpt-test",
  }),
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue(null),
  setChatV2ToolApprovalMode: vi.fn().mockResolvedValue(undefined),
  detachChatV2ConversationStreamListeners: vi.fn(),
  getCompactionStatus: vi.fn().mockResolvedValue(null),
  cancelCompaction: vi.fn().mockResolvedValue(undefined),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  subscribeCompactionProgress: vi.fn(),
  unsubscribeCompactionProgress: vi.fn(),
  denyChatV2ToolPermission: vi.fn(),
}));

vi.mock("@/views/api/aiChatScheduledLoop", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/views/api/aiChatScheduledLoop")
  >();
  return {
    ...actual,
    getScheduledLoopStatus: vi.fn().mockResolvedValue(null),
    createScheduledLoop: vi.fn(),
    controlScheduledLoop: vi.fn(),
    subscribeConversationUpdated: subscribeConversationUpdatedMock,
    unsubscribeConversationUpdated: vi.fn(),
    subscribeScheduledStream: subscribeScheduledStreamMock,
    unsubscribeScheduledStream: vi.fn(),
  };
});

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
      aiChatV2: {
        title: "AI Assistant",
      },
    },
  },
});

beforeAll(() => {
  const noop = (): void => undefined;
  const stub = {
    invoke: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    receive: vi.fn().mockReturnValue(noop),
    removeListener: vi.fn(),
    on: vi.fn().mockReturnValue(noop),
    off: vi.fn(),
  };
  (globalThis.window as unknown as { api: unknown }).api = stub;
});

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Messages: {
          props: ["messages", "activeAssistantMessageId"],
          template:
            '<div data-testid="chat-messages"><div v-for="m in messages" :key="m.id" :data-message-id="m.id" :data-active="m.id === activeAssistantMessageId ? \'true\' : \'false\'">{{ m.content }}</div></div>',
        },
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: {
          template: "<div />",
        },
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        AiChatCompactionStatus: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        AgentTaskListDialog: true,
        WorkspaceBadge: true,
        WorkspaceRequiredCard: true,
        WorkspaceMemoryPanel: true,
        WorkspaceTrustCard: true,
        ScheduledLoopToolApprovalDialog: true,
        SkillApprovalCard: true,
        VBtn: { template: "<button><slot /></button>" },
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
        VProgressCircular: true,
        VProgressLinear: true,
        VSheet: true,
        VSnackbar: true,
        VSpacer: true,
        VTextField: true,
        VAlert: true,
        VTooltip: true,
      },
    },
  });
}

describe("AiChatV2 scheduled stream renders as normal chat", () => {
  it("appends scheduled tokens as a normal assistant message, no separate running bubble", async () => {
    const wrapper = mountChat();
    await flushPromises();

    expect(subscribeScheduledStreamMock).toHaveBeenCalledTimes(1);
    const handler = subscribeScheduledStreamMock.mock.calls[0][0] as (
      event: ChatV2ScheduledStreamEvent,
    ) => void;

    const exposed = wrapper.vm as unknown as {
      onSelectConversation: (conversationId: string) => void;
    };
    exposed.onSelectConversation("conv-scheduled");
    await flushPromises();

    const token1: ChatV2ScheduledStreamEvent = {
      conversationId: "conv-scheduled",
      runId: 7,
      messageId: "scheduled-assistant-1",
      kind: "token",
      contentDelta: "Hello ",
    };
    handler(token1);
    await flushPromises();

    const token2: ChatV2ScheduledStreamEvent = {
      conversationId: "conv-scheduled",
      runId: 7,
      messageId: "scheduled-assistant-1",
      kind: "token",
      contentDelta: "from schedule",
    };
    handler(token2);
    await flushPromises();

    // Scheduled content must appear inside the normal chat message list.
    const chatMessages = wrapper.find('[data-testid="chat-messages"]');
    expect(chatMessages.exists()).toBe(true);
    expect(chatMessages.text()).toContain("Hello from schedule");

    // The old separate grey running area must be gone.
    expect(wrapper.find(".scheduled-live-bubble").exists()).toBe(false);
  });
});
