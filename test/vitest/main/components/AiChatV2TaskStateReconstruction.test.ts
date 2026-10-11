// test/vitest/main/components/AiChatV2TaskStateReconstruction.test.ts
//
// T13 (PRD FR-13/14, AC-16/24/25/27/32, NFR-10) — the renderer restores the
// task badge from the stored latest execution row on conversation switch and
// after history reload, and dedups stream chunks by executionId:
//   - conversation switch → restoreActiveTaskExecution fetches the latest row
//     (null when no enrolled execution → no badge)
//   - history reload (loadHistory) → restoreActiveTaskExecution runs after
//     applyPlanState, pinned to the active conversation
//   - Piece C executionId dedup: a late chunk from an OLD execution is dropped
//     (stale callback racing a successor); a terminal replay for the SAME
//     execution is dropped (NFR-10: one terminal event per execution).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import {
  streamChatV2Message,
  getChatV2History,
} from "@/views/api/aiChatV2";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";

const {
  continueTaskMock,
  retryTaskMock,
  getTaskStateMock,
  attachSuccessorMock,
  getActiveGoalMock,
} = vi.hoisted(() => ({
  continueTaskMock: vi.fn().mockResolvedValue(null),
  retryTaskMock: vi.fn().mockResolvedValue(null),
  getTaskStateMock: vi.fn().mockResolvedValue(null),
  attachSuccessorMock: vi.fn().mockResolvedValue(undefined),
  getActiveGoalMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  clearChatV2StreamListeners: vi.fn(),
  clearChatV2Conversation: vi.fn().mockResolvedValue({ deleted: 1 }),
  attachChatV2SuccessorStream: attachSuccessorMock,
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  startCompaction: vi.fn().mockResolvedValue({ started: true }),
  getCompactionStatus: vi.fn().mockResolvedValue(null),
  cancelCompaction: vi.fn().mockResolvedValue({ cancelled: false }),
  subscribeCompactionProgress: vi.fn(),
  unsubscribeCompactionProgress: vi.fn(),
  detachChatV2ConversationStreamListeners: vi.fn(),
  isHistoryUiEnabled: vi.fn().mockResolvedValue(false),
  getChatV2Conversations: vi.fn().mockResolvedValue([
    {
      conversationId: "v2-test",
      title: "Test conversation",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      runtimeStatus: "idle",
    },
  ]),
  getChatV2History: vi.fn().mockResolvedValue({
    messages: [],
    runtimeStatus: "idle",
  }),
  streamChatV2Message: vi.fn(),
  stopChatV2Stream: vi.fn(),
  getChatV2PlanState: vi.fn().mockResolvedValue(null),
  compactChatV2Conversation: vi.fn(),
  answerChatV2Question: vi.fn(),
  approveChatV2Plan: vi.fn(),
  rejectChatV2Plan: vi.fn(),
  requestChatV2PlanChanges: vi.fn(),
  getOpenAIChatModels: vi.fn().mockResolvedValue({
    data: [{ id: "test-model", name: "Test Model" }],
    default_model: "test-model",
  }),
  getChatV2ToolApprovalMode: vi.fn().mockResolvedValue("ask_for_approval"),
  setChatV2ToolApprovalMode: vi.fn(),
}));

vi.mock("@/views/api/aiChatTaskExecution", () => ({
  continueTask: continueTaskMock,
  retryTask: retryTaskMock,
  getChatV2TaskExecutionState: getTaskStateMock,
}));

vi.mock("@/views/api/aiChatV2Voice", () => ({
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT:
    "aifetchly:ai-chat-v2-voice-settings-changed",
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT:
    "aifetchly:ai-chat-v2-voice-models-changed",
  cancelVoiceJob: vi.fn().mockResolvedValue({ ok: true }),
  cancelVoiceModelDownload: vi.fn().mockResolvedValue(undefined),
  downloadVoiceModel: vi.fn().mockResolvedValue(undefined),
  getVoiceSettings: vi.fn().mockResolvedValue({
    spokenResponsesEnabled: false,
    spokenResponsePolicy: "off",
  }),
  getVoiceStatus: vi.fn().mockResolvedValue({
    sttState: "ready",
    ttsState: "ready",
  }),
  listVoiceModels: vi.fn().mockResolvedValue([]),
  notifyVoiceModelsChanged: vi.fn(),
  onVoiceModelDownloadProgress: vi.fn().mockReturnValue(() => undefined),
  setVoiceSettings: vi.fn(async (settings: unknown) => settings),
  synthesizeVoice: vi.fn(),
}));

