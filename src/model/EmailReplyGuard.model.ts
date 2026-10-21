import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";
import { runReplyTxn } from "@/model/replyTxn";
import {
  readClusterEvidence,
  evidenceToPhase,
  classifyClusterEligibility,
  type ClusterEligibilityReason,
} from "@/model/replyClusterEvidence";
import { pickReusableDraft } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import type {
  GuardPhase,
  EmailReplyPolicyCode,
} from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Map a {@link ClusterEligibilityReason} to its surface policy code. The four
 * non-eligible reasons are valid `EmailReplyPolicyCode` literals, but TypeScript
 * does not narrow the union automatically (the values overlap); the exhaustive
 * ternary keeps the mapping 1:1 and forces a compile error here if a fifth
 * reason is ever added without updating the call sites.
 */
function eligibilityReasonToCode(reason: ClusterEligibilityReason): EmailReplyPolicyCode {
  return reason === "already_replied" ? "already_replied"
    : reason === "delivery_unknown" ? "delivery_unknown"
    : reason === "reply_in_progress" ? "reply_in_progress"
    : "reply_state_conflict";
}

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
  | { readonly status: "blocked"; readonly code: EmailReplyPolicyCode }
  /**
   * F04: the caller's invocation budget elapsed before the lease could be
   * claimed — no row was written and no live owner was created. A detached
   * loser (its `raceWithDeadline` already rejected) discards this; a
   * synchronous caller converts it to a deadline failure, never a draft.
   */
  | { readonly status: "expired" };

/**
 * Result of re-validating a previously-identified reusable draft (R15).
 * The reservation's `reusable` verdict is a point-in-time snapshot; between
 * it and the reuse return, awaited detection/audit work opens a window in
 * which another request can claim or finalize the draft. Revalidation
 * re-reads the draft row and the cluster evidence in ONE short transaction
 * so the reuse decision is coherent:
 *
 *   - `eligible` — the draft still exists and the cluster is still clean;
 *     `draft` is the FRESH row (never the earlier read's snapshot).
 *   - `blocked` — the cluster has moved to a state that forbids reuse
 *     (already_replied / delivery_unknown / reply_in_progress /
 *     reply_state_conflict); `code` is the typed surface code.
 *   - `missing` — the draft row vanished (deleted/discarded between the
 *     original read and revalidation); the caller refuses with
 *     `reply_state_unknown`.
 */
export type RevalidatedReusableDraft =
  | { readonly status: "eligible"; readonly draft: EmailReplyDraftEntity }
  | { readonly status: "blocked"; readonly code: EmailReplyPolicyCode }
  | { readonly status: "missing" };

/** Input for {@link EmailReplyGuardModel.revalidateReusableDraft}. */
export interface RevalidateReusableDraftInput {
  readonly draftId: number;
  readonly emailServiceId: number;
  readonly messageId: number;
  /** The seed row's normalized RFC id, used to resolve the canonical cluster. */
  readonly normalizedMessageId: string | null;
}

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
  /**
   * F04: absolute invocation expiry (the caller's aggregate deadline end).
   * The acquire refuses with `expired` — writing nothing — once this passes,
   * checked at transaction entry and again immediately before the mutation
   * phase, so a request that waited out its budget in the write queue can
   * never become a live owner. The granted lease is additionally clamped to
   * this instant, so even a commit landing exactly on the boundary expires
   * with the invocation instead of outliving it. Absent = no owner deadline
   * (recovery paths); lease applies as given.
   */
  readonly ownerExpiresAt?: Date;
}

/**
 * Detect a unique-constraint collision from a failed guard INSERT.
 *
 * better-sqlite3 surfaces SQLite `SQLITE_CONSTRAINT` violations as an `Error`
 * whose message begins `UNIQUE constraint failed: ...`. TypeORM may wrap it in
 * a `QueryFailedError` carrying the same message and a `code` field. We match
 * the project's established convention (`EmailServiceTagRelation.model.ts`):
 * message-regex on `Error` instances. This is the ONLY insert error class for
 * which the conditional-acquire recovery path is safe — every other failure
 * (disk full, DB-locked, connection, schema) must propagate.
 */
