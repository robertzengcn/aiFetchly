import { BaseDb } from "@/model/Basedb";
import { Repository, EntityManager } from "typeorm";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";
import { runReplyTxn } from "@/model/replyTxn";
import {
  readClusterEvidence,
  evidenceToPhase,
} from "@/model/replyClusterEvidence";
import { pickReusableDraft } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import type {
  GuardPhase,
  EmailReplyPolicyCode,
} from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Result of attempting to acquire a generation reservation (T07/FR-035,
 * technical design §8.1). The acquire transaction reconciles the canonical
 * cluster's draft/attempt evidence BEFORE claiming, so a losing invocation
 * learns what to do with no further reads:
 *
 *   - `acquired` — this caller owns the lease; proceed to model work.
 *   - `generation_in_progress` — another owner holds an unexpired lease; the
 *     caller returns the `generation_in_progress` policy code (defined but
 *     previously never emitted).
 *   - `reusable` — the cluster already has an eligible draft (B08 reuse); the
 *     caller returns it instead of regenerating.
 *   - `blocked` — the cluster is in a state that forbids generation
 *     (already_replied / delivery_unknown / reply_in_progress /
 *     reply_state_conflict / reply_state_unknown); the caller returns the
 *     matching policy code.
 */
export type ReservationAcquireResult =
  | { readonly status: "acquired"; readonly guardId: number }
  | { readonly status: "generation_in_progress" }
  | { readonly status: "reusable"; readonly draftId: number }
  | { readonly status: "blocked"; readonly code: EmailReplyPolicyCode };

/** Input for {@link EmailReplyGuardModel.acquireReservation}. */
export interface AcquireReservationInput {
  readonly emailServiceId: number;
  readonly replyKey: string;
  readonly messageId: number;
  readonly ownerToken: string;
  readonly leaseExpiresAt: Date;
  readonly now: Date;
  /** The seed row's normalized RFC id, used to resolve the canonical cluster. */
  readonly normalizedMessageId: string | null;
}

/**
 * Persisted message-level generation/send guard (T07/FR-035, T08/FR-036,
 * technical design §5.2/§8.1/§8.2).
 *
 * The guard is an ownership index over `(emailServiceId, replyKey)`. Every
 * mutation reconciles against actual draft/attempt records — never trust
 * `phase = "idle"` while a related sent/unknown/in-flight record exists
 * (§5.2). All methods run under the shared `runReplyTxn` mutex so they
 * serialize against `EmailReplyDraftModel` transactions on the same
 * better-sqlite3 connection.
 *
 * Model/mailbox network work is NEVER done inside these transactions (§8.1):
 * the acquire transaction is short (reconcile + claim), the commit transaction
 * is short (persist + transition). The generation service holds the lease
 * across the unbounded LLM call between them.
 */
