import { EntityManager } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { SqliteDb } from "@/config/SqliteDb";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailAuditLogModel } from "@/model/OutboundEmailAuditLog.model";
import { OutboundEmailAuditLogEntity } from "@/entity/OutboundEmailAuditLog.entity";
import { OutboundEmailSendAttemptEntity } from "@/entity/OutboundEmailSendAttempt.entity";
import { OutboundEmailDeliveryOutcomeEntity } from "@/entity/OutboundEmailDeliveryOutcome.entity";
import { OutboundEmailAuthorizationEntity } from "@/entity/OutboundEmailAuthorization.entity";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import { OutboundEmailDraftRevisionEntity } from "@/entity/OutboundEmailDraftRevision.entity";
import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { BatchEnvelopeEntry } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";

/**
 * Authoritative delivery service for the intent-aware outbound-email pipeline
 * (technical design §15). This is where trusted application code authorizes a
 * send: it runs the §15.1 claim transaction that consumes a one-time
 * authorization, inserts an idempotent send attempt + pending outcomes, and
 * only THEN asks a narrow adapter to start the worker. SMTP never occurs inside
 * a database transaction (FR-018).
 *
 * The service is main-process only. It owns no SMTP logic — the injected
 * `workerStarter` builds the versioned payload and spawns the utility process.
 * One authorization produces at most one attempt (AD-009); the unique
 * idempotency key deduplicates concurrent or retried claims.
 */

/** §7.6 idempotency key format. */
function buildIdempotencyKey(
  batchId: number,
  authorizationId: number,
  batchHash: string
): string {
  return `outbound-email:v1:${batchId}:${authorizationId}:${batchHash}`;
}

/** Current preflight policy/validation versions the claim enforces (§15.1.7). */
const POLICY_VERSION = "outbound-policy-v1";
const VALIDATION_VERSION = "outbound-validation-v1";

export interface ClaimInput {
  readonly batchId: number;
  readonly authorizationId: number;
  readonly batchHash: string;
}

export type ClaimResult =
  | { status: "claimed"; attemptId: number }
  | { status: "already_processed"; attemptId: number }
  | { status: "worker_start_failed"; attemptId: number };

export interface WorkerStartResult {
  readonly started: boolean;
}

export interface OutboundEmailDeliveryServiceOptions {
  readonly dbpath?: string;
  /**
   * Builds the versioned payload and starts the worker. Injected so tests can
   * substitute a fake. Throwing indicates a definite pre-acceptance failure.
   */
  readonly workerStarter?: (
    attemptId: number,
    batch: OutboundEmailDraftBatchEntity,
    drafts: ReadonlyArray<{
      draft: OutboundEmailDraftEntity;
      revision: OutboundEmailDraftRevisionEntity;
    }>,
    authorization: OutboundEmailAuthorizationEntity
  ) => Promise<WorkerStartResult>;
}

export class OutboundEmailDeliveryService extends BaseDb {
  private readonly draftModel: OutboundEmailDraftModel;
  private readonly authorizationModel: OutboundEmailAuthorizationModel;
  private readonly deliveryModel: OutboundEmailDeliveryModel;
  private readonly auditModel: OutboundEmailAuditLogModel;
  private readonly workerStarter: NonNullable<
    OutboundEmailDeliveryServiceOptions["workerStarter"]
  >;

  constructor(
    options: OutboundEmailDeliveryServiceOptions | string = {},
    legacyOptions?: OutboundEmailDeliveryServiceOptions
  ) {
    super("");
    // Accept either a dbpath string (production wiring passes a path) or an
    // options object (tests pass overrides). Tolerate either positional form.
    const opts: OutboundEmailDeliveryServiceOptions =
      typeof options === "string"
        ? { dbpath: options, ...legacyOptions }
        : options;
    // Re-initialize models with the requested dbpath. BaseDb("") would fall
    // back to the test temp dir; respect an explicit path instead.
    this.draftModel = new OutboundEmailDraftModel(opts.dbpath ?? "");
    this.authorizationModel = new OutboundEmailAuthorizationModel(
      opts.dbpath ?? ""
    );
    this.deliveryModel = new OutboundEmailDeliveryModel(opts.dbpath ?? "");
    this.auditModel = new OutboundEmailAuditLogModel(opts.dbpath ?? "");
    this.workerStarter =
      opts.workerStarter ??
      (async () => {
        // Production default wires the real worker; left as a placeholder so the
        // service is constructible in isolation. The IPC layer injects the real
        // adapter when wiring the full pipeline.
        throw new Error(
          "[outbound-email-delivery] No workerStarter configured"
        );
      });
    // Re-establish the sqliteDb handle so ensureConnection() and the
    // transaction API target the correct (explicit) database path. BaseDb("")
    // fell back to the test temp dir; rebind to the dbpath instance the models
    // share via the shared singleton. `sqliteDb` is protected on BaseDb,
    // accessible from this subclass.
    this.sqliteDb = SqliteDb.getInstance(opts.dbpath ?? "");
  }

