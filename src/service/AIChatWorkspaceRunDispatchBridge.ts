import { AIChatRunModule } from "@/modules/AIChatRunModule";
import type { AIChatRunEntity } from "@/entity/AIChatRun.entity";
import type { ChatRunStatus } from "@/entityTypes/aiChatWorkspaceTypes";
import type { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";

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
   * claimed pending row and admit it through the global scheduler.
   * Returns null when the envelope cannot be minted (the queue releases
   * the claim instead). When a scheduler is composed (B02), `admitted`
   * is false while global capacity is full — the envelope stays `queued`
   * with its original enqueue time (scheduling age preserved) and the
   * queue releases its dispatch claim WITHOUT error so a later
   * capacity-free notification can re-drain. `admitted` is always true
   * when no scheduler is composed (legacy immediate-running behavior).
   */
  schedule(
    candidate: QueueDispatchCandidate
  ): Promise<{ runId: string; admitted: boolean } | null>;
  /** Persist the run terminal state (idempotent; ignored for null runId). */
  finishRun(runId: string | null, status: TerminalRunStatus): Promise<void>;
  /**
   * B05 strict variant: returns true when the terminal row is durably
   * terminal after the call (persisted now or already terminal), false when
   * persistence failed. Callers must NOT publish terminal UI events or
   * advance the queue on false — surface reconciliation/recovery instead.
   */
  finishRunStrict(
    runId: string | null,
    status: TerminalRunStatus
  ): Promise<boolean>;
  /** conversation_busy release: running -> queued for the next claim. */
  releaseToQueued(runId: string | null): Promise<void>;
  /** Parked (permission/plan) run: running -> awaiting_user. */
  parkRun(runId: string | null): Promise<void>;
  /**
   * Parked with the correct waiting family (B04): permission pauses use
   * `awaiting_permission`, plan-question pauses use `awaiting_user`.
   * Indiscriminately recording every wait as `awaiting_user` mislabels
   * permission attention in Activity/reconstruction.
   */
  parkRunWaiting(
    runId: string | null,
    waiting: "awaiting_permission" | "awaiting_user"
  ): Promise<void>;
  /**
   * Admit a previously deferred (queued) envelope after capacity frees.
   * Returns true when the run is now running. Idempotent.
   */
  admitDeferred(runId: string | null): Promise<boolean>;
  /** Remove a deferred envelope from scheduler admission (cancel path). */
  cancelDeferred(runId: string | null): void;
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
  private readonly scheduler: AIChatExecutionScheduler | null;

  constructor(
    runModule?: AIChatRunModule,
    scheduler?: AIChatExecutionScheduler | null
  ) {
    this.runModule = runModule ?? new AIChatRunModule();
    this.scheduler = scheduler ?? null;
  }

  async schedule(
    candidate: QueueDispatchCandidate
  ): Promise<{ runId: string; admitted: boolean } | null> {
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
          aiChatQueueCounters.incrementWorkspace("ai_chat_run_created_total", {
            owner: "interactive",
            resource_class: candidate.resourceClass,
          });
          return this.admitEnvelope(next.runId, candidate);
        }
        // queued → admit through the global scheduler (B02); running /
        // awaiting_* → idempotent re-claim (the queue's claim token
        // serializes dispatches per conversation, so returning the SAME
        // envelope cannot double-run).
        if (existing.status === "queued") {
          return this.admitEnvelope(existing.runId, candidate);
        }
        return { runId: existing.runId, admitted: true };
      }
      const created = await this.runModule.createRun({
        conversationId: candidate.conversationId,
        owner: "interactive",
        sourceId: candidate.pendingMessageId,
        resourceClass: candidate.resourceClass,
      });
      // G03 §18.1: run envelopes by owner + resource class (bounded).
      aiChatQueueCounters.incrementWorkspace("ai_chat_run_created_total", {
        owner: "interactive",
        resource_class: candidate.resourceClass,
      });
      return this.admitEnvelope(created.runId, candidate);
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
    await this.finishRunStrict(runId, status);
  }

  async finishRunStrict(
    runId: string | null,
    status: TerminalRunStatus
  ): Promise<boolean> {
    if (!runId) return true;
    try {
      const row = await this.runModule.getByRunId(runId);
      if (!row) {
        this.scheduler?.complete(runId);
        return false;
      }
      if (TERMINAL_RUN_STATUSES.has(row.status)) {
        this.scheduler?.complete(runId);
        return true;
      }
      await this.runModule.transition(runId, status);
      // G03 §18.1: run terminals by status (bounded; error codes ride the
      // run row, never the counter).
      aiChatQueueCounters.incrementLabeled(
        "ai_chat_run_terminal_total",
        status
      );
    } catch (err) {
      // B05: terminal persistence failure is NOT silent — the caller gates
      // terminal publication and queue advancement on this return value.
      console.error(
        `[run-dispatch-bridge] terminal persistence failed run=${runId}:`,
        err
      );
      return false;
    } finally {
      // B02: always release global capacity on terminal outcomes so a
      // deferred fourth run can admit. Safe to call twice (idempotent).
      this.scheduler?.complete(runId);
    }
    return true;
  }

  async releaseToQueued(runId: string | null): Promise<void> {
    if (!runId) return;
    try {
      const row = await this.runModule.getByRunId(runId);
      if (!row || row.status !== "running") return;
      await this.runModule.transition(runId, "queued");
    } catch {
      // best-effort; the next claim's idempotent lookup reconciles
    } finally {
      // B02: a lease-race release returns the scheduler slot with its
      // original enqueue time preserved (requeue, not cancel+resubmit, so
      // scheduling age must not restart — design AD-002).
      if (this.scheduler?.isActive(runId)) {
        this.scheduler.requeue(runId);
      }
    }
  }

  async parkRun(runId: string | null): Promise<void> {
    return this.parkRunWaiting(runId, "awaiting_user");
  }

  async parkRunWaiting(
    runId: string | null,
    waiting: "awaiting_permission" | "awaiting_user"
  ): Promise<void> {
    if (!runId) return;
    try {
      const row = await this.runModule.getByRunId(runId);
      if (!row || row.status !== "running") return;
      await this.runModule.transition(runId, waiting);
    } catch {
      // best-effort; the resume path reconciles via its own transitions
    } finally {
      // B02: a parked turn is not executing — release capacity so other
      // conversations can admit while this run waits for the user. The
      // resume path re-admits through admitDeferred (same run id).
      this.scheduler?.complete(runId);
    }
  }

  async admitDeferred(runId: string | null): Promise<boolean> {
    if (!runId) return false;
    try {
      const row = await this.runModule.getByRunId(runId);
      if (!row || TERMINAL_RUN_STATUSES.has(row.status)) {
        this.scheduler?.complete(runId);
        return false;
      }
      if (!this.scheduler) {
        if (row.status === "queued") {
          await this.runModule.transition(runId, "running");
        }
        return true;
      }
      if (this.scheduler.isActive(runId)) {
        if (row.status === "queued") {
          await this.runModule.transition(runId, "running");
        }
        return true;
      }
      // Still queued in the scheduler (or unknown): pump once and recheck.
      // The caller re-drains on capacity-free notifications; a pump here
      // covers the race where capacity freed between notification and drain.
      this.scheduler.pump(() => undefined);
      if (this.scheduler.isActive(runId)) {
        if (row.status === "queued") {
          await this.runModule.transition(runId, "running");
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  cancelDeferred(runId: string | null): void {
    if (!runId || !this.scheduler) return;
    this.scheduler.cancelQueued(runId);
  }

  /**
   * B02: admit one envelope through the global scheduler. Without a
   * scheduler the envelope transitions to running immediately (legacy).
   * With a scheduler the envelope is submitted (idempotent) and pumped;
   * `admitted` is true only when the scheduler dispatched THIS run id.
   * A deferred envelope stays `queued` in BOTH the run table and the
   * scheduler queue with its original enqueue time — scheduling age is
   * preserved for the later admitDeferred.
   */
  private async admitEnvelope(
    runId: string,
    candidate: QueueDispatchCandidate
  ): Promise<{ runId: string; admitted: boolean } | null> {
    if (!this.scheduler) {
      await this.runModule.transition(runId, "running");
      return { runId, admitted: true };
    }
    this.scheduler.submit({
      runId,
      conversationId: candidate.conversationId,
      owner: "interactive",
      resourceClass: candidate.resourceClass,
    });
    let admitted = false;
    this.scheduler.pump((dispatch) => {
      if (dispatch.runId === runId) admitted = true;
    });
    if (admitted) {
      await this.runModule.transition(runId, "running");
      return { runId, admitted: true };
    }
    return { runId, admitted: false };
  }

  private findInteractiveRunBySource(
    pendingMessageId: string
  ): Promise<AIChatRunEntity | null> {
    return this.runModule.findBySourceId("interactive", pendingMessageId);
  }
}
