import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2 from "@/views/components/aiChatV2/AiChatV2.vue";
import {
  streamChatV2Message,
  attachChatV2SuccessorStream,
} from "@/views/api/aiChatV2";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";

/**
 * Component tests for B09/B10 (PRD FR-13/14/21/22, AC-25/27/32).
 *
 * B09: the badge's execution acceptance binds to the current run — a NEW
 * execution arriving while the tracked one is terminal is a legitimate
 * replacement (task B after task A) and is adopted; late chunks from an
 * older run while a newer one is tracked (or an older terminal over a
 * newer terminal) are dropped, never resurrecting stale state.
 *
 * B10: Continue/Retry successor turns render (tokens/tools into a disclosed
 * successor assistant turn), badge from the successor's states, finalize on
 * the successor complete, and correlate the attach by successor identity +
 * parent message id.
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
  getChatV2TaskExecutionState: vi.fn().mockResolvedValue(null),
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
  getChatV2TaskExecutionState: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/views/api/aiChatV2Voice", () => ({
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT:
    "aifetchly:ai-provider-settings-changed",
  AI_CHAT_V2_VOICE_MODELS_CHANGED_EVENT:
    "aifetchly:ai-provider-models-changed",
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
          successor_reused:
            "This task is already running; no new attempt was started.",
          successor_error: "Could not start the task follow-up.",
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
          template: `<div data-testid="messages">{{ JSON.stringify(messages) }}</div>`,
        },
        AiChatV2QuestionCard: true,
        AiChatV2PlanApprovalCard: true,
        AiChatV2Composer: ComposerStub,
        AiChatV2ModeSelector: true,
        AiChatV2ModelSelector: true,
        AiChatV2ToolApprovalModeSelector: true,
        AiChatV2PlanStatusBadge: true,
        TaskExecutionStatusBadge: {
          props: ["status", "outcome", "reasonCode"],
          template: `<span data-testid="task-badge" :data-status="status" :data-outcome="outcome ?? ''" :title="reasonCode ?? ''" />`,
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
          props: ["loading", "disabled"],
          // Mirror loading onto disabled so tests can assert the in-flight
          // state via the native disabled attribute (Vuetify does the same).
          computed: {
            isDisabled() {
              return this.disabled || this.loading;
            },
          },
          template: `<button :disabled="isDisabled" v-bind="$attrs"><slot /></button>`,
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
        VSnackbar: {
          props: ["modelValue"],
          template: `<div v-show="modelValue" data-testid="v-snackbar"><slot /></div>`,
        },
        VSpacer: true,
        VTextField: true,
        VTooltip: true,
      },
    },
  });
}

/** Captured live streams: each send appends {onChunk, onComplete, conversationId}. */
interface CapturedStream {
  conversationId: string;
  onChunk: (chunk: ChatV2StreamChunk) => void;
  onComplete: (chunk: ChatV2StreamChunk) => void;
}

function captureStreams(): CapturedStream[] {
  const streams: CapturedStream[] = [];
  vi.mocked(streamChatV2Message).mockImplementation(
    async (request, onChunk, onComplete) => {
      streams.push({
        conversationId: request.conversationId ?? "v2-test",
        onChunk: onChunk as CapturedStream["onChunk"],
        onComplete: onComplete as CapturedStream["onComplete"],
      });
    }
  );
  return streams;
}

function stateChunk(
  conversationId: string,
  executionId: string,
  status: "active" | "terminal",
  extra: Record<string, unknown> = {}
): ChatV2StreamChunk {
  return {
    eventType: "task_execution_state",
    conversationId,
    messageId: "asst-parent",
    taskExecutionState: {
      executionId,
      conversationId,
      status,
      ...extra,
    },
  } as ChatV2StreamChunk;
}

/** Run stream A's chunks then its terminal complete (messageId asst-A). */
function completeStreamA(stream: CapturedStream, outcome = "incomplete"): void {
  const conv = stream.conversationId;
  stream.onChunk({ eventType: "start", conversationId: conv, messageId: "asst-A" });
  stream.onChunk(stateChunk(conv, "exec-A", "active"));
  stream.onChunk(stateChunk(conv, "exec-A", "terminal", {
    reasonCode: "NO_PROGRESS",
    outcome,
  }));
  stream.onChunk({
    eventType: "token",
    conversationId: conv,
    messageId: "asst-A",
    contentDelta: "parent text",
  });
  stream.onComplete({
    eventType: "complete",
    conversationId: conv,
    messageId: "asst-A",
    fullContent: "parent text",
  });
}

function badge(wrapper: ReturnType<typeof mountChat>) {
  return wrapper.find('[data-testid="task-badge"]');
}

function messagesJson(wrapper: ReturnType<typeof mountChat>): string {
  return wrapper.find('[data-testid="messages"]').text();
}