function isUniqueConstraintInsertError(error: unknown): boolean {
  return error instanceof Error && /unique constraint/i.test(error.message);
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
      // F04 checkpoint 1: fail fast when the owner's budget already elapsed
      // in the write queue — before any evidence work or mutation.
      if (
        input.ownerExpiresAt !== undefined &&
        input.ownerExpiresAt !== null &&
        input.now.getTime() >= input.ownerExpiresAt.getTime()
      ) {
        return { status: "expired" };
      }
      const evidence = await readClusterEvidence(manager, {
        emailServiceId: input.emailServiceId,
        normalizedMessageId: input.normalizedMessageId,
        seedMessageId: input.messageId,
      });

      // R03: the canonical eligibility contract — ONE precedence ladder shared
      // by acquire, commit (R01), and claim (R02). The acquire layer previously
      // inspected `replyStatus === "sent"` (seed-only) and cluster-wide draft/
      // attempt arrays but NOT `clusterReplyDetectedAt` or
      // `clusterHasRowLevelSent`, so a sibling sticky positive or sibling
      // row-level `replyStatus=sent` passed acquire and was only caught by
      // R01's commit-time backstop. Routing both gates through the same helper
      // closes the hole at the source (and is a no-op for the cases the old
      // ladder already caught). `actingDraftId = null` because acquire has no
      // draft yet.
      const eligibility = classifyClusterEligibility(evidence, null);
      if (eligibility.reason !== "eligible") {
        return {
          status: "blocked",
          code: eligibilityReasonToCode(eligibility.reason),
        };
      }

      // An eligible draft already exists (draft/approved preferred, then a
      // definitely-failed draft per B08) — the caller reuses it by ID with
      // no model work, mirroring the orchestrator's `pickReusableDraft`
      // (stage 2c). Only reached when the cluster is otherwise clean.
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

      // F04 checkpoint 2: the evidence read + row lookup above are awaits —
      // the owner's budget may have elapsed while queued/reading. Re-check
      // against TRUE wall time here (input.now is stale by construction once
      // we waited): an expired owner must not mutate, even though the
      // cluster verdict above may be reusable/blocked. No writes have
      // happened yet, so refusing here creates no live owner and disturbs
      // no guard row.
      const ownerExpired =
        input.ownerExpiresAt !== undefined &&
        input.ownerExpiresAt !== null &&
        Date.now() >= input.ownerExpiresAt.getTime();
      if (ownerExpired) {
        return { status: "expired" };
      }
      // F04 lease clamp: a granted lease never outlives the owner's
      // invocation budget. A commit landing exactly on the expiry boundary
      // (after checkpoint 2, before the write lands) still expires with the
      // invocation instead of stranding a five-minute live lease with no
      // owner to release it — the next retry reclaims immediately.
      const effectiveLeaseExpiresAt =
        input.ownerExpiresAt !== undefined &&
        input.ownerExpiresAt !== null &&
        input.leaseExpiresAt.getTime() > input.ownerExpiresAt.getTime()
          ? input.ownerExpiresAt
          : input.leaseExpiresAt;

      if (!existing) {
        const guard = new EmailReplyGuardEntity();
        guard.emailServiceId = input.emailServiceId;
        guard.replyKey = input.replyKey;
        guard.messageId = input.messageId;
        guard.phase = "generating";
        guard.ownerToken = input.ownerToken;
        guard.leaseExpiresAt = effectiveLeaseExpiresAt;
        guard.activeDraftId = null;
        guard.activeAttemptId = null;
        try {
          const saved = await manager.getRepository(EmailReplyGuardEntity).save(guard);
          return { status: "acquired", guardId: saved.id };
        } catch (error) {
          // Only a unique-constraint collision is recoverable here (a
          // concurrent invoker inserted first → reread and fall through to
          // the existing-row path below). Any OTHER insert failure — disk
          // full, DB-locked, connection error, schema mismatch — must
          // propagate so the caller surfaces the real failure; swallowing it
          // would mask a persistent DB error as a transient "another owner is
          // generating" retry signal (review R-2, adversarial conf 7.0).
          if (!isUniqueConstraintInsertError(error)) {
            throw error;
          }
          console.error(
            "EmailReplyGuard conditional-acquire insert collided (unique constraint); rereading:",
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
        // Re-entrant acquire by the same owner — extend the lease (F04:
        // clamped to the owner expiry, never beyond the invocation).
        const renewed = await manager
          .getRepository(EmailReplyGuardEntity)
          .update(
            { id: row.id, ownerToken: input.ownerToken },
            { phase: "generating", leaseExpiresAt: effectiveLeaseExpiresAt, messageId: input.messageId }
          );
        if ((renewed.affected ?? 0) > 0) {
          return { status: "acquired", guardId: row.id };
        }
        return { status: "generation_in_progress" };
      }

      if (isIdle || leaseExpired) {
        // Reclaim an idle or expired row. Fenced by phase/lease so a
        // concurrent reclaim by a different owner yields 0 rows. F04: the
        // claimed lease is clamped to the owner expiry.
        const reclaimed = await manager
          .getRepository(EmailReplyGuardEntity)
          .update(
            {
              id: row.id,
            },
            {
              phase: "generating" as GuardPhase,
              ownerToken: input.ownerToken,
              leaseExpiresAt: effectiveLeaseExpiresAt,
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
   * Re-validate a reusable draft at the moment of reuse (R15). The
   * reservation's `reusable` verdict is read at acquire time; the generation
   * service then awaits mailbox detection and reuse-audit persistence before
   * returning the draft. In that window another request can transition the
   * draft (sending/sent/delivery_unknown) or claim it with an in-flight send
   * attempt — returning the stale snapshot would hand back a draft that is
   * no longer eligible as if it were editable.
   *
   * One short `runReplyTxn` re-reads BOTH the draft row and the canonical
   * cluster evidence, so the reuse decision is made against a coherent
   * state: draft + evidence cannot disagree mid-transaction (the shared
   * mutex serializes against every draft/attempt mutation).
   *
   * `actingDraftId = null` in the classification: the reused draft's OWN
   * sending/in-flight state must DENY reuse (passing its own id would
   * exclude exactly the "another request claimed it" scenario we are
   * guarding against — the mirror image of acquire, where the caller owns
   * nothing yet).
   */
  async revalidateReusableDraft(
    input: RevalidateReusableDraftInput
  ): Promise<RevalidatedReusableDraft> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draft = await manager
        .getRepository(EmailReplyDraftEntity)
        .findOne({ where: { id: input.draftId } });
      if (!draft) {
        return { status: "missing" };
      }

      const evidence = await readClusterEvidence(manager, {
        emailServiceId: input.emailServiceId,
        normalizedMessageId: input.normalizedMessageId,
        seedMessageId: input.messageId,
      });
      const eligibility = classifyClusterEligibility(evidence, null);
      if (eligibility.reason !== "eligible") {
        return {
          status: "blocked",
          code: eligibilityReasonToCode(eligibility.reason),
        };
      }

      return { status: "eligible", draft };
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
