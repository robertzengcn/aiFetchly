import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatMessage,
  ToolExecutionResult,
} from "@/api/aiChatApi";
import type { ImageModelArtifact } from "@/entityTypes/aiImageAttachmentToolTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { setHookAuditLoggerForTests } from "@/service/hooks/HookAuditService";

function makeChunk(
  delta: string,
  finishReason?: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: { content: delta },
        finish_reason: finishReason ?? null,
      },
    ],
  };
}

function makeToolCallChunk(
  toolCallId: string,
  toolName: string,
  argsJson: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: "function",
              function: { name: toolName, arguments: argsJson },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

const ARTIFACT: ImageModelArtifact = {
  kind: "image",
  fileName: "a.png",
  relativePath: "a.png",
  mimeType: "image/png",
  sizeBytes: 100,
  width: 64,
  height: 64,
  sha256: "abc",
  detail: "auto",
  dataUrl: "data:image/png;base64,SECRETIMAGEBYTES",
};

const PRIOR_IMAGE_URL = "data:image/jpeg;base64,EXISTINGUSERIMAGE";

describe("AIChatQueryLoop image-artifact handoff", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
    setHookAuditLoggerForTests({ log: () => undefined });
  });

  async function runAttachLoop(executeResult: ToolExecutionResult): Promise<{
    secondRoundMessages: readonly OpenAIChatMessage[];
    executeContext: SkillExecutionContext;
    emitted: unknown[];
  }> {
    const toolCallChunk = makeToolCallChunk(
      "call-1",
      "attach_local_images",
      '{"paths":["a.png"]}'
    );
    const finalChunk = makeChunk("Done", "stop");
    let callCount = 0;
    let secondRoundMessages: readonly OpenAIChatMessage[] = [];
    const fakeStream = vi.fn(
      async (
        request: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        if (callCount === 0) {
          callCount += 1;
          onChunk(toolCallChunk);
          return;
        }
        secondRoundMessages = request.messages;
        onChunk(finalChunk);
      }
    );
    let executeContext: SkillExecutionContext | undefined;
    const fakeExecute = vi.fn(
      async (
        _name: string,
        _args: Record<string, unknown>,
        ctx: SkillExecutionContext
      ) => {
        executeContext = ctx;
        return executeResult;
      }
    );
    const emitted: unknown[] = [];
    const loop = new AIChatQueryLoop({
      streamChatCompletion: fakeStream,
      executeTool: fakeExecute,
      getSkillDefinition: vi.fn().mockReturnValue(undefined),
    });
    // Seed the transcript with a user message that already carries one
    // user-selected image, so we can assert the combined capacity is forwarded.
    const messages: OpenAIChatMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Edit the attached image: make background white.",
          },
          {
            type: "image_url",
            image_url: { url: PRIOR_IMAGE_URL, detail: "auto" },
          },
        ],
      },
    ];
    const input: AIChatQueryLoopInput = {
      conversationId: "v2-test",
      assistantMessageId: "a-1",
      messages,
      request: {
        message: "Edit the attached image: make background white.",
      },
      openAITools: [],
      abortController: new AbortController(),
      eventSink: { emit: (e) => emitted.push(e) },
      startRound: 0,
      isActiveTurn: () => true,
    };
    await loop.run(input);
    return {
      secondRoundMessages,
      executeContext: executeContext as SkillExecutionContext,
      emitted,
    };
  }

  it("forwards combined image count + data-URL chars to the tool context", async () => {
    const { executeContext } = await runAttachLoop({
      tool_call_id: "call-1",
      tool_name: "attach_local_images",
      success: true,
      result: { success: true, attached_count: 1, summary: "ok" },
      execution_time_ms: 5,
      modelArtifacts: [ARTIFACT],
    });
    expect(executeContext.currentRequestImageCount).toBe(1);
    expect(executeContext.currentRequestImageDataUrlChars).toBe(
      PRIOR_IMAGE_URL.length
    );
  });

  it("appends a metadata-only tool message then a multimodal handoff message", async () => {
    const { secondRoundMessages } = await runAttachLoop({
      tool_call_id: "call-1",
      tool_name: "attach_local_images",
      success: true,
      result: { success: true, attached_count: 1, summary: "ok" },
      execution_time_ms: 5,
      modelArtifacts: [ARTIFACT],
    });

    const serialized = JSON.stringify(secondRoundMessages as unknown);
    // Handoff marker + original request + the image data all reach round 2.
    expect(serialized).toContain("[AIFETCHLY_IMAGE_HANDOFF_V1]");
    expect(serialized).toContain(
      "Edit the attached image: make background white."
    );
    expect(serialized).toContain("data:image/png;base64,SECRETIMAGEBYTES");

    // The role:tool message is metadata-only — no image bytes.
    const toolMsg = secondRoundMessages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(JSON.stringify(toolMsg?.content)).not.toContain("data:image/");
    expect(JSON.stringify(toolMsg?.content)).not.toContain("SECRETIMAGEBYTES");

    // The synthetic handoff is the role:user message carrying the handoff marker.
    const handoff = secondRoundMessages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some(
          (p) =>
            (p as { type?: string; text?: string }).type === "text" &&
            typeof (p as { text?: string }).text === "string" &&
            (p as { text: string }).text.includes(
              "[AIFETCHLY_IMAGE_HANDOFF_V1]"
            )
        )
    );
    expect(handoff).toBeDefined();
    const imageParts = (
      handoff?.content as unknown as Array<{
        type: string;
        image_url?: { url: string; detail?: string };
      }>
    ).filter((p) => p.type === "image_url");
    expect(imageParts.length).toBe(1);
    expect(imageParts[0].image_url?.url).toBe(ARTIFACT.dataUrl);
    expect(imageParts[0].image_url?.detail).toBe("auto");
  });

  it("emits no data:image/ in the renderer tool_result event", async () => {
    const { emitted } = await runAttachLoop({
      tool_call_id: "call-1",
      tool_name: "attach_local_images",
      success: true,
      result: { success: true, attached_count: 1, summary: "ok" },
      execution_time_ms: 5,
      modelArtifacts: [ARTIFACT],
    });
    const toolResultEvent = emitted.find(
      (e) => (e as { type?: string }).type === "tool_result"
    );
    expect(toolResultEvent).toBeDefined();
    const serialized = JSON.stringify(toolResultEvent);
    expect(serialized).not.toContain("data:image/");
    expect(serialized).not.toContain("SECRETIMAGEBYTES");
    expect(serialized).not.toContain("modelArtifacts");
  });

  it("appends NO handoff when the tool returns no modelArtifacts", async () => {
    const { secondRoundMessages } = await runAttachLoop({
      tool_call_id: "call-1",
      tool_name: "attach_local_images",
      success: true,
      result: { success: true, attached_count: 0, summary: "none" },
      execution_time_ms: 5,
    });
    const serialized = JSON.stringify(secondRoundMessages as unknown);
    expect(serialized).not.toContain("[AIFETCHLY_IMAGE_HANDOFF_V1]");
    // Still got the metadata-only tool message.
    expect(secondRoundMessages.some((m) => m.role === "tool")).toBe(true);
  });

  it("appends NO handoff when the tool failed", async () => {
    const { secondRoundMessages } = await runAttachLoop({
      tool_call_id: "call-1",
      tool_name: "attach_local_images",
      success: false,
      result: { success: false, code: "path_not_found", error: "missing" },
      execution_time_ms: 5,
      modelArtifacts: [ARTIFACT], // even if artifacts present, failure → no handoff
    });
    const serialized = JSON.stringify(secondRoundMessages as unknown);
    expect(serialized).not.toContain("[AIFETCHLY_IMAGE_HANDOFF_V1]");
    expect(serialized).not.toContain("SECRETIMAGEBYTES");
  });

  it("steers generated-artifact shell copies to the dedicated export tool", async () => {
    const generatedImage = {
      type: "image" as const,
      delivery: "local_file" as const,
      url: "aifetchly-generated-image://local/user/c/m/image-1.png",
      local_path:
        "/home/test/.config/aiFetchly/ai-chat-generated-images/user/c/m/image-1.png",
    };
    const chunks = [
      makeToolCallChunk(
        "call-process",
        "process_artifact_batch",
        '{"files":["a.png"],"instruction":"edit"}'
      ),
      makeToolCallChunk(
        "call-shell",
        "shell_execute",
        '{"command":"cp /home/test/.config/aiFetchly/ai-chat-generated-images/user/c/m/image-1.png /workspace/out.png"}'
      ),
      makeChunk("Export guidance followed.", "stop"),
    ];
    let round = 0;
    const fakeStream = vi.fn(
      async (
        _request: OpenAIChatCompletionRequest,
        onChunk: (chunk: OpenAIChatCompletionChunk) => void
      ): Promise<void> => {
        onChunk(chunks[round]);
        round += 1;
      }
    );
    const fakeExecute = vi.fn(
      async (): Promise<ToolExecutionResult> => ({
        tool_call_id: "call-process",
        tool_name: "process_artifact_batch",
        success: true,
        result: { outputImages: [generatedImage] },
        execution_time_ms: 5,
      })
    );
    const loop = new AIChatQueryLoop({
      streamChatCompletion: fakeStream,
      executeTool: fakeExecute,
      getSkillDefinition: vi.fn().mockReturnValue(undefined),
    });

    const result = await loop.run({
      conversationId: "v2-test",
      assistantMessageId: "a-1",
      messages: [{ role: "user", content: "edit and save all images" }],
      request: { message: "edit and save all images" },
      openAITools: [],
      abortController: new AbortController(),
      eventSink: { emit: vi.fn() },
      startRound: 0,
      isActiveTurn: () => true,
    });

    expect(result.type).toBe("completed");
    expect(fakeExecute).toHaveBeenCalledTimes(1);
    expect(fakeExecute).toHaveBeenCalledWith(
      "process_artifact_batch",
      expect.any(Object),
      expect.any(Object)
    );
    if (result.type === "completed") {
      expect(result.images).toEqual([generatedImage]);
    }
  });

  it("blocks multi-image edit attachments and routes the model to the batch processor", async () => {
    const chunks = [
      makeToolCallChunk(
        "call-attach",
        "attach_local_images",
        JSON.stringify({
          paths: ["images (1).jpg", "images (2).jpg", "images (3).jpg"],
          instruction: "Change the background color to white",
        })
      ),
      makeToolCallChunk(
        "call-batch",
        "process_artifact_batch",
        JSON.stringify({
          files: ["images (1).jpg", "images (2).jpg", "images (3).jpg"],
          instruction: "Change the background color to white",
        })
      ),
      makeChunk("Processed the batch.", "stop"),
    ];
    let round = 0;
    const fakeStream = vi.fn(
      async (
        _request: OpenAIChatCompletionRequest,
        onChunk: (chunk: OpenAIChatCompletionChunk) => void
      ): Promise<void> => {
        onChunk(chunks[round]);
        round += 1;
      }
    );
    const fakeExecute = vi.fn(
      async (name: string): Promise<ToolExecutionResult> => ({
        tool_call_id: "call-batch",
        tool_name: name,
        success: true,
        result: { status: "completed", completedCount: 3 },
        execution_time_ms: 5,
      })
    );
    const emitted: Array<Record<string, unknown>> = [];
    const loop = new AIChatQueryLoop({
      streamChatCompletion: fakeStream,
      executeTool: fakeExecute,
      getSkillDefinition: vi.fn().mockReturnValue(undefined),
    });
    const userMessage =
      "please modify the background color of those image in the workspace to white";

    const result = await loop.run({
      conversationId: "v2-test",
      assistantMessageId: "a-1",
      messages: [{ role: "user", content: userMessage }],
      request: { message: userMessage },
      openAITools: [],
      abortController: new AbortController(),
      eventSink: {
        emit: (event) =>
          emitted.push(event as unknown as Record<string, unknown>),
      },
      startRound: 0,
      isActiveTurn: () => true,
    });

    expect(result.type).toBe("completed");
    expect(fakeExecute).toHaveBeenCalledOnce();
    expect(fakeExecute).toHaveBeenCalledWith(
      "process_artifact_batch",
      expect.any(Object),
      expect.any(Object)
    );
    expect(
      emitted.some(
        (event) =>
          event.type === "tool_result" &&
          event.toolName === "attach_local_images" &&
          JSON.stringify(event).includes("process_artifact_batch")
      )
    ).toBe(true);
  });
});
