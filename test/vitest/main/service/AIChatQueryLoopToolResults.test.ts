import { describe, expect, it, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import type { AIChatQueryEvent, AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAITool,
} from "@/api/aiChatApi";

/**
 * End-to-end proof that the query loop actually PREPARES and PERSISTS an
 * oversized tool result (technical design §9.1, PRD FR-01/FR-02).
 *
 * This is the test that would have caught the original gap: the preparer
 * existed and was unit-tested, but nothing in the running application called
 * it, so the feature was completely inert while every unit test passed.
 *
 * The loop is driven with the capture flag forced ON and an injected module +
 * storage, then the assertion is made on what actually reached the renderer
 * event, the transcript, and the durable store.
 */

vi.mock("@/config/featureFlags", async () => {
  const actual = await vi.importActual<
    typeof import("@/config/featureFlags")
  >("@/config/featureFlags");
  return {
    ...actual,
    // The rollout flag is off by default; this test exercises the ON path.
    isToolOutputCaptureEnabled: () => true,
    isToolOutputModelRefsEnabled: () => true,
  };
});

let tmpDir: string;
let root: string;
let toolModule: ToolResultModule;
let storage: ToolResultStorageService;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `aifetchly-loop-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  root = path.join(tmpDir, "artifacts");
  fs.mkdirSync(root, { recursive: true });
  toolModule = new ToolResultModule(tmpDir);
  await toolModule.ensureConnection();
  storage = new ToolResultStorageService({ root });
});

function chunk(delta: string, finishReason?: string): OpenAIChatCompletionChunk {
  return {
    id: "r1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [{ index: 0, delta: { content: delta }, finish_reason: finishReason ?? null }],
  } as unknown as OpenAIChatCompletionChunk;
}

/** A body comfortably over the 16 KiB inline ceiling. */
function oversizedResult() {
  return { rows: Array.from({ length: 1200 }, (_, i) => ({ i, name: `Biz ${i}` })) };
}

function buildInput(events: AIChatQueryEvent[]): AIChatQueryLoopInput {
  return {
    conversationId: "v2-wiring",
    assistantMessageId: "asst-wiring",
    messages: [
      { role: "system", content: "you are helpful" },
      { role: "user", content: "find businesses" },
    ],
    request: {
      message: "find businesses",
      model: "gpt-4o",
      conversationId: "v2-wiring",
    },
    openAITools: [
      {
        type: "function",
        function: {
          name: "scrape_businesses",
          description: "scrape",
          parameters: { type: "object", properties: {} },
        },
      },
    ] as OpenAITool[],
    abortController: new AbortController(),
    eventSink: { emit: (e) => events.push(e) },
    startRound: 0,
    isActiveTurn: () => true,
  };
}

describe("AIChatQueryLoop — preserved tool results are wired", () => {
  it("externalizes an oversized result and publishes a retrievable receipt", async () => {
    const events: AIChatQueryEvent[] = [];
    let round = 0;
    const persisted: string[] = [];

    const stream = vi.fn(
      async (
        _req: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        round += 1;
        if (round === 1) {
          onChunk({
            id: "r1",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-4o",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "scrape_businesses", arguments: "{}" },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          } as unknown as OpenAIChatCompletionChunk);
          onChunk(chunk("", "tool_calls"));
          return;
        }
        onChunk(chunk("done", "stop"));
      }
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: async () => ({
        success: true,
        result: oversizedResult(),
        execution_time_ms: 12,
      }),
      getSkillDefinition: () => undefined,
      toolResultModule: toolModule,
      toolResultStorage: storage,
      saveToolResultReceipt: async (input: {
        conversationId: string;
        assistantMessageId: string;
        toolCallId: string;
        toolName: string;
        content: string;
        uiMetadata: Record<string, unknown>;
      }) => {
        persisted.push(input.content);
      },
    } as never);

    await loop.run(buildInput(events));

    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent).toBeDefined();
    if (!resultEvent || resultEvent.type !== "tool_result") return;

    // The renderer event carries a receipt, not the bulk payload.
    const payload = resultEvent.toolResult as Record<string, unknown>;
    const receipt = payload.toolResultReceipt as
      | { outputs: Array<{ outputId: string; capturedBytes: number }> }
      | undefined;
    expect(receipt).toBeDefined();
    expect(receipt?.outputs).toHaveLength(1);
    const outputId = receipt?.outputs[0]?.outputId ?? "";
    expect(outputId).toMatch(/^out_[0-9a-f]{32}$/);
    // The bulk body must NOT appear in the event.
    expect(JSON.stringify(payload)).not.toContain("Biz 1199");

    // It was persisted durably BEFORE the event went out.
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toContain(outputId);

    // And the artifact is genuinely readable, so the assistant can continue
    // without re-running the tool (AC-04).
    const decision = await toolModule.authorizeAccess({
      outputId,
      profileId: "default",
      conversationId: "v2-wiring",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      const window = await storage.readWindow({
        storageKey: decision.output.storageKey ?? "",
        startByte: 0,
        maxBytes: 4 * 1024 * 1024,
      });
      expect(window.buffer.toString("utf8")).toContain("Biz 1199");
    }
  });

  it("leaves a SMALL result inline with no artifact (AC-01)", async () => {
    const events: AIChatQueryEvent[] = [];
    let round = 0;
    const persisted: string[] = [];
    const stream = vi.fn(
      async (
        _req: OpenAIChatCompletionRequest,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        round += 1;
        if (round === 1) {
          onChunk({
            id: "r1",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-4o",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "scrape_businesses", arguments: "{}" },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          } as unknown as OpenAIChatCompletionChunk);
          onChunk(chunk("", "tool_calls"));
          return;
        }
        onChunk(chunk("done", "stop"));
      }
    );
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: async () => ({
        success: true,
        result: { total: 3, rows: [{ id: 1 }] },
        execution_time_ms: 5,
      }),
      getSkillDefinition: () => undefined,
      toolResultModule: toolModule,
      toolResultStorage: storage,
      saveToolResultReceipt: async (input: {
        conversationId: string;
        assistantMessageId: string;
        toolCallId: string;
        toolName: string;
        content: string;
        uiMetadata: Record<string, unknown>;
      }) => {
        persisted.push(input.content);
      },
    } as never);

    await loop.run(buildInput(events));
    const resultEvent = events.find((e) => e.type === "tool_result");
    expect(resultEvent?.type === "tool_result" ? resultEvent.toolResult : null)
      .toMatchObject({ success: true });
    // No receipt and no artifact for a small result.
    expect(persisted).toHaveLength(0);
    const payload = resultEvent?.type === "tool_result" ? resultEvent.toolResult : {};
    expect(payload).not.toHaveProperty("toolResultReceipt");
  });

  it("resolves a DISTINCT epoch per conversation on the same loop instance (I3 cross-conversation leak)", async () => {
    // I3 regression: `conversationEpochCache` was a single `string | null`
    // ignoring the conversationId param. A loop instance serving conversation
    // A then B would return A's cached epoch for B → the publisher rejects B's
    // output at commit (EPOCH_MISMATCH) → catch degrades to a bounded-failure
    // content → silent output loss. The fix keys the cache by conversationId,
    // mirroring AIChatQueryEngine.conversationEpochs.
    const epochCalls: string[] = [];
    const stubModule = {
      ...toolModule,
      currentEpoch: vi.fn(async (_profile: string, conversationId: string) => {
        epochCalls.push(conversationId);
        // Distinct epoch per conversation so a leaked cache would be caught.
        return `epoch-for-${conversationId}`;
      }),
    } as unknown as ToolResultModule;

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
      toolResultModule: stubModule,
      toolResultStorage: storage,
      saveToolResultReceipt: vi.fn(),
    } as never);

    // Access the private resolver to pin the invariant directly. Both calls
    // go through the SAME instance; a single-value cache would return the
    // first epoch for both.
    const resolve = (
      loop as unknown as {
        resolveConversationEpoch: (id: string) => Promise<string>;
      }
    ).resolveConversationEpoch.bind(loop);

    const epochA = await resolve("conv-a");
    const epochB = await resolve("conv-b");

    expect(epochA).toBe("epoch-for-conv-a");
    expect(epochB).toBe("epoch-for-conv-b");
    // Both conversations were looked up — B was not short-circuited by A's
    // cache entry.
    expect(epochCalls).toEqual(["conv-a", "conv-b"]);
  });
});