async function clickContinue(wrapper: ReturnType<typeof mountChat>) {
  const btn = wrapper
    .findAll("button[aria-label]")
    .find((b) => b.attributes("aria-label") === "Continue");
  expect(btn).toBeDefined();
  await btn!.trigger("click");
  await flushPromises();
}

describe("AiChatV2 B09 execution acceptance binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    continueTaskMock.mockResolvedValue({ executionId: "exec-new", status: "created" });
    retryTaskMock.mockResolvedValue({ executionId: "exec-new", status: "created" });
  });

  it("B09a: a new execution after a terminal tracked run is adopted (task B replaces task A)", async () => {
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
    expect(badge(wrapper).attributes("data-outcome")).toBe("incomplete");

    // Task B streams in the same conversation: its active chunk must adopt
    // the badge (old code drops every different-execution chunk, so the
    // badge would stay stuck on A's terminal).
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    const conv = streams[1].conversationId;
    streams[1].onChunk({ eventType: "start", conversationId: conv, messageId: "asst-B" });
    streams[1].onChunk(stateChunk(conv, "exec-B", "active"));
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("active");
    expect(badge(wrapper).attributes("data-outcome")).toBe("");
  });

  it("B09b: a late chunk from the older run never overwrites the tracked newer run", async () => {
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    const conv = streams[1].conversationId;
    streams[1].onChunk(stateChunk(conv, "exec-B", "active"));
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("active");

    // Late A chunk (captured live-stream callback, racing delivery).
    streams[0].onChunk(stateChunk(conv, "exec-A", "active"));
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("active");
    expect(badge(wrapper).attributes("data-outcome")).toBe("");
  });

  it("B09c: an older run's delayed terminal never resurrects over a newer terminal", async () => {
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    const conv = streams[1].conversationId;
    streams[1].onChunk(stateChunk(conv, "exec-B", "active"));
    streams[1].onChunk(
      stateChunk(conv, "exec-B", "terminal", {
        reasonCode: "CRITERIA_SATISFIED",
        outcome: "verified_complete",
      })
    );
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
    expect(badge(wrapper).attributes("data-outcome")).toBe("verified_complete");

    // Delayed terminal from the older run A: must not resurrect A.
    streams[0].onChunk(
      stateChunk(conv, "exec-A", "terminal", {
        reasonCode: "NO_PROGRESS",
        outcome: "incomplete",
      })
    );
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
    expect(badge(wrapper).attributes("data-outcome")).toBe("verified_complete");
    expect(badge(wrapper).attributes("title")).toBe("CRITERIA_SATISFIED");
  });
});

describe("AiChatV2 B10 successor turn rendering + correlation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    continueTaskMock.mockResolvedValue({ executionId: "exec-B", status: "created" });
    retryTaskMock.mockResolvedValue({ executionId: "exec-B", status: "created" });
  });

  function attachInput(): {
    mode: string;
    parentExecutionId: string;
    executionId: string;
    parentMessageId?: string | null;
    onTaskExecutionState: (s: unknown) => void;
    onChunk?: (c: ChatV2StreamChunk) => void;
    onComplete: (c: ChatV2StreamChunk) => void;
    onError: (e: Error) => void;
  } {
    expect(attachChatV2SuccessorStream).toHaveBeenCalledTimes(1);
    return attachSuccessorMock.mock.calls[0][0] as ReturnType<typeof attachInput>;
  }

  it("B10a: Continue attaches with successor identity + parent message id", async () => {
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();
    await clickContinue(wrapper);

    const input = attachInput();
    expect(input.mode).toBe("continue");
    expect(input.parentExecutionId).toBe("exec-A");
    expect(input.executionId).toBe("exec-B");
    // Parent message id recorded from the parent complete → late parent
    // chunks are attributable (and ignorable) downstream.
    expect(input.parentMessageId).toBe("asst-A");
    expect(badge(wrapper).attributes("data-status")).toBe("continuing");
  });

  it("B10b: successor states badge, tokens render into a disclosed successor turn", async () => {
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();
    await clickContinue(wrapper);
    const input = attachInput();
    const conv = streams[0].conversationId;

    input.onTaskExecutionState({
      executionId: "exec-B",
      conversationId: conv,
      status: "active",
    } as ChatV2StreamChunk["taskExecutionState"]);
    await flushPromises();
    expect(badge(wrapper).attributes("data-status")).toBe("active");

    input.onChunk?.({
      eventType: "token",
      conversationId: conv,
      messageId: "asst-B",
      contentDelta: "successor text",
    });
    await flushPromises();
    const rendered = messagesJson(wrapper);
    expect(rendered).toContain("successor text");
    // New-attempt disclosure: the turn carries the successor marker.
    expect(rendered).toContain('"successorMode":"continue"');
    expect(rendered).toContain('"successorExecutionId":"exec-B"');
  });

  it("B10c: successor tools render and the successor complete finalizes with terminal badge", async () => {
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();
    await clickContinue(wrapper);
    const input = attachInput();
    const conv = streams[0].conversationId;

    input.onChunk?.({
      eventType: "tool_call",
      conversationId: conv,
      messageId: "asst-B",
      toolCallId: "call-1",
      toolName: "search",
      toolArguments: { q: "x" },
    });
    await flushPromises();
    expect(messagesJson(wrapper)).toContain("call-1");

    input.onTaskExecutionState({
      executionId: "exec-B",
      conversationId: conv,
      status: "terminal",
      reasonCode: "CRITERIA_SATISFIED",
      outcome: "verified_complete",
    } as ChatV2StreamChunk["taskExecutionState"]);
    input.onComplete({
      eventType: "complete",
      conversationId: conv,
      messageId: "asst-B",
      fullContent: "successor final",
    });
    await flushPromises();
    expect(messagesJson(wrapper)).toContain("successor final");
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
    expect(badge(wrapper).attributes("data-outcome")).toBe("verified_complete");
  });
});

