import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import {
  streamChatV2Message,
  attachChatV2SuccessorStream,
} from "@/views/api/aiChatV2";
import { continueTask, retryTask } from "@/views/api/aiChatTaskExecution";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";

/**
 * Component test for the task-execution renderer surface (PRD FR-13/FR-14,
 * AC-29): task_execution_state stream chunks keep the header badge in sync,
 * and Continue/Retry/Stop actions appear only in the states that allow them.
 * Continue/Retry invoke the recovery IPC with the parent executionId and a
 * FRESH submissionId (one successor — AC-27); they must NOT resend the user
 * message or re-freeze a contract (that stays main-process authoritative).
 * T09 (AC-16/27/28): a `created` response also ADOPTS the successor identity
 * (the badge stops referencing the parent row) and attaches the successor
 * stream listeners so the dispatched successor turn is not dead-air.
 */

const { continueTaskMock, retryTaskMock, attachSuccessorMock } = vi.hoisted(
  () => ({
    continueTaskMock: vi.fn().mockResolvedValue(null),
    retryTaskMock: vi.fn().mockResolvedValue(null),
    attachSuccessorMock: vi.fn().mockResolvedValue(undefined),
  })
);

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
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
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
  getActiveGoal: vi.fn().mockResolvedValue(null),
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
  taskChunks: ChatV2StreamChunk["taskExecutionState"][]
): Promise<void> {
  vi.mocked(streamChatV2Message).mockImplementation(
    async (request, onChunk, onComplete) => {
      const conversationId = request.conversationId ?? "v2-test";
      onChunk({ eventType: "start", conversationId, messageId: "asst-1" });
      for (const te of taskChunks) {
        onChunk({
          eventType: "task_execution_state",
          conversationId,
          messageId: "asst-1",
          taskExecutionState: te,
        });
      }
      onChunk({ eventType: "token", conversationId, messageId: "asst-1", contentDelta: "done" });
      onComplete({
        eventType: "complete",
        conversationId,
        messageId: "asst-1",
        fullContent: "done",
      });
    }
  );
  // Re-send through the composer stub to start the stream.
  await wrapper.find('[data-testid="send-first"]').trigger("click");
  await flushPromises();
}

function badge(wrapper: ReturnType<typeof mountChat>) {
  return wrapper.find('[data-testid="task-badge"]');
}

