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
