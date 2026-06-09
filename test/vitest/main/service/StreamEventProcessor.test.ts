"use strict";
import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  StreamEventProcessor,
  StreamState,
} from "@/service/StreamEventProcessor";
import { StreamEventType, type StreamEvent } from "@/api/aiChatApi";
import {
  AI_CHAT_STREAM_CHUNK,
  AI_CHAT_STREAM_COMPLETE,
} from "@/config/channellist";
// IpcMainEvent type definition
type IpcMainEvent = {
  sender: {
    send: (channel: string, ...args: unknown[]) => void;
  };
};

/**
 * Helper: create a minimal StreamState for tests.
 */
function createMockState(overrides?: Partial<StreamState>): StreamState {
  return {
    assistantMessageId: "test-message-id",
    fullContent: "",
    streamConversationId: "test-conversation-id",
    hasStartedConversation: false,
    pendingToolCalls: new Set(),
    deferredCompletionChunk: null,
    messageSaved: false,
    chatModule: {} as never,
    aiChatApi: {} as never,
    currentPlan: null,
    ...overrides,
  };
}

function createMockEvent(): IpcMainEvent {
  return {
    sender: {
      send: vi.fn(),
    },
  } as unknown as IpcMainEvent;
}

describe("StreamEventProcessor", () => {
  let streamEventProcessor: StreamEventProcessor;
  let mockEvent: IpcMainEvent;
  let mockState: StreamState;

  beforeEach(() => {
    mockEvent = createMockEvent();
    mockState = createMockState();
    streamEventProcessor = new StreamEventProcessor(mockEvent, mockState);
  });

  // ---------------------------------------------------------------------------
  // Existing basic functionality
  // ---------------------------------------------------------------------------
  describe("basic functionality", () => {
    test("should be instantiated", () => {
      expect(streamEventProcessor).toBeInstanceOf(StreamEventProcessor);
    });

    test("COMPLETE stream event triggers stream completion like DONE", () => {
      const streamEvent: StreamEvent = {
        event: StreamEventType.COMPLETE,
        data: {
          content: "",
          timestamp: new Date().toISOString(),
        },
      };
      streamEventProcessor.processEvent(streamEvent);
      expect(mockEvent.sender.send).toHaveBeenCalledWith(
        AI_CHAT_STREAM_COMPLETE,
        expect.stringContaining('"isComplete":true')
      );
    });

    test("TOOL_RESULT stream event should include serialized content for frontend display", () => {
      const streamEvent: StreamEvent = {
        event: StreamEventType.TOOL_RESULT,
        data: {
          content: {
            success: true,
            summary: "Found 2 records",
          },
          timestamp: new Date().toISOString(),
        },
      };

      streamEventProcessor.processEvent(streamEvent);

      expect(mockEvent.sender.send).toHaveBeenCalledWith(
        AI_CHAT_STREAM_CHUNK,
        expect.any(String)
      );

      const sendCalls = (
        mockEvent.sender.send as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls;
      const lastCall = sendCalls[sendCalls.length - 1];
      const payload = JSON.parse(String(lastCall[1])) as {
        eventType?: string;
        content?: string;
      };

      expect(payload.eventType).toBe(StreamEventType.TOOL_RESULT);
      expect(payload.content).toContain("Found 2 records");
    });
  });

  // ---------------------------------------------------------------------------
  // Abort / stop behaviour
  //
  // These tests verify that when the user clicks stop (abort signal fires),
  // the processor stops sending events and does not start continuation streams.
  // ---------------------------------------------------------------------------
  describe("abort / stop behaviour", () => {
    /** Create an AbortController-backed state so we can trigger abort in tests. */
    function createAbortableProcessor(): {
      processor: StreamEventProcessor;
      event: IpcMainEvent;
      state: StreamState;
      abortController: AbortController;
    } {
      const abortController = new AbortController();
      const event = createMockEvent();
      const state = createMockState({
        abortSignal: abortController.signal,
      });
      const processor = new StreamEventProcessor(event, state);
      return { processor, event, state, abortController };
    }

    /** Timestamp string used in all test stream events. */
    const ts = new Date().toISOString();

    /** Shorthand for a plain-text content data block. */
    function textData(content: string) {
      return { content, timestamp: ts };
    }

    // ----- processEvent ----------------------------------------------------

    test("processEvent discards TOKEN events after abort", () => {
      const { processor, event, abortController } = createAbortableProcessor();

      // Before abort: token events are processed
      const tokenEvent: StreamEvent = {
        event: StreamEventType.TOKEN,
        data: textData("hello"),
      };
      processor.processEvent(tokenEvent);
      expect(event.sender.send).toHaveBeenCalled();

      vi.clearAllMocks();
      abortController.abort();

      // After abort: token events are silently dropped
      processor.processEvent(tokenEvent);
      expect(event.sender.send).not.toHaveBeenCalled();
    });

    test("processEvent discards DONE events after abort", () => {
      const { processor, event, abortController } = createAbortableProcessor();

      abortController.abort();

      const doneEvent: StreamEvent = {
        event: StreamEventType.DONE,
        data: textData(""),
      };
      processor.processEvent(doneEvent);

      // No AI_CHAT_STREAM_COMPLETE should be sent after abort
      expect(event.sender.send).not.toHaveBeenCalledWith(
        AI_CHAT_STREAM_COMPLETE,
        expect.anything()
      );
    });

    test("processEvent discards TOOL_CALL events after abort", () => {
      const { processor, event, state, abortController } =
        createAbortableProcessor();

      abortController.abort();

      const toolCallEvent: StreamEvent = {
        event: StreamEventType.TOOL_CALL,
        data: {
          content: "",
          timestamp: ts,
          data: {
            id: "tool-1",
            name: "test_tool",
            arguments: { query: "hello" },
          },
        },
      };
      processor.processEvent(toolCallEvent);

      // No chunk sent to renderer and no tool added to pending set
      expect(event.sender.send).not.toHaveBeenCalled();
      expect(state.pendingToolCalls.has("tool-1")).toBe(false);
    });

    test("processEvent discards TOOL_RESULT events after abort", () => {
      const { processor, event, abortController } = createAbortableProcessor();

      abortController.abort();

      const toolResultEvent: StreamEvent = {
        event: StreamEventType.TOOL_RESULT,
        data: {
          content: { success: true, data: "result" },
          timestamp: ts,
          data: { id: "tool-1", name: "test_tool", arguments: {} },
        },
      };
      processor.processEvent(toolResultEvent);

      expect(event.sender.send).not.toHaveBeenCalled();
    });

    // ----- sendDeferredCompletionIfReady -----------------------------------

    test("deferred completion is discarded when abort fires before tools finish", () => {
      const { processor, event, state, abortController } =
        createAbortableProcessor();

      // Simulate a pending tool call so DONE is deferred
      state.pendingToolCalls.add("tool-pending");

      // Process DONE — it should be deferred, not sent immediately
      const doneEvent: StreamEvent = {
        event: StreamEventType.DONE,
        data: textData(""),
      };
      processor.processEvent(doneEvent);

      // Before abort: completion should be deferred, not sent
      expect(state.deferredCompletionChunk).not.toBeNull();
      expect(event.sender.send).not.toHaveBeenCalledWith(
        AI_CHAT_STREAM_COMPLETE,
        expect.anything()
      );

      // Abort
      abortController.abort();

      // Now simulate tool finishing — deferred completion should be discarded
      state.pendingToolCalls.delete("tool-pending");
      // Re-process DONE to trigger sendDeferredCompletionIfReady path
      // (in real flow this is called from executeTool cleanup)
      processor.processEvent({
        event: StreamEventType.DONE,
        data: textData(""),
      });

      // No completion should be sent after abort
      expect(event.sender.send).not.toHaveBeenCalledWith(
        AI_CHAT_STREAM_COMPLETE,
        expect.anything()
      );
    });

    test("deferred completion is sent normally without abort", () => {
      const { processor, event, state } = createAbortableProcessor();

      // Simulate a pending tool call
      state.pendingToolCalls.add("tool-pending");

      // Process DONE — deferred
      processor.processEvent({
        event: StreamEventType.DONE,
        data: textData(""),
      });
      expect(state.deferredCompletionChunk).not.toBeNull();

      // Tool finishes — completion should be sent
      state.pendingToolCalls.delete("tool-pending");
      processor.processEvent({
        event: StreamEventType.COMPLETE,
        data: textData(""),
      });

      expect(event.sender.send).toHaveBeenCalledWith(
        AI_CHAT_STREAM_COMPLETE,
        expect.stringContaining('"isComplete":true')
      );
    });

    // ----- executeTool abort guard -----------------------------------------

    test("hasPendingToolCalls returns true when tools are pending", () => {
      mockState.pendingToolCalls.add("tool-1");
      expect(streamEventProcessor.hasPendingToolCalls()).toBe(true);
    });

    test("hasPendingToolCalls returns false when no tools are pending", () => {
      expect(streamEventProcessor.hasPendingToolCalls()).toBe(false);
    });

    // ----- abort with no signal (graceful degradation) --------------------

    test("processor works normally when no abortSignal is provided", () => {
      // Default state has no abortSignal
      const doneEvent: StreamEvent = {
        event: StreamEventType.DONE,
        data: textData(""),
      };
      streamEventProcessor.processEvent(doneEvent);

      expect(mockEvent.sender.send).toHaveBeenCalledWith(
        AI_CHAT_STREAM_COMPLETE,
        expect.anything()
      );
    });
  });
});
