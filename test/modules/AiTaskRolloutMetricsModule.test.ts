"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskRolloutMetricsModule } from "@/modules/AiTaskRolloutMetricsModule";
import { AiTaskRolloutMetricsModel } from "@/model/AiTaskRolloutMetrics.model";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import {
  MANUAL_BUDGET_DEFAULTS,
} from "@/service/aiTaskExecution/budgetDefaults";
import type { CreateExecutionResult } from "@/model/AiTaskExecution.model";
import type { TaskOutcome } from "@/entityTypes/aiTaskExecutionTypes";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir to avoid the known SQLITE_BUSY shared-db flake.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-rollout-metrics-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (
    SqliteDb as unknown as { currentDbPath: string | null }
  ).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

/**
 * The snapshot is a COUNT(*) aggregation over the WHOLE window, so any row
 * left by a previous test in this file would leak into the next test's
 * numbers (keyed-row suites don't have this problem; aggregate suites do).
 * Wipe the three rollout tables between tests for per-test isolation.
 */
async function wipeRolloutTables(): Promise<void> {
  const runner = SqliteDb.getInstance(tmpDir).connection.createQueryRunner();
  try {
    await runner.query("DELETE FROM ai_task_operation");
    await runner.query("DELETE FROM ai_task_execution");
    await runner.query("DELETE FROM ai_task_execution_ledger");
  } finally {
    await runner.release();
  }
}

/**
 * Narrow `startExecution`'s discriminated result to the `created` variant —
 * every seed below uses unique conversation/submission pairs, so anything
 * else is a test bug.
 */