  /**
   * §15.1 claim transaction + §15.2 worker prep. Returns `already_processed`
   * for a duplicate idempotency key without starting a second worker.
   * `worker_start_failed` is returned (not thrown) when the worker definitely
   * fails before accepting the payload; the attempt + batch are marked failed.
   */
  async claim(input: ClaimInput): Promise<ClaimResult> {
    await this.ensureConnection();

    const idempotencyKey = buildIdempotencyKey(
      input.batchId,
      input.authorizationId,
      input.batchHash
    );

    // §15.1 step 1 (partial) — check for a duplicate before the transaction.
    const existing = await this.deliveryModel.findAttemptByIdempotencyKey(
      idempotencyKey
    );
    if (existing) {
      return { status: "already_processed", attemptId: existing.id };
    }

    // §15.1 steps 1–11 in one transaction.
    const claimed = await this.sqliteDb.connection.transaction(
      async (manager: EntityManager) => {
        // Step 1 — load batch, authorization.
        const batch = await this.draftModel.readBatch(input.batchId, manager);
        if (!batch) {
          throw new Error(
            `batch_not_found: batch ${input.batchId} does not exist`
          );
        }
        const authorization = await this.authorizationModel.read(
          input.authorizationId
        );
        if (!authorization) {
          throw new Error(
            `authorization_not_found: authorization ${input.authorizationId} does not exist`
          );
        }

        // Step 2 — ownership: the authorization must bind this batch.
        if (authorization.batchId !== input.batchId) {
          throw new Error(
            "authorization_batch_mismatch: authorization does not bind this batch"
          );
        }

        // Step 3 — batch status must be direct_authorized or review_authorized.
        if (
          batch.status !== "direct_authorized" &&
          batch.status !== "review_authorized"
        ) {
          throw new Error(
            `batch_status_unauthorized: batch status is ${batch.status}, expected direct_authorized or review_authorized`
          );
        }

        // Step 4 — authorization active and not expired.
        if (authorization.status !== "active") {
          throw new Error(
            `authorization_not_active: status is ${authorization.status}`
          );
        }
        if (authorization.expiresAt.getTime() < Date.now()) {
          throw new Error("authorization_expired");
        }
        if (authorization.invalidatedAt) {
          throw new Error("authorization_invalidated");
        }

        // Step 5 — recompute envelope + batch hashes from current revisions.
        const drafts = await this.draftModel.listDraftsByBatch(
          input.batchId,
          manager
        );
        const envelopes: BatchEnvelopeEntry[] = [];
        const revisions: OutboundEmailDraftRevisionEntity[] = [];
        for (const draft of drafts) {
          const revision = await this.draftModel.readCurrentRevision(draft.id);
          if (!revision) {
            throw new Error(
              `missing_current_revision: draft ${draft.id} has no current revision`
            );
          }
          revisions.push(revision);
          envelopes.push({
            version: 1,
            draftId: draft.id,
            emailServiceId: revision.emailServiceId,
            senderAddress: revision.senderAddress,
            recipientAddress: revision.recipientAddress,
            subject: revision.subject,
            bodyText: revision.bodyText,
            bodyHtml: revision.bodyHtml,
          });
        }
        const recomputedBatchHash =
          OutboundEmailEnvelopeHasher.hashBatch(envelopes);

        // Step 6 — authorization hash equals the current batch hash.
        if (authorization.batchHash !== recomputedBatchHash) {
          throw new Error(
            `batch_hash_mismatch: authorization hash ${authorization.batchHash} != recomputed ${recomputedBatchHash}`
          );
        }
        // The caller-supplied hash must also match (defense-in-depth).
        if (input.batchHash !== recomputedBatchHash) {
          throw new Error(
            `batch_hash_mismatch: claim hash ${input.batchHash} != recomputed ${recomputedBatchHash}`
          );
        }

        // Step 7 — preflight policy/validation versions remain current.
        if (batch.policyVersion && batch.policyVersion !== POLICY_VERSION) {
          throw new Error(
            `policy_version_stale: ${batch.policyVersion} != ${POLICY_VERSION}`
          );
        }
        if (
          batch.validationVersion &&
          batch.validationVersion !== VALIDATION_VERSION
        ) {
          throw new Error(
            `validation_version_stale: ${batch.validationVersion} != ${VALIDATION_VERSION}`
          );
        }

        // Step 8 — insert the send attempt (unique idempotency key).
        const now = new Date();
        const attempt = await this.deliveryModel.createAttempt(
          Object.assign(new OutboundEmailSendAttemptEntity(), {
            batchId: input.batchId,
            authorizationId: input.authorizationId,
            batchHash: recomputedBatchHash,
            idempotencyKey,
            status: "claimed",
            claimedAt: now,
          }),
          manager
        );

        // Step 9 — one pending outcome per draft.
        for (let i = 0; i < drafts.length; i++) {
          const draft = drafts[i];
          const revision = revisions[i];
          const envelopeHash = OutboundEmailEnvelopeHasher.hashEnvelope(
            envelopes[i]
          );
          await this.deliveryModel.createOutcome(
            Object.assign(new OutboundEmailDeliveryOutcomeEntity(), {
              sendAttemptId: attempt.id,
              batchId: input.batchId,
              draftId: draft.id,
              revisionId: revision.id,
              envelopeHash,
              recipientAddress: revision.recipientAddress,
              status: "pending",
            }),
            manager
          );
        }

        // Step 10 — mark authorization consumed.
        await this.authorizationModel.consume(
          input.authorizationId,
          now,
          manager
        );

        // Step 11 — mark batch + drafts queued.
        await this.draftModel.updateBatchStatus(
          input.batchId,
          "queued",
          {
            sendAttemptId: attempt.id,
            queuedAt: now,
          },
          manager
        );
        for (const draft of drafts) {
          await this.draftModel.updateDraftStatus(draft.id, "queued", manager);
        }

        return {
          attemptId: attempt.id,
          batch,
          drafts,
          revisions,
          authorization,
        };
      }
    );

    // §15.2 worker prep — AFTER the transaction commits. Any failure here is
    // recoverable to `worker_start_failed` (§15.3), never a silent duplicate.
    try {
      const draftViews = claimed.drafts.map((draft, i) => ({
        draft,
        revision: claimed.revisions[i],
      }));
      await this.workerStarter(
        claimed.attemptId,
        claimed.batch,
        draftViews,
        claimed.authorization
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[outbound-email-delivery] worker start failed for attempt ${claimed.attemptId}: ${message}`
      );
      await this.handleWorkerStartFailure(
        claimed.attemptId,
        input.batchId,
        (manager) => this.draftModel.listDraftsByBatch(input.batchId, manager)
      );
      return {
        status: "worker_start_failed",
        attemptId: claimed.attemptId,
      };
    }

    // Audit the successful claim.
    await this.auditModel.create(
      Object.assign(new OutboundEmailAuditLogEntity(), {
        batchId: input.batchId,
        eventCode: "send_claimed",
        actorType: "system",
        metadataJson: JSON.stringify({
          attemptId: claimed.attemptId,
          authorizationId: input.authorizationId,
        }),
      })
    );

    return { status: "claimed", attemptId: claimed.attemptId };
  }

  /**
   * §15.3 worker-start failure handling. Marks the attempt + pending outcomes
   * failed and the batch failed; preserves the consumed authorization and
   * audit trail. A retry requires a new explicit user request or review
   * approval (one authorization = one attempt, AD-009).
   */
  private async handleWorkerStartFailure(
    attemptId: number,
    batchId: number,
    draftsLoader: (
      manager: EntityManager | undefined
    ) => Promise<OutboundEmailDraftEntity[]>
  ): Promise<void> {
    await this.sqliteDb.connection.transaction(
      async (manager: EntityManager) => {
        const now = new Date();
        await this.deliveryModel.updateAttemptStatus(
          attemptId,
          "failed",
          { lastErrorCode: "worker_start_failed", completedAt: now },
          manager
        );
        const outcomes = await this.deliveryModel.listOutcomesByAttempt(
          attemptId
        );
        for (const outcome of outcomes) {
          if (outcome.status === "pending") {
            await this.deliveryModel.updateOutcomeStatus(
              outcome.id,
              "failed",
              { errorCode: "worker_start_failed", completedAt: now },
              manager
            );
          }
        }
        await this.draftModel.updateBatchStatus(
          batchId,
          "failed",
          { lastErrorCode: "worker_start_failed", completedAt: now },
          manager
        );
        const drafts = await draftsLoader(manager);
        for (const draft of drafts) {
          await this.draftModel.updateDraftStatus(draft.id, "failed", manager);
        }
      }
    );
  }
}
