import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";

// Mock electron module — must be hoisted by vitest before handler import.
vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

// Mock Token so AI-enabled is controllable per-test via mockState.aiEnabled.
const mockState = vi.hoisted(() => ({ aiEnabled: "true" }));
const mockGetAllToolFunctions = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    {
      type: "function",
      name: "scrape_urls_from_search_engine",
      description: "Search a search engine and return result URLs",
      parameters: {
        type: "object",
        properties: {
          search_engine: { type: "string" },
          query: { type: "string" },
        },
        required: ["search_engine", "query"],
      },
    },
  ])
);
const mockSkillExecute = vi.hoisted(() => vi.fn());
vi.mock("@/modules/token", () => {
  return {
    Token: vi.fn().mockImplementation(() => ({
      getValue: vi.fn().mockImplementation(() => mockState.aiEnabled),
    })),
  };
});
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...actual,
    USER_AI_ENABLED: "USER_AI_ENABLED",
    USERSDBPATH: "USERSDBPATH",
  };
});

// Mock the v2 module.
const mockClearConversation = vi.fn().mockResolvedValue(5);
const mockClearAllV2 = vi.fn().mockResolvedValue(5);
const mockGetConversations = vi.fn().mockResolvedValue([]);
const mockCreateConversationIfNeeded = vi.fn().mockReturnValue("v2-test-conv");
const mockSaveUserMessage = vi
  .fn()
  .mockResolvedValue({ messageId: "user-test-1" });
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockSaveToolCallMessage = vi.fn().mockResolvedValue({});
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
const mockGetDefaultSystemPrompt = vi
  .fn()
  .mockReturnValue("You are a helpful assistant.");
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    clearConversation: mockClearConversation,
    clearAllV2History: mockClearAllV2,
    getConversations: mockGetConversations,
    createConversationIfNeeded: mockCreateConversationIfNeeded,
    saveUserMessage: mockSaveUserMessage,
    getConversationMessages: mockGetConversationMessages,
    saveAssistantMessage: mockSaveAssistantMessage,
    saveToolCallMessage: mockSaveToolCallMessage,
    saveToolResultMessage: mockSaveToolResultMessage,
    getDefaultSystemPrompt: mockGetDefaultSystemPrompt,
  })),
}));

// Mock AiChatApi — openAIChatCompletionStream is controllable per-test.
const mockOpenAIChatCompletionStream = vi.fn().mockResolvedValue(undefined);
const mockListOpenAIModels = vi.fn().mockResolvedValue({ data: [] });
vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(() => ({
    openAIChatCompletionStream: mockOpenAIChatCompletionStream,
    listOpenAIModels: mockListOpenAIModels,
  })),
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: mockGetAllToolFunctions,
    getSkill: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: {
    execute: mockSkillExecute,
  },
}));

// Mock plan module
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: vi.fn().mockResolvedValue(null),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
  })),
}));

// Mock plan mode helpers
vi.mock("@/service/PlanModeToolRegistry", () => ({
  PlanModeToolRegistry: { toOpenAITools: vi.fn().mockReturnValue([]) },
}));

vi.mock("@/service/PlanModePromptBuilder", () => ({
  buildPlanModeSystemPrompt: vi.fn().mockReturnValue("plan prompt"),
}));

vi.mock("@/service/OpenAIChatTranscriptBuilder", () => ({
  buildOpenAITranscript: vi.fn().mockReturnValue({ messages: [] }),
}));

// Mock compact-related modules used by AIChatContextAssembler (T11/T12).
vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: vi.fn().mockResolvedValue(null),
  })),
}));

import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import {
  AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
  AI_CHAT_V2_HISTORY,
  AI_CHAT_V2_STREAM,
  AI_CHAT_V2_STREAM_STOP,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
} from "@/config/channellist";

