import { BaseDb } from "@/model/Basedb";
import { Repository, EntityManager } from "typeorm";
import { OutboundEmailSendAttemptEntity } from "@/entity/OutboundEmailSendAttempt.entity";
import { OutboundEmailDeliveryOutcomeEntity } from "@/entity/OutboundEmailDeliveryOutcome.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { outboundEmailSendAttemptWriteSchema } from "@/schemas/entity/outboundEmailSendAttempt";
import { outboundEmailDeliveryOutcomeWriteSchema } from "@/schemas/entity/outboundEmailDeliveryOutcome";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

/**
 * Data-access model for outbound-email send attempts and per-recipient delivery
 * outcomes (technical design §7.6, §7.7). The unique `idempotencyKey` index on
 * attempts and the unique `(sendAttemptId, draftId)` index on outcomes enforce
 * idempotency at the database level.
 */
export class OutboundEmailDeliveryModel extends BaseDb {
  private readonly attemptRepo: Repository<OutboundEmailSendAttemptEntity>;
  private readonly outcomeRepo: Repository<OutboundEmailDeliveryOutcomeEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("OutboundEmailDeliveryModel");
    const conn = this.sqliteDb.connection;
    this.attemptRepo = conn.getRepository(OutboundEmailSendAttemptEntity);
    this.outcomeRepo = conn.getRepository(OutboundEmailDeliveryOutcomeEntity);
  }

  // -- Send attempt --------------------------------------------------------

  async createAttempt(
    entity: OutboundEmailSendAttemptEntity,
    manager?: EntityManager
  ): Promise<OutboundEmailSendAttemptEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailSendAttemptWriteSchema()
    ) as unknown as OutboundEmailSendAttemptEntity;
    const repo =
      manager?.getRepository(OutboundEmailSendAttemptEntity) ??
      this.attemptRepo;
    return await repo.save(repo.create(stripped));
  }

  async readAttempt(
    id: number
  ): Promise<OutboundEmailSendAttemptEntity | null> {
    return await this.attemptRepo.findOne({ where: { id } });
  }

  async findAttemptByIdempotencyKey(
    idempotencyKey: string,
    manager?: EntityManager
  ): Promise<OutboundEmailSendAttemptEntity | null> {
    const repo =
      manager?.getRepository(OutboundEmailSendAttemptEntity) ??
      this.attemptRepo;
    return await repo.findOne({ where: { idempotencyKey } });
  }

  async updateAttemptStatus(
    id: number,
    status: OutboundEmailSendAttemptEntity["status"],
    patch: Partial<OutboundEmailSendAttemptEntity> = {},
    manager?: EntityManager
  ): Promise<void> {
    const repo =
      manager?.getRepository(OutboundEmailSendAttemptEntity) ??
      this.attemptRepo;
    await repo.update(id, { status, ...patch });
  }

  // -- Delivery outcome ------------------------------------------------------

  async createOutcome(
    entity: OutboundEmailDeliveryOutcomeEntity,
    manager?: EntityManager
  ): Promise<OutboundEmailDeliveryOutcomeEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailDeliveryOutcomeWriteSchema()
    ) as unknown as OutboundEmailDeliveryOutcomeEntity;
    const repo =
      manager?.getRepository(OutboundEmailDeliveryOutcomeEntity) ??
      this.outcomeRepo;
    return await repo.save(repo.create(stripped));
  }

  async listOutcomesByAttempt(
    sendAttemptId: number,
    manager?: EntityManager
  ): Promise<OutboundEmailDeliveryOutcomeEntity[]> {
    const repo =
      manager?.getRepository(OutboundEmailDeliveryOutcomeEntity) ??
      this.outcomeRepo;
    return await repo.find({ where: { sendAttemptId } });
  }

  async listOutcomesByBatch(
    batchId: number
  ): Promise<OutboundEmailDeliveryOutcomeEntity[]> {
    return await this.outcomeRepo.find({ where: { batchId } });
  }

  /**
   * The single outcome for a (sendAttemptId, draftId) pair — the unique index
   * guarantees at most one. Used by the worker-event bridge to correlate an
   * envelope event to the persisted outcome before mutating it (§15.4).
   */
  async findOutcomeByAttemptAndDraft(
    sendAttemptId: number,
    draftId: number,
    manager?: EntityManager
  ): Promise<OutboundEmailDeliveryOutcomeEntity | null> {
    const repo =
      manager?.getRepository(OutboundEmailDeliveryOutcomeEntity) ??
      this.outcomeRepo;
    return await repo.findOne({ where: { sendAttemptId, draftId } });
  }

  /**
   * Stale in-flight attempts (§21 rules 2–3). "In-flight" = `claimed` or
   * `sending`; "stale" = `claimedAt` older than `cutoff`. Recovery uses
   * `workerStartedAt` (null ⇒ worker never started; set ⇒ worker alive at
   * start but a dead worker is detected elsewhere) to decide failed vs
   * `delivery_unknown`.
   */
  async listStaleInFlight(
    cutoff: Date
  ): Promise<OutboundEmailSendAttemptEntity[]> {
    const inFlight = await this.attemptRepo.find({
      where: [
        ...(["claimed", "sending"] as const).map((status) => ({ status })),
      ],
    });
    return inFlight.filter((a) => a.claimedAt.getTime() < cutoff.getTime());
  }

  /**
   * Update a single outcome's status (used by worker-start failure handling
   * to flip pending outcomes to failed without inserting duplicates).
   */
  async updateOutcomeStatus(
    id: number,
    status: OutboundEmailDeliveryOutcomeEntity["status"],
    patch: Partial<OutboundEmailDeliveryOutcomeEntity> = {},
    manager?: EntityManager
  ): Promise<void> {
    const repo =
      manager?.getRepository(OutboundEmailDeliveryOutcomeEntity) ??
      this.outcomeRepo;
    await repo.update(id, { status, ...patch });
  }

  /**
   * Transition every still-`submitted` outcome of one attempt to `sent` —
   * the recipient lifecycle §8.3 step `submitted -> sent`. Called only when the
   * worker has reported `authorized-email-worker-complete` (a normal, clean
   * finish): the envelope was accepted by SMTP and, in this local-delivery
   * model with no provider DSNs, worker completion is the confirmation point.
   * Conditional on `status = 'submitted'` so it is idempotent and never revives
   * a `delivery_unknown`/`failed` outcome that recovery had already downgraded.
   */
  async markAttemptOutcomesSent(
    sendAttemptId: number,
    at: Date
  ): Promise<void> {
    await this.outcomeRepo
      .createQueryBuilder()
      .update()
      .set({ status: "sent", completedAt: at })
      .where("sendAttemptId = :sendAttemptId AND status = :status", {
        sendAttemptId,
        status: "submitted",
      })
      .execute();
  }
}