function unwrapCreated(
  result: CreateExecutionResult
): { executionId: string; ledgerId: string } {
  if (result.status !== "created") {
    throw new Error(
      `expected startExecution to create a new row, got status=${result.status}`
    );
  }
  return result;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}-${seq}`;
}

/** Seed one manual execution (unique submission per call). */
async function seedManual(input: {
  readonly route: string;
  readonly outcome?: TaskOutcome;
  readonly reasonCode?: string;
  readonly tokens?: number;
  readonly continuations?: number;
  readonly waitMs?: number;
}): Promise<{ executionId: string; ledgerId: string }> {
  const mod = new AiTaskExecutionModule();
  const submissionId = nextId("sub");
  const created = unwrapCreated(
    await mod.startExecution({
      conversationId: nextId("conv"),
      sourceUserMessageId: nextId("msg"),
      submissionId,
      requestHash: `sha256:${submissionId}`,
      origin: { type: "manual", submissionId },
      route: input.route as "response_only",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    })
  );

  if (
    input.tokens !== undefined ||
    input.continuations !== undefined ||
    input.waitMs !== undefined
  ) {
    const spent = await mod.persistBudgetConsumption({
      ledgerId: created.ledgerId,
      expectedOwnerGeneration: 0,
      activeExecutionId: created.executionId,
      delta: {
        tokens: input.tokens ?? 0,
        continuations: input.continuations ?? 0,
        waitMs: input.waitMs ?? 0,
      },
    });
    expect(spent, "persistBudgetConsumption should succeed on the fresh lease")
      .to.equal(true);
  }

  if (input.outcome) {
    const exec = await mod.getExecution(created.executionId);
    const finalized = await mod.finalizeExecution({
      executionId: created.executionId,
      expectedVersion: exec?.execution_state_version ?? 0,
      outcome: input.outcome,
      reasonCode: input.reasonCode ?? "UNKNOWN_ACTION_OUTCOME",
      summary: "seeded for rollout metrics",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(finalized.ok, `finalize should succeed: ${finalized.reasonCode ?? ""}`)
      .to.equal(true);
  }
  return created;
}

/** Seed one scheduled execution (submissionId null; occurrence-key identity). */
async function seedScheduled(input: {
  readonly route: string;
  readonly outcome?: TaskOutcome;
  readonly reasonCode?: string;
}): Promise<{ executionId: string; ledgerId: string }> {
  const mod = new AiTaskExecutionModule();
  const created = unwrapCreated(
    await mod.startExecution({
      conversationId: nextId("sconv"),
      sourceUserMessageId: nextId("smsg"),
      submissionId: null,
      requestHash: `sha256:${nextId("sreq")}`,
      origin: {
        type: "scheduled",
        taskId: 1,
        runId: seq + 1,
        occurrenceKey: nextId("occ"),
      },
      route: input.route as "task_verified",
      completionOwner: "standalone",
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
    })
  );

  if (input.outcome) {
    const exec = await mod.getExecution(created.executionId);
    const finalized = await mod.finalizeExecution({
      executionId: created.executionId,
      expectedVersion: exec?.execution_state_version ?? 0,
      outcome: input.outcome,
      reasonCode: input.reasonCode ?? "UNKNOWN_ACTION_OUTCOME",
      summary: "seeded for rollout metrics",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(finalized.ok, `finalize should succeed: ${finalized.reasonCode ?? ""}`)
      .to.equal(true);
  }
  return created;
}

/** Seed one operation row, optionally advancing it along the state machine. */
async function seedOperation(input: {
  readonly executionId: string;
  readonly states: readonly (
    | "claimed"
    | "dispatched"
    | "accepted"
    | "completed"
    | "failed"
    | "unknown"
  )[];
}): Promise<void> {
  const mod = new AiTaskOperationModule();
  const key = nextId("opk");
  const created = await mod.recordOperation({
    operationKey: key,
    executionId: input.executionId,
    toolIdentity: "send_email",
    domainTarget: null,
    intentHash: `sha256:${key}`,
  });
  expect(created.ok, "recordOperation should succeed").to.equal(true);
  let generation = 0;
  for (const state of input.states) {
    // Claim bumps generation; every subsequent transition bumps it again.
    const result = await mod.updateState({
      operationKey: key,
      expectedClaimGeneration: generation,
      newState: state,
    });
    expect(
      result.ok,
      `transition to ${state} should succeed: ${result.reasonCode ?? ""}`
    ).to.equal(true);
    generation += 1;
  }
}

/** Query helper: `since` = an instant guaranteed to predate all seeds. */
function windowStart(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

describe("AiTaskRolloutMetricsModule (§17 snapshot; Mocha)", function () {
  this.timeout(20000);

  beforeEach(async () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await wipeRolloutTables();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("returns an all-zero snapshot on an empty database", async () => {
    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });

    expect(snapshot.schemaVersion).to.equal(1);
    expect(snapshot.manual.origin).to.equal("manual");
    expect(snapshot.scheduled.origin).to.equal("scheduled");
    for (const cohort of [snapshot.manual, snapshot.scheduled]) {
      expect(cohort.routes).to.deep.equal({});
      expect(cohort.incompleteReasons).to.deep.equal({});
      expect(cohort.outcomes).to.deep.equal({
        verified_complete: 0,
        incomplete: 0,
        needs_user_input: 0,
        blocked_by_policy: 0,
        failed: 0,
        cancelled: 0,
        timeout: 0,
      });
      expect(cohort.consumption).to.deep.equal({
        executions: 0,
        continuations: 0,
        providerAttempts: 0,
        toolExecutions: 0,
        checkerAttempts: 0,
        actualTokens: 0,
        estimatedTokens: 0,
        activeRuntimeMs: 0,
        waitMs: 0,
      });
      expect(cohort.latency).to.deep.equal({
        finalizedCount: 0,
        totalLatencyMs: 0,
        maxLatencyMs: 0,
      });
    }
    expect(snapshot.operations).to.deep.equal({
      total: 0,
      pending: 0,
      claimed: 0,
      dispatched: 0,
      accepted: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
    });
    // Empty DB (read succeeded, nothing migrated/seeded) is NOT degraded.
    expect(snapshot.degraded).to.equal(false);
  });

  it("marks the snapshot degraded (not silently zero) when the aggregation throws (D7)", async () => {
    // A real, seeded DB that the monitor can normally read — then break the
    // read by dropping one rollout table mid-flight, simulating a corrupt/
    // concurrently-migrating store. The monitor must still return the
    // all-zero shape (never throw into IPC) but flag degraded:true so an
    // operator can tell "read failed" from "nothing measurable".
    await seedManual({ route: "task_verified", outcome: "verified_complete" });
    const runner = SqliteDb.getInstance(tmpDir).connection.createQueryRunner();
    try {
      await runner.query("DROP TABLE ai_task_execution_ledger");
    } finally {
      await runner.release();
    }
    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });
    expect(snapshot.manual.consumption.executions).to.equal(0);
    expect(snapshot.operations.total).to.equal(0);
    expect(snapshot.degraded).to.equal(true);
  });

  it("aggregates seeded rows per origin: counts, routes, outcomes, reasons, sums, latency", async () => {
    // Manual cohort: 2 verified_complete + 1 incomplete (NO_PROGRESS) +
    // 1 failed (TOKEN_LIMIT); ledger consumption spread over two lineages.
    await seedManual({ route: "task_verified", outcome: "verified_complete" });
    await seedManual({
      route: "task_verified",
      outcome: "verified_complete",
      tokens: 120,
      continuations: 1,
      waitMs: 500,
    });
    await seedManual({
      route: "response_only",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
    });
    await seedManual({
      route: "task_best_effort",
      outcome: "failed",
      reasonCode: "TOKEN_LIMIT",
      tokens: 80,
    });

    // Scheduled cohort: 1 verified_complete + 1 incomplete.
    await seedScheduled({ route: "task_verified", outcome: "verified_complete" });
    await seedScheduled({
      route: "task_verified",
      outcome: "incomplete",
      reasonCode: "CONTINUATION_LIMIT",
    });

    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });

    // --- manual cohort ---
    expect(snapshot.manual.consumption.executions).to.equal(4);
    expect(snapshot.manual.routes).to.deep.equal({
      task_verified: 2,
      response_only: 1,
      task_best_effort: 1,
    });
    expect(snapshot.manual.outcomes.verified_complete).to.equal(2);
    expect(snapshot.manual.outcomes.incomplete).to.equal(1);
    expect(snapshot.manual.outcomes.failed).to.equal(1);
    // Reasons histogram covers non-verified terminal rows only.
    expect(snapshot.manual.incompleteReasons).to.deep.equal({
      NO_PROGRESS: 1,
      TOKEN_LIMIT: 1,
    });
    // Ledger sums come from the shared-ledger-deduped join: lineage 1
    // (120 tokens, 1 continuation, 500ms wait) + lineage 2 (80 tokens).
    expect(snapshot.manual.consumption.actualTokens).to.equal(200);
    expect(snapshot.manual.consumption.continuations).to.equal(1);
    expect(snapshot.manual.consumption.waitMs).to.equal(500);
    // Latency: all four manual rows were finalized → finalizedCount counts
    // ALL finalized rows (4). Latencies are wall-clock deltas (created →
    // finalized within the same test tick) so they are small and jittery:
    // assert invariants only — total ≥ max ≥ 0, and total ≥ per-row max.
    expect(snapshot.manual.latency.finalizedCount).to.equal(4);
    expect(snapshot.manual.latency.totalLatencyMs).to.be.at.least(0);
    expect(snapshot.manual.latency.maxLatencyMs).to.be.at.least(0);
    expect(snapshot.manual.latency.totalLatencyMs).to.be.at.least(
      snapshot.manual.latency.maxLatencyMs
    );
    expect(snapshot.manual.latency.maxLatencyMs).to.be.at.most(60_000);

    // --- scheduled cohort ---
    expect(snapshot.scheduled.consumption.executions).to.equal(2);
    expect(snapshot.scheduled.routes).to.deep.equal({ task_verified: 2 });
    expect(snapshot.scheduled.outcomes.verified_complete).to.equal(1);
    expect(snapshot.scheduled.outcomes.incomplete).to.equal(1);
    expect(snapshot.scheduled.incompleteReasons).to.deep.equal({
      CONTINUATION_LIMIT: 1,
    });
    // Segmentation: manual consumption must not leak into scheduled.
    expect(snapshot.scheduled.consumption.actualTokens).to.equal(0);
  });

  it("counts an unfinalized execution in executions/routes but not in outcomes/latency", async () => {
    await seedManual({ route: "task_verified" }); // never finalized
    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });
    expect(snapshot.manual.consumption.executions).to.equal(1);
    expect(snapshot.manual.routes).to.deep.equal({ task_verified: 1 });
    expect(Object.values(snapshot.manual.outcomes).every((n) => n === 0)).to
      .equal(true);
    expect(snapshot.manual.latency.finalizedCount).to.equal(0);
    expect(snapshot.manual.incompleteReasons).to.deep.equal({});
  });

  it("histograms operation states (§17 operation reconciliation)", async () => {
    const a = await seedManual({ route: "task_verified", outcome: "verified_complete" });
    const b = await seedManual({ route: "task_verified", outcome: "verified_complete" });
    const c = await seedManual({ route: "response_only" });

    await seedOperation({ executionId: a.executionId, states: ["claimed", "dispatched", "accepted"] });
    await seedOperation({ executionId: b.executionId, states: ["claimed", "dispatched", "failed"] });
    await seedOperation({ executionId: c.executionId, states: [] }); // stays pending

    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });
    expect(snapshot.operations).to.deep.equal({
      total: 3,
      pending: 1,
      claimed: 0,
      dispatched: 0,
      accepted: 1,
      completed: 0,
      failed: 1,
      unknown: 0,
    });
  });

  it("counts an unresolved unknown operation in the histogram (duplicate-effect audit trail)", async () => {
    const a = await seedManual({ route: "task_verified" });
    await seedOperation({ executionId: a.executionId, states: ["claimed", "dispatched", "unknown"] });

    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });
    expect(snapshot.operations.total).to.equal(1);
    expect(snapshot.operations.unknown).to.equal(1);
  });

  it("counts a shared lineage ledger ONCE (Continue successors do not double-count)", async () => {
    const execMod = new AiTaskExecutionModule();
    // Parent: fresh lineage with consumption.
    const parent = unwrapCreated(
      await execMod.startExecution({
        conversationId: nextId("conv"),
        sourceUserMessageId: nextId("msg"),
        submissionId: nextId("sub"),
        requestHash: "sha256:lineage-parent",
        origin: { type: "manual", submissionId: nextId("sub2") },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      })
    );
    const spent = await execMod.persistBudgetConsumption({
      ledgerId: parent.ledgerId,
      expectedOwnerGeneration: 0,
      activeExecutionId: parent.executionId,
      delta: { tokens: 500, continuations: 2 },
    });
    expect(spent).to.equal(true);

    // Parent finalizes (releases the ledger); successor claims it via
    // lineageLedgerId and spends MORE against the same shared ledger.
    const parentExec = await execMod.getExecution(parent.executionId);
    const fin = await execMod.finalizeExecution({
      executionId: parent.executionId,
      expectedVersion: parentExec?.execution_state_version ?? 0,
      outcome: "incomplete",
      reasonCode: "CONTINUATION_LIMIT",
      summary: "parent exhausts continuations",
      evidenceIds: [],
      remainingWork: [],
    });
    expect(fin.ok).to.equal(true);

    const successor = unwrapCreated(
      await execMod.startExecution({
        conversationId: nextId("conv2"),
        sourceUserMessageId: nextId("msg2"),
        submissionId: nextId("sub3"),
        requestHash: "sha256:lineage-successor",
        origin: { type: "manual", submissionId: nextId("sub4") },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
        parentExecutionId: parent.executionId,
        lineageLedgerId: parent.ledgerId,
      })
    );
    const spent2 = await execMod.persistBudgetConsumption({
      ledgerId: successor.ledgerId,
      expectedOwnerGeneration: 1, // successor's claim bumped the generation
      activeExecutionId: successor.executionId,
      delta: { tokens: 300 },
    });
    expect(spent2).to.equal(true);

    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });

    // 2 execution rows, but ONE lineage ledger → the naive join would
    // double-count (500+300 appearing twice). The anchor dedup sums the
    // ledger once: 800.
    expect(snapshot.manual.consumption.executions).to.equal(2);
    expect(snapshot.manual.consumption.actualTokens).to.equal(800);
    expect(snapshot.manual.consumption.continuations).to.equal(2);
  });

  it("attributes a shared ledger to the stable lineage ROOT origin, not a random MIN(execution_id) member (G03, §17)", async () => {
    // Scheduled lineage with a manual Continue: the shared ledger's
    // consumption must stay in the scheduled cohort (the lineage root's
    // origin) even when the successor's random execution_id sorts below
    // every other member. MIN(execution_id) over UUIDs picks an arbitrary
    // member, so cohorts would flip as successors arrive.
    const execMod = new AiTaskExecutionModule();
    const parent = await seedScheduled({ route: "task_verified" });
    const spent = await execMod.persistBudgetConsumption({
      ledgerId: parent.ledgerId,
      expectedOwnerGeneration: 0,
      activeExecutionId: parent.executionId,
      delta: { tokens: 800 },
    });
    expect(spent).to.equal(true);

    // Manual Continue successor on the SAME shared ledger.
    const successor = unwrapCreated(
      await execMod.startExecution({
        conversationId: nextId("conv"),
        sourceUserMessageId: nextId("msg"),
        submissionId: nextId("sub"),
        requestHash: `sha256:${nextId("req")}`,
        origin: { type: "manual", submissionId: nextId("sub2") },
        route: "task_verified",
        completionOwner: "standalone",
        budgetLimits: MANUAL_BUDGET_DEFAULTS,
      })
    );
    // Rewire into one lineage with adversarial ids: the manual successor
    // sorts FIRST, so MIN(execution_id) would attribute to manual.
    const runner = SqliteDb.getInstance(tmpDir).connection.createQueryRunner();
    try {
      await runner.query(
        `UPDATE ai_task_execution SET execution_id = 'exec-zzz-root' WHERE execution_id = ?`,
        [parent.executionId]
      );
      await runner.query(
        `UPDATE ai_task_execution SET execution_id = 'exec-aaa-child', parent_execution_id = 'exec-zzz-root', lineage_ledger_id = ? WHERE execution_id = ?`,
        [parent.ledgerId, successor.executionId]
      );
    } finally {
      await runner.release();
    }

    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });

    // Root (scheduled) owns the cohort: 800 tokens scheduled, 0 manual.
    // The pre-G03 MIN(execution_id) anchor attributed to manual instead.
    expect(snapshot.scheduled.consumption.actualTokens).to.equal(800);
    expect(snapshot.manual.consumption.actualTokens).to.equal(0);
  });

  it("skips corrupt/unparseable timestamps in the latency pass without affecting counts", async () => {
    await seedManual({ route: "task_verified", outcome: "verified_complete" });

    // Corrupt one row's finalized_at directly (model writes
    // toISOString() there; make it unparseable).
    const runner = SqliteDb.getInstance(tmpDir).connection.createQueryRunner();
    try {
      await runner.query(
        `UPDATE ai_task_execution
            SET finalized_at = 'not-a-timestamp'
          WHERE finalized = 1`
      );
    } finally {
      await runner.release();
    }

    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });
    // The row still counts as finalized (durable row), but contributes no
    // latency sample (unparseable timestamp → skipped, fail-closed to 0).
    expect(snapshot.manual.latency.finalizedCount).to.equal(0);
    expect(snapshot.manual.latency.totalLatencyMs).to.equal(0);
    expect(snapshot.manual.latency.maxLatencyMs).to.equal(0);
    expect(snapshot.manual.outcomes.verified_complete).to.equal(1);
  });

  it("scopes the snapshot to the since window (older rows excluded)", async () => {
    await seedManual({ route: "task_verified", outcome: "verified_complete" });

    // Backdate the row beyond the window.
    const runner = SqliteDb.getInstance(tmpDir).connection.createQueryRunner();
    try {
      await runner.query(
        `UPDATE ai_task_execution
            SET "createdAt" = '2020-01-01 00:00:00'
          WHERE finalized = 1`
      );
    } finally {
      await runner.release();
    }

    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(), // now ~2026 → 2020 row is out of window
    });
    expect(snapshot.manual.consumption.executions).to.equal(0);
    expect(snapshot.manual.latency.finalizedCount).to.equal(0);
  });

  it("fail-closed: missing tables return the zeroed snapshot instead of throwing", async () => {
    // Simulate a pre-migration DB by dropping the three rollout tables.
    const runner = SqliteDb.getInstance(tmpDir).connection.createQueryRunner();
    try {
      await runner.query("DROP TABLE ai_task_operation");
      await runner.query("DROP TABLE ai_task_execution_ledger");
      await runner.query("DROP TABLE ai_task_execution");
    } finally {
      await runner.release();
    }

    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });
    expect(snapshot.schemaVersion).to.equal(1);
    expect(snapshot.manual.consumption.executions).to.equal(0);
    expect(snapshot.scheduled.consumption.executions).to.equal(0);
    expect(snapshot.operations.total).to.equal(0);
  });

  it("keeps estimatedTokens at 0 (honest: no durable reservation store)", async () => {
    await seedManual({ route: "task_verified", outcome: "verified_complete", tokens: 42 });
    const snapshot = await new AiTaskRolloutMetricsModule().getRolloutSnapshot({
      since: windowStart(),
    });
    // consumed_tokens is the reconciled ACTUAL total. The policy has no
    // durable estimated-token reservation rows (reservations are in-memory
    // TaskRunBudget mirrors only), so estimatedTokens must stay 0 — the
    // honest "no data" rather than a fabricated estimate.
    expect(snapshot.manual.consumption.actualTokens).to.equal(42);
    expect(snapshot.manual.consumption.estimatedTokens).to.equal(0);
  });

  it("guards worker access: BaseDb construction throws for model and module (NFR-03)", () => {
    const previous = process.env.WORKER_TYPE;
    process.env.WORKER_TYPE = "test-worker";
    try {
      // The worker guard is enforced at BaseDb construction (assertNotWorker
      // runs before any model wiring): a worker can never wire the rollout
      // tables at all — stricter than the previous per-method guard whose
      // throw the module's fail-close contract used to absorb. The
      // fail-close-to-zeroed-snapshot behavior for table/row errors keeps
      // its own coverage above (partial tables, malformed rows).
      expect(() => new AiTaskRolloutMetricsModel(tmpDir)).to.throw(
        "Direct database access from worker process is not allowed"
      );
      expect(() => new AiTaskRolloutMetricsModule()).to.throw(/worker/i);
    } finally {
      if (previous === undefined) {
        delete process.env.WORKER_TYPE;
      } else {
        process.env.WORKER_TYPE = previous;
      }
    }
  });
});
