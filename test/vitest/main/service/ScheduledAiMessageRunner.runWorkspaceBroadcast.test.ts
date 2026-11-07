import { describe, expect, it, beforeEach, vi } from "vitest";
import type { ConversationSummaryEvent } from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * BUGFIX 2026-11-02 — after Run Now (or a cron tick) on a schedule whose AI
 * message task chose a workspace, the left menu never showed the new
 * workspace folder in the same session.
 *
 * Root cause: `ScheduledAiMessageRunner.run()` → `executeRunLoop` — the path
 * used by the Schedule page button and by standalone cron schedules — wired
 * the engine with the raw `ScheduledLoopEventSink` only. The workspace
 * summary broadcasts (design §8.3 owner adapter) existed ONLY in
 * `runChatScheduledLoop`, so background schedule runs were invisible to the
 * sidebar and the conversation stayed under "Other chats" for the whole
 * session.
 *
 * Contract under test: `run()` broadcasts run-lifecycle summary events for
 * the schedule's conversation through the owner adapter, stamped with the
 * conversation's bound workspace key and the scheduled owner so the sidebar
 * can regroup immediately.
 */

// --- Controllable stubs (hoisted so vi.mock factories can reference them) ---
const chatCanUse = vi.hoisted(() => ({ value: true }));
const engineOutcome = vi.hoisted(() => ({
  value: null as
    | { type: "complete"; content?: string }
    | { type: "error"; message?: string }
    | null,
}));

const mockGetTask = vi.hoisted(() => vi.fn());
const mockParseAllowedTools = vi.hoisted(() => vi.fn());
const mockUpdateTask = vi.hoisted(() => vi.fn());
const mockCreateRun = vi.hoisted(() => vi.fn());
const mockUpdateRunStatus = vi.hoisted(() => vi.fn());
const mockCompleteRun = vi.hoisted(() => vi.fn());
const mockFailRun = vi.hoisted(() => vi.fn());
const mockGetScheduleById = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockBroadcastEmit = vi.hoisted(() => vi.fn());
const mockBroadcastStream = vi.hoisted(() => vi.fn());
const mockRunTurn = vi.hoisted(() => vi.fn());
const mockCreateConversationIfNeeded = vi.hoisted(() =>
  vi.fn((id?: string) => (id && id.startsWith("v2-") ? id : "v2-minted"))
);
const mockRecordMessagePersisted = vi.hoisted(() => vi.fn());
const mockGetWorkspaceKey = vi.hoisted(() => vi.fn());
const mockBindApprovedWorkspace = vi.hoisted(() => vi.fn());
const broadcastSummarySpy = vi.hoisted(() => vi.fn());

type MockConstructor<T> = new (...args: never[]) => T;

function createMockClass<T extends object>(
  factory: () => T
): MockConstructor<T> {
  const cls = function (this: T) {
    Object.assign(this, factory());
  } as unknown as MockConstructor<T>;
  return cls;
}

const testDbDir = vi.hoisted(() => () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("os") as typeof import("os");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path") as typeof import("path");
  const poolId = process.env.VITEST_POOL_ID ?? "0";
  return path.join(os.tmpdir(), "aifetchly-test", poolId, "scraper.db");
});

vi.mock("@/modules/token", () => ({
  Token: createMockClass(() => ({
    getValue: vi.fn((key: string) =>
      key === "user_ai_enabled" ? "true" : testDbDir()
    ),
  })),
}));

vi.mock("@/service/aiProvider/AIProviderResolver", () => ({
  AIProviderResolver: class {
    resolveForChat(): { kind: "hosted"; canUse: true } {
      return { kind: "hosted" as const, canUse: true as const };
    }
  },
}));
vi.mock("@/modules/AiMessageTaskModule", () => ({
  AiMessageTaskModule: class {
    getTask = mockGetTask;
    parseAllowedTools = mockParseAllowedTools;
    updateTask = mockUpdateTask;
    updateLastRunResult = vi.fn();
  },
}));
vi.mock("@/modules/AiMessageTaskRunModule", () => ({
  AiMessageTaskRunModule: class {
    createRun = mockCreateRun;
    updateRunStatus = mockUpdateRunStatus;
    completeRun = mockCompleteRun;
    failRun = mockFailRun;
  },
}));
vi.mock("@/modules/AIChatConversationModule", () => ({
  AIChatConversationModule: class {
    recordMessagePersisted = mockRecordMessagePersisted;
    getWorkspaceKeyForConversation = mockGetWorkspaceKey;
  },
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: class {
    createConversationIfNeeded = mockCreateConversationIfNeeded;
  },
}));
vi.mock("@/model/ScheduleTask.model", () => ({
  ScheduleTaskModel: class {
    getScheduleById = mockGetScheduleById;
  },
}));
vi.mock("@/service/AIChatQueryEngineFactory", () => ({
  AIChatQueryEngineFactory: class {
    createScheduled() {
      return { runTurn: mockRunTurn };
    }
  },
}));
vi.mock("@/service/AIChatConversationTurnCoordinator", () => ({
  AIChatConversationTurnCoordinator: {
    getInstance: () => ({
      acquire: mockAcquire,
      tryAcquire: vi.fn(() => null),
    }),
  },
  ConversationTurnBusyError: class extends Error {},
}));
vi.mock("@/service/AIChatConversationUpdateBroadcaster", () => ({
  AIChatConversationUpdateBroadcaster: {
    getInstance: () => ({
      emit: mockBroadcastEmit,
      emitScheduledStream: mockBroadcastStream,
    }),
  },
}));
vi.mock("@/service/ScheduledLoopRunRegistry", () => ({
  ScheduledLoopRunRegistry: {
    getInstance: () => ({
      register: vi.fn(),
      unregister: vi.fn(),
      abort: vi.fn(() => false),
    }),
  },
}));
vi.mock("@/service/AiMessageTaskWorkspace", () => ({
  bindApprovedWorkspace: mockBindApprovedWorkspace,
}));
// The owner adapter resolves the workspace key through the REAL service
// module — only intercept the SUMMARY BROADCAST delivery so tests observe it.
vi.mock("@/service/aiChatWorkspaceRuntime", () => ({
  sharedSummaryBroadcaster: {
    broadcastSummary: broadcastSummarySpy,
  },
  sharedWorkspaceEventRouter: {
    broadcastSummary: broadcastSummarySpy,
    register: vi.fn(),
  },
  scheduledAwareLiveRuntime: vi.fn((live: unknown) => live),
}));

