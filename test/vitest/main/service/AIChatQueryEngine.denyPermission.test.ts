// test/vitest/main/service/AIChatQueryEngine.denyPermission.test.ts
//
// Validates the scheduled-loop deny-and-continue path: when the user denies a
// paused tool, the scheduled run must CONTINUE (the model receives a
// "permission denied" tool_result and proceeds with an alternate plan)
// rather than stopping the whole conversation (which is what the interactive
// deny does). Here we only lock the not-pending contract — the full
// deny-and-continue re-entry is covered by the runner-level test in Task 6,
// which drives the real engine through the scheduled executor + sink. The
// re-entry mechanics are identical to resumeToolAfterPermission (already
// covered by existing resume tests), so we assert only the deny-specific
// guard: no pending permission ⇒ ok:false with the canonical error message.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopInput, AIChatQueryLoopResult } from "@/service/AIChatQueryEvents";
import { HookRegistry } from "@/service/hooks/HookRegistry";

// --- Mock AIChatV2Module -----------------------------------------------
const mockSaveUserMessage = vi.fn().mockResolvedValue({ messageId: "user-1" });
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockGetRecentMessages = vi.fn().mockResolvedValue([]);
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockSaveToolCallMessage = vi.fn().mockResolvedValue({});
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
const mockCreateConversationIfNeeded = vi.fn().mockReturnValue("v2-test-conv");
const mockGetDefaultSystemPrompt = vi.fn().mockReturnValue("You are helpful.");

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
      saveUserMessage: mockSaveUserMessage,
      getConversationMessages: mockGetConversationMessages,
      getRecentMessages: mockGetRecentMessages,
      saveAssistantMessage: mockSaveAssistantMessage,
      saveToolCallMessage: mockSaveToolCallMessage,
      saveToolResultMessage: mockSaveToolResultMessage,
      createConversationIfNeeded: mockCreateConversationIfNeeded,
      getDefaultSystemPrompt: mockGetDefaultSystemPrompt,
    };
  }),
}));

vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn().mockImplementation(function () {
    return {
      saveUploadedFiles: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

const mockGetPlanState = vi.fn().mockResolvedValue(null);
const mockEnsurePlanForConversation = vi.fn().mockResolvedValue(null);
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(function () {
    return {
      getPlanState: mockGetPlanState,
      ensurePlanForConversation: mockEnsurePlanForConversation,
    };
  }),
}));

const mockGetActiveGoal = vi.fn().mockResolvedValue(null);
vi.mock("@/modules/AIChatGoalModule", () => ({
  AIChatGoalModule: vi.fn().mockImplementation(function () {
    return {
      getActiveGoal: mockGetActiveGoal,
    };
  }),
}));

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(function () {
    return {
      getByConversation: vi.fn().mockResolvedValue(null),
    };
  }),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(function () {
    return {
      getActiveSummary: vi.fn().mockResolvedValue(null),
    };
  }),
}));
vi.mock("@/modules/AIChatArchiveModule", () => ({
  AIChatArchiveModule: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock("@/modules/AIChatCompactionModule", () => ({
  AIChatCompactionModule: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(function () {
    return {
      listActiveForRuntime: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/aiChatApi")>();
  return {
    ...actual,
    AiChatApi: vi.fn().mockImplementation(function () {
      return {};
    }),
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
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return {
      getValue: vi.fn().mockReturnValue("true"),
    };
  }),
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

/**
 * Create an engine backed by a fake loop whose `run()` returns the given
 * result. Mirrors the helper in AIChatQueryEngine.test.ts so the constructor
 * gets a minimal but satisfiable dependency set.
 */
function createEngineWithFakeLoop(
  fakeRun: (input: AIChatQueryLoopInput) => Promise<AIChatQueryLoopResult>
): AIChatQueryEngine {
  const fakeLoop = {
    run: fakeRun,
  } as unknown as AIChatQueryLoop;
  return new AIChatQueryEngine(fakeLoop);
}

describe("AIChatQueryEngine.denyToolPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanState.mockResolvedValue(null);
    mockEnsurePlanForConversation.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockReturnValue("v2-test-conv");
    HookRegistry.unregisterSource("plugin:test-hooks");
  });

  it("returns ok:false when no pending permission matches", async () => {
    const engine = createEngineWithFakeLoop(
      vi.fn(async () => ({
        type: "completed" as const,
        conversationId: "v2-x",
        assistantMessageId: "a1",
        fullContent: "",
        finishReason: "stop",
      })) as unknown as (
        input: AIChatQueryLoopInput
      ) => Promise<AIChatQueryLoopResult>
    );
    const result = await engine.denyToolPermission({
      toolId: "t1",
      conversationId: "v2-x",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No active permission-gated tool call/);
  });

  it("returns ok:false when no conversationId is provided and no pending turn exists", async () => {
    const engine = createEngineWithFakeLoop(
      vi.fn(async () => ({
        type: "completed" as const,
        conversationId: "v2-y",
        assistantMessageId: "a2",
        fullContent: "",
        finishReason: "stop",
      })) as unknown as (
        input: AIChatQueryLoopInput
      ) => Promise<AIChatQueryLoopResult>
    );
    const result = await engine.denyToolPermission({
      toolId: "no-such-tool",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No active permission-gated tool call/);
  });
});
