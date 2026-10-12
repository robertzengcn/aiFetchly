import { BaseModule } from "./baseModule";
import {
  AiTaskRolloutMetricsModel,
  buildOriginCohort,
} from "@/model/AiTaskRolloutMetrics.model";
import { rolloutMetricsSnapshotSchema } from "@/entityTypes/aiTaskRolloutMetricsTypes";
import type {
  RolloutMetricsQuery,
  RolloutMetricsSnapshot,
  RolloutOriginCohort,
  RolloutOperationStats,
} from "@/entityTypes/aiTaskRolloutMetricsTypes";
import type { RolloutOrigin } from "@/entityTypes/aiTaskRolloutMetricsTypes";

/**
 * Business logic for the §17 rollout-metrics snapshot (PRD §12 measure
 * list; technical-design §17 "Monitor …"). Read-only: the module wraps the
 * model's aggregation queries and assembles + schema-validates the
 * snapshot. Nothing here mutates, enrolls, or finalizes — the snapshot is
 * a reproducible monitor, not an actor.
 *
 * Fail-closed contract: on ANY error (missing tables on a pre-migration DB,
 * corrupt rows, driver failure) the module returns an all-zero snapshot
 * rather than throwing — a monitor must never crash its caller (the IPC
 * handler in T26b), and a zeroed snapshot is honest ("no measurable
 * rows"), not fabricated data.
 *
 * Worker guard: the model asserts `assertNotWorker` on every entry point
 * (NFR-03) — workers must never read the rollout tables directly.
 */
export class AiTaskRolloutMetricsModule extends BaseModule {
  private readonly model: AiTaskRolloutMetricsModel;

  constructor() {
    super();
    this.model = new AiTaskRolloutMetricsModel(this.dbpath);
  }

  /**
   * Build the §17 monitor snapshot for rows created at/after `since`.
   * The returned snapshot is validated through `rolloutMetricsSnapshotSchema`
   * so a malformed aggregation cannot leak a partial/NaN-poisoned object
   * past the module boundary (the same schema the IPC envelope re-validates
   * for defense in depth at T26b).
   */
  async getRolloutSnapshot(
    query: RolloutMetricsQuery
  ): Promise<RolloutMetricsSnapshot> {
    const generatedAt = new Date().toISOString();
    try {
      await this.ensureConnection();

      const tablesReady = await this.model.tablesExist();
      if (!tablesReady) {
        // Pre-migration DB (or a fresh install before the first run):
        // all-zero snapshot, fail-closed.
        return this.emptySnapshot(query, generatedAt);
      }

      const aggregated = await this.model.aggregateSince(query);

      const manual = this.buildCohort("manual", aggregated);
      const scheduled = this.buildCohort("scheduled", aggregated);
      const operations = this.buildOperationStats(aggregated.operationGroups);

      return rolloutMetricsSnapshotSchema.parse({
        schemaVersion: 1,
        generatedAt,
        since: query.since,
        manual,
        scheduled,
        operations,
      });
    } catch {
      // Fail-closed: any aggregation/validation error → zeroed snapshot.
      // Zeroed counters are honest ("nothing measurable") — a monitor never
      // fabricates numbers and never throws into the IPC layer.
      return this.emptySnapshot(query, generatedAt);
    }
  }

  /**
   * Assemble one origin cohort from the aggregated rows: execution groups
   * and latency rows filtered to the cohort's origin_type, plus the
   * matching origin's ledger-consumption group.
   */
  private buildCohort(
    origin: RolloutOrigin,
    aggregated: Awaited<ReturnType<AiTaskRolloutMetricsModel["aggregateSince"]>>
  ): RolloutOriginCohort {
    return buildOriginCohort({
      origin,
      executionGroups: aggregated.executionGroups.filter(
        (row) => row.origin_type === origin
      ),
      ledgerGroup: aggregated.ledgerGroups.find(
        (row) => row.origin_type === origin
      ),
      latencyRows: aggregated.latencyRows.filter(
        (row) => row.origin_type === origin
      ),
    });
  }

  /**
   * Fold the operation-state histogram into the fixed-shape stats object
   * (every §10.2 state always present so a consumer can chart without
   * key-presence checks).
   */
  private buildOperationStats(
    groups: readonly {
      readonly operation_state: string;
      readonly row_count: number;
    }[]
  ): RolloutOperationStats {
    const byState: Record<string, number> = {};
    let total = 0;
    for (const row of groups) {
      const count = asNonNegative(row.row_count);
      byState[row.operation_state] = count;
      total += count;
    }
    return {
      total,
      pending: byState["pending"] ?? 0,
      claimed: byState["claimed"] ?? 0,
      dispatched: byState["dispatched"] ?? 0,
      accepted: byState["accepted"] ?? 0,
      completed: byState["completed"] ?? 0,
      failed: byState["failed"] ?? 0,
      unknown: byState["unknown"] ?? 0,
    };
  }

  /**
   * The all-zero fail-closed snapshot (§17 requires both origin cohorts and
   * the operation histogram to always be present in the payload).
   */
  private emptySnapshot(
    query: RolloutMetricsQuery,
    generatedAt: string
  ): RolloutMetricsSnapshot {
    return rolloutMetricsSnapshotSchema.parse({
      schemaVersion: 1,
      generatedAt,
      since: query.since,
      manual: buildOriginCohort({
        origin: "manual",
        executionGroups: [],
        ledgerGroup: undefined,
        latencyRows: [],
      }),
      scheduled: buildOriginCohort({
        origin: "scheduled",
        executionGroups: [],
        ledgerGroup: undefined,
        latencyRows: [],
      }),
      operations: {
        total: 0,
        pending: 0,
        claimed: 0,
        dispatched: 0,
        accepted: 0,
        completed: 0,
        failed: 0,
        unknown: 0,
      },
    });
  }
}

function asNonNegative(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
