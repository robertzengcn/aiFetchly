import { BaseModule } from "@/modules/baseModule";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import { AIChatRunEntity } from "@/entity/AIChatRun.entity";
import type { ChatRunOwner, ChatRunStatus } from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Run-transition and reconciliation business rules over the durable run
 * envelope (technical-design §9, §19.4). IPC handlers and services call this
 * module; they never touch repositories directly.
 */
export class AIChatRunModule extends BaseModule {
  private getModel(): AIChatRunModel {
    return new AIChatRunModel(this.dbpath);
  }

  async createRun(input: {
    conversationId: string;
    owner: ChatRunOwner;
    sourceId?: string | null;
    resourceClass?: "general" | "browser" | "cpu" | "artifact_batch";
  }): Promise<AIChatRunEntity> {
    await this.ensureConnection();
    return this.getModel().createRun(input);
  }

  async getByRunId(runId: string): Promise<AIChatRunEntity | null> {
    await this.ensureConnection();
    return this.getModel().getByRunId(runId);
  }

  async listByConversation(
    conversationId: string,
    limit?: number
  ): Promise<AIChatRunEntity[]> {
    await this.ensureConnection();
    return this.getModel().listByConversation(conversationId, limit);
  }

  /** Transition rules per the §9.1 state machine. Throws on violations. */
  async transition(
    runId: string,
    next: ChatRunStatus,
    patch?: {
      assistantMessageId?: string;
      errorCode?: string | null;
      errorSummary?: string | null;
    }
  ): Promise<AIChatRunEntity> {
    await this.ensureConnection();
    const EXPECTED: Record<ChatRunStatus, readonly ChatRunStatus[]> = {
      queued: ["queued"],
      running: ["queued", "awaiting_permission", "awaiting_user"],
      awaiting_permission: ["queued", "running"],
      awaiting_user: ["queued", "running"],
      completed: ["queued", "running", "awaiting_permission", "awaiting_user"],
      failed: ["queued", "running", "awaiting_permission", "awaiting_user"],
      cancelled: ["queued", "running", "awaiting_permission", "awaiting_user"],
      interrupted: [
        "queued",
        "running",
        "awaiting_permission",
        "awaiting_user",
      ],
    };
    return this.getModel().transition(
      runId,
      next,
      EXPECTED[next],
      patch
    );
  }

  /**
   * Startup reconciliation (§19.4): every non-terminal run without an
   * explicitly supported durable resume protocol is marked `interrupted`.
   * Returns the number of runs reconciled.
   */
  async reconcileInterruptedRuns(reason: string): Promise<number> {
    await this.ensureConnection();
    const model = this.getModel();
    const active = await model.listAllActive();
    let count = 0;
    for (const run of active) {
      const updated = await model.markInterrupted(run.runId, reason);
      if (updated && updated.status === "interrupted") count += 1;
    }
    return count;
  }
}
