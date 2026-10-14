/**
 * B10 renderer API tests (FR-13/14/21/22, AC-25/27/32): the successor-stream
 * attachment correlates by successor execution identity and assistant
 * message id, so late parent chunks can neither regress the successor badge
 * nor close the attachment early — while the successor's own states,
 * content, and terminal completion flow through.
 *
 * Drives attachChatV2SuccessorStream against the typed window.api fake
 * (emits JSON-stringified chunks like the real IPC bridge).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowApiFake } from "./windowApiFake";
import {
  attachChatV2SuccessorStream,
  isSuccessorExecutionState,
  isSupersededTurnChunk,
} from "@/views/api/aiChatV2";
import {
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
  AI_CHAT_V2_TASK_CONTINUE,
} from "@/config/channellist";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";

const api = new WindowApiFake();

function stateChunk(
  executionId: string,
  status: "active" | "terminal",
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    eventType: "task_execution_state",
    conversationId: "conv-1",
    taskExecutionState: {
      executionId,
      conversationId: "conv-1",
      status,
      ...extra,
    },
  } satisfies Partial<ChatV2StreamChunk>);
}

function tokenChunk(messageId: string, delta: string): string {
  return JSON.stringify({
    eventType: "token",
    conversationId: "conv-1",
    messageId,
    contentDelta: delta,
  } satisfies Partial<ChatV2StreamChunk>);
}

function completeChunk(messageId: string | undefined, fullContent: string): string {
  return JSON.stringify({
    eventType: "complete",
    conversationId: "conv-1",
    messageId,
    fullContent,
  } satisfies Partial<ChatV2StreamChunk>);
}

describe("successor chunk correlation predicates (B10, pure)", () => {
  it("isSuccessorExecutionState matches only the successor execution", () => {
    const chunk = JSON.parse(
      stateChunk("exec-B", "active")
    ) as ChatV2StreamChunk;
    expect(isSuccessorExecutionState(chunk, "exec-B")).toBe(true);
    expect(isSuccessorExecutionState(chunk, "exec-A")).toBe(false);
    const token = JSON.parse(tokenChunk("asst-1", "hi")) as ChatV2StreamChunk;
    expect(isSuccessorExecutionState(token, "exec-B")).toBe(false);
  });

  it("isSupersededTurnChunk drops parent and third-turn chunks, keeps unattributable ones", () => {
    const parent = JSON.parse(tokenChunk("asst-A", "x")) as ChatV2StreamChunk;
    const successor = JSON.parse(tokenChunk("asst-B", "x")) as ChatV2StreamChunk;
    const third = JSON.parse(tokenChunk("asst-C", "x")) as ChatV2StreamChunk;
    const bare = JSON.parse(
      JSON.stringify({ eventType: "token", conversationId: "conv-1", contentDelta: "x" })
    ) as ChatV2StreamChunk;
    // Parent message id → superseded (late parent straggler).
    expect(isSupersededTurnChunk(parent, "asst-A", "asst-B")).toBe(true);
    // Learned successor id → kept.
    expect(isSupersededTurnChunk(successor, "asst-A", "asst-B")).toBe(false);
    // Third id once the successor is learned → superseded.
    expect(isSupersededTurnChunk(third, "asst-A", "asst-B")).toBe(true);
    // No ids learned yet → third id kept (cannot attribute; successor is
    // the only turn this attachment streams).
    expect(isSupersededTurnChunk(third, null, null)).toBe(false);
    // No message id at all → kept.
    expect(isSupersededTurnChunk(bare, "asst-A", "asst-B")).toBe(false);
  });
});

describe("attachChatV2SuccessorStream correlation (B10, fake IPC)", () => {
  beforeEach(() => {
    api.reset();
    api.install();
    api.setInvokeResponse(AI_CHAT_V2_TASK_CONTINUE, { ok: true });
  });

  function attach(callbacks: {
    onState?: (s: unknown) => void;
    onChunk?: (c: ChatV2StreamChunk) => void;
    onComplete?: (c: ChatV2StreamChunk) => void;
    onError?: (e: Error) => void;
  } = {}) {
    const seen = {
      states: [] as unknown[],
      chunks: [] as ChatV2StreamChunk[],
      completes: [] as ChatV2StreamChunk[],
      errors: [] as Error[],
    };
    const done = attachChatV2SuccessorStream({
      mode: "continue",
      parentExecutionId: "exec-A",
      submissionId: "sub-1",
      conversationId: "conv-1",
      executionId: "exec-B",
      parentMessageId: "asst-A",
      onTaskExecutionState: (s) => {
        seen.states.push(s);
        callbacks.onState?.(s);
      },
      onChunk: (c) => {
        seen.chunks.push(c);
        callbacks.onChunk?.(c);
      },
      onComplete: (c) => {
        seen.completes.push(c);
        callbacks.onComplete?.(c);
      },
      onError: (e) => {
        seen.errors.push(e);
        callbacks.onError?.(e);
      },
    });
    return { seen, done };
  }

  it("forwards the successor execution's states and drops parent-execution states", async () => {
    const { seen } = attach({ });
    await Promise.resolve();
    api.emit(AI_CHAT_V2_STREAM_CHUNK, stateChunk("exec-A", "active"));
    api.emit(AI_CHAT_V2_STREAM_CHUNK, stateChunk("exec-B", "active"));
    expect(seen.states).toHaveLength(1);
    expect((seen.states[0] as { executionId: string }).executionId).toBe("exec-B");
  });

  it("forwards successor tokens and drops parent-message tokens", async () => {
    const { seen } = attach({});
    await Promise.resolve();
    // Successor start learns the successor message id.
    api.emit(
      AI_CHAT_V2_STREAM_CHUNK,
      JSON.stringify({
        eventType: "start",
        conversationId: "conv-1",
        messageId: "asst-B",
      })
    );
    api.emit(AI_CHAT_V2_STREAM_CHUNK, tokenChunk("asst-A", "stale"));
    api.emit(AI_CHAT_V2_STREAM_CHUNK, tokenChunk("asst-B", "fresh"));
    const deltas = seen.chunks
      .filter((c) => c.eventType === "token")
      .map((c) => c.contentDelta);
    expect(deltas).toEqual(["fresh"]);
  });

  it("a late parent complete neither resolves the attachment nor detaches it", async () => {
    const completed: ChatV2StreamChunk[] = [];
    const { seen, done } = attach({ onComplete: (c) => completed.push(c) });
    await Promise.resolve();
    // Late parent complete (parent message id): ignored — attachment alive.
    api.emit(AI_CHAT_V2_STREAM_COMPLETE, completeChunk("asst-A", "parent text"));
    expect(completed).toHaveLength(0);
    expect(seen.completes).toHaveLength(0);
    // Successor's own states still flow after the ignored parent complete
    // (listeners were NOT detached).
    api.emit(AI_CHAT_V2_STREAM_CHUNK, stateChunk("exec-B", "active"));
    expect(seen.states).toHaveLength(1);
    // Successor complete resolves with the successor chunk.
    api.emit(AI_CHAT_V2_STREAM_COMPLETE, completeChunk("asst-B", "successor text"));
    await done;
    expect(completed).toHaveLength(1);
    expect(completed[0].fullContent).toBe("successor text");
  });

  it("ignores chunks for other conversations", async () => {
    const { seen } = attach({});
    await Promise.resolve();
    api.emit(
      AI_CHAT_V2_STREAM_CHUNK,
      JSON.stringify({
        eventType: "task_execution_state",
        conversationId: "conv-other",
        taskExecutionState: {
          executionId: "exec-B",
          conversationId: "conv-other",
          status: "active",
        },
      })
    );
    expect(seen.states).toHaveLength(0);
    expect(seen.chunks).toHaveLength(0);
  });
});
