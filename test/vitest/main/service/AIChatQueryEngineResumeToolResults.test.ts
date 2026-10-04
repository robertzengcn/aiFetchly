import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryEvent } from "@/service/AIChatQueryEvents";
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import { SkillExecutor } from "@/service/SkillExecutor";

/**
 * The permission-RESUME path must use the same preparation and storage policy
 * as a foreground tool call (technical design §9.2, AC-09).
 *
 * This matters disproportionately: the first tool call of any session always
 * takes the resume path, and that is exactly where gated tools live (outbound
 * email, file edit, shell). A gap here meant the first result of a session
 * bypassed the receipt entirely while every foreground one did not.
 *
 * The pipeline collaborators are injected so the test needs no real database or
 * filesystem, and the assertions are made on what actually reached the
 * renderer event, the persisted row, and the transcript.
 */

const captureEnabled = { value: true };

vi.mock("@/config/featureFlags", async () => {
  const actual = await vi.importActual<
    typeof import("@/config/featureFlags")
  >("@/config/featureFlags");
  return {
    ...actual,
    isToolOutputCaptureEnabled: () => captureEnabled.value,
    isToolOutputModelRefsEnabled: () => captureEnabled.value,
  };
});

// The engine executes tools through SkillExecutor, not a raw dep.
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
      saveToolResultMessage: mockSaveToolResultMessage,
      createConversationIfNeeded: vi.fn().mockReturnValue("conv-resume"),
      getConversationMessages: vi.fn().mockResolvedValue([]),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      saveUserMessage: vi.fn(),
      saveAssistantMessage: vi.fn(),
      saveToolCallMessage: vi.fn(),
      getDefaultSystemPrompt: vi.fn().mockReturnValue("You are helpful."),
    };
  }),
}));

let epochCounter = 0;
const capturedContexts: string[] = [];
const processedKeys: string[] = [];

const fakeModule = {
  currentEpoch: vi.fn(async () => `epoch-${++epochCounter}`),
};
const fakeStorage = { readWindow: vi.fn() };

/** Stands in for the real preparation/publisher chain. */
const fakePipeline = {
  isActive: () => captureEnabled.value,
  process: vi.fn(async (input: {
    context: { executionId: string; toolCallId: string };
    outcome: unknown;
    store: (a: { receipt: unknown }) => Promise<void>;
  }) => {
    capturedContexts.push(input.context.executionId);
    processedKeys.push(JSON.stringify(input.outcome).length.toString());
    const receipt = {
      schemaVersion: 1,
      toolCallId: input.context.toolCallId,
      toolName: "send_email",
      operationStatus: "success",
      success: true,
      executionTimeMs: 7,
      control: {},
      outputs: [
        {
          outputId: "out_0123456789abcdef0123456789abcdef",
          revision: 1,
          storageBackend: "file",
          format: "json",
          mediaType: "application/json",
          capturedBytes: 50000,
          sha256: "a".repeat(64),
          preservation: "complete",
          sourceCompleteness: "complete",
        },
      ],
      preview: "800 records",
      previewComplete: false,
    };
    // Mirrors ToolResultPublisher: durable publication precedes delivery.
    await input.store({ receipt });
    return {
      canonicalMessageContent: "receipt",
      modelContent: "receipt",
      uiMetadata: {
        toolOutputPreservation: "complete",
        toolOutputPreview: "800 records",
      },
      serializedBytes: 64,
      accountedTokens: 64,
      receipt,
    };
  }),
};

vi.mock("@/service/toolResult/ToolResultPipeline", () => ({
  ToolResultPipeline: vi.fn().mockImplementation(function () {
    return fakePipeline;
  }),
  ToolResultPublicationError: class extends Error {},
}));

/**
 * A stream stub that completes cleanly, so the resume reaches the end of the
 * turn. Without it the loop throws while consuming `undefined`, and the turn
 * aborts before the transcript can be inspected.
 */
function makeStream() {
  return vi.fn(
    async (
      _req: unknown,
      onChunk: (c: unknown) => void
    ) => {
      onChunk({
        id: "r1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o",
        choices: [
          { index: 0, delta: { content: "ok" }, finish_reason: "stop" },
        ],
      });
    }
  );
}

/**
 * The query loop is the engine's first CONSTRUCTOR argument, so a stub is
 * passed in directly rather than mocking the module.
 */
function stubLoop() {
  return {
    run: vi.fn().mockResolvedValue({
      type: "completed",
      content: "ok",
      conversationId: "conv-resume",
      assistantMessageId: "asst-resume",
      messages: [],
    }),
  };
}

function makeEngine(events: AIChatQueryEvent[]): AIChatQueryEngine {
  const engine = new AIChatQueryEngine(stubLoop() as never, {
    streamChatCompletion: makeStream(),
    executeTool: vi.fn().mockResolvedValue(oversizedToolResult()),
    getSkillDefinition: () => undefined,
  } as never);
  // Inject the pipeline collaborators used by the resume path.
  (engine as unknown as {
    toolResultModule: unknown;
    toolResultStorage: unknown;
  }).toolResultModule = fakeModule;
  (engine as unknown as {
    toolResultStorage: unknown;
  }).toolResultStorage = fakeStorage;
  return engine;
}