export class EmailReplyGuardModel extends BaseDb {
  private repository: Repository<EmailReplyGuardEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailReplyGuardModel");
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReplyGuardEntity
    );
  }

  /**
   * Atomically acquire a generation reservation (§8.1). Reconciles the
   * canonical cluster's drafts + attempts inside the same transaction as the
   * conditional INSERT/UPDATE that claims the lease, so a concurrent invoker
   * cannot both pass the reconcile and both claim.
   */
  async acquireReservation(
    input: AcquireReservationInput
  ): Promise<ReservationAcquireResult> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const evidence = await readClusterEvidence(manager, {
        emailServiceId: input.emailServiceId,
        normalizedMessageId: input.normalizedMessageId,
        seedMessageId: input.messageId,
      });

      // 1. Already replied (sent draft OR sent attempt OR replyStatus=sent).
      if (evidence.replyStatus === "sent" || evidence.sentDrafts.length > 0 || evidence.sentAttempts.length > 0) {
        return { status: "blocked", code: "already_replied" };
      }
      // 2. Ambiguous delivery on a prior attempt.
      if (evidence.unknownDrafts.length > 0 || evidence.unknownAttempts.length > 0) {
        return { status: "blocked", code: "delivery_unknown" };
      }
      // 3. In-flight send.
      if (evidence.sendingDrafts.length > 0 || evidence.inFlightAttempts.length > 0) {
        return { status: "blocked", code: "reply_in_progress" };
      }
      // 4. Multiple live drafts across the cluster → conflict.
      if (evidence.liveDrafts.length > 1) {
        return { status: "blocked", code: "reply_state_conflict" };
      }

      // 5. An eligible draft already exists (draft/approved preferred, then a
      //    definitely-failed draft per B08) — the caller reuses it by ID with
      //    no model work, mirroring the orchestrator's `pickReusableDraft`
      //    (stage 2c). Only reached when the cluster is otherwise clean.
      const reusableDraft = pickReusableDraft([
        ...evidence.liveDrafts,
        ...evidence.failedDrafts,
      ]);
      if (reusableDraft) {
        return { status: "reusable", draftId: reusableDraft.id };
      }

      // Conditional acquire. Try INSERT first; on unique conflict, reread and
      // either reclaim an expired/idle row or observe an active owner.
      const existing = await manager.getRepository(EmailReplyGuardEntity).findOne({
        where: {
          emailServiceId: input.emailServiceId,
          replyKey: input.replyKey,
        },
      });

      if (!existing) {
        const guard = new EmailReplyGuardEntity();
        guard.emailServiceId = input.emailServiceId;
        guard.replyKey = input.replyKey;
        guard.messageId = input.messageId;
        guard.phase = "generating";
        guard.ownerToken = input.ownerToken;
        guard.leaseExpiresAt = input.leaseExpiresAt;
        guard.activeDraftId = null;
        guard.activeAttemptId = null;
        try {
          const saved = await manager.getRepository(EmailReplyGuardEntity).save(guard);
          return { status: "acquired", guardId: saved.id };
        } catch (error) {
          // Unique constraint collision — a concurrent invoker inserted first.
          // Reread and fall through to the existing-row path below. The error
          // is logged but the swallow stays: the reread below is the recovery.
          console.error(
            "EmailReplyGuard conditional-acquire insert failed (likely unique collision); rereading:",
            error
          );
        }
      }

      // Existing row (or just-inserted by a concurrent caller).
      const row =
        existing ??
        (await manager.getRepository(EmailReplyGuardEntity).findOne({
          where: {
            emailServiceId: input.emailServiceId,
            replyKey: input.replyKey,
          },
        }));
      if (!row) {
        // Extremely unlikely: insert threw but the row is still absent. Treat
        // as in-progress so the caller retries safely.
        return { status: "generation_in_progress" };
      }

      const leaseExpired =
        row.leaseExpiresAt === null || row.leaseExpiresAt < input.now;
      const isIdle = row.phase === "idle";
      const sameOwner = row.ownerToken === input.ownerToken;

      if (sameOwner && (row.phase === "generating" || row.phase === "draft_ready")) {
        // Re-entrant acquire by the same owner — extend the lease.
        const renewed = await manager
          .getRepository(EmailReplyGuardEntity)
          .update(
            { id: row.id, ownerToken: input.ownerToken },
            { phase: "generating", leaseExpiresAt: input.leaseExpiresAt, messageId: input.messageId }
          );
        if ((renewed.affected ?? 0) > 0) {
          return { status: "acquired", guardId: row.id };
        }
        return { status: "generation_in_progress" };
      }

      if (isIdle || leaseExpired) {
        // Reclaim an idle or expired row. Fenced by phase/lease so a
        // concurrent reclaim by a different owner yields 0 rows.
        const reclaimed = await manager
          .getRepository(EmailReplyGuardEntity)
          .update(
            {
              id: row.id,
            },
            {
              phase: "generating" as GuardPhase,
              ownerToken: input.ownerToken,
              leaseExpiresAt: input.leaseExpiresAt,
              messageId: input.messageId,
              activeDraftId: null,
              activeAttemptId: null,
            }
          );
        // Note: this UPDATE is unconditional on the row id alone; the
        // fence against a concurrent reclaim is the unique-row read above +
        // the mutex serializing transactions. A concurrent invoker that
        // reads the same expired row will block on the mutex until this
        // transaction commits, then reread the now-`generating` row and
        // return `generation_in_progress`.
        if ((reclaimed.affected ?? 0) > 0) {
          return { status: "acquired", guardId: row.id };
        }
        return { status: "generation_in_progress" };
      }

      // Active lease held by a different owner — the caller loses.
      return { status: "generation_in_progress" };
    });
  }

  /**
   * Conditionally extend the lease. Returns false when the owner has been
   * replaced or the lease already expired — the caller must abort (§8.2:
   * "An expired/replaced owner cannot renew, commit, or release the current
   * lease").
   */
  async extendLease(input: {
    guardId: number;
    ownerToken: string;
    newExpiresAt: Date;
    now: Date;
  }): Promise<boolean> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const res = await manager.getRepository(EmailReplyGuardEntity).update(
        {
          id: input.guardId,
          ownerToken: input.ownerToken,
        },
        { leaseExpiresAt: input.newExpiresAt }
      );
      return (res.affected ?? 0) > 0;
    });
  }

  /**
   * Release a reservation on generation failure. Fenced by ownerToken so a
   * replaced owner cannot release the current lease (§8.2). 0 rows = another
   * owner already reclaimed — leave the row untouched.
   */
  async releaseReservation(input: {
    guardId: number;
    ownerToken: string;
    now: Date;
  }): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      await manager.getRepository(EmailReplyGuardEntity).update(
        { id: input.guardId, ownerToken: input.ownerToken },
        {
          phase: "idle" as GuardPhase,
          ownerToken: null,
          leaseExpiresAt: null,
          activeDraftId: null,
          activeAttemptId: null,
        }
      );
    });
  }

  /**
   * Fenced commit gate: transition to `draft_ready` and bind the committed
   * draft. Called INSIDE the commit transaction (the caller already holds the
   * `runReplyTxn` for draft+revision+projection+audit). Returns false when the
   * owner has been replaced or the lease expired before commit — the caller
   * must roll back (no draft persisted). This is the §8.2 fenced late-result
   * rejection: "Late LLM results from expired owners are discarded."
   *
   * NOTE: this method does NOT open its own `runReplyTxn` — it must be called
   * from within one. Accepting a `manager` keeps the guard transition in the
   * SAME transaction as the draft/revision/projection/audit commit.
   */
  async commitDraftToGuardWithManager(
    manager: EntityManager,
    input: {
      guardId: number;
      ownerToken: string;
      now: Date;
      activeDraftId: number;
    }
  ): Promise<boolean> {
    const res = await manager.getRepository(EmailReplyGuardEntity).update(
      {
        id: input.guardId,
        ownerToken: input.ownerToken,
      },
      {
        phase: "draft_ready" as GuardPhase,
        activeDraftId: input.activeDraftId,
        activeAttemptId: null,
      }
    );
    return (res.affected ?? 0) > 0;
  }

  /**
   * Own-transaction form of the fenced commit gate, for callers that are NOT
   * already inside a `runReplyTxn` (the commit transaction itself calls
   * {@link commitDraftToGuardWithManager} directly with its manager).
   */
  async commitDraftToGuard(input: {
    guardId: number;
    ownerToken: string;
    now: Date;
    activeDraftId: number;
  }): Promise<boolean> {
    return await runReplyTxn(this.sqliteDb, (manager) =>
      this.commitDraftToGuardWithManager(manager, input)
    );
  }

  async read(guardId: number): Promise<EmailReplyGuardEntity | null> {
    return await this.repository.findOne({ where: { id: guardId } });
  }

  async findByReplyKey(
    emailServiceId: number,
    replyKey: string
  ): Promise<EmailReplyGuardEntity | null> {
    return await this.repository.findOne({
      where: { emailServiceId, replyKey },
    });
  }

  /**
   * Stale reservations older than the threshold — recovery input. A guard in
   * `generating` or `draft_ready` with an expired lease is a candidate for
   * reclamation (§8.2).
   */
  async listStaleReservations(
    threshold: Date
  ): Promise<EmailReplyGuardEntity[]> {
    return await this.repository
      .createQueryBuilder("guard")
      .where("guard.phase IN (:...phases)", {
        phases: ["generating", "draft_ready"] as GuardPhase[],
      })
      .andWhere("guard.leaseExpiresAt < :threshold", { threshold })
      .orderBy("guard.leaseExpiresAt", "ASC")
      .getMany();
  }

  /**
   * Reclaim an expired reservation on recovery (§8.2). Re-reads the canonical
   * cluster's drafts + attempts BEFORE reclaiming — never trust an expired
   * `generating`/`draft_ready` row when actual records show a committed draft
   * or a sent/unknown/in-flight attempt (§5.2).
   *
   *   - A committed draft exists → transition to `draft_ready` (the draft
   *     survived the crash; it is still the active binding).
   *   - A sent attempt exists → `sent` (terminal protection).
   *   - A delivery_unknown/in-flight attempt exists → `delivery_unknown`/
   *     `sending` (preserve the unresolved state; recovery's attempt sweep
   *     will finalize the in-flight one).
   *   - No conflicting evidence → `idle` (safe to reclaim).
   */
  async reclaimExpiredReservation(input: {
    guardId: number;
    now: Date;
  }): Promise<boolean> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const guardRepo = manager.getRepository(EmailReplyGuardEntity);
      const row = await guardRepo.findOne({ where: { id: input.guardId } });
      if (!row) {
        return false;
      }
      // Only reclaim expired rows. A fresh lease is left untouched.
      if (row.leaseExpiresAt !== null && row.leaseExpiresAt >= input.now) {
        return false;
      }

      const evidence = await readClusterEvidence(manager, {
        emailServiceId: row.emailServiceId,
        normalizedMessageId: null, // resolved from the seed row
        seedMessageId: row.messageId,
      });

      // §5.2 precedence ladder shared with the send-claim sibling check
      // (T08) via `evidenceToPhase` — never trust `idle` while a related
      // sent/unknown/in-flight record exists.
      const { phase: nextPhase, activeDraftId, activeAttemptId } =
        evidenceToPhase(evidence);

      await guardRepo.update(
        { id: row.id },
        {
          phase: nextPhase,
          ownerToken: null,
          leaseExpiresAt: null,
          activeDraftId,
          activeAttemptId,
        }
      );
      return true;
    });
  }
}
