import { BaseDb } from "@/model/Basedb";
import { SqliteDb } from "@/config/SqliteDb";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailAuditLogModel } from "@/model/OutboundEmailAuditLog.model";
import { OutboundEmailAuditLogEntity } from "@/entity/OutboundEmailAuditLog.entity";
import { OutboundEmailRecoveryService } from "@/service/outboundEmail/OutboundEmailRecoveryService";
import { incrementOutboundMetric } from "@/service/outboundEmail/OutboundEmailMetrics";
import type {
  AuthorizedEmailWorkerEvent,
  AuthorizedEmailWorkerEventSubmitted,
  AuthorizedEmailWorkerEventFailed,
  AuthorizedEmailWorkerEventComplete,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Worker-event bridge for the intent-aware outbound-email pipeline (technical
 * design §15.4, §16.4). The starter forks a `utilityProcess` that runs
 * `sendAuthorizedEmails`; the worker posts typed events back over its
 * MessagePort. This bridge is the trusted main-process side that correlates
 * each event to a persisted outcome BEFORE mutating it, persists the outcome,
 * recomputes batch status on completion, broadcasts progress to the renderer,
 * and audits asymmetric events it cannot correlate.
 *
 * §15.4 correlation: an event is accepted only when batchId + sendAttemptId +
 * draftId + revisionId + envelopeHash ALL match an active attempt/outcome. A
 * mismatch is audited as `worker_event_correlation_failed` and the event is
 * dropped — never applied to the wrong outcome.
 *
 * The bridge performs no SMTP and makes no authorization decisions. It is
 * main-process only and delegates persistence to the delivery/draft/audit
 * models (never a repository directly).
 */

/** Optional broadcast sink (defaults to the IPC broadcaster). Injected for tests. */
export interface OutboundEmailWorkerEventBridgeOptions {
  readonly dbpath?: string;
  /**
   * Receives every event the bridge accepts (and the complete event). In
   * production this is {@link broadcastOutboundEmailProgress}; tests pass a
   * spy. Must never throw.
   */
  readonly onBroadcast?: (event: AuthorizedEmailWorkerEvent) => void;
}

export class OutboundEmailWorkerEventBridge extends BaseDb {
  private readonly deliveryModel: OutboundEmailDeliveryModel;
  private readonly auditModel: OutboundEmailAuditLogModel;
  private readonly recoveryService: OutboundEmailRecoveryService;
  private readonly onBroadcast: (event: AuthorizedEmailWorkerEvent) => void;

  constructor(
    options: OutboundEmailWorkerEventBridgeOptions | string = {},
    legacyOptions?: OutboundEmailWorkerEventBridgeOptions
  ) {
    // Accept either a dbpath string (production wiring passes a path) or an
    // options object (tests pass overrides). Tolerate either positional form —
    // mirrors OutboundEmailDeliveryService's constructor contract so callers can
    // use `new Bridge(tmpDir, { onBroadcast })`.
    const opts: OutboundEmailWorkerEventBridgeOptions =
      typeof options === "string"
        ? { dbpath: options, ...legacyOptions }
        : options;
    const dbpath = opts.dbpath ?? "";
    // Pass the real dbpath to BaseDb so SqliteDb.getInstance targets the
    // correct path in ONE call (no empty-string bounce that would fire-and-
    // forget destroy() on the shared singleton and close the live connection).
    super(dbpath);
    this.deliveryModel = new OutboundEmailDeliveryModel(dbpath);
    this.auditModel = new OutboundEmailAuditLogModel(dbpath);
    this.recoveryService = new OutboundEmailRecoveryService(dbpath);
    this.sqliteDb = SqliteDb.getInstance(dbpath);
    this.onBroadcast =
      opts.onBroadcast ??
      (() => {
        // Default no-op in the service layer. The production wiring in
        // outboundEmailDelivery-ipc.ts supplies broadcastOutboundEmailProgress;
        // tests supply a spy. Keeping the default inert avoids importing
        // Electron's BrowserWindow into the service layer.
      });
  }

  /**
   * Handle one typed worker event. Correlates, persists, broadcasts, and on
   * `worker-complete` marks the attempt terminal + recomputes the batch. Never
   * throws — a correlation failure is audited and dropped.
   */
  async handleEvent(event: AuthorizedEmailWorkerEvent): Promise<void> {
    try {
      await this.ensureConnection();
      switch (event.type) {
        case "authorized-email-submitted":
          await this.handleSubmitted(event);
          break;
        case "authorized-email-failed":
          await this.handleFailed(event);
          break;
        case "authorized-email-worker-complete":
          await this.handleComplete(event);
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[outbound-email-bridge] failed to handle event ${event.type}: ${message}`
      );
      incrementOutboundMetric("worker_event_handler_error", {
        event_type: event.type,
      });
    }
  }

  /**
   * §15.4 — a submitted event flips the outcome to `submitted` with the
   * provider message id. The envelope is now in-flight at the provider.
   */
  private async handleSubmitted(
    event: AuthorizedEmailWorkerEventSubmitted
  ): Promise<void> {
    const outcome = await this.deliveryModel.findOutcomeByAttemptAndDraft(
      event.sendAttemptId,
      event.draftId
    );
    if (!this.correlates(outcome, event)) {
      await this.auditCorrelationFailure(event);
      return;
    }
    await this.deliveryModel.updateOutcomeStatus(outcome!.id, "submitted", {
      providerMessageId: event.providerMessageId,
      submittedAt: new Date(),
    });
    this.onBroadcast(event);
    incrementOutboundMetric("worker_event_submitted");
  }

  /**
   * §15.4 + FR-019 — a failed event is classified by retrySafety: `safe`
   * (definitive pre-acceptance rejection) ⇒ `failed`; `unknown` (ambiguous
   * network-class failure, may have been accepted) ⇒ `delivery_unknown`, which
   * is NEVER auto-retried.
   */
  private async handleFailed(
    event: AuthorizedEmailWorkerEventFailed
  ): Promise<void> {
    const outcome = await this.deliveryModel.findOutcomeByAttemptAndDraft(
      event.sendAttemptId,
      event.draftId
    );
    if (!this.correlates(outcome, event)) {
      await this.auditCorrelationFailure(event);
      return;
    }
    const nextStatus =
      event.retrySafety === "safe" ? "failed" : "delivery_unknown";
    await this.deliveryModel.updateOutcomeStatus(outcome!.id, nextStatus, {
      errorCode: event.errorCode,
      completedAt: new Date(),
    });
    this.onBroadcast(event);
    incrementOutboundMetric("worker_event_failed", {
      retry_safety: event.retrySafety,
    });
  }

  /**
   * §16.4 — the worker finished the batch. Mark the attempt terminal (the
   * outcomes are the source of truth for per-recipient state) and recompute
   * the batch status from outcomes.
   */
  private async handleComplete(
    event: AuthorizedEmailWorkerEventComplete
  ): Promise<void> {
    const attempt = await this.deliveryModel.readAttempt(event.sendAttemptId);
    if (!attempt || attempt.batchId !== event.batchId) {
      // Unknown or mismatched attempt — audit and drop. Never throw.
      await this.auditModel.create(
        Object.assign(new OutboundEmailAuditLogEntity(), {
          actorType: "system",
          eventCode: "worker_event_correlation_failed",
          batchId: event.batchId,
          sendAttemptId: event.sendAttemptId,
          metadataJson: JSON.stringify({
            reason: "complete_event_unknown_attempt",
          }),
        })
      );
      return;
    }
    await this.deliveryModel.updateAttemptStatus(
      event.sendAttemptId,
      "completed",
      { completedAt: new Date() }
    );
    // §8.3 recipient lifecycle — `submitted -> sent`. A normal, clean worker
    // completion means every envelope accepted so far was submitted to (and
    // accepted by) SMTP; in this local-delivery model with no provider DSNs,
    // that acceptance is the confirmation point. Flip still-`submitted`
    // outcomes to `sent` (conditional on status, so it never revives an
    // outcome recovery already downgraded to `delivery_unknown`/`failed`).
    const completedAt = new Date();
    await this.deliveryModel.markAttemptOutcomesSent(
      event.sendAttemptId,
      completedAt
    );
    await this.auditModel.create(
      Object.assign(new OutboundEmailAuditLogEntity(), {
        actorType: "system",
        eventCode: "recipient_sent",
        batchId: event.batchId,
        sendAttemptId: event.sendAttemptId,
        metadataJson: JSON.stringify({
          completedAt: completedAt.toISOString(),
        }),
      })
    );
    // Recompute the batch from its outcomes (§21 rule 4). If every outcome is
    // terminal, the batch moves to sent/failed/delivery_unknown/partially_sent;
    // if any are still in-flight, the batch stays non-terminal.
    await this.recoveryService.recomputeBatchStatus(event.batchId);
    this.onBroadcast(event);
    incrementOutboundMetric("worker_event_complete");
  }

  /**
   * §15.4 five-field correlation. The outcome must exist and its
   * sendAttemptId/draftId/revisionId/envelopeHash must all match the event,
   * AND the event's batchId must match the attempt's batch (defence-in-depth).
   */
  private correlates(
    outcome: Awaited<
      ReturnType<OutboundEmailDeliveryModel["findOutcomeByAttemptAndDraft"]>
    >,
    event:
      | AuthorizedEmailWorkerEventSubmitted
      | AuthorizedEmailWorkerEventFailed
  ): outcome is NonNullable<typeof outcome> {
    if (!outcome) return false;
    if (outcome.batchId !== event.batchId) return false;
    if (outcome.sendAttemptId !== event.sendAttemptId) return false;
    if (outcome.draftId !== event.draftId) return false;
    if (outcome.revisionId !== event.revisionId) return false;
    if (outcome.envelopeHash !== event.envelopeHash) return false;
    return true;
  }

  /** Audit a §15.4 correlation failure without mutating any outcome. */
  private async auditCorrelationFailure(
    event:
      | AuthorizedEmailWorkerEventSubmitted
      | AuthorizedEmailWorkerEventFailed
  ): Promise<void> {
    await this.auditModel.create(
      Object.assign(new OutboundEmailAuditLogEntity(), {
        actorType: "system",
        eventCode: "worker_event_correlation_failed",
        batchId: event.batchId,
        sendAttemptId: event.sendAttemptId,
        draftId: event.draftId,
        revisionId: event.revisionId,
        metadataJson: JSON.stringify({
          reason: "five_field_mismatch",
          eventEnvelopeHash: event.envelopeHash,
        }),
      })
    );
    incrementOutboundMetric("worker_event_correlation_failed");
  }
}
