import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import {
  streamChatV2Message,
  clearChatV2Conversation,
} from "@/views/api/aiChatV2";
import { installQueueSendBridge } from "./helpers/queueSendBridge";

installQueueSendBridge();
import { dispatchSlashCommand } from "@/views/api/slashCommands";
import { createGoal } from "@/views/api/aiChatGoal";
import type { AIChatGoalView } from "@/entityTypes/aiChatGoalTypes";

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
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
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

vi.mock("@/views/api/aiChatGoal", () => ({
  createGoal: vi.fn().mockResolvedValue(null),
  getActiveGoal: vi.fn().mockResolvedValue(null),
  startGoalLoop: vi.fn().mockResolvedValue(null),
  stopGoalLoop: vi.fn().mockResolvedValue(null),
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
            '<div><button data-testid="send-help" @click="$emit(\'send\', \'/help\', [])">help</button><button data-testid="send-clear" @click="$emit(\'send\', \'/clear\', [])">clear</button><button data-testid="send-goal" @click="$emit(\'send\', \'/goal Build a Facebook campaign scraper and verify it works\', [])">goal</button><slot name="prepend" /></div>',
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

  it("creates the goal and streams its Plan Mode prompt instead of re-dispatching /goal", async () => {
    const planPrompt =
      "Plan the Facebook campaign scraper goal and propose acceptance criteria.";
    vi.mocked(createGoal).mockResolvedValueOnce({
      goal: {
        goalId: "goal-1",
        conversationId: "v2-1",
        objective: "Build a Facebook campaign scraper and verify it works",
        criteria: [],
        status: "active",
        iterationCount: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      } as AIChatGoalView,
      planPrompt,
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send-goal"]').trigger("click");
    await flushPromises();

    // The goal is created with the user's objective. replace:true so a retry
    // after a failed first stream (busy server, etc.) supersedes the leftover draft.
    expect(createGoal).toHaveBeenCalledWith({
      conversationId: expect.stringMatching(/^v2-/),
      objective: "Build a Facebook campaign scraper and verify it works",
      replace: true,
    });
    // The generic slash dispatcher must NOT intercept /goal — that would show
    // the usage text and swallow the plan prompt.
    expect(dispatchSlashCommand).not.toHaveBeenCalled();
    // The goal's Plan Mode prompt is streamed once, in plan mode.
    expect(streamChatV2Message).toHaveBeenCalledTimes(1);
    expect(vi.mocked(streamChatV2Message).mock.calls[0]?.[0]).toMatchObject({
      message: planPrompt,
      mode: "plan",
    });
  });
});
