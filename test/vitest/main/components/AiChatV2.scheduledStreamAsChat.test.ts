import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  // Each test mounts a fresh AiChatV2 which re-subscribes; reset call counts
  // so toHaveBeenCalledTimes(1) assertions stay isolated across cases. Use
  // mockClear (not mockReset) so the hoisted default implementation is kept
  // for tests that don't override it.
  subscribeScheduledStreamMock.mockClear();
  subscribeConversationUpdatedMock.mockClear();
  getChatV2HistoryMock.mockClear();
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

  // Regression: a scheduled turn registers itself in the engine's activeTurns
  // map (AIChatQueryEngine.submitMessage), so getChatV2History reports
  // runtimeStatus "running" for the conversation while the scheduled turn is
  // in flight. The frontend's `chatIsRunning` (isStreaming ||
  // authoritativeRuntimeStatus === "running") therefore becomes true during a
  // scheduled run. The previous `if (chatIsRunning.value) return;` guard in
  // handleScheduledStream bailed on this self-inflicted "running" state,
  // dropping live tokens and leaving the typing indicator ("running label")
  // instead of the assistant response. Scheduled tokens must still render.
  it("renders scheduled tokens as a normal message even when the conversation reports runtimeStatus 'running'", async () => {
    // Simulate the scheduled turn's own activeTurns entry: history reports the
    // conversation as "running" (this is what the IPC handler returns via
    // engine.getConversationRuntimeStatus while the scheduled turn streams).
    getChatV2HistoryMock.mockResolvedValue({
      messages: [],
      runtimeStatus: "running",
    });

    const wrapper = mountChat();
    await flushPromises();

    expect(subscribeScheduledStreamMock).toHaveBeenCalledTimes(1);
    const handler = subscribeScheduledStreamMock.mock.calls[0][0] as (
      event: ChatV2ScheduledStreamEvent,
    ) => void;

    const exposed = wrapper.vm as unknown as {
      onSelectConversation: (conversationId: string) => void;
    };
    exposed.onSelectConversation("conv-scheduled-running");
    await flushPromises();

    // After loadHistory resolves, authoritativeRuntimeStatus must be "running",
    // which makes chatIsRunning true — the exact condition that used to bail.
    const token1: ChatV2ScheduledStreamEvent = {
      conversationId: "conv-scheduled-running",
      runId: 8,
      messageId: "scheduled-assistant-running-1",
      kind: "token",
      contentDelta: "Scheduled ",
    };
    handler(token1);
    await flushPromises();

    const token2: ChatV2ScheduledStreamEvent = {
      conversationId: "conv-scheduled-running",
      runId: 8,
      messageId: "scheduled-assistant-running-1",
      kind: "token",
      contentDelta: "reply",
    };
    handler(token2);
    await flushPromises();

    const chatMessages = wrapper.find('[data-testid="chat-messages"]');
    expect(chatMessages.exists()).toBe(true);
    // The scheduled response must appear in the chat, not be suppressed by a
    // running/typing indicator.
    expect(chatMessages.text()).toContain("Scheduled reply");
    // The optimistic message must be marked active so it renders with the
    // streaming status (not idle), matching an interactive assistant turn.
    const activeMsg = chatMessages.find(
      '[data-active="true"]'
    );
    expect(activeMsg.exists()).toBe(true);
    expect(activeMsg.attributes("data-message-id")).toBe(
      "scheduled-assistant-running-1"
    );
  });
});
