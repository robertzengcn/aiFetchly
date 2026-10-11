import { BaseModule } from "./baseModule";
import { AiTaskOperationModel } from "@/model/AiTaskOperation.model";
import type {
  CreateOperationInput,
  CreateOperationResult,
  UpdateStateInput,
  UpdateStateResult,
} from "@/model/AiTaskOperation.model";
import type { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";

/**
 * Consequential-action operation guard scaffolding (technical-design §10).
 *
 * Slice 1: create/get/updateState with claim-generation CAS. Full receipt
 * reconciliation (FR-11; AC-09/10/13/28) lands in Slice 3.
 *
 * Workers must never access this table directly (NFR-03).
 */
export class AiTaskOperationModule extends BaseModule {
  private readonly model: AiTaskOperationModel;

  constructor() {
    super();
    this.model = new AiTaskOperationModel(this.dbpath);
  }

  async recordOperation(
    input: CreateOperationInput
  ): Promise<CreateOperationResult> {
    await this.ensureConnection();
    return this.model.create(input);
  }

  async getOperation(
    operationKey: string
  ): Promise<AiTaskOperationEntity | null> {
    await this.ensureConnection();
    return this.model.getByKey(operationKey);
  }

  /**
   * §10.2 cross-execution unresolved lookup — passthrough to the model query.
   */
  async findUnresolvedByIntent(input: {
    readonly toolIdentity: string;
    readonly domainTarget: string | null;
    readonly intentHash: string;
    readonly limit?: number;
  }): Promise<AiTaskOperationEntity[]> {
    await this.ensureConnection();
    return this.model.findUnresolvedByIntent(input);
  }

  async updateState(
    input: UpdateStateInput
  ): Promise<UpdateStateResult> {
    await this.ensureConnection();
    return this.model.updateState(input);
  }
}
