import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import { streamChatV2Message } from "@/views/api/aiChatV2";

// Drafts are added through the history drawer's `select` event and observed
// through the composer's `selections` prop (the same prop the real
// AiChatSelectedContext chip row renders), so the assertions read exactly the
// state the UI renders.
const held = vi.hoisted(() => ({
  nextId: "s1",
  nextPreview: "the archived passage text",
  sendText: "what did we decide",
  chips: [] as string[],
  refreshed: [] as boolean[],
}));

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
      workspace: { badgeLabel: "Workspace", notSet: "No workspace set" },
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
        AiChatHistoryDrawer: {
          emits: ["select"],
          setup(_, { emit }) {
            return () =>
              h("button", {
                "data-testid": "add-selection",
                onClick: () =>
                  emit("select", {
                    sourceId: held.nextId,
                    messageId: "arch-1",
                    role: "assistant",
                    timestamp: "2026-09-01T10:00:00.000Z",
                    text: held.nextPreview,
                    exact: true,
                    redacted: false,
                    hasMore: false,
                  }),
              });
          },
        },
        AiChatSelectedContext: {
          props: ["selections"],
          setup(props) {
            return () => {
              const items = props.selections as {
                preview: string;
                refreshed?: boolean;
              }[];
              const previews = items.map((s) => s.preview);
              held.chips = previews;
              held.refreshed = items.map((s) => s.refreshed === true);
              // Copy: Vue normalizes vnode children in place, so handing it the
              // same array would overwrite `held.chips` with text vnodes.
              return h("div", { "data-testid": "selection-chips" }, [
                ...previews,
              ]);
            };
          },
        },
        AiChatV2Composer: {
          emits: ["send"],
          setup(_, { emit }) {
            return () =>
              h("button", {
                "data-testid": "send-message",
                onClick: () => emit("send", held.sendText, undefined),
              });
          },
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

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

interface StreamRequest {
  conversationId?: string;
  message?: string;
  historySelectionIds?: readonly string[];
  submissionId?: string;
}

/** The mock's real signature is a 4-arg call; the test only reads 3 of them. */
function lastCall(): {
  request: StreamRequest;
  onChunk: (c: unknown) => void;
  onComplete: (c: unknown) => void;
  onError: (e: Error) => void;
} {
  const call = vi.mocked(streamChatV2Message).mock.calls.at(-1) as unknown as [
    StreamRequest,
    (c: unknown) => void,
    (c: unknown) => void,
    (e: Error) => void
  ];
  return {
    request: call[0],
    onChunk: call[1],
    onComplete: call[2],
    onError: call[3],
  };
}

/**
 * Click send and return the submitted request, leaving the stream in flight so
 * the test can decide when — and with what — the `start` event arrives.
 */
async function sendOnly(
  wrapper: ReturnType<typeof mountChat>
): Promise<StreamRequest> {
  vi.mocked(streamChatV2Message).mockResolvedValueOnce(undefined);
  await wrapper.find('[data-testid="send-message"]').trigger("click");
  await flushPromises();
  await wrapper.vm.$nextTick();
  return lastCall().request;
}

/**
 * Deliver a `start` event for the in-flight stream. It must echo that
 * stream's own `conversationId` — otherwise `isCurrentStreamChunk` drops it
 * entirely and no chip is ever reconciled.
 */
async function deliverStart(
  wrapper: ReturnType<typeof mountChat>,
  acceptedIds: readonly string[] = [],
  changedIds: readonly string[] = []
): Promise<void> {
  const { request, onChunk } = lastCall();
  expect(onChunk).toBeTypeOf("function");
  onChunk({
    eventType: "start",
    conversationId: request.conversationId ?? "v2-test",
    messageId: "assistant-1",
    historySelectionAcceptedIds: acceptedIds,
    historySelectionChangedIds: changedIds,
  });
  await flushPromises();
  await wrapper.vm.$nextTick();
}

/**
 * Send one throwaway message to activate a conversation and CLOSE its stream.
 * The history drawer is rendered only once a conversation is active
 * (`v-if="activeConversationId"`), which the first send establishes via
 * `ensureWorkspaceConversationId()`. `onComplete` is also required: without it
 * `chatIsRunning` stays true and the NEXT send is rejected by the guard before
 * it can submit any selections.
 */
async function activateConversation(
  wrapper: ReturnType<typeof mountChat>
): Promise<void> {
  const testText = held.sendText;
  held.sendText = "open the chat";
  await sendOnly(wrapper);
  held.sendText = testText;
  const { onComplete } = lastCall();
  expect(onComplete).toBeTypeOf("function");
  onComplete({ eventType: "token", content: "ok" });
  await flushPromises();
  await wrapper.vm.$nextTick();
}

/** Add a drafted chip through the drawer stub, then flush reactivity. */
async function addChip(
  wrapper: ReturnType<typeof mountChat>,
  preview: string
): Promise<void> {
  held.nextId = `sid-${preview}`;
  held.nextPreview = preview;
  await wrapper.find('[data-testid="add-selection"]').trigger("click");
  await flushPromises();
  await wrapper.vm.$nextTick();
}

describe("AiChatV2 selected archived passages (§13.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    held.chips = [];
    held.sendText = "what did we decide";
    held.nextId = "s1";
  });

  it("sends only opaque source ids plus a stable submission id", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await activateConversation(wrapper);
    await addChip(wrapper, "passage one");
    await addChip(wrapper, "passage two");
    expect(held.chips).toEqual(["passage one", "passage two"]);

    const request = await sendOnly(wrapper);
    // Opaque refs only — never the passage text.
    expect(request.historySelectionIds).toEqual([
      "sid-passage one",
      "sid-passage two",
    ]);
    expect(JSON.stringify(request)).not.toContain("the archived passage text");
    expect(request.message).toBe("what did we decide");
    // Stable submission id for transport retry.
    expect(request.submissionId).toMatch(UUID);
  });

  it("clears only the accepted chips on `start` and keeps rejected drafts", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await activateConversation(wrapper);
    await addChip(wrapper, "accepted one");
    await addChip(wrapper, "rejected two");

    await sendOnly(wrapper);
    // Drafts survive until the backend reports acceptance.
    expect(held.chips).toHaveLength(2);

    await deliverStart(wrapper, ["sid-accepted one"]);
    expect(held.chips).toEqual(["rejected two"]);
  });

  it("keeps every draft when nothing was accepted", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await activateConversation(wrapper);
    await addChip(wrapper, "still waiting");

    await sendOnly(wrapper);
    await deliverStart(wrapper, []);
    expect(held.chips).toEqual(["still waiting"]);
  });

  it("marks changed-source survivors refreshed without quoting them (§4.2)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await activateConversation(wrapper);
    await addChip(wrapper, "stale passage");

    await sendOnly(wrapper);
    // The backend accepted nothing but reports the source moved: the chip
    // survives (never quoted) and is flagged for explicit re-confirmation.
    await deliverStart(wrapper, [], ["sid-stale passage"]);
    expect(held.chips).toEqual(["stale passage"]);
    expect(held.refreshed).toEqual([true]);
  });

  it("omits historySelectionIds when there is no selection draft", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await activateConversation(wrapper);

    const request = await sendOnly(wrapper);
    expect(request.historySelectionIds).toBeUndefined();
    // submissionId is always present so a retry can dedupe.
    expect(request.submissionId).toMatch(UUID);
  });

  it("reuses the same submission id across retries until acceptance resolves", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await activateConversation(wrapper);
    await addChip(wrapper, "retry passage");

    // First attempt ends WITHOUT any `start` arriving (transport failure
    // before acceptance) — the draft and the submission identity both survive
    // for the retry. `onComplete` only closes the turn's running state.
    const first = await sendOnly(wrapper);
    expect(held.chips).toHaveLength(1);
    lastCall().onComplete({ eventType: "token", content: "ok" });
    await flushPromises();
    await wrapper.vm.$nextTick();
    // Retry without an intervening acceptance reuses the same id so the
    // backend reuses the accepted user-turn metadata instead of duplicating
    // the message.
    const second = await sendOnly(wrapper);
    expect(second.submissionId).toBe(first.submissionId);
    expect(second.historySelectionIds).toEqual(first.historySelectionIds);

    // Once `start` resolves acceptance, the next turn mints a fresh id.
    await deliverStart(wrapper, ["sid-retry passage"]);
    lastCall().onComplete({ eventType: "token", content: "ok" });
    await flushPromises();
    await wrapper.vm.$nextTick();
    const third = await sendOnly(wrapper);
    expect(third.submissionId).toMatch(UUID);
    expect(third.submissionId).not.toBe(first.submissionId);
  });
});
