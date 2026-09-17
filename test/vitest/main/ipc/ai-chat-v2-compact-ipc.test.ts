import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";

// Mock electron module — must be hoisted before handler import.
vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

// Controllable AI-enabled state.
// ES class: production code constructs Token with `new` (AIProviderResolver's
// default ctor arg); a vi.fn() factory is not constructable under Vitest 4.
const mockState = vi.hoisted(() => ({ aiEnabled: "true" }));
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return mockState.aiEnabled;
    }
  },
}));
// Override USER_AI_ENABLED to a literal so the Token mock matches.
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...actual,
    USER_AI_ENABLED: "USER_AI_ENABLED",
    USERSDBPATH: "USERSDBPATH",
  };
});

// Deterministic chat-availability resolver: hosted + usable exactly when the
// mocked USER_AI_ENABLED flag is on. Production AIProviderResolver reads
// provider settings/secrets that this suite does not stub.
vi.mock("@/service/aiProvider/AIProviderResolver", () => ({
  AIProviderResolver: class {
    resolveForChat() {
      if (mockState.aiEnabled === "true") {
        return { canUse: true, kind: "hosted" };
      }
      return {
        canUse: false,
        kind: "hosted",
        message: "AI is not enabled",
        reason: "hosted_subscription_required",
      };
    }
  },
}));

// Controllable coordinator for the non-blocking START flow. The START handler
// must return while the run is still pending, then report settle via events.
const mockRequestCompaction = vi.hoisted(() => vi.fn());
vi.mock("@/service/AIChatCompactionCoordinator", () => ({
  AIChatCompactionCoordinator: class {
    requestCompaction = mockRequestCompaction;
    requestCompactionForTurn = vi.fn();
    getStatus = vi.fn().mockResolvedValue(null);
  },
}));

const mockEmitCompactionProgress = vi.hoisted(() => vi.fn());
vi.mock("@/service/AIChatConversationUpdateBroadcaster", () => ({
  AIChatConversationUpdateBroadcaster: {
    getInstance: () => ({
      emitCompactionProgress: mockEmitCompactionProgress,
      emitAutoCompacted: vi.fn(),
    }),
  },
}));

// Stub remaining modules that the IPC file imports at load time.
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversations: vi.fn().mockResolvedValue([]),
    createConversationIfNeeded: vi.fn().mockReturnValue("v2-test"),
    saveUserMessage: vi.fn().mockResolvedValue({}),
    getConversationMessages: vi.fn().mockResolvedValue([]),
    getRecentMessages: vi.fn().mockResolvedValue([]),
    saveAssistantMessage: vi.fn().mockResolvedValue({}),
    getDefaultSystemPrompt: vi.fn().mockReturnValue("sys"),
    clearConversation: vi.fn().mockResolvedValue(0),
    clearAllV2History: vi.fn().mockResolvedValue(0),
  })),
}));
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: vi.fn().mockResolvedValue(null),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/aiChatApi")>();
  return {
    ...actual,
    // ES class: getCompactAgent() constructs AiChatApi via `new` inside
    // AIChatModelCatalogService; a vi.fn() factory is not constructable.
    AiChatApi: class {},
  };
});

vi.mock("@/service/DesktopNotifyService", () => ({
  DesktopNotifyService: {
    getInstance: () => ({
      show: vi.fn().mockResolvedValue(false),
    }),
  },
}));
vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn().mockResolvedValue([]),
    getSkill: vi.fn().mockReturnValue(undefined),
  },
}));
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import { AI_CHAT_V2_COMPACTION_START } from "@/config/channellist";

type StartResult = { status: boolean; data?: { started: boolean }; msg?: string };

/**
 * START is the ONLY user-facing compact contract (design §13.1
 * start/status/progress). The old blocking compact channel was removed: no
 * production or renderer API awaits the full batch.
 */
describe("AI Chat V2 Compaction Start IPC", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    mockState.aiEnabled = "true";
    registerAiChatV2IpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("registers the compaction start channel", () => {
    const registered = mockIpcMain.getRegisteredChannels();
    expect(registered).toContain(AI_CHAT_V2_COMPACTION_START);
  });

  it("returns denied when AI is not enabled", async () => {
    mockState.aiEnabled = "false";
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACTION_START,
      {},
      JSON.stringify({ conversationId: "v2-conv-1" })
    )) as StartResult;
    expect(result.status).toBe(false);
    expect(mockRequestCompaction).not.toHaveBeenCalled();
  });

  it("returns denied when conversationId is missing", async () => {
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACTION_START,
      {},
      JSON.stringify({})
    )) as StartResult;
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/conversationId is required/i);
    expect(mockRequestCompaction).not.toHaveBeenCalled();
  });

  it("returns denied when conversationId lacks v2- prefix", async () => {
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACTION_START,
      {},
      JSON.stringify({ conversationId: "legacy-1" })
    )) as StartResult;
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/v2-/i);
    expect(mockRequestCompaction).not.toHaveBeenCalled();
  });

  it("returns immediately while the run is still pending (non-blocking)", async () => {
    let release!: (v: {
      runId: string;
      state: "completed";
      generationId: string;
      sectionsPacked: number;
    }) => void;
    mockRequestCompaction.mockImplementationOnce(
      () =>
        new Promise<{
          runId: string;
          state: "completed";
          generationId: string;
          sectionsPacked: number;
        }>((resolve) => {
          release = resolve;
        })
    );

    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACTION_START,
      {},
      JSON.stringify({ conversationId: "v2-conv-1", model: "gpt-4o" })
    )) as StartResult;

    // Returned while the coordinator run is still in flight — the renderer
    // never waits on one RPC for the whole batch (design §13.1).
    expect(result.status).toBe(true);
    expect(result.data).toEqual({ started: true });
    expect(mockRequestCompaction).toHaveBeenCalledTimes(1);
    expect(mockEmitCompactionProgress).toHaveBeenCalledWith(
      expect.objectContaining({ state: "running" })
    );

    // Settle drives the badge via a progress event, not the RPC result.
    release({
      runId: "run-9",
      state: "completed",
      generationId: "gen-9",
      sectionsPacked: 2,
    });
    await vi.waitFor(() =>
      expect(mockEmitCompactionProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-9",
          state: "completed",
          generationId: "gen-9",
          sectionsPacked: 2,
        })
      )
    );
  });

  it("reports a failed settle via progress events (RPC already returned)", async () => {
    let reject!: (e: unknown) => void;
    mockRequestCompaction.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, rejectFn) => {
          reject = rejectFn;
        })
    );

    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACTION_START,
      {},
      JSON.stringify({ conversationId: "v2-conv-1" })
    )) as StartResult;
    expect(result.status).toBe(true);
    expect(result.data).toEqual({ started: true });

    reject(new Error("provider down"));
    await vi.waitFor(() =>
      expect(mockEmitCompactionProgress).toHaveBeenCalledWith(
        expect.objectContaining({ state: "failed" })
      )
    );
  });
});
