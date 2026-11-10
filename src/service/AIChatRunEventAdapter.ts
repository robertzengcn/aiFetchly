import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";
import type {
  ChatRunDetailEvent,
  ChatRunStatus,
} from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Wraps renderer stream chunks with run identity for the detail-event
 * envelope (technical-design §7.6, §11.4): monotonic sequence per run,
 * emission timestamp, and a durable-status hint the coordinator may apply.
 */
export class AIChatRunEventAdapter {
  private sequenceCounter = 0;

  /**
   * D01 (audit 2026-10-21-r3): the accepted append identity this run serves
   * (`pending-<pendingMessageId>` for queue-drained turns, the run's own
   * durable id for direct interactive runs). Detail envelopes carry it so
   * the renderer binds starts/terminals by durable source identity instead
   * of the legacy FIFO branch that an orphaned queued row can poison.
   */
  constructor(
    private readonly runId: string,
    private readonly conversationId: string,
    private readonly sourceRunId?: string | null
  ) {}

  /** Wrap one chunk into the routed detail-event envelope. */
  wrap(chunk: ChatV2StreamChunk): ChatRunDetailEvent {
    this.sequenceCounter += 1;
    return {
      conversationId: this.conversationId,
      runId: this.runId,
      sequence: this.sequenceCounter,
      emittedAt: new Date().toISOString(),
      eventType: chunk.eventType,
      payload: chunk as unknown as Record<string, unknown>,
      ...(this.sourceRunId ? { sourceRunId: this.sourceRunId } : {}),
    };
  }

  /** Highest sequence handed out (diagnostics / gap detection aid). */
  get sequence(): number {
    return this.sequenceCounter;
  }

  /**
   * Durable-status hint for a chunk type, or null when the chunk carries no
   * lifecycle information. Permission pauses are engine state (not sink
   * events) and are sampled separately by the coordinator.
   */
  static statusHintFor(eventType: ChatV2StreamChunk["eventType"]): ChatRunStatus | null {
    switch (eventType) {
      case "start":
        return "running";
      case "ask_user_question":
      case "plan_submitted":
        return "awaiting_user";
      case "complete":
        return "completed";
      case "error":
        return "failed";
      case "cancelled":
        return "cancelled";
      default:
        return null;
    }
  }
}
