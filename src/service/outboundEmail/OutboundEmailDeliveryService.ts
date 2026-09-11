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
import {
  OutboundEmailEnvelopeHasher,
  normalizeEmailAddressV2,
  normalizeSmtpUsernameForHash,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type {
  BatchEnvelopeEntry,
  BatchEnvelopeEntryV2,
} from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import { EmailServiceModel } from "@/model/EmailService.model";
import {
  OUTBOUND_POLICY_VERSION,
  OUTBOUND_VALIDATION_VERSION,
} from "@/service/outboundEmail/outboundReliabilityVersions";
import { log } from "@/modules/Logger";

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
const POLICY_VERSION = OUTBOUND_POLICY_VERSION;
const VALIDATION_VERSION = OUTBOUND_VALIDATION_VERSION;

/**
 * Sentinel thrown from inside the claim transaction when the in-transaction
 * idempotency-key re-check finds a row a concurrent claim just inserted. The
 * outer catch converts it to `already_processed` instead of surfacing a raw
 * unique-constraint violation.
 */
class IdempotencyKeyAlreadyClaimed extends Error {
  readonly existingAttemptId: number;
  constructor(existingAttemptId: number) {
    super(`idempotency_key_already_claimed: ${existingAttemptId}`);
    this.name = "IdempotencyKeyAlreadyClaimed";
    this.existingAttemptId = existingAttemptId;
  }
}

/**
 * §17.2 — thrown inside the claim transaction when a batch mixes v1 and v2
 * current revisions. The outer catch converts it to `mixed_version_batch`
 * WITHOUT consuming the authorization (the transaction rolls back).
 */
class MixedVersionBatchError extends Error {
  constructor() {
    super(
      "mixed_version_batch: batch contains both v1 and v2 current revisions"
    );
    this.name = "MixedVersionBatchError";
  }
}

/**
 * §17.1 — thrown inside the claim transaction when a legacy all-v1 batch's
 * referenced services do not satisfy the v1 compatibility gate. The outer
 * catch converts it to `legacy_identity_requires_review` WITHOUT consuming the
 * authorization (the transaction rolls back). The user must create a new v2
 * revision and re-approve.
 */
class LegacyIdentityRequiresReviewError extends Error {
  constructor() {
    super(
      "legacy_identity_requires_review: legacy v1 batch identity no longer matches the approved sender"
    );
    this.name = "LegacyIdentityRequiresReviewError";
  }
}

/**
 * §15.5 — thrown AFTER the claim transaction commits, before starting the v2
 * worker, when a freshly-reloaded service identity no longer matches the frozen
 * revision. This is a delivery-time check (the transaction already committed),
 * so the attempt is marked failed via {@link handleWorkerStartFailure} and the
 * status returned as `sender_identity_changed`.
 */
class SenderIdentityChangedError extends Error {
  constructor() {
    super(
      "sender_identity_changed: service identity changed between approval and delivery"
    );
    this.name = "SenderIdentityChangedError";
  }
}

export interface ClaimInput {
  readonly batchId: number;
  readonly authorizationId: number;
  readonly batchHash: string;
}

export type ClaimResult =
  | { status: "claimed"; attemptId: number }
  | { status: "already_processed"; attemptId: number }
  | { status: "worker_start_failed"; attemptId: number }
  | { status: "legacy_identity_requires_review" }
  | { status: "sender_identity_changed" }
  | { status: "mixed_version_batch" };

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
  private readonly dbpath: string;
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
    // Parse before super() so BaseDb.getInstance hits the real user path in
    // one call. super("") used to bounce the singleton onto
    // os.tmpdir()/aifetchly-test and fire-and-forget destroy() the live
    // connection — the scheduler then threw "The database connection is
    // not open" on every poll.
    const opts: OutboundEmailDeliveryServiceOptions =
      typeof options === "string"
        ? { dbpath: options, ...legacyOptions }
        : options;
    const dbpath = opts.dbpath ?? "";
    super(dbpath);
    this.dbpath = dbpath;
    this.draftModel = new OutboundEmailDraftModel(dbpath);
    this.authorizationModel = new OutboundEmailAuthorizationModel(dbpath);
    this.deliveryModel = new OutboundEmailDeliveryModel(dbpath);
    this.auditModel = new OutboundEmailAuditLogModel(dbpath);
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
    if (dbpath) {
      this.sqliteDb = SqliteDb.getInstance(dbpath);
    }
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

    // §15.1 step 1 (partial) — check for a duplicate before the transaction
    // as a fast path to avoid the transaction entirely on the hot retry.
    const existing = await this.deliveryModel.findAttemptByIdempotencyKey(
      idempotencyKey
    );
    if (existing) {
      return { status: "already_processed", attemptId: existing.id };
    }

    // §15.1 steps 1–11 in one transaction.
    let claimed: {
      attemptId: number;
      batch: OutboundEmailDraftBatchEntity;
      drafts: OutboundEmailDraftEntity[];
      revisions: OutboundEmailDraftRevisionEntity[];
      authorization: OutboundEmailAuthorizationEntity;
    };
    try {
      claimed = await this.sqliteDb.connection.transaction(
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

          // Step 1b — re-check the idempotency key INSIDE the transaction. The
          // pre-transaction check above races a concurrent claim that inserts
          // the same key between the check and this transaction; the unique
          // index is the final backstop, but re-checking here turns the race
          // into a clean `already_processed` return instead of a constraint
          // violation thrown out of the transaction.
          const raced = await this.deliveryModel.findAttemptByIdempotencyKey(
            idempotencyKey,
            manager
          );
          if (raced) {
            // Throw a sentinel the outer handler converts to already_processed;
            // cannot `return` from inside the transaction callback cleanly.
            throw new IdempotencyKeyAlreadyClaimed(raced.id);
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
          // Version-aware (§15.5): v2 revisions carry smtpUsername +
          // replyToAddress bound into the hash; v1 use the legacy shape. Mixed
          // v1+v2 batches are blocked (§17.2) — they cannot be sent under one
          // canonicalization rule.
          const drafts = await this.draftModel.listDraftsByBatch(
            input.batchId,
            manager
          );
          const v1Envelopes: BatchEnvelopeEntry[] = [];
          const v2Envelopes: BatchEnvelopeEntryV2[] = [];
          const revisions: OutboundEmailDraftRevisionEntity[] = [];
          for (const draft of drafts) {
            const revision = await this.draftModel.readCurrentRevision(
              draft.id
            );
            if (!revision) {
              throw new Error(
                `missing_current_revision: draft ${draft.id} has no current revision`
              );
            }
            revisions.push(revision);
            const version = revision.envelopeVersion ?? 1;
            if (version === 2) {
              v2Envelopes.push({
                version: 2,
                draftId: draft.id,
                emailServiceId: revision.emailServiceId,
                smtpUsername: revision.smtpUsername ?? "",
                senderAddress: revision.senderAddress,
                replyToAddress: revision.replyToAddress,
                recipientAddress: revision.recipientAddress,
                subject: revision.subject,
                bodyText: revision.bodyText,
                bodyHtml: revision.bodyHtml,
              });
            } else {
              v1Envelopes.push({
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
          }

          // §17.2 — a batch mixing v1 and v2 current revisions cannot be sent.
          // Abort before consuming the authorization; do not insert an attempt.
          if (v1Envelopes.length > 0 && v2Envelopes.length > 0) {
            throw new MixedVersionBatchError();
          }

          // §17.1 — legacy v1 gate. An all-v1 batch may only use the legacy
          // payload-v2 path when every referenced service satisfies:
          //   effective From == approved sender
          //   effective Reply-To == null
          //   effective SMTP username == approved sender
          // (approved sender = the revision's senderAddress). If any condition
          // fails, require a new v2 revision + re-approval. This preserves the
          // authentication identity v1 implicitly assumed.
          if (v1Envelopes.length > 0) {
            const legacyGate = await this.checkLegacyIdentityGate(
              v1Envelopes,
              revisions
            );
            if (!legacyGate.ok) {
              throw new LegacyIdentityRequiresReviewError();
            }
          }

          // Recompute the batch hash with the matching canonicalizer.
          const recomputedBatchHash =
            v2Envelopes.length > 0
              ? OutboundEmailEnvelopeHasher.hashBatchV2(v2Envelopes)
              : OutboundEmailEnvelopeHasher.hashBatch(v1Envelopes);

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

          // Step 9 — one pending outcome per draft. Version-aware: the envelope
          // hash matches the version that was authorized (v1→hashEnvelope,
          // v2→hashEnvelopeV2). Outcomes carry the same hash the worker will
          // recompute, so the bridge can correlate without re-deriving version.
          const allEnvelopes: Array<BatchEnvelopeEntry | BatchEnvelopeEntryV2> =
            [...v1Envelopes, ...v2Envelopes];
          for (let i = 0; i < drafts.length; i++) {
            const draft = drafts[i];
            const revision = revisions[i];
            const envForHash = allEnvelopes.find((e) => e.draftId === draft.id);
            if (!envForHash) {
              throw new Error(
                `envelope_reconstruction_failed: draft ${draft.id}`
              );
            }
            const envelopeHash =
              envForHash.version === 2
                ? OutboundEmailEnvelopeHasher.hashEnvelopeV2(
                    envForHash as BatchEnvelopeEntryV2
                  )
                : OutboundEmailEnvelopeHasher.hashEnvelope(
                    envForHash as BatchEnvelopeEntry
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
            await this.draftModel.updateDraftStatus(
              draft.id,
              "queued",
              manager
            );
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
    } catch (error: unknown) {
      // The in-transaction idempotency-key re-check throws a sentinel when a
      // concurrent claim won the race; surface it as already_processed instead
      // of a constraint-violation error.
      if (error instanceof IdempotencyKeyAlreadyClaimed) {
        return {
          status: "already_processed",
          attemptId: error.existingAttemptId,
        };
      }
      // §17.2 — mixed-version batches are rejected before the authorization is
      // consumed (the transaction rolls back). No attempt is created.
      if (error instanceof MixedVersionBatchError) {
        return { status: "mixed_version_batch" };
      }
      // §17.1 — legacy v1 identity no longer matches; require a new v2
      // revision + re-approval. Transaction rolls back, no attempt consumed.
      if (error instanceof LegacyIdentityRequiresReviewError) {
        return { status: "legacy_identity_requires_review" };
      }
      throw error;
    }

    // §15.5 — delivery-time identity reload. BEFORE starting the v2 worker,
    // reload each referenced service and compare its resolved identity to the
    // immutable revision (service ID, smtpUsername trim-only, From
    // email-normalized, Reply-To including null). A mismatch means the service
    // was edited after approval — abort without consuming SMTP capacity. This
    // check runs AFTER the transaction commits, so a mismatch is routed through
    // the worker-start-failure cleanup (attempt → failed) and surfaced as
    // `sender_identity_changed`. Only v2 revisions carry the bound identity
    // needed for this comparison; v1 revisions already passed the §17.1 gate.
    try {
      await this.verifyIdentityNotChanged(claimed.revisions);
    } catch (error: unknown) {
      if (error instanceof SenderIdentityChangedError) {
        const message = error.message;
        // Route to the file logger (electron-log → main.log) rather than raw
        // console.error, which is NOT mirrored to app.log in production. This
        // fail-closed security event must be auditable from the production log.
        // The message is a fixed constant (no email address or SMTP username).
        log.error(
          `[outbound-email-delivery] sender identity changed for attempt ${claimed.attemptId}: ${message}`
        );
        await this.handleWorkerStartFailure(
          claimed.attemptId,
          input.batchId,
          (manager) => this.draftModel.listDraftsByBatch(input.batchId, manager)
        );
        return { status: "sender_identity_changed" };
      }
      throw error;
    }

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
   * §17.1 legacy v1 compatibility gate. An all-v1 batch may use the legacy
   * payload-v2 path only when every referenced service satisfies:
   *   effective From == approved sender (email-normalized)
   *   effective Reply-To == null
   *   effective SMTP username == approved sender (trim-only)
   * The "approved sender" is the revision's frozen `senderAddress` — the value
   * the v1 hash covered. If any condition fails, the caller must create a new
   * v2 revision + re-approve. Uses the same normalization as the hasher so the
   * comparison is byte-identical.
   *
   * Runs inside the claim transaction so a failure rolls back without consuming
   * the authorization.
   */
  private async checkLegacyIdentityGate(
    v1Envelopes: BatchEnvelopeEntry[],
    revisions: OutboundEmailDraftRevisionEntity[]
  ): Promise<{ ok: true } | { ok: false }> {
    const emailServiceModel = new EmailServiceModel(this.dbpath);
    for (let i = 0; i < v1Envelopes.length; i++) {
      const env = v1Envelopes[i];
      const revision = revisions[i];
      const identity = await emailServiceModel.readIdentity(env.emailServiceId);
      if (!identity) {
        // Service was deleted after approval — fail closed.
        return { ok: false };
      }
      const effectiveFrom = identity.from ?? "";
      const effectiveSmtpUsername = identity.smtpUsername ?? effectiveFrom;
      const effectiveReplyTo = identity.replyTo ?? null;
      // §17.1 conditions — approved sender = revision.senderAddress.
      if (
        normalizeEmailAddressV2(effectiveFrom) !==
        normalizeEmailAddressV2(revision.senderAddress)
      ) {
        return { ok: false };
      }
      if (effectiveReplyTo !== null) {
        return { ok: false };
      }
      if (
        normalizeSmtpUsernameForHash(effectiveSmtpUsername) !==
        normalizeSmtpUsernameForHash(revision.senderAddress)
      ) {
        return { ok: false };
      }
    }
    return { ok: true };
  }

  /**
   * §15.5 delivery-time identity reload. Before starting the v2 worker, reload
   * each referenced email service and compare its resolved identity to the
   * immutable revision. A mismatch returns a stable `sender_identity_changed`
   * finding and does not consume SMTP submission capacity. Only v2 revisions
   * carry the bound identity needed for this comparison; v1 revisions already
   * passed the §17.1 gate inside the transaction.
   *
   * Uses byte-identical normalization to the hash function so the comparison
   * is authoritative.
   */
  private async verifyIdentityNotChanged(
    revisions: OutboundEmailDraftRevisionEntity[]
  ): Promise<void> {
    const emailServiceModel = new EmailServiceModel(this.dbpath);
    const distinctIds = Array.from(
      new Set(revisions.map((r) => r.emailServiceId))
    );
    for (const id of distinctIds) {
      const identity = await emailServiceModel.readIdentity(id);
      if (!identity) {
        // Service deleted between approval and delivery — fail closed.
        throw new SenderIdentityChangedError();
      }
      // Compare against every v2 revision referencing this service.
      for (const revision of revisions) {
        if (revision.emailServiceId !== id) continue;
        const version = revision.envelopeVersion ?? 1;
        if (version !== 2) continue;
        const svcSmtp = normalizeSmtpUsernameForHash(
          identity.smtpUsername ?? identity.from ?? ""
        );
        const revSmtp = normalizeSmtpUsernameForHash(
          revision.smtpUsername ?? revision.senderAddress
        );
        if (svcSmtp !== revSmtp) {
          throw new SenderIdentityChangedError();
        }
        const svcFrom = normalizeEmailAddressV2(identity.from ?? "");
        const revFrom = normalizeEmailAddressV2(revision.senderAddress);
        if (svcFrom !== revFrom) {
          throw new SenderIdentityChangedError();
        }
        const svcReplyTo =
          identity.replyTo === null || identity.replyTo === undefined
            ? null
            : normalizeEmailAddressV2(identity.replyTo);
        const revReplyTo =
          revision.replyToAddress === null
            ? null
            : normalizeEmailAddressV2(revision.replyToAddress);
        if (svcReplyTo !== revReplyTo) {
          throw new SenderIdentityChangedError();
        }
      }
    }
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
