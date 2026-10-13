import { AIChatRunModule } from "@/modules/AIChatRunModule";
import type { AIChatRunEntity } from "@/entity/AIChatRun.entity";
import type { ChatRunStatus } from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Run-dispatch bridge (capability-parity technical design §8.3, AD-002/003;
 * audit T1).
 *
 * The durable pending queue owns per-conversation FIFO order and steering;
 * the run module owns durable execution envelopes. This bridge is the ONE
 * place a queue-backed dispatch mints its run envelope: the pending row is
 * claimed first, the envelope is created at the scheduling claim with
 * `sourceId = pendingMessageId`, and the terminal mapping persists the run
 * row before terminal events reach any surface.
 *
 * Identity model (design AD-003, audit T1 item 4):
 *
 * | Identity             | Created by                  | Linked by                      |
 * |----------------------|-----------------------------|--------------------------------|
 * | clientRequestId      | renderer (per submission)   | unique key on the pending row  |
 * | pendingMessageId     | pending module at accept    | `AIChatRunEntity.sourceId`     |
 * | userMessageId        | pending module at accept    | `user-pending-<pendingId>`     |
 * | runId                | THIS bridge at claim        | row with sourceId=pendingId    |
 * | assistantMessageId   | queue dispatcher            | `assistant-pending-<pendingId>`|
 *
 * One accepted ordinary send → one pending row → at most one non-terminal
 * interactive run keyed by that row's id. A steering-consumed row never
 * reaches the claim, so it never gets an envelope.
 */
export interface QueueDispatchCandidate {
  readonly pendingMessageId: string;
  readonly conversationId: string;
  readonly resourceClass: "general" | "browser" | "cpu" | "artifact_batch";
}

export interface WorkspaceRunDispatchBridge {
  /**
   * Idempotently create (or reuse) the interactive run envelope for a
   * claimed pending row and transition it to running. Returns null when the
   * envelope cannot be minted (the queue releases the claim instead).
   */
  schedule(
    candidate: QueueDispatchCandidate
  ): Promise<{ runId: string } | null>;
  /** Persist the run terminal state (idempotent; ignored for null runId). */
  finishRun(runId: string | null, status: TerminalRunStatus): Promise<void>;
  /** conversation_busy release: running -> queued for the next claim. */
  releaseToQueued(runId: string | null): Promise<void>;
  /** Parked (permission/plan) run: running -> awaiting_user. */
  parkRun(runId: string | null): Promise<void>;
}

export type TerminalRunStatus = Extract<
  ChatRunStatus,
  "completed" | "failed" | "cancelled" | "interrupted"
>;

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export class AIChatWorkspaceRunDispatchBridge
  implements WorkspaceRunDispatchBridge
{
  private readonly runModule: AIChatRunModule;

  constructor(runModule?: AIChatRunModule) {
    this.runModule = runModule ?? new AIChatRunModule();
  }

  async schedule(
    candidate: QueueDispatchCandidate
  ): Promise<{ runId: string } | null> {
    try {
      const existing = await this.findInteractiveRunBySource(
        candidate.pendingMessageId
      );
      if (existing) {
        // A conversation mismatch is a hard inconsistency — refuse so the
        // queue releases the claim instead of executing cross-linked work.
        if (existing.conversationId !== candidate.conversationId) {
          return null;
        }
        if (TERMINAL_RUN_STATUSES.has(existing.status)) {
          // Crash-restart recovery: the earlier attempt ended terminal
          // (e.g. interrupted) and the recovered pending row is being
          // re-dispatched — mint a fresh attempt envelope. Invariant 2
          // holds: the previous envelope is terminal, so at most one
          // NON-TERMINAL run exists per source id.
          const next = await this.runModule.createRun({
            conversationId: candidate.conversationId,
            owner: "interactive",
            sourceId: candidate.pendingMessageId,
            resourceClass: candidate.resourceClass,
          });
          await this.runModule.transition(next.runId, "running");
          return { runId: next.runId };
        }
        // queued → running on first claim; running/awaiting_* → idempotent
        // re-claim (the queue's claim token serializes dispatches per
        // conversation, so returning the SAME envelope cannot double-run).
        if (existing.status === "queued") {
          await this.runModule.transition(existing.runId, "running");
        }
        return { runId: existing.runId };
      }
      const created = await this.runModule.createRun({
        conversationId: candidate.conversationId,
        owner: "interactive",
        sourceId: candidate.pendingMessageId,
        resourceClass: candidate.resourceClass,
      });
      await this.runModule.transition(created.runId, "running");
      return { runId: created.runId };
    } catch {
      // Envelope minting failed: no provider call happens through this
      // dispatch — the queue treats it as a pre-turn failure.
      return null;
    }
  }

  async finishRun(
    runId: string | null,
    status: TerminalRunStatus
  ): Promise<void> {
    if (!runId) return;
    try {
      const row = await this.runModule.getByRunId(runId);
      if (!row || TERMINAL_RUN_STATUSES.has(row.status)) return;
      await this.runModule.transition(runId, status);
    } catch {
      // Terminal persistence is best-effort on the bridge; the queue's own
      // durable transitions remain authoritative for the pending row.
    }
  }

  async releaseToQueued(runId: string | null): Promise<void> {
    if (!runId) return;
    try {
      const row = await this.runModule.getByRunId(runId);
      if (!row || row.status !== "running") return;
      await this.runModule.transition(runId, "queued");
    } catch {
      // best-effort; the next claim's idempotent lookup reconciles
    }
  }

  async parkRun(runId: string | null): Promise<void> {
    if (!runId) return;
    try {
      const row = await this.runModule.getByRunId(runId);
      if (!row || row.status !== "running") return;
      await this.runModule.transition(runId, "awaiting_user");
    } catch {
      // best-effort; the resume path reconciles via its own transitions
    }
  }

  private findInteractiveRunBySource(
    pendingMessageId: string
  ): Promise<AIChatRunEntity | null> {
    return this.runModule.findBySourceId("interactive", pendingMessageId);
  }
}
