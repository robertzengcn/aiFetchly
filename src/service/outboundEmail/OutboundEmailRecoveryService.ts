import { EntityManager } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { SqliteDb } from "@/config/SqliteDb";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailAuditLogModel } from "@/model/OutboundEmailAuditLog.model";
import { OutboundEmailAuditLogEntity } from "@/entity/OutboundEmailAuditLog.entity";
import type { OutboundEmailRecipientOutcomeStatus } from "@/entityTypes/outboundEmailDeliveryTypes";
import { OUTBOUND_SEND_RECOVERY_THRESHOLD_MS } from "@/service/outboundEmail/outboundReliabilityVersions";

/**
 * Startup + interval reconciliation for the outbound-email delivery pipeline
 * (technical design §21). Runs only in the main process and applies six rules:
 *
 *  1. Expire active authorizations past `expiresAt`.
 *  2. `claimed` attempts whose worker never started (null `workerStartedAt`)
 *     past the threshold are marked failed — definite pre-acceptance rejection.
 *  3. `sending` attempts with a dead worker and pending/submitted outcomes mark
 *     the uncertain recipients `delivery_unknown` — NEVER failed, NEVER auto-
 *     retried (FR-019).
 *  4. Batch status is recomputed from recipient outcomes.
 *  5. Recovery never creates a new send attempt.
 *  6. Every transition is audited.
 *
 * SMTP is outside SQLite and unreliable; after possible acceptance we can never
 * prove non-delivery, so any in-flight attempt with a dead worker resolves to
 * `delivery_unknown` until a human or provider API says otherwise.
 */
export class OutboundEmailRecoveryService extends BaseDb {
  private readonly draftModel: OutboundEmailDraftModel;
  private readonly authorizationModel: OutboundEmailAuthorizationModel;
  private readonly deliveryModel: OutboundEmailDeliveryModel;
  private readonly auditModel: OutboundEmailAuditLogModel;

  constructor(dbpath = "") {
    super(dbpath);
    this.draftModel = new OutboundEmailDraftModel(dbpath);
    this.authorizationModel = new OutboundEmailAuthorizationModel(dbpath);
    this.deliveryModel = new OutboundEmailDeliveryModel(dbpath);
    this.auditModel = new OutboundEmailAuditLogModel(dbpath);
    this.sqliteDb = SqliteDb.getInstance(dbpath);
  }

  /** §21 one-shot sweep. Returns counts for observability; never throws. */
  async recover(options?: {
    thresholdMs?: number;
  }): Promise<{ authorizationsExpired: number; attemptsRecovered: number }> {
    await this.ensureConnection();
    const thresholdMs =
      options?.thresholdMs ?? OUTBOUND_SEND_RECOVERY_THRESHOLD_MS;
    const cutoff = new Date(Date.now() - thresholdMs);

    const authorizationsExpired = await this.expireAuthorizations();
    const attemptsRecovered = await this.recoverStaleAttempts(cutoff);
    return { authorizationsExpired, attemptsRecovered };
  }

  /** §21 rule 1 — expire active authorizations past their TTL. */
  private async expireAuthorizations(): Promise<number> {
    const now = new Date();
    const expired = await this.authorizationModel.listExpiredActive(now);
    let count = 0;
    for (const authorization of expired) {
      await this.authorizationModel.expire(authorization.id);
      await this.audit(
        {
          eventCode: "authorization_expired",
          batchId: authorization.batchId,
          authorizationId: authorization.id,
        },
        { expiresAt: authorization.expiresAt.toISOString() }
      );
      count += 1;
    }
    return count;
  }

  /**
   * §21 rules 2–3 — conservative stale-attempt recovery. `claimed` + no
   * `workerStartedAt` ⇒ the worker provably never started ⇒ failed. `sending`
   * (worker was alive at start but is now dead) ⇒ uncertain recipients become
   * `delivery_unknown`. Never inserts a new attempt (rule 5).
   */
  private async recoverStaleAttempts(cutoff: Date): Promise<number> {
    const stale = await this.deliveryModel.listStaleInFlight(cutoff);
    let recovered = 0;
    for (const attempt of stale) {
      const workerStarted = attempt.workerStartedAt != null;
      await this.sqliteDb.connection.transaction(async (manager) => {
        if (!workerStarted) {
          await this.recoverNeverStarted(attempt.id, attempt.batchId, manager);
        } else {
          await this.recoverDeadWorker(attempt.id, attempt.batchId, manager);
        }
      });
      recovered += 1;
    }
    return recovered;
  }

