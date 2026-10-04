import { BaseModule } from "./baseModule";
import { AiTaskExecutionModel } from "@/model/AiTaskExecution.model";
import type {
  CreateExecutionInput,
  FinalizeInput,
  FinalizeResult,
} from "@/model/AiTaskExecution.model";

/**
 * Business logic for task executions (technical-design §6.3, FR-24).
 *
 * Manual executions finalize WITHOUT touching schedules. Scheduled origin
 * (Slice 2) participates in the same transaction to update occurrence/
 * schedule counters atomically. Slice 1 implements manual finalization
 * only.
 *
 * Worker guard: every model method calls assertNotWorker; workers must
 * never access these tables directly (NFR-03).
 */
export class AiTaskExecutionModule extends BaseModule {
  private readonly model: AiTaskExecutionModel;

  constructor() {
    super();
    this.model = new AiTaskExecutionModel(this.dbpath);
  }

  async startExecution(
    input: CreateExecutionInput
  ): Promise<{ executionId: string; ledgerId: string; executionRowId: number }> {
    await this.ensureConnection();
    return this.model.createExecution(input);
  }

  async getExecution(executionId: string) {
    await this.ensureConnection();
    return this.model.getById(executionId);
  }

  async finalizeExecution(input: FinalizeInput): Promise<FinalizeResult> {
    await this.ensureConnection();
    return this.model.finalizeExecution(input);
  }

  async getUnfinalizedExecutions() {
    await this.ensureConnection();
    return this.model.getUnfinalized();
  }

  /**
   * Record a shadow decision's provenance (FR-16). Slice 1 stores the
   * decision summary in execution_state_json; live enforcement is Slice 2.
   */
  async recordShadowDecision(input: {
    executionId: string;
    decision: unknown;
  }): Promise<void> {
    await this.ensureConnection();
    const exec = await this.model.getById(input.executionId);
    if (!exec) return;
    exec.execution_state_json = JSON.stringify(input.decision);
    await this.model.saveExecution(exec);
  }
}
