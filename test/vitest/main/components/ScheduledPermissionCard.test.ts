import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import type { ChatV2ConversationUpdatedEvent } from "@/entityTypes/aiChatScheduledLoopTypes";

// vi.hoisted so the spies are available inside the hoisted vi.mock factories.
const {
  getOpenAIChatModelsMock,
  subscribeConversationUpdatedMock,
  denyChatV2ToolPermissionMock,
  getChatV2HistoryMock,
  stopChatV2StreamMock,
} = vi.hoisted(() => ({
  getOpenAIChatModelsMock: vi.fn().mockResolvedValue({
    data: [{ id: "gpt-test", object: "model", created: 0, owned_by: "test" }],
    default_model: "gpt-test",
  }),
  subscribeConversationUpdatedMock: vi.fn(),
  denyChatV2ToolPermissionMock: vi.fn(),
  getChatV2HistoryMock: vi.fn().mockResolvedValue({ messages: [] }),
  stopChatV2StreamMock: vi.fn(),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 0 }),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getChatV2History: getChatV2HistoryMock,
  streamChatV2Message: vi.fn(),
  stopChatV2Stream: stopChatV2StreamMock,
  getChatV2PlanState: vi.fn().mockResolvedValue(null),
  startCompaction: vi.fn().mockResolvedValue({ started: true }),
  isHistoryUiEnabled: vi.fn().mockResolvedValue(true),
  answerChatV2Question: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  getOpenAIChatModels: getOpenAIChatModelsMock,
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue(null),
  setChatV2ToolApprovalMode: vi.fn().mockResolvedValue(undefined),
  detachChatV2ConversationStreamListeners: vi.fn(),
  getCompactionStatus: vi.fn().mockResolvedValue(null),
  cancelCompaction: vi.fn().mockResolvedValue(undefined),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  subscribeCompactionProgress: vi.fn(),
  unsubscribeCompactionProgress: vi.fn(),
  denyChatV2ToolPermission: denyChatV2ToolPermissionMock,
}));

// Capture the conversation-updated handler so the test can invoke it directly
// with a synthetic scheduled_turn_permission_requested event. Keep all other
// real exports intact (subscribeScheduledStream etc. resolve against the
// permissive window.api stub) so mount succeeds.
vi.mock("@/views/api/aiChatScheduledLoop", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/views/api/aiChatScheduledLoop")
  >();
  return {
    ...actual,
    subscribeConversationUpdated: subscribeConversationUpdatedMock,
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
        new_conversation: "New conversation",
        permission_denied: "Permission denied.",
        permission_requested_scheduled:
          "A scheduled task is asking for permission to use a tool.",
      },
    },
  },
});

// The component's onMounted wires up many IPC subscriptions + fetches that
// touch window.api, absent in the happy-dom test env. Provide a permissive
// stub so mount succeeds.
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
        AiChatV2Messages: true,
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: {
          template: '<div><slot name="prepend" /></div>',
        },
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: {
          props: ["modelValue", "items", "defaultModel", "disabled", "loading"],
          emits: ["update:modelValue"],
          template: '<div data-testid="model-selector"></div>',
        },
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        AgentTaskListDialog: true,
        WorkspaceBadge: true,
        WorkspaceRequiredCard: true,
        WorkspaceMemoryPanel: true,
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
        VListItemSubtitle: true,
        VListItemTitle: true,
        VProgressCircular: true,
        VProgressLinear: true,
        VSheet: true,
        VSnackbar: {
          props: ["modelValue", "timeout", "location"],
          emits: ["update:modelValue"],
          template:
            "<div v-if=\"modelValue\" :data-testid=\"$attrs['data-testid'] || 'v-snackbar'\"><slot /></div>",
        },
        VSpacer: true,
        VTextField: true,
        VAlert: true,
        VTooltip: true,
      },
    },
  });
}

describe("AiChatV2 scheduled permission-requested", () => {
  it("reloads history + surfaces snackbar on scheduled_turn_permission_requested", async () => {
    const wrapper = mountChat();
    await flushPromises();

    expect(subscribeConversationUpdatedMock).toHaveBeenCalledTimes(1);
    const handler = subscribeConversationUpdatedMock.mock.calls[0][0] as (
      event: ChatV2ConversationUpdatedEvent
    ) => void;

    // Set the active conversation so the handler's conversationId match branch
    // fires (the handler only reloads history for the active conversation).
    const exposed = wrapper.vm as unknown as {
      onSelectConversation: (conversationId: string) => void;
    };
    exposed.onSelectConversation("conv-active");
    await flushPromises();

    getChatV2HistoryMock.mockClear();

    handler({
      conversationId: "conv-active",
      reason: "scheduled_turn_permission_requested",
      scheduleId: 1,
      toolCallId: "tc1",
      toolName: "file_write",
      occurredAt: "2026-09-25T00:00:00Z",
    });
    await flushPromises();

    // History must reload so the persisted permission card renders.
    expect(getChatV2HistoryMock).toHaveBeenCalledWith("conv-active");
    // The persistent permission-requested snackbar becomes visible.
    expect(
      wrapper.find('[data-testid="scheduled-permission-notice"]').exists()
    ).toBe(true);
  });

  it("deny calls denyChatV2ToolPermission and skips stop when handled", async () => {
    // The permission card is deeply nested with many deps; driving it through
    // the template proved brittle. Instead assert the contract at the
    // handleSkillPermissionDeny level via defineExpose, which the component
    // exposes for test/debug access to internal handlers.
    denyChatV2ToolPermissionMock.mockResolvedValueOnce({
      ok: true,
      handled: true,
    });
    stopChatV2StreamMock.mockClear();
    denyChatV2ToolPermissionMock.mockClear();

    const wrapper = mountChat();
    await flushPromises();

    const exposed = wrapper.vm as unknown as {
      handleSkillPermissionDeny: (message: unknown) => Promise<void>;
    };
    expect(typeof exposed.handleSkillPermissionDeny).toBe("function");

    const message = {
      id: "msg-1",
      conversationId: "conv-deny",
      metadata: { toolCallId: "tc-deny", source: "chat-v2" },
    };
    await exposed.handleSkillPermissionDeny(message);
    await flushPromises();

    expect(denyChatV2ToolPermissionMock).toHaveBeenCalledWith(
      "tc-deny",
      "conv-deny"
    );
    // When the scheduled engine handled it, the interactive stream must NOT
    // be stopped (the resumed run's terminal event resolves the card).
    expect(stopChatV2StreamMock).not.toHaveBeenCalled();
  });

  it("deny falls back to stopChatV2Stream when not handled", async () => {
    denyChatV2ToolPermissionMock.mockResolvedValueOnce({
      ok: false,
      handled: false,
    });
    stopChatV2StreamMock.mockClear();
    denyChatV2ToolPermissionMock.mockClear();

    const wrapper = mountChat();
    await flushPromises();

    const exposed = wrapper.vm as unknown as {
      handleSkillPermissionDeny: (message: unknown) => Promise<void>;
    };
    const message = {
      id: "msg-2",
      conversationId: "conv-fallback",
      metadata: { toolCallId: "tc-fallback", source: "chat-v2" },
    };
    await exposed.handleSkillPermissionDeny(message);
    await flushPromises();

    expect(denyChatV2ToolPermissionMock).toHaveBeenCalledWith(
      "tc-fallback",
      "conv-fallback"
    );
    // Interactive path: stop the stream.
    expect(stopChatV2StreamMock).toHaveBeenCalledWith("conv-fallback");
  });
});