function oversizedToolResult() {
  return {
    tool_call_id: "call_1",
    tool_name: "send_email",
    success: true,
    result: { sent: 800, ids: Array.from({ length: 800 }, (_, i) => i) },
    execution_time_ms: 7,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (SkillExecutor.execute as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    oversizedToolResult()
  );
  captureEnabled.value = true;
  epochCounter = 0;
  capturedContexts.length = 0;
  processedKeys.length = 0;
  fakePipeline.process.mockClear();
});

/** Drive a permission pause, then resume it. */
async function pauseThenResume(events: AIChatQueryEvent[]) {
  const engine = makeEngine(events);
  const messages: OpenAIChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "send it" },
  ];

  // Seed a pending permission directly: the pause is produced by the loop,
  // which has its own coverage. What matters here is the RESUME.
  (
    engine as unknown as {
      pendingPermissions: Map<string, unknown>;
    }
  ).pendingPermissions.set("conv-resume", {
    conversationId: "conv-resume",
    assistantMessageId: "asst-resume",
    conversationMessages: messages,
    abortController: new AbortController(),
    request: { message: "send it", model: "gpt-4o", conversationId: "conv-resume" },
    openAITools: [],
    // The engine emits through the pending turn's own sink; supplying it here
    // is also how the test observes what reached the renderer.
    eventSink: { emit: (e: AIChatQueryEvent) => events.push(e) },
    nextRound: 1,
    toolCallId: "call_1",
    toolName: "send_email",
    toolArguments: { to: "x@example.com" },
    turnId: "turn-1",
  });

  const result = await engine.resumeToolAfterPermission({
    toolId: "call_1",
    conversationId: "conv-resume",
    approved: true,
  } as never);
  return { engine, result, messages };
}

describe("AIChatQueryEngine.resumeToolAfterPermission — preserved results", () => {
  it("routes the resumed result through the pipeline", async () => {
    const events: AIChatQueryEvent[] = [];
    const { engine, messages } = await pauseThenResume(events);
    expect(engine).toBeDefined();

    // The pipeline actually ran for the resumed attempt.
    expect(fakePipeline.process).toHaveBeenCalledTimes(1);
    // And it got its OWN execution identity, distinct from the placeholder.
    expect(capturedContexts[0]).toContain("resume");
  });

  it("puts the MODEL PROJECTION in the transcript, not the raw body", async () => {
    const events: AIChatQueryEvent[] = [];
    const { messages, result } = await pauseThenResume(events);

    expect(result.ok).toBe(true);
    const toolMessages = messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    const content = String(toolMessages[0].content);
    // The next model round sees the bounded projection...
    expect(content).toBe("receipt");
    // ...and never the producer's whole body.
    expect(content).not.toContain('"ids"');
  });

  it("persists the receipt exactly once, replacing the permission-prompt row", async () => {
    const events: AIChatQueryEvent[] = [];
    await pauseThenResume(events);

    // The pipeline is the single durable writer; the event sink defers to it,
    // so the same row is not written twice.
    expect(mockSaveToolResultMessage).toHaveBeenCalledTimes(1);
    const saved = mockSaveToolResultMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.replacesPermissionPromptForToolId).toBe("call_1");
    expect(String(saved.content)).toContain("out_0123456789abcdef0123456789abcdef");
    // The persisted metadata is bounded too: no bulk body.
    const metadata = saved.toolResult as Record<string, unknown>;
    expect(JSON.stringify(metadata)).not.toContain('"ids"');
    expect(metadata.toolOutputPreservation).toBe("complete");
  });

  it("leaves the legacy path untouched when the feature is disabled", async () => {
    captureEnabled.value = false;
    const events: AIChatQueryEvent[] = [];
    const { messages } = await pauseThenResume(events);

    // No preparation ran, so the event sink persists as it always has.
    expect(fakePipeline.process).not.toHaveBeenCalled();
    expect(mockSaveToolResultMessage).toHaveBeenCalledTimes(1);
    const toolMessages = messages.filter((m) => m.role === "tool");
    const content = String(toolMessages[0]?.content ?? "");
    expect(content).toContain('"ids"');
  });

  it("emits a bounded receipt payload, never the raw body", async () => {
    const events: AIChatQueryEvent[] = [];
    await pauseThenResume(events);

    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent).toBeDefined();
    if (!resultEvent || resultEvent.type !== "tool_result") return;
    const payload = resultEvent.toolResult as Record<string, unknown>;
    expect(payload.toolResultReceipt).toBeDefined();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('"ids"');
    expect(serialized.length).toBeLessThan(2000);
  });
});
