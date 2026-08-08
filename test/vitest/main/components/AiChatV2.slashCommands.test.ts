import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import {
  streamChatV2Message,
  clearChatV2Conversation,
} from "@/views/api/aiChatV2";
import { dispatchSlashCommand } from "@/views/api/slashCommands";

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
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
        AiChatV2Messages: {
          props: ["messages"],
          template:
            '<div data-testid="messages">{{ messages.map((m) => m.content).join("\\n") }}</div>',
        },
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: {
          emits: ["send"],
          template:
            '<div><button data-testid="send-help" @click="$emit(\'send\', \'/help\', [])">help</button><button data-testid="send-clear" @click="$emit(\'send\', \'/clear\', [])">clear</button><slot name="prepend" /></div>',
        },
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2PlanStatusBadge: true,
        AiChatV2ContextBadge: true,
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

describe("AiChatV2 slash command dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders built-in local command results without starting the AI stream", async () => {
    vi.mocked(dispatchSlashCommand).mockResolvedValueOnce({
      status: true,
      action: "show_result",
      commandId: "built-in:command:help",
      content: "Available commands\n/help\n/clear",
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send-help"]').trigger("click");
    await flushPromises();

    expect(dispatchSlashCommand).toHaveBeenCalledWith({
      conversationId: expect.stringMatching(/^v2-/),
      rawInput: "/help",
    });
    expect(streamChatV2Message).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="messages"]').text()).toContain(
      "Available commands"
    );
  });

  it("runs /clear through the existing clear conversation API", async () => {
    vi.mocked(dispatchSlashCommand).mockResolvedValueOnce({
      status: true,
      action: "show_result",
      commandId: "built-in:command:clear",
      content: "Clear the current conversation.",
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send-clear"]').trigger("click");
    await flushPromises();

    expect(clearChatV2Conversation).toHaveBeenCalledWith(
      expect.stringMatching(/^v2-/)
    );
    expect(streamChatV2Message).not.toHaveBeenCalled();
  });

  it("streams a prompt command whose expansion starts with `/` instead of re-dispatching it (TODO #3)", async () => {
    vi.mocked(dispatchSlashCommand).mockResolvedValueOnce({
      status: true,
      action: "submit_prompt",
      commandId: "plugin:p:command:slashexpand",
      // Expanded body deliberately starts with `/` — must stream as a prompt,
      // NOT be intercepted as a second slash command.
      prompt: "/expanded prompt body that begins with a slash",
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send-help"]').trigger("click");
    await flushPromises();

    // The original manual command dispatched exactly once...
    expect(dispatchSlashCommand).toHaveBeenCalledTimes(1);
    expect(dispatchSlashCommand).toHaveBeenCalledWith({
      conversationId: expect.stringMatching(/^v2-/),
      rawInput: "/help",
    });
    // ...and the expanded prompt was submitted to the Chat V2 stream exactly
    // once, using the expanded body as the message — never re-dispatched.
    expect(streamChatV2Message).toHaveBeenCalledTimes(1);
    const streamCall = vi.mocked(streamChatV2Message).mock.calls[0];
    expect(streamCall?.[0]).toMatchObject({
      message: "/expanded prompt body that begins with a slash",
    });
  });
});
