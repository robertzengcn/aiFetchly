'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { StreamEventProcessor, StreamState } from '@/service/StreamEventProcessor';
import { StreamEventType, type StreamEvent } from '@/api/aiChatApi';
import { AI_CHAT_STREAM_COMPLETE } from '@/config/channellist';
// IpcMainEvent type definition
type IpcMainEvent = {
    sender: {
        send: (channel: string, ...args: unknown[]) => void;
    };
};

describe('StreamEventProcessor', () => {
  let streamEventProcessor: StreamEventProcessor;
  let mockEvent: IpcMainEvent;
  let mockState: StreamState;

  beforeEach(() => {
    // Create mock IpcMainEvent
    mockEvent = {
      sender: {
        send: vi.fn(),
      },
    } as unknown as IpcMainEvent;

    // Create mock StreamState with required properties
    mockState = {
      assistantMessageId: 'test-message-id',
      fullContent: '',
      streamConversationId: 'test-conversation-id',
      hasStartedConversation: false,
      pendingToolCalls: new Set(),
      deferredCompletionChunk: null,
      messageSaved: false,
      chatModule: {} as any,
      aiChatApi: {} as any,
      currentPlan: null,
    };

    streamEventProcessor = new StreamEventProcessor(mockEvent, mockState);
  });

  describe('basic functionality', () => {
    test('should be instantiated', () => {
      expect(streamEventProcessor).toBeInstanceOf(StreamEventProcessor);
    });

    test('COMPLETE stream event triggers stream completion like DONE', () => {
      const streamEvent: StreamEvent = {
        event: StreamEventType.COMPLETE,
        data: {
          content: '',
          timestamp: new Date().toISOString(),
        },
      };
      streamEventProcessor.processEvent(streamEvent);
      expect(mockEvent.sender.send).toHaveBeenCalledWith(
        AI_CHAT_STREAM_COMPLETE,
        expect.stringContaining('"isComplete":true')
      );
    });
  });
});