vi.mock("@/views/api/aiProvider", () => ({
  AI_PROVIDER_SETTINGS_CHANGED_EVENT: "aifetchly:ai-provider-settings-changed",
  getAIProviderSettings: vi.fn().mockResolvedValue({
    provider: "openai",
    baseUrl: "",
    apiKeySet: true,
    model: "test-model",
  }),
}));

vi.mock("@/views/api/workspace", () => ({
  getWorkspace: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/views/api/aiWorkspaceMemory", () => ({
  workspaceMemoryApi: {
    getSummary: vi.fn().mockResolvedValue({ count: 0 }),
    list: vi.fn().mockResolvedValue({ status: true, data: [] }),
  },
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
  getActiveGoal: getActiveGoalMock,
  startGoalLoop: vi.fn().mockResolvedValue(null),
  stopGoalLoop: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/views/api/aiChatScheduledLoop", () => ({
  getScheduledLoopStatus: vi.fn().mockResolvedValue(null),
  createScheduledLoop: vi.fn(),
  controlScheduledLoop: vi.fn(),
  onScheduledLoopEvent: vi.fn().mockReturnValue(() => undefined),
  subscribeConversationUpdated: vi.fn(),
  unsubscribeConversationUpdated: vi.fn(),
  subscribeScheduledStream: vi.fn(),
  unsubscribeScheduledStream: vi.fn(),
}));

vi.mock("@/views/api/workspaceWatch", () => ({
  acquireWorkspaceWatch: vi.fn(),
  releaseWorkspaceWatch: vi.fn(),
  previewWorkspaceAgents: vi.fn(),
}));

vi.mock("@/views/api/localAiRuntime", () => ({
  getLocalAiRuntimeStatus: vi.fn().mockResolvedValue(null),
  installLocalAiRuntime: vi.fn(),
  onLocalAiRuntimeProgress: vi.fn().mockReturnValue(() => undefined),
  prepareLocalAiRuntimeInstall: vi.fn(),
}));

vi.mock("@/views/api/aiContentReport", () => ({
  getAIContentReportCapabilities: vi.fn().mockResolvedValue({
    conversationReporting: { enabled: false },
  }),
  createAIContentReport: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        title: "AI Assistant",
        taskExecution: {
          status_active: "working",
          status_verifying: "checking",
          status_continuing: "continuing",
          status_terminal: "completed",
          actions: {
            continue: "Continue",
            retry: "Retry",
            cancel: "Stop task",
          },
        },
      },
    },
  },
});

const ComposerStub = defineComponent({
  name: "AiChatV2Composer",
  emits: ["send"],
  template: `<div>
    <button data-testid="send-first" @click="$emit('send', 'hello', [])">
      send
    </button>
    <slot name="prepend" />
  </div>`,
});

function mountChat() {
  return mount(AiChatV2, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Messages: {
          props: ["messages"],
          template: `<div data-testid="messages" />`,
        },
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: ComposerStub,
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2PlanStatusBadge: true,
        TaskExecutionStatusBadge: {
          props: ["status", "reasonCode"],
          template: `<span data-testid="task-badge" :data-status="status" :title="reasonCode ?? ''" />`,
        },
        AiChatV2ContextBadge: true,
        AiChatCompactionStatus: true,
        AiChatHistoryDrawer: true,
        AiChatSelectedContext: true,
        AiChatHistoryMessage: true,
        FileOperationBadge: true,
        MCPToolManager: true,
        AgentTaskListDialog: true,
        WorkspaceRequiredCard: true,
        WorkspaceBadge: true,
        WorkspaceMemoryPanel: true,
        WorkspaceMemoryStatusBadge: true,
        ScheduledLoopToolApprovalDialog: true,
        AIConversationReportButton: true,
        VBtn: {
          template: `<button v-bind="$attrs"><slot /></button>`,
        },
        VAlert: true,
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
        VSelect: true,
        VSheet: true,
        VSnackbar: true,
        VSpacer: true,
        VTextField: true,
        VTooltip: true,
      },
    },
  });
}

/** Drive a stream whose chunk sequence includes task_execution_state events. */
async function streamWithTaskChunks(
  wrapper: ReturnType<typeof mountChat>,
  taskChunks: ChatV2StreamChunk["taskExecutionState"][],
  conversationId = "v2-test"
): Promise<void> {
  vi.mocked(streamChatV2Message).mockImplementation(
    async (request, onChunk, onComplete) => {
      const cid = request.conversationId ?? conversationId;
      onChunk({ eventType: "start", conversationId: cid, messageId: "asst-1" });
      for (const te of taskChunks) {
        onChunk({
          eventType: "task_execution_state",
          conversationId: cid,
          messageId: "asst-1",
          taskExecutionState: te,
        });
      }
      onChunk({
        eventType: "token",
        conversationId: cid,
        messageId: "asst-1",
        contentDelta: "done",
      });
      onComplete({
        eventType: "complete",
        conversationId: cid,
        messageId: "asst-1",
        fullContent: "done",
      });
    }
  );
  await wrapper.find('[data-testid="send-first"]').trigger("click");
  await flushPromises();
}

