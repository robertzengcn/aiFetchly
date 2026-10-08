/**
 * StreamEventProcessor → ToolResultPipeline wiring (T15a / design §9.1).
 *
 * The legacy local-execution and server-TOOL_RESULT paths persisted raw
 * `toolResult` via `ToolExecutionService.saveToolResult` with NO
 * capture/externalization, so an oversized result was stored inline in
 * `ai_chat_messages` unbounded. This test proves both paths now route through
 * the bounded pipeline when the rollout flags are on:
 *
 *  - the artifact is written (capturedBytes > 0, storage has the payload);
 *  - the persisted message content is a BOUNDED receipt (a JSON object with
 *    `toolResultReceipt`/`operationStatus`, NOT the producer's bulk body);
 *  - the renderer chunk carries the same bounded content, never the raw body.
 *
 * And when the flags are off, the legacy inline path is used unchanged.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  StreamEventProcessor,
  type StreamState,
} from "@/service/StreamEventProcessor";
import { StreamEventType, type StreamEvent } from "@/api/aiChatApi";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { MessageType } from "@/entityTypes/commonType";

// Force the rollout flags ON for this suite. The processor consults them via
// `isToolOutputCaptureEnabled`/`isToolOutputModelRefsEnabled`; mocking here
// makes `pipeline.isActive()` return true so `saveToolResult` routes through
// the bounded pipeline instead of the legacy inline write.
vi.mock("@/config/featureFlags", async () => {
  const actual = await vi.importActual<
    typeof import("@/config/featureFlags")
  >("@/config/featureFlags");
  return {
    ...actual,
    isToolOutputCaptureEnabled: () => true,
    isToolOutputModelRefsEnabled: () => true,
  };
});

type IpcMainEvent = {
  sender: { send: (channel: string, ...args: unknown[]) => void };
};

let tmpDir: string;
let root: string;
let toolModule: ToolResultModule;
let storage: ToolResultStorageService;
/** Records every saveMessage payload so the test can assert receipt vs raw body. */
let savedMessages: {
  messageId: string;
  conversationId: string;
  content: string;
  messageType: MessageType;
  metadata: unknown;
}[];

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `aifetchly-stream-toolresult-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  root = path.join(tmpDir, "artifacts");
  fs.mkdirSync(root, { recursive: true });
  toolModule = new ToolResultModule(tmpDir);
  await toolModule.ensureConnection();
  storage = new ToolResultStorageService({ root });
  savedMessages = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * A chatModule that records saves instead of hitting a real DB message table.
 * The production `ToolExecutionService.saveToolResult` calls
 * `chatModule.saveMessage({ messageId, conversationId, role, content,
 * timestamp, messageType, metadata })`; we mirror that exact shape so the
 * pipeline's `store` callback persists the receipt (not the raw body).
 */
function recordingChatModule(): unknown {
  return {
    saveMessage: async (opts: {
      messageId: string;
      conversationId: string;
      role: string;
      content: string;
      timestamp: Date;
      messageType: MessageType;
      metadata?: unknown;
    }) => {
      savedMessages.push({
        messageId: opts.messageId,
        conversationId: opts.conversationId,
        content: opts.content,
        messageType: opts.messageType,
        metadata: opts.metadata,
      });
      return { messageId: opts.messageId };
    },
  };
}

/** A body comfortably over the 16 KiB inline ceiling. */
function oversizedResult(): Record<string, unknown> {
  return {
    rows: Array.from({ length: 1200 }, (_, i) => ({ i, name: `Biz ${i}` })),
    success: true,
  };
}

function createState(overrides?: Partial<StreamState>): StreamState {
  return {
    assistantMessageId: "asst-stream-toolresult",
    fullContent: "",
    streamConversationId: "conv-stream-toolresult",
    hasStartedConversation: false,
    pendingToolCalls: new Set<string>(),
    deferredCompletionChunk: null,
    messageSaved: false,
    chatModule: recordingChatModule() as never,
    aiChatApi: {} as never,
    currentPlan: null,
    toolResultModule: toolModule,
    toolResultStorage: storage,
    ...overrides,
  };
}

function createEvent(): IpcMainEvent {
  return {
    sender: { send: vi.fn() },
  } as unknown as IpcMainEvent;
}

/** Extract the last AI_CHAT_STREAM_CHUNK payload sent to the renderer. */
function lastChunkPayload(event: IpcMainEvent): {
  content?: string;
  eventType?: string;
  toolResult?: unknown;
} {
  const calls = (
    event.sender.send as unknown as { mock: { calls: unknown[][] } }
  ).mock.calls;
  const last = calls[calls.length - 1];
  return JSON.parse(String(last[1])) as {
    content?: string;
    eventType?: string;
    toolResult?: unknown;
  };
}

describe("StreamEventProcessor — tool result pipeline wiring (T15a)", () => {
  it("externalizes an oversized server-originated TOOL_RESULT and persists a receipt", async () => {
    const event = createEvent();
    const processor = new StreamEventProcessor(event, createState());

    const streamEvent: StreamEvent = {
      event: StreamEventType.TOOL_RESULT,
      data: {
        content: oversizedResult(),
        data: { id: "call-server-1", name: "scrape_businesses", arguments: {} },
        timestamp: new Date().toISOString(),
      },
    };

    processor.processEvent(streamEvent);
    // The handler defers to an async IIFE; let it resolve.
    await vi.waitFor(() => {
      expect(savedMessages.length).toBeGreaterThanOrEqual(1);
    });

    // 1. The persisted message content is a ToolResultReceipt (NOT the raw
    //    `rows` body). The receipt carries outputs[] with the artifact ref.
    const persisted = savedMessages[savedMessages.length - 1];
    expect(persisted.messageType).toBe(MessageType.TOOL_RESULT);
    const receipt = JSON.parse(persisted.content) as {
      schemaVersion?: number;
      toolCallId?: string;
      success?: boolean;
      operationStatus?: string;
      outputs?: Array<{
        outputId: string;
        capturedBytes: number;
        preservation: string;
      }>;
      preview?: string;
    };
    expect(receipt.schemaVersion).toBe(1);
    expect(receipt.toolCallId).toBe("call-server-1");
    expect(receipt.success).toBe(true);
    expect(receipt.outputs).toBeDefined();
    expect(receipt.outputs!.length).toBeGreaterThanOrEqual(1);
    const outputId = receipt.outputs![0].outputId;
    expect(outputId).toMatch(/^out_[0-9a-f]+$/);
    expect(receipt.outputs![0].capturedBytes).toBeGreaterThan(0);
    // The bulk body must NOT appear anywhere in the persisted content.
    expect(persisted.content).not.toContain("Biz 1199");

    // 2. The artifact payload exists in storage under that outputId.
    const epoch = await toolModule.currentEpoch(
      "default",
      "conv-stream-toolresult"
    );
    const manifest = await storage.readManifest("default", epoch, outputId);
    expect(manifest).not.toBeNull();
    expect(manifest?.sha256).toBeTruthy();

    // 3. The renderer chunk content is the model projection (snake_case
    //    `output.output_id`), and the chunk `toolResult` payload carries the
    //    bounded receipt envelope — neither carries the raw `rows` body.
    const chunkPayload = lastChunkPayload(event);
    expect(chunkPayload.eventType).toBe(StreamEventType.TOOL_RESULT);
    const chunkContent = JSON.parse(chunkPayload.content as string) as {
      success?: boolean;
      operation_status?: string;
      output?: { output_id?: string; captured_bytes?: number } | null;
      preview?: string;
      next?: { tool?: string; arguments?: { output_id?: string } };
    };
    expect(chunkContent.success).toBe(true);
    expect(chunkContent.output?.output_id).toBe(outputId);
    expect(chunkContent.next?.tool).toBe("tool_result_read");
    expect(chunkContent.next?.arguments?.output_id).toBe(outputId);
    expect(chunkPayload.content).not.toContain("Biz 1199");

    // The chunk `toolResult` field is the bounded payload, not the raw body.
    const chunkToolResult = chunkPayload.toolResult as {
      success?: boolean;
      executionTimeMs?: number;
      toolResultReceipt?: {
        outputs?: Array<{ outputId: string; capturedBytes: number }>;
      };
    };
    expect(chunkToolResult?.success).toBe(true);
    expect(chunkToolResult?.toolResultReceipt?.outputs?.[0]?.outputId).toBe(
      outputId
    );
    expect(JSON.stringify(chunkPayload.toolResult)).not.toContain("Biz 1199");
  });

  it("skips the duplicate server echo for a locally-executed tool (no double-save)", async () => {
    // When a tool runs locally, the local path persists + streams the result
    // and adds the id to `localExecutingToolIds`. The continuation stream later
    // emits a TOOL_RESULT echo for the same id; that echo MUST be dropped (no
    // second save, no second chunk) because the local path already delivered a
    // bounded receipt — re-saving would overwrite the receipt with the raw echo.
    const event = createEvent();
    const processor = new StreamEventProcessor(event, createState());
    (processor as unknown as { localExecutingToolIds: Set<string> })
      .localExecutingToolIds.add("call-local-1");

    const echo: StreamEvent = {
      event: StreamEventType.TOOL_RESULT,
      data: {
        content: { success: true, rows: [] },
        data: { id: "call-local-1", name: "scrape_businesses", arguments: {} },
        timestamp: new Date().toISOString(),
      },
    };
    processor.processEvent(echo);
    await vi.waitFor(() => {
      // No save, no chunk: the duplicate echo is dropped.
      expect(savedMessages.length).toBe(0);
      const calls = (
        event.sender.send as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls;
      expect(calls.length).toBe(0);
    });
  });

  it("falls back to the legacy inline path when the pipeline has no collaborators", async () => {
    // No toolResultModule/toolResultStorage injected → getToolResultPipeline
    // returns null → saveToolResult uses the legacy ToolExecutionService path.
    const event = createEvent();
    const processor = new StreamEventProcessor(
      event,
      createState({
        toolResultModule: undefined,
        toolResultStorage: undefined,
      })
    );

    const streamEvent: StreamEvent = {
      event: StreamEventType.TOOL_RESULT,
      data: {
        content: { success: true, summary: "small inline result" },
        data: { id: "call-legacy-1", name: "quick_tool", arguments: {} },
        timestamp: new Date().toISOString(),
      },
    };

    processor.processEvent(streamEvent);
    await vi.waitFor(() => {
      expect(savedMessages.length).toBeGreaterThanOrEqual(1);
    });

    const persisted = savedMessages[savedMessages.length - 1];
    const content = JSON.parse(persisted.content) as Record<string, unknown>;
    // Legacy path: the raw body is persisted inline (no receipt).
    expect(content.summary).toBe("small inline result");
    expect(content.toolResultReceipt).toBeUndefined();

    const chunkPayload = lastChunkPayload(event);
    const chunkContent = JSON.parse(chunkPayload.content as string) as Record<
      string,
      unknown
    >;
    expect(chunkContent.summary).toBe("small inline result");
  });
});
