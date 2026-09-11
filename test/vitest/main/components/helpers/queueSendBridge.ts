import { vi } from "vitest";
import {
  awaitChatV2Turn,
  createChatV2PendingMessage,
  streamChatV2Message,
} from "@/views/api/aiChatV2";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";

/**
 * Component-test bridge for the message-queue send path.
 *
 * onSend now routes ordinary sends through awaitChatV2Turn +
 * createChatV2PendingMessage instead of calling streamChatV2Message
 * directly. Suites that script streamChatV2Message's behavior (and assert
 * on its request argument / call count) install this bridge: the create
 * mock resolves a dispatch_scheduled receipt and drives the suite's
 * streamChatV2Message mock with the ORIGINAL request and the handlers the
 * component registered via awaitChatV2Turn — so every existing assertion
 * keeps working unchanged.
 */
export function installQueueSendBridge(): void {
  let bridgedHandlers: {
    onChunk: (chunk: ChatV2StreamChunk) => void;
    onComplete: (chunk: ChatV2StreamChunk) => void;
    onError: (error: Error) => void;
  } | null = null;
  let resolveTurn: (() => void) | null = null;

  vi.mocked(awaitChatV2Turn).mockImplementation(
    (
      _conversationId: string,
      onChunk: (chunk: ChatV2StreamChunk) => void,
      onComplete: (chunk: ChatV2StreamChunk) => void,
      onError: (error: Error) => void
    ) => {
      bridgedHandlers = { onChunk, onComplete, onError };
      return {
        promise: new Promise<void>((resolve) => {
          resolveTurn = resolve;
        }),
        detach: () => undefined,
      };
    }
  );

  vi.mocked(createChatV2PendingMessage).mockImplementation(
    async (_clientRequestId: string, request: ChatV2StreamRequest_t) => {
      const handlers = bridgedHandlers ?? {
        onChunk: () => undefined,
        onComplete: () => undefined,
        onError: () => undefined,
      };
      void vi
        .mocked(streamChatV2Message)(
          request,
          handlers.onChunk,
          handlers.onComplete,
          handlers.onError
        )
        .then(
          () => resolveTurn?.(),
          () => resolveTurn?.()
        );
      return {
        conversationId: request.conversationId ?? "v2-bridge",
        disposition: "dispatch_scheduled" as const,
        pendingMessage: {
          pendingMessageId: "pm-bridge",
          conversationId: request.conversationId ?? "v2-bridge",
          clientRequestId: "bridge",
          sequence: 1,
          content: request.message ?? "",
          status: "queued" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          canSteer: false,
        },
      };
    }
  );
}

/** Minimal local alias to avoid importing app types into the helper. */
type ChatV2StreamRequest_t = {
  conversationId?: string;
  message: string;
};