  /** §21 rule 2 — worker provably never started ⇒ definite failure. */
  private async recoverNeverStarted(
    attemptId: number,
    batchId: number,
    manager: EntityManager
  ): Promise<void> {
    const now = new Date();
    await this.deliveryModel.updateAttemptStatus(
      attemptId,
      "failed",
      { lastErrorCode: "worker_never_started", completedAt: now },
      manager
    );
    const outcomes = await this.deliveryModel.listOutcomesByAttempt(attemptId);
    for (const outcome of outcomes) {
      if (outcome.status === "pending") {
        await this.deliveryModel.updateOutcomeStatus(
          outcome.id,
          "failed",
          { errorCode: "worker_never_started", completedAt: now },
          manager
        );
      }
    }
    await this.draftModel.updateBatchStatus(
      batchId,
      "failed",
      { lastErrorCode: "worker_never_started", completedAt: now },
      manager
    );
    await this.audit(
      {
        eventCode: "recovery_attempt_failed",
        batchId,
        sendAttemptId: attemptId,
      },
      { lastErrorCode: "worker_never_started" }
    );
  }

  /** §21 rule 3 — dead worker + uncertain recipients ⇒ `delivery_unknown`. */
  private async recoverDeadWorker(
    attemptId: number,
    batchId: number,
    manager: EntityManager
  ): Promise<void> {
    const now = new Date();
    await this.deliveryModel.updateAttemptStatus(
      attemptId,
      "delivery_unknown",
      { lastErrorCode: "recovery_timeout", completedAt: now },
      manager
    );
    const outcomes = await this.deliveryModel.listOutcomesByAttempt(attemptId);
    for (const outcome of outcomes) {
      if (outcome.status === "pending" || outcome.status === "submitted") {
        await this.deliveryModel.updateOutcomeStatus(
          outcome.id,
          "delivery_unknown",
          { completedAt: now },
          manager
        );
      }
    }
    await this.draftModel.updateBatchStatus(
      batchId,
      "delivery_unknown",
      { lastErrorCode: "recovery_timeout", completedAt: now },
      manager
    );
    await this.audit(
      {
        eventCode: "recovery_delivery_unknown",
        batchId,
        sendAttemptId: attemptId,
      },
      { lastErrorCode: "recovery_timeout" }
    );
  }

  /**
   * §21 rule 4 — recompute a batch's status from its recipient outcomes. The
   * outcomes are the source of truth for delivery state; a stale attempt status
   * (e.g. `sending` after a crash) must not keep the batch in a non-terminal
   * state once the outcomes are resolved.
   */
  async recomputeBatchStatus(batchId: number): Promise<void> {
    await this.ensureConnection();
    const outcomes = await this.deliveryModel.listOutcomesByBatch(batchId);
    const batch = await this.draftModel.readBatch(batchId);
    if (!batch) return;

    const statuses = outcomes.map((o) => o.status);
    const terminal = statuses.filter(
      (
        s
      ): s is Exclude<
        OutboundEmailRecipientOutcomeStatus,
        "pending" | "submitted"
      > => s !== "pending" && s !== "submitted"
    );
    // No outcomes yet ⇒ nothing to recompute.
    if (statuses.length === 0) return;
    // Any still in-flight ⇒ batch not terminal.
    if (terminal.length < statuses.length) return;

    let nextStatus = batch.status;
    if (terminal.every((s) => s === "sent")) {
      nextStatus = "sent";
    } else if (terminal.some((s) => s === "delivery_unknown")) {
      nextStatus = "delivery_unknown";
    } else if (terminal.every((s) => s === "failed" || s === "suppressed")) {
      nextStatus = "failed";
    } else {
      nextStatus = "partially_sent";
    }

    if (nextStatus !== batch.status) {
      await this.draftModel.updateBatchStatus(batchId, nextStatus);
    }
  }

  /** §21 rule 6 — append an audit event for a recovery transition. */
  private async audit(
    fields: {
      eventCode: string;
      batchId?: number | null;
      sendAttemptId?: number | null;
      authorizationId?: number | null;
    },
    metadata: Record<string, string>
  ): Promise<void> {
    await this.auditModel.create(
      Object.assign(new OutboundEmailAuditLogEntity(), {
        actorType: "system",
        eventCode: fields.eventCode,
        batchId: fields.batchId ?? null,
        sendAttemptId: fields.sendAttemptId ?? null,
        authorizationId: fields.authorizationId ?? null,
        metadataJson: JSON.stringify(metadata),
      })
    );
  }
}
