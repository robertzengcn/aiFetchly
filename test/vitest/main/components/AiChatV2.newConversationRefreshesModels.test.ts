import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";

// vi.hoisted so the spy is available inside the hoisted vi.mock factory.
const { getOpenAIChatModelsMock } = vi.hoisted(() => ({
  getOpenAIChatModelsMock: vi.fn().mockResolvedValue({
    data: [{ id: "gpt-test", object: "model", created: 0, owned_by: "test" }],
    default_model: "gpt-test",
  }),
}));

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
  getOpenAIChatModels: getOpenAIChatModelsMock,
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 0 }),
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
      aiChatV2: {
        title: "AI Assistant",
        new_conversation: "New conversation",
      },
    },
  },
});

// The component's onMounted wires up many IPC subscriptions + fetches
// (voice, local-AI runtime, provider settings, scheduled loop, etc.) that
// touch window.api, which is absent in the happy-dom test env. Provide a
// permissive stub so mount succeeds; only the model-list call is spied via
// the aiChatV2 mock above.
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
        AiChatV2ModelSelector: true,
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
        // Render v-btn as a real <button> so fallthrough attrs (data-testid)
        // and the @click listener land on a clickable element.
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
        VSnackbar: true,
        VSpacer: true,
        VTextField: true,
        VAlert: true,
        VTooltip: true,
      },
    },
  });
}

describe("AiChatV2 new-conversation model refresh", () => {
  it("re-fetches the OpenAI model list when New conversation is clicked", async () => {
    const wrapper = mountChat();
    await flushPromises();
    // onMounted already loaded the model list once on first paint.
    expect(getOpenAIChatModelsMock).toHaveBeenCalledTimes(1);

    getOpenAIChatModelsMock.mockClear();

    await wrapper.find('[data-testid="new-conversation"]').trigger("click");
    await flushPromises();

    // Clicking "New conversation" must refresh the model list so newly-added
    // server-side models appear without an app restart.
    expect(getOpenAIChatModelsMock).toHaveBeenCalledTimes(1);
  });
});
