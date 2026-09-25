/**
 * Task 7: IPC — scheduled permission grant/deny routing.
 *
 * Verifies that `handleResumeToolAfterPermission` and
 * `handleDenyToolPermission` route to a registered scheduled-loop engine via
 * `ScheduledLoopEngineRegistry` when one owns the conversation's pending
 * permission, and fall through to the interactive engine / handled:false
 * otherwise.
 *
 * `getQueryEngine` is a module-local function that constructs an
 * `AIChatQueryEngine` on first call. To make the interactive fall-through path
 * unit-testable without spinning up the real engine and its many service deps,
 * we mock `@/service/AIChatQueryEngine` as a class whose instances carry the
 * methods the handlers call. The first `getQueryEngine()` call then constructs
 * the mock, and the stub's `resumeToolAfterPermission` stands in for the
 * interactive path.
 *
 * The heavy transitive mocks (AIChatV2Module, AiChatApi, SkillRegistry, etc.)
 * mirror the established pattern in `ai-chat-v2-ipc.test.ts` — importing the
 * IPC module pulls in the full handler graph, so every service it constructs at
 * module scope or inside helpers must be stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockIpcMain } from "../../../utils/electron-mocks";

// --- Mock electron (ipcMain is used at registration time) ---
vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

// --- Stub for the interactive AIChatQueryEngine instance ---
// getQueryEngine() constructs `new AIChatQueryEngine(loop, {...})` on first
// call. Mocking the class lets the fall-through path return a controllable
// stub without wiring the real engine's service deps.
const mockInteractiveResume = vi.fn();
const mockInteractiveDeny = vi.fn();
vi.mock("@/service/AIChatQueryEngine", () => ({
  AIChatQueryEngine: class {
    resumeToolAfterPermission = mockInteractiveResume;
    denyToolPermission = mockInteractiveDeny;
  },
}));

// --- Mock the scheduled-loop registry ---
const mockEntry = {
  engine: {
    resumeToolAfterPermission: vi.fn(),
    denyToolPermission: vi.fn(),
  },
  runId: 1,
  scheduleId: 1,
  clearPermissionBackstop: vi.fn(),
};
const mockRegistry = {
  getByConversation: vi.fn(),
  hasPendingPermission: vi.fn(),
  clearPendingPermission: vi.fn(),
};
vi.mock("@/service/ScheduledLoopEngineRegistry", () => ({
  ScheduledLoopEngineRegistry: { getInstance: () => mockRegistry },
}));

// --- Mock Token + usersetting (used by canUseChat + getCurrentUserDbPath) ---
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "";
    }
    setValue(): void {
      // noop
    }
    deleteValue(): void {
      // noop
    }
    hasValue(): boolean {
      return false;
    }
  },
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...actual,
    USER_AI_ENABLED: "USER_AI_ENABLED",
    USERSDBPATH: "USERSDBPATH",
  };
});

// --- Mock the AI feature gate + provider resolver so canUseChat() always
// allows. The IPC handler's canUseChat() calls AIProviderResolver.resolveForChat()
// then ensureHostedAiEnabled() on hosted denials — stub both so every test
// passes the gate without wiring real provider config.
vi.mock("@/service/AiFeatureGate", () => ({
  ensureHostedAiEnabled: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/service/aiProvider/AIProviderResolver", () => ({
  AIProviderResolver: class {
    resolveForChat() {
      return { canUse: true };
    }
  },
}));

// --- Mirror the transitive mocks from ai-chat-v2-ipc.test.ts ---
// The IPC module imports and constructs these services at module scope / inside
// helpers, so every one must be stubbed for the import to succeed.
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: class {
    clearConversation = vi.fn();
    clearAllV2History = vi.fn();
    getConversations = vi.fn();
    createConversationIfNeeded = vi.fn();
    saveUserMessage = vi.fn();
    getConversationMessages = vi.fn();
    getRecentMessages = vi.fn();
    saveAssistantMessage = vi.fn();
    saveToolCallMessage = vi.fn();
    saveToolResultMessage = vi.fn();
    getDefaultSystemPrompt = vi.fn();
  },
}));
vi.mock("@/modules/user", () => ({
  User: class {
    Signout = vi.fn();
    removeToken = vi.fn();
  },
}));
vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/aiChatApi")>();
  return {
    ...actual,
    AiChatApi: class {
      openAIChatCompletionStream = vi.fn();
      listOpenAIModels = vi.fn();
    },
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
    isRegistered: vi.fn().mockReturnValue(false),
  },
}));
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: {
    execute: vi.fn(),
  },
}));
vi.mock("@/modules/AIChatToolApprovalModule", () => ({
  AIChatToolApprovalModule: class {
    getMode = vi.fn().mockReturnValue("ask_for_approval");
    setMode = vi.fn();
  },
}));
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: class {
    getPlanState = vi.fn().mockResolvedValue(null);
    ensurePlanForConversation = vi.fn().mockResolvedValue(null);
    clearConversationPlanState = vi.fn().mockResolvedValue({ deleted: 0 });
  },
}));
vi.mock("@/service/PlanModeToolRegistry", () => ({
  PlanModeToolRegistry: { toOpenAITools: vi.fn().mockReturnValue([]) },
}));
vi.mock("@/service/PlanModePromptBuilder", () => ({
  buildPlanModeSystemPrompt: vi.fn().mockReturnValue("plan prompt"),
}));
vi.mock("@/service/OpenAIChatTranscriptBuilder", () => ({
  buildOpenAITranscript: vi.fn().mockReturnValue({ messages: [] }),
}));
vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: class {
    getByConversation = vi.fn().mockResolvedValue(null);
  },
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: class {
    getActiveSummary = vi.fn().mockResolvedValue(null);
  },
}));
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    listActiveForRuntime = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: class {
    getSettingValue = vi.fn().mockResolvedValue(null);
  },
}));
vi.mock("@/service/WorkspaceResolver", () => ({
  WorkspaceResolver: class {
    resolve = vi.fn().mockResolvedValue(null);
  },
}));
vi.mock("@/service/AIUserMemoryRetrievalService", () => ({
  AIUserMemoryRetrievalService: class {
    retrieve = vi.fn().mockResolvedValue({ contextBlock: "", memories: [] });
  },
}));
vi.mock("@/service/AIWorkspaceMemoryRetrievalService", () => ({
  AIWorkspaceMemoryRetrievalService: class {
    retrieve = vi.fn().mockResolvedValue({ contextBlock: "", memories: [] });
  },
}));
vi.mock("@/service/aifetchlyConfig/AIFetchlyContextLoader", () => ({
  AIFetchlyContextLoader: class {
    static formatInstructionBlock(): string {
      return "";
    }

    async getInstructionBlocks(): Promise<[]> {
      return [];
    }
  },
}));
vi.mock("@/service/AIAutoDreamFactory", () => ({
  getSharedAutoDreamService: vi.fn(() => ({
    evaluateAfterChatTurn: vi.fn().mockResolvedValue(undefined),
    evaluateAfterAgentTask: vi.fn().mockResolvedValue(undefined),
  })),
  resetSharedAutoDreamService: vi.fn(),
  getSharedWorkspaceAutoDreamService: vi.fn(() => ({
    evaluateAfterChatTurn: vi.fn().mockResolvedValue(undefined),
    evaluateAfterAgentTask: vi.fn().mockResolvedValue(undefined),
  })),
  resetSharedWorkspaceAutoDreamService: vi.fn(),
}));

import {
  handleResumeToolAfterPermission,
  handleDenyToolPermission,
} from "@/main-process/communication/ai-chat-v2-ipc";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: registry reports nothing pending.
  mockRegistry.getByConversation.mockReturnValue(undefined);
  mockRegistry.hasPendingPermission.mockReturnValue(false);
  mockRegistry.clearPendingPermission.mockReturnValue(undefined);
  // Interactive engine stubs return a success ResumeTurnResult by default.
  mockInteractiveResume.mockResolvedValue({ ok: true });
  mockInteractiveDeny.mockResolvedValue({ ok: true });
});

describe("Scheduled permission routing — resume", () => {
  it("routes to the scheduled engine when registered + has pending permission", async () => {
    mockRegistry.getByConversation.mockReturnValue(mockEntry);
    mockRegistry.hasPendingPermission.mockReturnValue(true);
    mockEntry.engine.resumeToolAfterPermission.mockResolvedValue({
      ok: true,
    });

    const result = await handleResumeToolAfterPermission({
      toolId: "t1",
      conversationId: "c1",
    });

    expect(mockEntry.engine.resumeToolAfterPermission).toHaveBeenCalledWith({
      toolId: "t1",
      conversationId: "c1",
    });
    expect(mockEntry.clearPermissionBackstop).toHaveBeenCalled();
    expect(mockRegistry.clearPendingPermission).toHaveBeenCalledWith("c1");
    expect(result).toMatchObject({ status: true, data: { ok: true } });
  });

  it("falls through to the interactive engine when not registered", async () => {
    mockRegistry.getByConversation.mockReturnValue(undefined);

    const result = await handleResumeToolAfterPermission({
      toolId: "t1",
      conversationId: "c1",
    });

    expect(mockEntry.engine.resumeToolAfterPermission).not.toHaveBeenCalled();
    expect(mockInteractiveResume).toHaveBeenCalledWith({
      toolId: "t1",
      conversationId: "c1",
    });
    expect(result).toMatchObject({ status: true, data: { ok: true } });
  });
});

describe("Scheduled permission routing — deny", () => {
  it("routes to the scheduled engine when registered + has pending permission", async () => {
    mockRegistry.getByConversation.mockReturnValue(mockEntry);
    mockRegistry.hasPendingPermission.mockReturnValue(true);
    mockEntry.engine.denyToolPermission.mockResolvedValue({
      ok: true,
    });

    const result = await handleDenyToolPermission({
      toolId: "t1",
      conversationId: "c1",
    });

    expect(mockEntry.engine.denyToolPermission).toHaveBeenCalledWith({
      toolId: "t1",
      conversationId: "c1",
    });
    expect(mockEntry.clearPermissionBackstop).toHaveBeenCalled();
    expect(mockRegistry.clearPendingPermission).toHaveBeenCalledWith("c1");
    expect(result).toMatchObject({
      status: true,
      data: { ok: true, handled: true },
    });
  });

  it("returns handled:false when no scheduled engine owns the permission", async () => {
    mockRegistry.getByConversation.mockReturnValue(undefined);

    const result = await handleDenyToolPermission({
      toolId: "t1",
      conversationId: "c1",
    });

    expect(mockEntry.engine.denyToolPermission).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: true,
      data: { ok: true, handled: false },
    });
  });
});
