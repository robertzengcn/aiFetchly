import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
} from "@/service/AIChatQueryEvents";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import type {
  ChatRunOwner,
  ChatRunStatus,
  ConversationSummaryEvent,
} from "@/entityTypes/aiChatWorkspaceTypes";

/** Minimal summary broadcast the adapter depends on (DI-friendly). */
export interface SummaryBroadcaster {
  broadcastSummary(event: ConversationSummaryEvent): void;
}

export interface OwnerAdapterDeps {
  readonly conversationId: string;
  readonly owner: ChatRunOwner;
  /** Domain id from the owning subsystem (schedule id, goal run id, …). */
  readonly sourceId?: string | null;
  readonly runModule?: AIChatRunModule;
  readonly broadcaster?: SummaryBroadcaster;
}

/**
 * Wraps an existing owner-subsystem event sink (design §8.3 / §7.3): every
 * engine event forwards to the inner sink UNCHANGED while the adapter keeps
 * the shared run envelope durable — created queued, transitioned on observed
 * lifecycle, terminal state persisted BEFORE the redacted summary broadcast
 * (§5.3) so background owners become visible in the workspace sidebar.
 */
export async function createOwnerAdapterSink(
  inner: AIChatQueryEventSink,
  deps: OwnerAdapterDeps
): Promise<AIChatQueryEventSink> {
  const runModule = deps.runModule ?? new AIChatRunModule();
  const run = await runModule.createRun({
    conversationId: deps.conversationId,
    owner: deps.owner,
    sourceId: deps.sourceId ?? null,
  });
  const runId = run.runId;
  let status: ChatRunStatus = "queued";
  // Serialize durable transitions in emission order.
  let chain: Promise<unknown> = Promise.resolve();

  // FR-024: derive unread from the terminal status — a completed run
  // produces an unread result unless the conversation is actively selected.
  const isUnreadFor = (s: ChatRunStatus): boolean => s === "completed";

  const broadcast = (reason: ConversationSummaryEvent["reason"]): void => {
    deps.broadcaster?.broadcastSummary({
      conversationId: deps.conversationId,
      workspaceKey: null,
      runtimeStatus: status,
      attention:
        status === "awaiting_permission"
          ? "permission"
          : status === "awaiting_user"
          ? "user_input"
          : "none",
      unread: isUnreadFor(status),
      lastActivityAt: new Date().toISOString(),
      runId,
      reason,
    });
  };

  const transition = (next: ChatRunStatus, errorSummary?: string): void => {
    chain = chain
      .then(() =>
        runModule.transition(runId, next, errorSummary ? { errorSummary } : {})
      )
      .then(() => {
        status = next;
        // Persist-first: the summary hint follows the durable transition.
        const reason: ConversationSummaryEvent["reason"] =
          next === "running"
            ? "run_started"
            : next === "awaiting_permission"
            ? "permission_required"
            : next === "awaiting_user"
            ? "user_input_required"
            : next === "completed"
            ? "run_completed"
            : next === "failed"
            ? "run_failed"
            : next === "cancelled"
            ? "run_cancelled"
            : "run_interrupted";
        broadcast(reason);
      })
      .catch((err: unknown) => {
        console.warn(
          "[ai-chat-workspace] owner adapter transition failed:",
          err
        );
      });
  };

  return {
    emit: (event: AIChatQueryEvent): void => {
      // Forward unchanged — the owner subsystem keeps its own rendering.
      inner.emit(event);
      switch (event.type) {
        case "start":
          if (status === "queued") transition("running");
          break;
        case "ask_user_question":
        case "plan_submitted":
          if (status === "running" || status === "queued") {
            transition("awaiting_user");
          }
          break;
        case "complete":
          if (status !== "completed") transition("completed");
          break;
        case "cancelled":
          if (status !== "cancelled") transition("cancelled");
          break;
        case "error":
          if (status !== "failed") {
            transition("failed", event.errorMessage?.slice(0, 500));
          }
          break;
        default:
          break;
      }
    },
    // The engine may await this barrier before tool execution; delegate.
    flush: inner.flush?.bind(inner),
  };
}