import { ScheduledAiMessageRunner } from "@/service/ScheduledAiMessageRunner";

const TASK = {
  id: 1,
  source_type: "schedule_ui",
  conversation_id: null as string | null,
  message: "check deployment",
  model: "auto",
  allowed_tools_json: "[]",
  auto_approve_tools: true,
  max_tool_calls: 10,
  max_runtime_ms: 300_000,
  max_continue_calls: 10,
  status: "active",
  workspace_path: "/tmp/workroom" as string | null,
};
const SCHEDULE = {
  id: 2,
  task_id: 1,
  is_active: true,
  status: "active",
};

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (condition()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  chatCanUse.value = true;
  engineOutcome.value = null;
  mockParseAllowedTools.mockReturnValue([]);
  mockGetTask.mockResolvedValue(TASK);
  mockGetScheduleById.mockResolvedValue(SCHEDULE);
  mockCreateRun.mockResolvedValue(42);
  mockCreateConversationIfNeeded.mockImplementation((id?: string) =>
    id && id.startsWith("v2-") ? id : "v2-minted"
  );
  mockAcquire.mockResolvedValue({
    conversationId: "v2-minted",
    owner: "scheduled",
    ownerId: "run-9",
    leaseId: 1,
    release: vi.fn(),
  });
  mockGetWorkspaceKey.mockResolvedValue(null);
  mockBindApprovedWorkspace.mockResolvedValue("/tmp/workroom");
  mockRunTurn.mockImplementation(
    async (input: {
      eventSink: { emit: (e: unknown) => void };
      request: { conversationId: string };
    }) => {
      const sink = input.eventSink;
      if (engineOutcome.value?.type === "complete") {
        sink.emit({
          type: "start",
          conversationId: input.request.conversationId,
          messageId: "aid-1",
        });
        sink.emit({
          type: "token",
          conversationId: input.request.conversationId,
          messageId: "aid-1",
          contentDelta: "ok",
        });
        sink.emit({
          type: "complete",
          conversationId: input.request.conversationId,
          messageId: "aid-1",
          fullContent: engineOutcome.value.content ?? "ok",
        });
        return {
          type: "completed",
          conversationId: input.request.conversationId,
          assistantMessageId: "aid-1",
        };
      }
      if (engineOutcome.value?.type === "error") {
        sink.emit({
          type: "start",
          conversationId: input.request.conversationId,
          messageId: "aid-1",
        });
        sink.emit({
          type: "error",
          conversationId: input.request.conversationId,
          messageId: "aid-1",
          errorMessage: engineOutcome.value.message ?? "boom",
        });
        return {
          type: "failed",
          conversationId: input.request.conversationId,
          assistantMessageId: "aid-1",
        };
      }
      return {
        type: "failed",
        conversationId: input.request.conversationId,
        assistantMessageId: "",
      };
    }
  );
});

describe("ScheduledAiMessageRunner.run broadcasts workspace summaries (bugfix 2026-11-02)", () => {
  it("stamps run lifecycle summaries with the bound workspace key and owner", async () => {
    mockGetWorkspaceKey.mockResolvedValue("ws_bound_key_1");
    engineOutcome.value = { type: "complete", content: "deployment ok" };

    const result = await new ScheduledAiMessageRunner().run(1, 2);
    expect(result.status).toBe("completed");

    await waitFor(() =>
      broadcastSummarySpy.mock.calls.some(
        (c) => (c[0] as ConversationSummaryEvent).reason === "run_completed"
      )
    );
    const events = broadcastSummarySpy.mock.calls.map(
      (c) => c[0] as ConversationSummaryEvent
    );
    const started = events.find((e) => e.reason === "run_started");
    expect(started).toBeDefined();
    expect(started?.conversationId).toBe("v2-minted");
    expect(started?.workspaceKey).toBe("ws_bound_key_1");
    expect(started?.runOwner).toBe("scheduled");
    const completed = events.find((e) => e.reason === "run_completed");
    expect(completed?.workspaceKey).toBe("ws_bound_key_1");
  });

  it("broadcasts with null workspace key when the conversation is unbound", async () => {
    mockGetWorkspaceKey.mockResolvedValue(null);
    engineOutcome.value = { type: "complete", content: "plain" };

    await new ScheduledAiMessageRunner().run(1, 2);

    await waitFor(() =>
      broadcastSummarySpy.mock.calls.some(
        (c) => (c[0] as ConversationSummaryEvent).reason === "run_completed"
      )
    );
    for (const c of broadcastSummarySpy.mock.calls) {
      expect((c[0] as ConversationSummaryEvent).workspaceKey).toBeNull();
    }
  });
});
