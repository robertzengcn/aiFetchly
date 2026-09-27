import { AIChatEventRouter } from "@/service/AIChatEventRouter";
import type {
  ConversationSummaryEvent,
} from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Process-wide workspace event-routing singletons (design §7.5).
 *
 * Lives at the service layer so owner adapters (scheduled runner, future
 * goal/agent executors) can broadcast redacted summaries without importing
 * the IPC registration layer.
 */
export const sharedWorkspaceEventRouter = new AIChatEventRouter();

/** Broadcaster handoff for {@link AIChatRunOwnerAdapter} dependency injection. */
export const sharedSummaryBroadcaster = {
  broadcastSummary(event: ConversationSummaryEvent): void {
    sharedWorkspaceEventRouter.broadcastSummary(event);
  },
};

/**
 * Stage A §3.4 (generator-streaming PRD FR-004): lazy execution-owner seam for
 * queue-drained turns. The workspace IPC layer registers the coordinator's
 * dispatchQueuedTurn here once constructed; the queue service (wired in
 * ai-chat-v2-ipc.ts, which cannot import the workspace IPC module without a
 * static cycle) reads it at drain time. Missing registration fails the turn
 * honestly — it never silently bypasses the owner.
 */
export interface QueueTurnDispatcherHolder {
  dispatchQueuedTurn(input: {
    readonly conversationId: string;
    readonly pendingMessageId: string;
    readonly request: import("@/entityTypes/aiChatV2Types").ChatV2StreamRequest;
    readonly savedUser: {
      readonly messageId: string;
      readonly conversationId: string;
    };
    readonly modelContent: string;
    readonly contentParts?: unknown;
    readonly assistantMessageId: string;
  }): Promise<import("@/service/AIChatQueryEvents").AIChatSegmentOutcome>;
}

let queueTurnDispatcher: QueueTurnDispatcherHolder | null = null;

export function setQueueTurnDispatcher(dispatcher: QueueTurnDispatcherHolder): void {
  queueTurnDispatcher = dispatcher;
}

export function getQueueTurnDispatcher(): QueueTurnDispatcherHolder | null {
  return queueTurnDispatcher;
}