/**
 * Continue/Retry successor UI safety (FR-14): the two-time-offender bug was
 * that neither button had loading/disabled guards (a double-click minted two
 * successor submissionIds) and denied/conflict/reused outcomes were swallowed
 * with only a console.error — the user saw a spinning badge with no recourse
 * and no feedback. These tests lock the loading guard + snackbar feedback.
 */
describe("AiChatV2 Continue/Retry loading guard + successor feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    continueTaskMock.mockResolvedValue({ executionId: "exec-B", status: "created" });
    retryTaskMock.mockResolvedValue({ executionId: "exec-B", status: "created" });
  });

  function successorNotice(wrapper: ReturnType<typeof mountChat>) {
    return wrapper.find('[data-testid="task-successor-notice"]');
  }

  it("Continue surfaces a snackbar when the occurrence was reused (no new attempt)", async () => {
    continueTaskMock.mockResolvedValue({ executionId: null, status: "reused" });
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();
    await clickContinue(wrapper);

    // No successor attached — the reused result must not call attach.
    expect(attachSuccessorMock).not.toHaveBeenCalled();
    // The notice is shown with the reused feedback text.
    expect(successorNotice(wrapper).exists()).toBe(true);
    expect(successorNotice(wrapper).text()).toContain("already running");
    // Badge restored to the parent terminal state (not left spinning).
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
  });

  it("Retry surfaces a snackbar with the backend reason when the IPC handler denies (status:false)", async () => {
    retryTaskMock.mockRejectedValue(new Error("Intent conflict in flight"));
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();

    const retryBtn = wrapper
      .findAll("button[aria-label]")
      .find((b) => b.attributes("aria-label") === "Retry");
    expect(retryBtn).toBeDefined();
    await retryBtn!.trigger("click");
    await flushPromises();

    expect(attachSuccessorMock).not.toHaveBeenCalled();
    expect(successorNotice(wrapper).text()).toContain("Could not start");
    expect(successorNotice(wrapper).text()).toContain("Intent conflict");
    // Parent terminal state restored so the actions reappear.
    expect(badge(wrapper).attributes("data-status")).toBe("terminal");
  });

  it("Continue disables both buttons while the IPC call is in flight (no double-click)", async () => {
    // Never-resolve keeps the call pending so we can observe the in-flight state.
    continueTaskMock.mockReturnValue(new Promise(() => undefined));
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();

    const continueBtn = wrapper.find('[data-testid="task-continue-btn"]');
    const retryBtn = wrapper.find('[data-testid="task-retry-btn"]');
    expect(continueBtn.exists()).toBe(true);
    expect(retryBtn.exists()).toBe(true);

    await continueBtn.trigger("click");
    await flushPromises();

    // While in flight: BOTH buttons are disabled (shared loading flag).
    expect(continueBtn.attributes("disabled")).toBeDefined();
    expect(retryBtn.attributes("disabled")).toBeDefined();
  });

  it("a re-entrant Continue click while loading is refused (no second successor)", async () => {
    const pending = new Promise<{ executionId: string; status: string }>(() => undefined);
    continueTaskMock.mockReturnValue(pending);
    const wrapper = mountChat();
    await flushPromises();
    const streams = captureStreams();
    await wrapper.find('[data-testid="send-first"]').trigger("click");
    await flushPromises();
    completeStreamA(streams[0]);
    await flushPromises();

    const continueBtn = wrapper.find('[data-testid="task-continue-btn"]');
    await continueBtn.trigger("click");
    await flushPromises();
    const callsAfterFirst = continueTaskMock.mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    // Second click while still loading: the guard returns early — no new IPC call.
    await continueBtn.trigger("click");
    await flushPromises();
    expect(continueTaskMock.mock.calls.length).toBe(1);
  });
});

