import { BaseModule } from "@/modules/baseModule";
import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailAuthorizationEntity } from "@/entity/OutboundEmailAuthorization.entity";
import { OutboundEmailSendAttemptEntity } from "@/entity/OutboundEmailSendAttempt.entity";
import { OutboundEmailDeliveryOutcomeEntity } from "@/entity/OutboundEmailDeliveryOutcome.entity";

/**
 * Business-logic facade over outbound-email authorization and delivery
 * persistence (technical design §7.5–§7.7). Delegates data access to
 * {@link OutboundEmailAuthorizationModel} and {@link OutboundEmailDeliveryModel}.
 */
export class OutboundEmailDeliveryModule extends BaseModule {
  private authorizationModel: OutboundEmailAuthorizationModel;
  private deliveryModel: OutboundEmailDeliveryModel;

  constructor() {
    super();
    this.authorizationModel = new OutboundEmailAuthorizationModel(this.dbpath);
    this.deliveryModel = new OutboundEmailDeliveryModel(this.dbpath);
  }

  // -- Authorization --------------------------------------------------------

  async createAuthorization(
    entity: OutboundEmailAuthorizationEntity
  ): Promise<OutboundEmailAuthorizationEntity> {
    await this.ensureConnection();
    return await this.authorizationModel.create(entity);
  }

  async readAuthorization(
    id: number
  ): Promise<OutboundEmailAuthorizationEntity | null> {
    await this.ensureConnection();
    return await this.authorizationModel.read(id);
  }

  async findActiveAuthorizationByBatch(
    batchId: number
  ): Promise<OutboundEmailAuthorizationEntity | null> {
    await this.ensureConnection();
    return await this.authorizationModel.findActiveByBatch(batchId);
  }

  async consumeAuthorization(id: number, at: Date): Promise<void> {
    await this.ensureConnection();
    await this.authorizationModel.consume(id, at);
  }

  async invalidateAuthorization(
    id: number,
    reason: string,
    at: Date
  ): Promise<void> {
    await this.ensureConnection();
    await this.authorizationModel.invalidate(id, reason, at);
  }

  // -- Send attempt ---------------------------------------------------------

  async createSendAttempt(
    entity: OutboundEmailSendAttemptEntity
  ): Promise<OutboundEmailSendAttemptEntity> {
    await this.ensureConnection();
    return await this.deliveryModel.createAttempt(entity);
  }

  async readSendAttempt(
    id: number
  ): Promise<OutboundEmailSendAttemptEntity | null> {
    await this.ensureConnection();
    return await this.deliveryModel.readAttempt(id);
  }

  async findAttemptByIdempotencyKey(
    idempotencyKey: string
  ): Promise<OutboundEmailSendAttemptEntity | null> {
    await this.ensureConnection();
    return await this.deliveryModel.findAttemptByIdempotencyKey(idempotencyKey);
  }

  async updateAttemptStatus(
    id: number,
    status: OutboundEmailSendAttemptEntity["status"],
    patch: Partial<OutboundEmailSendAttemptEntity> = {}
  ): Promise<void> {
    await this.ensureConnection();
    await this.deliveryModel.updateAttemptStatus(id, status, patch);
  }

  // -- Delivery outcome -----------------------------------------------------

  async createDeliveryOutcome(
    entity: OutboundEmailDeliveryOutcomeEntity
  ): Promise<OutboundEmailDeliveryOutcomeEntity> {
    await this.ensureConnection();
    return await this.deliveryModel.createOutcome(entity);
  }

  async listOutcomesByAttempt(
    sendAttemptId: number
  ): Promise<OutboundEmailDeliveryOutcomeEntity[]> {
    await this.ensureConnection();
    return await this.deliveryModel.listOutcomesByAttempt(sendAttemptId);
  }

  async listOutcomesByBatch(
    batchId: number
  ): Promise<OutboundEmailDeliveryOutcomeEntity[]> {
    await this.ensureConnection();
    return await this.deliveryModel.listOutcomesByBatch(batchId);
  }
}