describe("AiChatV2 task execution chunk routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    continueTaskMock.mockResolvedValue({ executionId: "exec-new", status: "created" });
    retryTaskMock.mockResolvedValue({ executionId: "exec-new", status: "created" });
  });

  it("renders no task badge before any task_execution_state chunk", async () => {
    const wrapper = mountChat();
    await flushPromises();
    expect(badge(wrapper).exists()).toBe(false);
  });

  it("routes task_execution_state chunks to the badge (working state)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-1",
        conversationId: "v2-test",
        status: "active",
      },
    ]);
    expect(badge(wrapper).exists()).toBe(true);
    expect(badge(wrapper).attributes("data-status")).toBe("active");
  });

  it("keeps the badge in sync as the status advances to verifying", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      { executionId: "exec-1", conversationId: "v2-test", status: "active" },
      { executionId: "exec-1", conversationId: "v2-test", status: "verifying" },
    ]);
    expect(badge(wrapper).attributes("data-status")).toBe("verifying");
  });

  it("passes the terminal reason code through to the badge tooltip", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-1",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "CONTINUATION_LIMIT",
        outcome: "incomplete",
      },
    ]);
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
    expect(badge(wrapper).attributes("title")).toBe("CONTINUATION_LIMIT");
  });

  it("shows Continue/Retry on a terminal incomplete execution, not Stop", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-1",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "NO_PROGRESS",
        outcome: "incomplete",
      },
    ]);
    const labels = wrapper
      .findAll("button[aria-label]")
      .map((b) => b.attributes("aria-label"));
    expect(labels).toContain("Continue");
    expect(labels).toContain("Retry");
    expect(labels).not.toContain("Stop task");
  });

  it("hides Continue/Retry on a verified-complete execution", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-1",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "CRITERIA_SATISFIED",
        outcome: "verified_complete",
      },
    ]);
    const labels = wrapper
      .findAll("button[aria-label]")
      .map((b) => b.attributes("aria-label"));
    expect(labels).not.toContain("Continue");
    expect(labels).not.toContain("Retry");
  });

  it("shows Stop (not Continue/Retry) while the task is still running", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      { executionId: "exec-1", conversationId: "v2-test", status: "active" },
    ]);
    const labels = wrapper
      .findAll("button[aria-label]")
      .map((b) => b.attributes("aria-label"));
    expect(labels).toContain("Stop task");
    expect(labels).not.toContain("Continue");
    expect(labels).not.toContain("Retry");
  });

  it("Continue invokes the recovery IPC with the parent executionId and a fresh submissionId", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-parent",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "NO_PROGRESS",
        outcome: "incomplete",
      },
    ]);
    const continueBtn = wrapper
      .findAll("button[aria-label]")
      .find((b) => b.attributes("aria-label") === "Continue");
    expect(continueBtn).toBeDefined();
    await continueBtn!.trigger("click");
    await flushPromises();

    expect(continueTask).toHaveBeenCalledTimes(1);
    const req = continueTaskMock.mock.calls[0][0] as {
      parentExecutionId: string;
      submissionId: string;
    };
    expect(req.parentExecutionId).toBe("exec-parent");
    // Fresh UUID per action — one successor per submission (AC-27).
    expect(req.submissionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("Retry invokes the recovery IPC with the parent executionId", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-parent",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "MODEL_ATTEMPT_LIMIT",
        outcome: "incomplete",
      },
    ]);
    const retryBtn = wrapper
      .findAll("button[aria-label]")
      .find((b) => b.attributes("aria-label") === "Retry");
    expect(retryBtn).toBeDefined();
    await retryBtn!.trigger("click");
    await flushPromises();

    expect(retryTask).toHaveBeenCalledTimes(1);
    const req = retryTaskMock.mock.calls[0][0] as {
      parentExecutionId: string;
      submissionId: string;
    };
    expect(req.parentExecutionId).toBe("exec-parent");
    expect(req.submissionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("Continue created response adopts the successor identity and attaches the successor stream (T09)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-parent",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "NO_PROGRESS",
        outcome: "incomplete",
      },
    ]);
    const continueBtn = wrapper
      .findAll("button[aria-label]")
      .find((b) => b.attributes("aria-label") === "Continue");
    await continueBtn!.trigger("click");
    await flushPromises();

    // The successor identity replaces the parent's in the badge state — the
    // renderer must not keep pointing at the finalized parent row (T09).
    // The badge flips to "continuing"; the successor executionId is visible
    // through the attach call (script setup does not expose the ref on vm).
    expect(continueTask).toHaveBeenCalledTimes(1);
    expect(badge(wrapper).attributes("data-status")).toBe("continuing");
    // The successor stream listeners are attached so the dispatched turn's
    // chunks reach the badge (dead-air otherwise).
    expect(attachChatV2SuccessorStream).toHaveBeenCalledTimes(1);
    const attachArgs = attachSuccessorMock.mock.calls[0][0] as {
      mode: string;
      parentExecutionId: string;
      executionId: string;
      conversationId: string;
    };
    expect(attachArgs.mode).toBe("continue");
    expect(attachArgs.parentExecutionId).toBe("exec-parent");
    expect(attachArgs.executionId).toBe("exec-new");
    expect(attachArgs.conversationId).toBe("v2-test");
  });

  it("Retry created response adopts the successor identity and attaches the successor stream (T09)", async () => {
    retryTaskMock.mockResolvedValue({
      executionId: "exec-retry-new",
      status: "created",
    });
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-parent",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "MODEL_ATTEMPT_LIMIT",
        outcome: "incomplete",
      },
    ]);
    const retryBtn = wrapper
      .findAll("button[aria-label]")
      .find((b) => b.attributes("aria-label") === "Retry");
    await retryBtn!.trigger("click");
    await flushPromises();

    const state = badge(wrapper);
    expect(state.attributes("data-status")).toBe("resolving");
    expect(attachChatV2SuccessorStream).toHaveBeenCalledTimes(1);
    const attachArgs = attachSuccessorMock.mock.calls[0][0] as {
      mode: string;
      executionId: string;
      conversationId: string;
    };
    expect(attachArgs.mode).toBe("retry");
    expect(attachArgs.executionId).toBe("exec-retry-new");
    expect(attachArgs.conversationId).toBe("v2-test");
  });

  it("attaching the successor stream routes the successor's task_execution_state chunks to the badge (T09)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-parent",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "NO_PROGRESS",
        outcome: "incomplete",
      },
    ]);
    const continueBtn = wrapper
      .findAll("button[aria-label]")
      .find((b) => b.attributes("aria-label") === "Continue");
    await continueBtn!.trigger("click");
    await flushPromises();

    // The real attach helper forwards successor chunks into the component's
    // task_execution_state branch: drive the registered handler. The helper
    // takes a single input object — the callback lives on it, not as a
    // positional argument.
    const handler = (
      attachSuccessorMock.mock.calls[0][0] as {
        onTaskExecutionState: (
          state: ChatV2StreamChunk["taskExecutionState"]
        ) => void;
      }
    ).onTaskExecutionState;
    handler({
      executionId: "exec-new",
      conversationId: "v2-test",
      status: "active",
    });
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("active");

    handler({
      executionId: "exec-new",
      conversationId: "v2-test",
      status: "verifying",
    });
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("verifying");
  });

  it("a reused/denied Continue response leaves the badge untouched (no optimistic flip)", async () => {
    continueTaskMock.mockResolvedValue({ executionId: null, status: "reused" });
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      {
        executionId: "exec-parent",
        conversationId: "v2-test",
        status: "terminal",
        reasonCode: "NO_PROGRESS",
        outcome: "incomplete",
      },
    ]);
    const continueBtn = wrapper
      .findAll("button[aria-label]")
      .find((b) => b.attributes("aria-label") === "Continue");
    await continueBtn!.trigger("click");
    await flushPromises();

    expect(continueTask).toHaveBeenCalledTimes(1);
    // Still terminal — the optimistic continuing flip only happens on created.
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
  });

  it("clears the badge on conversation switch (state is per-conversation)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    await streamWithTaskChunks(wrapper, [
      { executionId: "exec-1", conversationId: "v2-test", status: "active" },
    ]);
    expect(badge(wrapper).exists()).toBe(true);

    const exposed = wrapper.vm as unknown as {
      onSelectConversation: (conversationId: string) => void;
    };
    exposed.onSelectConversation("conv-other");
    await flushPromises();

    expect(badge(wrapper).exists()).toBe(false);
  });
});