describe("AI Chat V2 IPC handlers", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    registerAiChatV2IpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("registers a handler for each v2 channel", () => {
    const registered = mockIpcMain.getRegisteredChannels();
    expect(registered).toContain(AI_CHAT_V2_CONVERSATIONS);
    expect(registered).toContain(AI_CHAT_V2_CLEAR_CONVERSATION);
    expect(registered).toContain(AI_CHAT_V2_CLEAR_ALL);
  });

  it("lists conversations through the module", async () => {
    const result = await mockIpcMain.callHandler(AI_CHAT_V2_CONVERSATIONS);
    expect(mockGetConversations).toHaveBeenCalled();
    expect(result).toMatchObject({ status: true });
  });

  it("clears a conversation through the module", async () => {
    const result = await mockIpcMain.callHandler(
      AI_CHAT_V2_CLEAR_CONVERSATION,
      {},
      JSON.stringify({ conversationId: "v2-1" })
    );
    expect(mockClearConversation).toHaveBeenCalledWith("v2-1");
    expect(result).toMatchObject({ status: true });
  });

  it("clears all v2 history through the module", async () => {
    const result = await mockIpcMain.callHandler(AI_CHAT_V2_CLEAR_ALL);
    expect(mockClearAllV2).toHaveBeenCalled();
    expect(result).toMatchObject({ status: true });
  });
});

/** Helper: extract the STREAM_COMPLETE payload from sender.send mock calls. */
function findCompletePayload(
  senderSend: ReturnType<typeof vi.fn>
): Record<string, unknown> | undefined {
  const call = senderSend.mock.calls.find(
    ([ch]) => ch === AI_CHAT_V2_STREAM_COMPLETE
  );
  return call
    ? (JSON.parse(call[1] as string) as Record<string, unknown>)
    : undefined;
}

describe("AI Chat V2 — AI-disabled gate", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    registerAiChatV2IpcHandlers();
  });
  afterEach(() => {
    resetElectronMocks();
    mockState.aiEnabled = "true";
  });

  it("denies conversations when AI is not enabled", async () => {
    mockState.aiEnabled = "false";
    const result = await mockIpcMain.callHandler(AI_CHAT_V2_CONVERSATIONS);
    expect(result).toMatchObject({
      status: false,
      msg: "AI functionality is only available to subscribers.",
    });
    expect(mockGetConversations).not.toHaveBeenCalled();
  });

  it("emits error completion when AI is disabled on stream", async () => {
    mockState.aiEnabled = "false";
    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "hi" })
    );
    const payload = findCompletePayload(senderSend);
    expect(payload).toBeDefined();
    expect(payload?.eventType).toBe("error");
    expect(payload?.errorMessage).toBe(
      "AI functionality is only available to subscribers."
    );
  });
});

describe("AI Chat V2 — stream validation", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    registerAiChatV2IpcHandlers();
  });
  afterEach(() => {
    resetElectronMocks();
  });

  it("rejects empty message with error completion", async () => {
    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "   " })
    );
    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("error");
    expect(payload?.errorMessage).toContain("non-empty");
  });

  it("rejects out-of-range temperature with error completion", async () => {
    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "hi", temperature: 5 })
    );
    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("error");
    expect(payload?.errorMessage).toContain("temperature");
  });

  it("rejects non-positive-integer maxTokens", async () => {
    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "hi", maxTokens: 0 })
    );
    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("error");
    expect(payload?.errorMessage).toContain("maxTokens");
  });
});

