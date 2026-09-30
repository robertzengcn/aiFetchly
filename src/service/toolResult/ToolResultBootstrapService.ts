import "reflect-metadata";
import type { DataSource } from "typeorm";
import { AIToolOutputBootstrapEntity } from "@/entity/AIToolOutputBootstrap.entity";

/**
 * Idempotent, resumable data bootstrap for preserved tool outputs
 * (technical design §13.2).
 *
 * The project has `synchronize: true` and an EMPTY migration list, so writing
 * a migration file would be theatre - it would never execute. This service is
 * the honest replacement: named steps record completion, and a step that
 * interrupts leaves an opaque resume position so it continues where it stopped
 * instead of rescanning from the beginning.
 *
 * Every step is written so that running it twice is a no-op, which is what
 * makes it safe to call on every startup.
 */

/** Current additive schema version for this feature. */
export const TOOL_OUTPUT_SCHEMA_VERSION = 1;

/** Named steps, so a step's identity is stable across releases. */
export const TOOL_OUTPUT_BOOTSTRAP_KEYS = {
  additiveEntities: "additive-entities-v1",
} as const;

export interface BootstrapStepResult {
  readonly key: string;
  /** True when this call performed the work (vs. it already being done). */
  readonly ran: boolean;
  /** True when the step is complete after this call. */
  readonly completed: boolean;
  readonly error?: string;
}

export class ToolResultBootstrapService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly profileId: string
  ) {}

  /**
   * Run every bootstrap step in order.
   *
   * A failing step is recorded and does NOT stop the others: an additive
   * schema step that cannot run should not prevent a later, independent step
   * from being attempted, and startup must never throw because of this.
   */
  async runAll(): Promise<BootstrapStepResult[]> {
    const results: BootstrapStepResult[] = [];
    for (const key of Object.values(TOOL_OUTPUT_BOOTSTRAP_KEYS)) {
      results.push(await this.runStep(key));
    }
    return results;
  }

  /** Run one named step exactly once. */
  async runStep(key: string): Promise<BootstrapStepResult> {
    const existing = await this.findMarker(key);
    if (existing?.completed) {
      return { key, ran: false, completed: true };
    }
    try {
      await this.executeStep(key);
      await this.upsertMarker({ key, completed: true, lastPositionJson: null });
      return { key, ran: true, completed: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Record the attempt so the failure is observable, but leave the step
      // incomplete so the next startup retries it.
      await this.upsertMarker({ key, completed: false, lastPositionJson: null });
      return { key, ran: true, completed: false, error: message };
    }
  }

  /**
   * Steps are intentionally empty today: the additive entities are created by
   * TypeORM `synchronize`, and the legacy backfill that this marker exists to
   * make resumable is explicitly out of scope for the first release.
   *
   * The hook is kept because adding a real step must not require changing the
   * caller, and because a step that does nothing is still a correct, testable
   * unit.
   */
  private async executeStep(key: string): Promise<void> {
    if (key === TOOL_OUTPUT_BOOTSTRAP_KEYS.additiveEntities) return;
    throw new Error(`unknown tool-output bootstrap step: ${key}`);
  }

  /** Read a marker's resume position, or null when absent/unreadable. */
  async readPosition(key: string): Promise<string | null> {
    const marker = await this.findMarker(key);
    if (!marker?.lastPositionJson) return null;
    try {
      return JSON.parse(marker.lastPositionJson) as string;
    } catch {
      return null;
    }
  }

  /** Persist a backfill's progress so an interrupted run resumes. */
  async writePosition(key: string, position: string): Promise<void> {
    await this.upsertMarker({
      key,
      completed: false,
      lastPositionJson: JSON.stringify(position),
    });
  }

  private async findMarker(
    key: string
  ): Promise<AIToolOutputBootstrapEntity | null> {
    const repo = this.dataSource.getRepository(AIToolOutputBootstrapEntity);
    return await repo.findOne({ where: { profileId: this.profileId, bootstrapKey: key } });
  }

  private async upsertMarker(input: {
    key: string;
    completed: boolean;
    lastPositionJson: string | null;
  }): Promise<void> {
    const repo = this.dataSource.getRepository(AIToolOutputBootstrapEntity);
    const entity =
      (await repo.findOne({
        where: { profileId: this.profileId, bootstrapKey: input.key },
      })) ?? new AIToolOutputBootstrapEntity();
    entity.id = entity.id ?? 1;
    entity.profileId = this.profileId;
    entity.bootstrapKey = input.key;
    entity.schemaVersion = TOOL_OUTPUT_SCHEMA_VERSION;
    entity.completed = input.completed;
    entity.lastPositionJson = input.lastPositionJson ?? undefined;
    await repo.save(entity);
  }
}
