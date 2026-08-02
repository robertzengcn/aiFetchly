import {
  windowInvoke,
  windowReceive,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import {
  AI_CHAT_V2_CONVERSATION_UPDATED,
  AI_CHAT_V2_SCHEDULED_LOOP_CREATE,
  AI_CHAT_V2_SCHEDULED_LOOP_GET,
  AI_CHAT_V2_SCHEDULED_LOOP_PAUSE,
  AI_CHAT_V2_SCHEDULED_LOOP_RESUME,
  AI_CHAT_V2_SCHEDULED_LOOP_STOP,
  AI_CHAT_V2_SCHEDULED_LOOP_STOP_RUN,
  AI_CHAT_V2_SCHEDULED_STREAM,
} from "@/config/channellist";
import type {
  ChatV2ConversationUpdatedEvent,
  ChatV2ScheduledStreamEvent,
  CreateScheduledLoopRequest,
  CreateScheduledLoopResponse,
  ScheduledLoopControlOperation,
  ScheduledLoopView,
} from "@/entityTypes/aiChatScheduledLoopTypes";

/**
 * Renderer API for the AI Chat V2 scheduled-loop feature (`/loop <duration>
 * <prompt>`).
 *
 * `windowInvoke` returns the unwrapped `result.data` from the IPC handler.
 * Renderer-side: must not import TypeORM, models, or modules.
 */

/** Create a bounded scheduled loop bound to one Chat V2 conversation. */
export async function createScheduledLoop(
  req: CreateScheduledLoopRequest
): Promise<CreateScheduledLoopResponse | null> {
  const resp = await windowInvoke(AI_CHAT_V2_SCHEDULED_LOOP_CREATE, req);
  return (resp as CreateScheduledLoopResponse | null) ?? null;
}

/** Get the renderer-safe schedule view for the conversation's loop. */
export async function getScheduledLoopStatus(
  conversationId: string
): Promise<ScheduledLoopView | null> {
  const resp = await windowInvoke(AI_CHAT_V2_SCHEDULED_LOOP_GET, {
    conversationId,
  });
  return (resp as ScheduledLoopView | null) ?? null;
}

/** Run a control operation (status handled by getScheduledLoopStatus). */
export async function controlScheduledLoop(
  conversationId: string,
  operation: Exclude<ScheduledLoopControlOperation, "status">
): Promise<ScheduledLoopView | null> {
  const channel =
    operation === "pause"
      ? AI_CHAT_V2_SCHEDULED_LOOP_PAUSE
      : operation === "resume"
      ? AI_CHAT_V2_SCHEDULED_LOOP_RESUME
      : AI_CHAT_V2_SCHEDULED_LOOP_STOP;
  const resp = await windowInvoke(channel, { conversationId });
  return (resp as ScheduledLoopView | null) ?? null;
}

/** Stop only the currently-running occurrence (future occurrences continue). */
export async function stopScheduledLoopRun(
  conversationId: string
): Promise<{ cancelled: boolean } | null> {
  const resp = await windowInvoke(AI_CHAT_V2_SCHEDULED_LOOP_STOP_RUN, {
    conversationId,
  });
  return (resp as { cancelled: boolean } | null) ?? null;
}

/**
 * Subscribe to the narrow conversation-update broadcast emitted after a
 * scheduled turn persists. The event is a refresh hint only — the renderer must
 * reload authoritative history. Call unsubscribe in onBeforeUnmount.
 */
export function subscribeConversationUpdated(
  handler: (event: ChatV2ConversationUpdatedEvent) => void
): void {
  windowReceive(AI_CHAT_V2_CONVERSATION_UPDATED, (event) => {
    handler(event as ChatV2ConversationUpdatedEvent);
  });
}

/** Remove all conversation-update listeners (call in onBeforeUnmount). */
export function unsubscribeConversationUpdated(): void {
  windowRemoveAllListeners(AI_CHAT_V2_CONVERSATION_UPDATED);
}

/**
 * Subscribe to the live scheduled-turn token stream. Strict routing is enforced
 * renderer-side: the handler should ignore events whose conversationId is not
 * active or while an interactive stream is running. Call unsubscribe in
 * onBeforeUnmount.
 */
export function subscribeScheduledStream(
  handler: (event: ChatV2ScheduledStreamEvent) => void
): void {
  windowReceive(AI_CHAT_V2_SCHEDULED_STREAM, (event) => {
    handler(event as ChatV2ScheduledStreamEvent);
  });
}

/** Remove all scheduled-stream listeners (call in onBeforeUnmount). */
export function unsubscribeScheduledStream(): void {
  windowRemoveAllListeners(AI_CHAT_V2_SCHEDULED_STREAM);
}