describe("AI Chat V2 — stream lifecycle", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    mockOpenAIChatCompletionStream.mockResolvedValue(undefined);
    registerAiChatV2IpcHandlers();
  });
  afterEach(() => {
    resetElectronMocks();
  });

  it("sends start → token → complete on a normal stream", async () => {
    mockOpenAIChatCompletionStream.mockImplementation(
      async (_req, onChunk: (c: unknown) => void) => {
        onChunk({ choices: [{ delta: { content: "Hello" } }] });
        onChunk({
          choices: [{ delta: { content: " world" }, finish_reason: "stop" }],
        });
      }
    );

    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "hi" })
    );

    // start chunk
    const startCall = senderSend.mock.calls.find(
      (call) =>
        call[0] === AI_CHAT_V2_STREAM_CHUNK &&
        JSON.parse(call[1] as string).eventType === "start"
    );
    expect(startCall).toBeTruthy();

    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("complete");
    expect(payload?.fullContent).toBe("Hello world");
    expect(mockSaveAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Hello world" })
    );
  });

  it("saves partial content and emits cancelled on abort", async () => {
    mockOpenAIChatCompletionStream.mockImplementation(
      async (
        _req,
        onChunk: (c: unknown) => void,
        opts: { signal: AbortSignal }
      ) => {
        onChunk({ choices: [{ delta: { content: "partial" } }] });
        return new Promise((_resolve, reject) => {
          if (opts.signal.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          opts.signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }
    );

    const senderSend = vi.fn();
    const event = { sender: { send: senderSend } };

    const streamPromise = mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      event,
      JSON.stringify({ message: "hi" })
    );
    // Allow the chunk callback to fire before aborting.
    await new Promise((r) => setTimeout(r, 30));
    await mockIpcMain.callHandler(AI_CHAT_V2_STREAM_STOP, event);
    await streamPromise;

    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("cancelled");
    expect(payload?.fullContent).toBe("partial");
    expect(mockSaveAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ cancelled: true }),
      })
    );
  });

  it("maps 401 errors to a sign-in prompt", async () => {
    mockOpenAIChatCompletionStream.mockRejectedValue(
      new Error("Server returned 401: Unauthorized")
    );

    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "hi" })
    );

    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("error");
    expect(payload?.errorMessage).toBe("Please sign in again.");
  });

  it("maps unmapped errors to a generic message (no raw leak)", async () => {
    mockOpenAIChatCompletionStream.mockRejectedValue(
      new Error(
        "Server returned 500: Internal stack trace at /var/app/handler.ts"
      )
    );

    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "hi" })
    );

    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("error");
    expect(payload?.errorMessage).toBe(
      "An unexpected error occurred. Please try again."
    );
    expect(payload?.errorMessage).not.toContain("stack trace");
  });

  it("sends tools, executes tool calls, and continues to a final answer", async () => {
    mockSkillExecute.mockResolvedValue({
      tool_call_id: "call_1",
      tool_name: "scrape_urls_from_search_engine",
      success: true,
      result: {
        results: [{ title: "Milk Supplier", url: "https://example.com" }],
      },
      execution_time_ms: 12,
    });

    mockOpenAIChatCompletionStream
      .mockImplementationOnce(async (req, onChunk: (c: unknown) => void) => {
        expect(req).toMatchObject({
          tools: [
            {
              type: "function",
              function: expect.objectContaining({
                name: "scrape_urls_from_search_engine",
              }),
            },
          ],
        });
        onChunk({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "scrape_urls_from_search_engine",
                      arguments:
                        '{"search_engine":"google","query":"milk wholesale"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      })
      .mockImplementationOnce(async (req, onChunk: (c: unknown) => void) => {
        expect(req.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "assistant",
              tool_calls: [
                expect.objectContaining({
                  id: "call_1",
                  function: expect.objectContaining({
                    name: "scrape_urls_from_search_engine",
                  }),
                }),
              ],
            }),
            expect.objectContaining({
              role: "tool",
              tool_call_id: "call_1",
            }),
          ])
        );
        onChunk({ choices: [{ delta: { content: "Found one supplier." } }] });
        onChunk({
          choices: [
            {
              delta: { content: "" },
              finish_reason: "stop",
            },
          ],
        });
      });

    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "please search milk wholesale in google" })
    );

    expect(mockGetAllToolFunctions).toHaveBeenCalled();
    expect(mockSkillExecute).toHaveBeenCalledWith(
      "scrape_urls_from_search_engine",
      { search_engine: "google", query: "milk wholesale" },
      expect.objectContaining({
        conversationId: "v2-test-conv",
        toolCallId: "call_1",
      })
    );
    expect(mockOpenAIChatCompletionStream).toHaveBeenCalledTimes(2);

    const toolCallEvent = senderSend.mock.calls.find(
      (call) =>
        call[0] === AI_CHAT_V2_STREAM_CHUNK &&
        JSON.parse(call[1] as string).eventType === "tool_call"
    );
    expect(toolCallEvent).toBeTruthy();

    const toolResultEvent = senderSend.mock.calls.find(
      (call) =>
        call[0] === AI_CHAT_V2_STREAM_CHUNK &&
        JSON.parse(call[1] as string).eventType === "tool_result"
    );
    expect(toolResultEvent).toBeTruthy();
    expect(JSON.parse(toolResultEvent?.[1] as string)).toMatchObject({
      toolResult: expect.objectContaining({
        success: true,
        executionTimeMs: 12,
      }),
    });

    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("complete");
    expect(payload?.fullContent).toBe("Found one supplier.");
  });

  it("surfaces permission prompts and resumes the stream after approval", async () => {
    mockSkillExecute
      .mockResolvedValueOnce({
        tool_call_id: "call_1",
        tool_name: "scrape_urls_from_search_engine",
        success: false,
        result: {
          error: "Permission required",
          needsPermissionPrompt: true,
          permissionCategory: "network",
        },
        execution_time_ms: 5,
      })
      .mockResolvedValueOnce({
        tool_call_id: "call_1",
        tool_name: "scrape_urls_from_search_engine",
        success: true,
        result: {
          results: [{ title: "Milk Supplier", url: "https://example.com" }],
        },
        execution_time_ms: 18,
      });

    mockOpenAIChatCompletionStream
      .mockImplementationOnce(async (_req, onChunk: (c: unknown) => void) => {
        onChunk({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "scrape_urls_from_search_engine",
                      arguments:
                        '{"search_engine":"google","query":"milk wholesale"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      })
      .mockImplementationOnce(async (_req, onChunk: (c: unknown) => void) => {
        onChunk({ choices: [{ delta: { content: "Approved result." } }] });
        onChunk({
          choices: [
            {
              delta: { content: "" },
              finish_reason: "stop",
            },
          ],
        });
      });

    const senderSend = vi.fn();
    const event = { sender: { send: senderSend } };

    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      event,
      JSON.stringify({ message: "please search milk wholesale in google" })
    );

    expect(findCompletePayload(senderSend)).toBeUndefined();

    const permissionChunk = senderSend.mock.calls
      .filter(([channel]) => channel === AI_CHAT_V2_STREAM_CHUNK)
      .map(([, payload]) => JSON.parse(payload as string))
      .find((chunk) => chunk.eventType === "tool_result");
    expect(permissionChunk).toMatchObject({
      toolCallId: "call_1",
      toolResult: expect.objectContaining({
        needsPermissionPrompt: true,
        permissionCategory: "network",
      }),
    });

    const resumeResult = await mockIpcMain.callHandler(
      AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
      {},
      JSON.stringify({
        toolId: "call_1",
        conversationId: "v2-test-conv",
      })
    );
    expect(resumeResult).toMatchObject({
      status: true,
      data: { ok: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const replacementChunk = senderSend.mock.calls
      .filter(([channel]) => channel === AI_CHAT_V2_STREAM_CHUNK)
      .map(([, payload]) => JSON.parse(payload as string))
      .find((chunk) => chunk.replacesPermissionPromptForToolId === "call_1");
    expect(replacementChunk).toMatchObject({
      toolResult: expect.objectContaining({
        success: true,
        executionTimeMs: 18,
      }),
    });

    const payload = findCompletePayload(senderSend);
    expect(payload?.eventType).toBe("complete");
    expect(payload?.fullContent).toBe("Approved result.");
    expect(mockOpenAIChatCompletionStream).toHaveBeenCalledTimes(2);
    expect(mockSkillExecute).toHaveBeenLastCalledWith(
      "scrape_urls_from_search_engine",
      { search_engine: "google", query: "milk wholesale" },
      expect.objectContaining({
        skipPermissionCheck: true,
      })
    );
  });
});

describe("AI Chat V2 — conversationId type validation", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    registerAiChatV2IpcHandlers();
  });
  afterEach(() => {
    resetElectronMocks();
  });

  it("rejects non-string conversationId on history", async () => {
    const result = await mockIpcMain.callHandler(
      AI_CHAT_V2_HISTORY,
      {},
      JSON.stringify({ conversationId: 12345 })
    );
    expect(result).toMatchObject({ status: false });
    expect((result as { msg: string }).msg).toContain("string");
  });

  it("rejects non-string conversationId on clear-conversation", async () => {
    const result = await mockIpcMain.callHandler(
      AI_CHAT_V2_CLEAR_CONVERSATION,
      {},
      JSON.stringify({ conversationId: { bad: true } })
    );
    expect(result).toMatchObject({ status: false });
    expect((result as { msg: string }).msg).toContain("string");
  });
});
