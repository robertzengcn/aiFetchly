// test/vitest/main/components/AiChatV2.planModeExit.test.ts
//
// Regression test for the "plan mode never exits after approval" bug.
//
// The bug: `isPlanStateActive` (planStateUtil.ts) treated every non-terminal
// status — including "approved" — as plan-active, so `applyPlanState` set
// `mode = "plan"` and it never returned to "chat" once the user approved.
//
// This component test drives the real AiChatV2 template + the real
// `applyPlanState` transition rule by capturing the stream chunk handler
// that `onSend` registers with `streamChatV2Message`, then synthesizing the
// same `plan_submitted` and `plan_state` chunks the main process emits in
// production. That exercises the actual integration (chunk → applyPlanState
// → mode ref → AiChatV2ModeSelector modelValue) without reaching into private
// setup state.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import { approveChatV2Plan, streamChatV2Message } from "@/views/api/aiChatV2";
import type {
  AIChatPlanStateView,
  ChatV2Mode,
} from "@/entityTypes/aiChatPlanTypes";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";

// Capture the stream handlers the component registers during onSend so the
// test can synthesize plan-mode stream chunks and drive stream completion
// (plan_submitted does not pause the loop; the model finishes its turn and
// the stream completes before the user can click Approve).
type ChunkHandler = (chunk: ChatV2StreamChunk) => void;
type CompleteHandler = (chunk: ChatV2StreamChunk) => void;
let capturedChunkHandler: ChunkHandler | null = null;
let capturedCompleteHandler: CompleteHandler | null = null;

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  detachChatV2ConversationStreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getChatV2History: vi.fn().mockResolvedValue({ messages: [] }),
  streamChatV2Message: vi
    .fn()
    .mockImplementation(
      async (
        _req: unknown,
        handler: ChunkHandler,
        onComplete: CompleteHandler
      ) => {
        capturedChunkHandler = handler;
        capturedCompleteHandler = onComplete;
      }
    ),
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
      aiChatV2Plan: {
        approved_continue_message:
          "Plan approved. Please begin executing the plan now.",
      },
      workspace: {
        badgeLabel: "Workspace",
        notSet: "No workspace set",
      },
    },
  },
});

// Expose the current mode via a data attribute so assertions can read it
// without reaching into the component instance.
const ModeSelectorStub = {
  props: {
    modelValue: {
      type: String as unknown as () => ChatV2Mode,
      default: "chat",
    },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  template: `<div data-testid="mode-selector" :data-mode="modelValue ?? 'none'" />`,
};

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Messages: true,
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: {
          props: ["planState"],
          emits: ["approve", "reject"],
          template: `<div data-testid="plan-approval-card"><button data-testid="approve-plan" @click="$emit('approve')">Approve</button></div>`,
        },
        // The mode selector is rendered in the composer's #prepend slot, so
        // the composer stub must surface that slot or the selector never mounts.
        AiChatV2Composer: {
          emits: ["send"],
          template: `<div><slot name="prepend" /><button data-testid="send" @click="$emit('send', 'plan my campaign', [])">send</button></div>`,
        },
        AiChatV2ModeSelector: ModeSelectorStub,
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
        VAlert: true,
      },
    },
  });
}

function makePlanState(
  status: AIChatPlanStateView["status"],
  overrides: Partial<AIChatPlanStateView> = {}
): AIChatPlanStateView {
  return {
    conversationId: "v2-conv-plan",
    planId: "plan-1",
    status,
    title: "Campaign plan",
    objective: "Create a Facebook campaign",
    currentVersion: 1,
    ...overrides,
  };
}

const MSG_ID = "assistant-1";

/** Emit a synthesized stream chunk to the captured handler. */
function emitChunk(chunk: Partial<ChatV2StreamChunk>): void {
  if (!capturedChunkHandler) {
    throw new Error(
      "streamChatV2Message was never called — no handler captured"
    );
  }
  capturedChunkHandler(chunk as ChatV2StreamChunk);
}

/**
 * Drive the stream to completion so isStreaming/chatIsRunning clear and the
 * approval card's :disabled binding releases. plan_submitted does not pause
 * the loop; the model finishes its turn normally before the user can act.
 */
function completeStream(): void {
  if (!capturedCompleteHandler) {
    throw new Error(
      "streamChatV2Message was never called — no handler captured"
    );
  }
  capturedCompleteHandler({
    eventType: "complete" as ChatV2StreamChunk["eventType"],
    conversationId: "",
    fullContent: "Plan submitted for your review.",
    finishReason: "stop",
  });
}