function badge(wrapper: ReturnType<typeof mountChat>) {
  return wrapper.find('[data-testid="task-badge"]');
}

/**
 * Drive the conversation-switch path that fires `restoreActiveTaskExecution`:
 * mount, let `loadConversations` populate the list, then call the exposed
 * `onSelectConversation` (the same handler a click on a conversation row
 * fires). The watcher at AiChatV2.vue ~line 2264 calls
 * `restoreActiveTaskExecution`, and `loadHistory` calls it again after
 * `applyPlanState`. Both fetch via `getChatV2TaskExecutionState`.
 */
async function selectConversation(
  wrapper: ReturnType<typeof mountChat>,
  conversationId = "v2-test"
): Promise<void> {
  await flushPromises(); // loadConversations populates conversations.value
  const exposed = wrapper.vm.$options.exposed as
    | { onSelectConversation?: (id: string) => void }
    | undefined;
  const select =
    (wrapper.vm as unknown as { onSelectConversation?: (id: string) => void })
      .onSelectConversation ??
    exposed?.onSelectConversation;
  if (typeof select !== "function") {
    throw new Error("onSelectConversation was not exposed on AiChatV2");
  }
  select(conversationId);
  await flushPromises();
}

describe("AiChatV2 T13 — task state reconstruction + executionId dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    continueTaskMock.mockResolvedValue({
      executionId: "exec-new",
      status: "created",
    });
    retryTaskMock.mockResolvedValue({
      executionId: "exec-new",
      status: "created",
    });
    getTaskStateMock.mockResolvedValue(null);
    getActiveGoalMock.mockResolvedValue(null);
    vi.mocked(getChatV2History).mockResolvedValue({
      conversationId: "v2-test",
      messages: [],
      totalMessages: 0,
      runtimeStatus: "idle",
    });
  });

  it("conversation switch with no enrolled execution renders no badge (response-only answer)", async () => {
    getTaskStateMock.mockResolvedValue(null);
    const wrapper = mountChat();
    await selectConversation(wrapper);
    expect(getTaskStateMock).toHaveBeenCalledWith("v2-test");
    expect(badge(wrapper).exists()).toBe(false);
  });

  it("conversation switch restores a terminal execution badge from the stored row (FR-13, AC-16/25)", async () => {
    getTaskStateMock.mockResolvedValue({
      executionId: "exec-stored-1",
      conversationId: "v2-test",
      status: "terminal",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
    });
    const wrapper = mountChat();
    await selectConversation(wrapper);
    expect(badge(wrapper).exists()).toBe(true);
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
    expect(badge(wrapper).attributes("title")).toBe("NO_PROGRESS");
  });

  it("conversation switch restores an in-flight (active) execution badge from the stored row", async () => {
    getTaskStateMock.mockResolvedValue({
      executionId: "exec-stored-2",
      conversationId: "v2-test",
      status: "active",
    });
    const wrapper = mountChat();
    await selectConversation(wrapper);
    expect(badge(wrapper).attributes("data-status")).toBe("active");
  });

  it("Piece C stale-execution dedup: a late chunk from an OLD execution does NOT overwrite the tracked successor badge", async () => {
    // Stream an active task, then a terminal chunk for a DIFFERENT execution
    // (a stale callback racing the tracked execution). The tracked execution
    // must win — the stale chunk is dropped.
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-tracked",
        conversationId: "v2-test",
        status: "active",
      },
      // Stale: different executionId, same conversation — drop.
      {
        executionId: "exec-stale",
        conversationId: "v2-test",
        status: "terminal",
        outcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
      },
    ]);
    // The tracked active execution wins; the stale terminal chunk did not
    // overwrite it.
    expect(badge(wrapper).attributes("data-status")).toBe("active");
  });

  it("NFR-10 terminal replay-once: a second terminal chunk for the SAME execution is dropped (no flicker)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-1",
        conversationId: "v2-test",
        status: "active",
      },
      {
        executionId: "exec-1",
        conversationId: "v2-test",
        status: "terminal",
        outcome: "incomplete",
        reasonCode: "NO_PROGRESS",
      },
      // Duplicate terminal for the same execution — drop (no re-fire).
      {
        executionId: "exec-1",
        conversationId: "v2-test",
        status: "terminal",
        outcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
      },
    ]);
    // The first terminal won; the replay did not flip outcome/reasonCode.
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
    expect(badge(wrapper).attributes("title")).toBe("NO_PROGRESS");
  });
});
