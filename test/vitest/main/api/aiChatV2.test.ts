import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_CHAT_V2_COMPACT_CONVERSATION,
  AI_CHAT_V2_STREAM,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
} from "@/config/channellist";
import {
  compactChatV2Conversation,
  streamChatV2Message,
} from "@/views/api/aiChatV2";

type ReceiveHandler = (raw: string) => void;

describe("aiChatV2 renderer API", () => {
  const handlers = new Map<string, ReceiveHandler>();
  const send = vi.fn();
  const invoke = vi.fn();
  const receive = vi.fn((channel: string, handler: ReceiveHandler) => {
    handlers.set(channel, handler);
  });
  const removeAllListeners = vi.fn((channel: string) => {
    handlers.delete(channel);
  });

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    (
      globalThis as unknown as {
        window: {
          api: {
            send: typeof send;
            invoke: typeof invoke;
            receive: typeof receive;
            removeAllListeners: typeof removeAllListeners;
          };
        };
      }
    ).window = {
      api: {
        send,
        invoke,
        receive,
        removeAllListeners,
      },
    };
  });

  it("keeps the stream promise pending until a terminal event arrives", async () => {
    const onChunk = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();
    let settled = false;

    const promise = streamChatV2Message(
      { message: "hello" },
      onChunk,
      onComplete,
      onError
    ).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await Promise.resolve();

    expect(send).toHaveBeenCalledWith(
      AI_CHAT_V2_STREAM,
      JSON.stringify({ message: "hello" })
    );
    expect(handlers.has(AI_CHAT_V2_STREAM_CHUNK)).toBe(true);
    expect(handlers.has(AI_CHAT_V2_STREAM_COMPLETE)).toBe(true);
    expect(settled).toBe(false);

    handlers.get(AI_CHAT_V2_STREAM_COMPLETE)?.(
      JSON.stringify({ eventType: "complete", conversationId: "v2-1" })
    );
    await promise;

    expect(onComplete).toHaveBeenCalledWith({
      eventType: "complete",
      conversationId: "v2-1",
    });
    expect(onChunk).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(settled).toBe(true);
  });

  it("rejects and reports an error when the stream cannot be sent", async () => {
    const onError = vi.fn();
    send.mockImplementationOnce(() => {
      throw new Error("send failed");
    });

    const promise = streamChatV2Message(
      { message: "hello" },
      vi.fn(),
      vi.fn(),
      onError
    );

    await expect(promise).rejects.toThrow("send failed");

    expect(onError).toHaveBeenCalledWith(new Error("send failed"));
    expect(removeAllListeners).toHaveBeenCalledWith(AI_CHAT_V2_STREAM_CHUNK);
    expect(removeAllListeners).toHaveBeenCalledWith(AI_CHAT_V2_STREAM_COMPLETE);
  });

  it("invokes the compact conversation channel with the active conversation id", async () => {
    const compactSummary = {
      compactId: "compact-1",
      conversationId: "v2-1",
      summary: "# Compact Summary",
      throughMessageId: "m-3",
      throughTimestamp: "2026-06-19T00:00:00.000Z",
      sourceMessageCount: 3,
      status: "active",
    };
    invoke.mockResolvedValueOnce({
      status: true,
      msg: "ok",
      data: compactSummary,
    });

    const result = await compactChatV2Conversation("v2-1");

    expect(invoke).toHaveBeenCalledWith(
      AI_CHAT_V2_COMPACT_CONVERSATION,
      JSON.stringify({ conversationId: "v2-1" })
    );
    expect(result).toEqual(compactSummary);
  });
});