describe("AiChatV2 plan mode exit after approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedChunkHandler = null;
    capturedCompleteHandler = null;
  });

  it("defaults to chat mode on mount (no active plan)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    expect(
      wrapper.find('[data-testid="mode-selector"]').attributes("data-mode")
    ).toBe("chat");
  });

  it("enters plan mode when a plan_submitted chunk arrives, then exits to chat after the plan_state becomes approved", async () => {
    const wrapper = mountChat();
    await flushPromises();

    // Start a stream so the component registers its chunk handler.
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    expect(streamChatV2Message).toHaveBeenCalledOnce();

    // Simulate the main process emitting the start + plan_submitted chunks.
    // Omit conversationId on chunks so isCurrentStreamChunk passes (it accepts
    // chunks with no conversationId — the guard is `!chunk.conversationId || ...`).
    emitChunk({ eventType: "start", messageId: MSG_ID });
    const awaiting = makePlanState("awaiting_approval");
    emitChunk({ eventType: "plan_submitted", planState: awaiting });
    await flushPromises();

    // Pre-approval: plan is active → selector shows "plan".
    expect(
      wrapper.find('[data-testid="mode-selector"]').attributes("data-mode")
    ).toBe("plan");

    // Simulate the main process emitting a plan_state chunk after approval.
    const approved: AIChatPlanStateView = {
      ...awaiting,
      status: "approved",
      approvedAt: new Date().toISOString(),
    };
    emitChunk({ eventType: "plan_state", planState: approved });
    await flushPromises();

    // Regression core: after approval the mode must return to "chat".
    expect(
      wrapper.find('[data-testid="mode-selector"]').attributes("data-mode")
    ).toBe("chat");
  });

  it("keeps plan mode when a plan_state chunk reports awaiting_approval", async () => {
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    emitChunk({ eventType: "start", messageId: MSG_ID });
    emitChunk({
      eventType: "plan_state",
      planState: makePlanState("awaiting_approval"),
    });
    await flushPromises();

    expect(
      wrapper.find('[data-testid="mode-selector"]').attributes("data-mode")
    ).toBe("plan");
  });

  it("exits plan mode after the user clicks the Approve button (handleApprovePlan)", async () => {
    // This test exercises the real approval UI path, not just stream chunks:
    // pinned approval card → @approve → handleApprovePlan → approveChatV2Plan
    // IPC → applyPlanState(approved) → mode selector back to "chat".
    const awaiting = makePlanState("awaiting_approval");
    const approved: AIChatPlanStateView = {
      ...awaiting,
      status: "approved",
      approvedAt: new Date().toISOString(),
    };
    vi.mocked(approveChatV2Plan).mockResolvedValue(approved);
    vi.mocked(streamChatV2Message).mockImplementation(
      async (
        _req: unknown,
        handler: ChunkHandler,
        onComplete: CompleteHandler
      ) => {
        capturedChunkHandler = handler;
        capturedCompleteHandler = onComplete;
      }
    );

    const wrapper = mountChat();
    await flushPromises();

    // Start a stream so the component registers its chunk handler and sets an
    // active conversation id (ensureWorkspaceConversationId runs in onSend).
    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    emitChunk({ eventType: "start", messageId: MSG_ID });
    emitChunk({ eventType: "plan_submitted", planState: awaiting });
    await flushPromises();

    // plan_submitted does not pause the loop — the model finishes its turn
    // and the stream completes before the user can click Approve (the card's
    // :disabled="chatIsRunning" binding requires the stream to end).
    completeStream();
    await flushPromises();

    // Pre-approval: selector shows plan, approval card is pinned.
    expect(
      wrapper.find('[data-testid="mode-selector"]').attributes("data-mode")
    ).toBe("plan");
    expect(wrapper.find('[data-testid="plan-approval-card"]').exists()).toBe(
      true
    );

    // Click the Approve button on the pinned card.
    await wrapper.find('[data-testid="approve-plan"]').trigger("click");
    await flushPromises();

    // handleApprovePlan called the IPC with the pinned plan's id + version.
    expect(approveChatV2Plan).toHaveBeenCalledWith(
      expect.any(String),
      "plan-1",
      1
    );
    // Regression: the mode selector must return to "chat" after approval.
    expect(
      wrapper.find('[data-testid="mode-selector"]').attributes("data-mode")
    ).toBe("chat");
    // The execution round was kicked off (continue message).
    expect(streamChatV2Message).toHaveBeenCalled();
  });

  it("does not send the execution message when approval returns no updated state", async () => {
    // Regression: handleApprovePlan used to fire onSend even when
    // approveChatV2Plan resolved null (approval did not take effect), telling
    // the model to execute a plan that was never approved. It must now bail
    // out with an error and leave the card pinned for a retry.
    const awaiting = makePlanState("awaiting_approval");
    vi.mocked(approveChatV2Plan).mockResolvedValue(null);
    vi.mocked(streamChatV2Message).mockImplementation(
      async (
        _req: unknown,
        handler: ChunkHandler,
        onComplete: CompleteHandler
      ) => {
        capturedChunkHandler = handler;
        capturedCompleteHandler = onComplete;
      }
    );

    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[data-testid="send"]').trigger("click");
    await flushPromises();
    emitChunk({ eventType: "start", messageId: MSG_ID });
    emitChunk({ eventType: "plan_submitted", planState: awaiting });
    await flushPromises();
    completeStream();
    await flushPromises();

    const callsBefore = vi.mocked(streamChatV2Message).mock.calls.length;
    await wrapper.find('[data-testid="approve-plan"]').trigger("click");
    await flushPromises();

    // The approval IPC was attempted…
    expect(approveChatV2Plan).toHaveBeenCalledOnce();
    // …but no new stream round was kicked off.
    expect(vi.mocked(streamChatV2Message).mock.calls.length).toBe(callsBefore);
    // The plan stays pinned (retry is possible) and plan mode stays on.
    expect(wrapper.find('[data-testid="plan-approval-card"]').exists()).toBe(
      true
    );
    expect(
      wrapper.find('[data-testid="mode-selector"]').attributes("data-mode")
    ).toBe("plan");
  });
});
