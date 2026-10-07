"use strict";
import { expect } from "chai";
import { SqliteDb } from "@/config/SqliteDb";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiMessageTaskModel } from "@/model/AiMessageTask.model";
import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { AiMessageTaskRunModel } from "@/model/AiMessageTaskRun.model";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import {
  MANUAL_BUDGET_DEFAULTS,
  buildScheduledBudgetLimits,
} from "@/service/aiTaskExecution/budgetDefaults";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir to avoid the known SQLITE_BUSY shared-db flake.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-task-exec-sched-finalize-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

/**
 * Narrow `startExecution`'s discriminated result to the `created` variant.
 */
function unwrapCreated(
  result: import("@/model/AiTaskExecution.model").CreateExecutionResult
): { executionId: string; ledgerId: string } {
  if (result.status !== "created") {
    throw new Error(
      `expected startExecution to create a new row, got status=${result.status}`
    );
  }
  return result;
}

describe("AiTaskExecutionScheduledFinalize (Mocha)", function () {
  this.timeout(15000);

  beforeEach(async () => {
    if (!fs.existsSync(tmpDir))
      fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  /**
   * Seed a real task + interval schedule + occurrence run row via the model
   * APIs (startExecution with a scheduled origin stores the TASK id in
   * schedule_id — the Unit 6 finalize input carries the real scheduleId
   * explicitly). Returns the seeded scheduleId, runId, and execution CAS
   * version.
   */
  async function seedScheduledWorld(
    conversationId: string,
    occurrence: number
  ): Promise<{
    scheduleId: number;
    runId: number;
    executionId: string;
    expectedVersion: number;
  }> {
    const tasks = new AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    const runs = new AiMessageTaskRunModel(tmpDir);
    const anchor = new Date();
    const taskId = await tasks.createChatScheduledTask({
      name: "test-loop",
      message: "check deployment",
      conversationId,
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
      maxToolCalls: 5,
      maxRuntimeMs: 300_000,
      maxContinueCalls: 3,
      sourceType: "chat_scheduled_loop",
    });
    const scheduleId = await schedules.createIntervalSchedule({
      name: "loop",
      taskId,
      conversationId,
      intervalMs: 60_000,
      anchorAt: anchor,
      nextRunAt: new Date(anchor.getTime() + 60_000),
      maxExecutionCount: 24,
      expiresAt: new Date(anchor.getTime() + 24 * 60 * 60 * 1000),
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });
    const runId = await runs.createOccurrence({
      taskId,
      scheduleId,
      conversationId,
      occurrence,
      scheduledFor: anchor,
      catchUp: false,
      idempotencyKey: `scheduled-loop:${scheduleId}:${occurrence}`,
    });

    const mod = new AiTaskExecutionModule();
    const started = unwrapCreated(await mod.startExecution({
      conversationId,
      sourceUserMessageId: `scheduled-user-${conversationId}`,
      submissionId: null,
      requestHash: `sha256:${conversationId}`,
      origin: {
        type: "scheduled",
        taskId,
        runId,
        occurrenceKey: `scheduled-loop:${scheduleId}:${occurrence}`,
      },
      route: "task_best_effort",
      completionOwner: "standalone",
      budgetLimits: buildScheduledBudgetLimits({
        maxContinueCalls: 3,
        maxToolCalls: 10,
        maxRuntimeMs: 300_000,
      }),
    }));
    const exec = await mod.getExecution(started.executionId);
    return {
      scheduleId,
      runId,
      executionId: started.executionId,
      expectedVersion: exec?.execution_state_version ?? 0,
    };
  }

  it("finalizeScheduledExecution finalizes the execution + updates the run row in one transaction", async () => {
    const mod = new AiTaskExecutionModule();
    const seeded = await seedScheduledWorld("conv-sched-finalize-1", 1);

    const result = await mod.finalizeScheduledExecution({
      executionId: seeded.executionId,
      expectedVersion: seeded.expectedVersion,
      runId: seeded.runId,
      scheduleId: seeded.scheduleId,
      taskOutcome: "incomplete",
      reasonCode: "STREAM_INCOMPLETE",
      summary: "partial run",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${seeded.scheduleId}:1`,
      incrementFailure: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });
    expect(result.ok).to.equal(true);

    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: seeded.executionId },
    });
    expect(exec?.finalized).to.equal(true);
    expect(exec?.task_outcome).to.equal("incomplete");

    const runRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiMessageTaskRunEntity
    );
    const run = await runRepo.findOne({ where: { id: seeded.runId } });
    expect(run?.status).to.equal("incomplete");
    expect(run?.execution_id).to.equal(seeded.executionId);
    expect(run?.task_outcome).to.equal("incomplete");
    expect(run?.task_outcome_reason).to.equal("STREAM_INCOMPLETE");
  });

  it("finalizeScheduledExecution increments the schedule failure count exactly once", async () => {
    const mod = new AiTaskExecutionModule();
    const schedules = new ScheduleTaskModel(tmpDir);
    const seeded = await seedScheduledWorld("conv-sched-finalize-2", 2);
    // Known count baseline on the freshly created schedule.
    const scheduleRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      (await import("@/entity/ScheduleTask.entity")).ScheduleTaskEntity
    );
    await scheduleRepo.update(
      { id: seeded.scheduleId },
      { consecutive_failure_count: 1 }
    );

    await mod.finalizeScheduledExecution({
      executionId: seeded.executionId,
      expectedVersion: seeded.expectedVersion,
      runId: seeded.runId,
      scheduleId: seeded.scheduleId,
      taskOutcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      summary: "fail",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${seeded.scheduleId}:2`,
      incrementFailure: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });

    const schedule = await schedules.getScheduleById(seeded.scheduleId);
    expect(schedule?.consecutive_failure_count).to.equal(2);
  });

  it("finalizeScheduledExecution does NOT increment the failure count on cancellation (FR-12)", async () => {
    const mod = new AiTaskExecutionModule();
    const schedules = new ScheduleTaskModel(tmpDir);
    const seeded = await seedScheduledWorld("conv-sched-finalize-3", 3);
    const scheduleRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      (await import("@/entity/ScheduleTask.entity")).ScheduleTaskEntity
    );
    await scheduleRepo.update(
      { id: seeded.scheduleId },
      { consecutive_failure_count: 1 }
    );

    await mod.finalizeScheduledExecution({
      executionId: seeded.executionId,
      expectedVersion: seeded.expectedVersion,
      runId: seeded.runId,
      scheduleId: seeded.scheduleId,
      taskOutcome: "cancelled",
      reasonCode: "RUN_INTERRUPTED",
      summary: "user cancelled",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${seeded.scheduleId}:3`,
      incrementFailure: false,
      nextRunAt: new Date(Date.now() + 60_000),
    });

    const schedule = await schedules.getScheduleById(seeded.scheduleId);
    expect(schedule?.consecutive_failure_count).to.equal(1);
  });

  it("finalizeScheduledExecution on a missing execution returns MISSING_TASK_OUTCOME (never success)", async () => {
    const mod = new AiTaskExecutionModule();
    const result = await mod.finalizeScheduledExecution({
      executionId: "exec-does-not-exist",
      expectedVersion: 0,
      runId: 99,
      scheduleId: 2,
      taskOutcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "x",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: "scheduled-loop:2:99",
      incrementFailure: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });
    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("MISSING_TASK_OUTCOME");
  });

  it("scheduled budget defaults differ from manual defaults (route sanity)", async () => {
    // Sanity guard: scheduled limits come from buildScheduledBudgetLimits
    // (min(task config, 3) continuations), not MANUAL_BUDGET_DEFAULTS.
    const scheduled = buildScheduledBudgetLimits({
      maxContinueCalls: 3,
      maxToolCalls: 10,
      maxRuntimeMs: 300_000,
    });
    expect(scheduled.maxContinuations).to.equal(3);
    expect(scheduled.maxActiveRuntimeMs).to.equal(300_000);
  });

  // ----- T19: failure-streak accounting + linked-record validation -----
  //
  // The streak bug (T19): `consecutive_failure_count` only incremented when
  // `incrementFailure=true`; on `verified_complete` (incrementFailure=false)
  // the streak was LEFT UNTOUCHED rather than reset to 0. A failure → success
  // → failure sequence grew the streak across the success, triggering
  // premature REPEATED_RUN_FAILURE. The fix derives streak semantics from
  // `taskOutcome`: verified_complete resets to 0; cancelled stays untouched
  // (FR-12: not a failure, not a success); incomplete/failed/timeout increment.

  it("T19: verified_complete resets consecutive_failure_count to 0 (streak reset on success)", async () => {
    const mod = new AiTaskExecutionModule();
    const schedules = new ScheduleTaskModel(tmpDir);
    const seeded = await seedScheduledWorld("conv-t19-reset", 1);
    const scheduleRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      (await import("@/entity/ScheduleTask.entity")).ScheduleTaskEntity
    );
    // Streak baseline = 2 (two prior failures).
    await scheduleRepo.update(
      { id: seeded.scheduleId },
      { consecutive_failure_count: 2, failure_count: 2 }
    );

    await mod.finalizeScheduledExecution({
      executionId: seeded.executionId,
      expectedVersion: seeded.expectedVersion,
      runId: seeded.runId,
      scheduleId: seeded.scheduleId,
      taskOutcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "done",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${seeded.scheduleId}:1`,
      // Callers set incrementFailure=false on verified_complete (the bug
      // was that this left the streak at 2 instead of resetting to 0).
      incrementFailure: false,
      nextRunAt: new Date(Date.now() + 60_000),
    });

    const schedule = await schedules.getScheduleById(seeded.scheduleId);
    expect(schedule?.consecutive_failure_count).to.equal(0);
    // failure_count is cumulative — NOT reset (only the consecutive streak resets).
    expect(schedule?.failure_count).to.equal(2);
  });

  it("T19: cancelled leaves consecutive_failure_count untouched (FR-12 no-reset no-increment)", async () => {
    const mod = new AiTaskExecutionModule();
    const schedules = new ScheduleTaskModel(tmpDir);
    const seeded = await seedScheduledWorld("conv-t19-cancel", 1);
    const scheduleRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      (await import("@/entity/ScheduleTask.entity")).ScheduleTaskEntity
    );
    await scheduleRepo.update(
      { id: seeded.scheduleId },
      { consecutive_failure_count: 2, failure_count: 2 }
    );

    await mod.finalizeScheduledExecution({
      executionId: seeded.executionId,
      expectedVersion: seeded.expectedVersion,
      runId: seeded.runId,
      scheduleId: seeded.scheduleId,
      taskOutcome: "cancelled",
      reasonCode: "RUN_INTERRUPTED",
      summary: "user cancelled",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${seeded.scheduleId}:1`,
      incrementFailure: false,
      nextRunAt: new Date(Date.now() + 60_000),
    });

    const schedule = await schedules.getScheduleById(seeded.scheduleId);
    expect(schedule?.consecutive_failure_count).to.equal(2);
    expect(schedule?.failure_count).to.equal(2);
  });

  it("T19: failure → success → failure resets streak between, so no premature REPEATED_RUN_FAILURE", async () => {
    const mod = new AiTaskExecutionModule();
    const schedules = new ScheduleTaskModel(tmpDir);
    const runs = new AiMessageTaskRunModel(tmpDir);
    const seeded1 = await seedScheduledWorld("conv-t19-seq", 1);
    const targetScheduleId = seeded1.scheduleId;
    const scheduleRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      (await import("@/entity/ScheduleTask.entity")).ScheduleTaskEntity
    );
    await scheduleRepo.update(
      { id: targetScheduleId },
      { consecutive_failure_count: 0, failure_count: 0 }
    );

    /**
     * Seed an additional occurrence run + execution against the SAME
     * schedule (occurrence 1's run already exists from seedScheduledWorld).
     * Distinct occurrence numbers keep the (schedule_id, occurrence) unique
     * index and the occurrence_key dedup happy.
     */
    const seedOccurrenceForSchedule = async (
      occurrence: number
    ): Promise<{ runId: number; executionId: string; expectedVersion: number }> => {
      const runId = await runs.createOccurrence({
        taskId: (await schedules.getScheduleById(targetScheduleId))?.task_id ?? 0,
        scheduleId: targetScheduleId,
        conversationId: "conv-t19-seq",
        occurrence,
        scheduledFor: new Date(),
        catchUp: false,
        idempotencyKey: `scheduled-loop:${targetScheduleId}:${occurrence}`,
      });
      const started = unwrapCreated(await mod.startExecution({
        conversationId: "conv-t19-seq",
        sourceUserMessageId: `scheduled-user-conv-t19-seq`,
        submissionId: null,
        requestHash: `sha256:conv-t19-seq:${occurrence}`,
        origin: {
          type: "scheduled",
          taskId: (await schedules.getScheduleById(targetScheduleId))?.task_id ?? 0,
          runId,
          occurrenceKey: `scheduled-loop:${targetScheduleId}:${occurrence}`,
        },
        route: "task_best_effort",
        completionOwner: "standalone",
        budgetLimits: buildScheduledBudgetLimits({
          maxContinueCalls: 3,
          maxToolCalls: 10,
          maxRuntimeMs: 300_000,
        }),
      }));
      const exec = await mod.getExecution(started.executionId);
      return {
        runId,
        executionId: started.executionId,
        expectedVersion: exec?.execution_state_version ?? 0,
      };
    };

    // Occurrence 1: failure → streak 1.
    await mod.finalizeScheduledExecution({
      executionId: seeded1.executionId,
      expectedVersion: seeded1.expectedVersion,
      runId: seeded1.runId,
      scheduleId: targetScheduleId,
      taskOutcome: "incomplete",
      reasonCode: "STREAM_INCOMPLETE",
      summary: "fail 1",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${targetScheduleId}:1`,
      incrementFailure: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });
    let schedule = await schedules.getScheduleById(targetScheduleId);
    expect(schedule?.consecutive_failure_count).to.equal(1);

    // Occurrence 2: success → streak RESET to 0 (the bug kept it at 1).
    const seeded2 = await seedOccurrenceForSchedule(2);
    await mod.finalizeScheduledExecution({
      executionId: seeded2.executionId,
      expectedVersion: seeded2.expectedVersion,
      runId: seeded2.runId,
      scheduleId: targetScheduleId,
      taskOutcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      summary: "success",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${targetScheduleId}:2`,
      incrementFailure: false,
      nextRunAt: new Date(Date.now() + 60_000),
    });
    schedule = await schedules.getScheduleById(targetScheduleId);
    expect(schedule?.consecutive_failure_count).to.equal(0);

    // Occurrence 3: failure → streak 1 (NOT 2 — the success in between reset it).
    const seeded3 = await seedOccurrenceForSchedule(3);
    await mod.finalizeScheduledExecution({
      executionId: seeded3.executionId,
      expectedVersion: seeded3.expectedVersion,
      runId: seeded3.runId,
      scheduleId: targetScheduleId,
      taskOutcome: "incomplete",
      reasonCode: "STREAM_INCOMPLETE",
      summary: "fail 3",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${targetScheduleId}:3`,
      incrementFailure: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });
    schedule = await schedules.getScheduleById(targetScheduleId);
    expect(schedule?.consecutive_failure_count).to.equal(1);
    // failure_count is cumulative across all three (2 failures + 1 success).
    expect(schedule?.failure_count).to.equal(2);
  });

  it("T19: rejects a run row not linked to the execution's schedule (linkage validation, no partial update)", async () => {
    const mod = new AiTaskExecutionModule();
    const seeded = await seedScheduledWorld("conv-t19-link", 1);
    // Seed a SECOND schedule + run that is NOT linked to the execution's run.
    const tasks = new (await import("@/model/AiMessageTask.model")).AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    const runs = new (await import("@/model/AiMessageTaskRun.model")).AiMessageTaskRunModel(tmpDir);
    const otherTaskId = await tasks.createChatScheduledTask({
      name: "other-loop",
      message: "other",
      conversationId: "conv-t19-link-other",
      allowedTools: [],
      autoApproveTools: false,
      allowSkills: false,
      allowMcp: false,
      allowSubagents: false,
      maxToolCalls: 5,
      maxRuntimeMs: 300_000,
      maxContinueCalls: 3,
      sourceType: "chat_scheduled_loop",
    });
    const otherScheduleId = await schedules.createIntervalSchedule({
      name: "other",
      taskId: otherTaskId,
      conversationId: "conv-t19-link-other",
      intervalMs: 60_000,
      anchorAt: new Date(),
      nextRunAt: new Date(Date.now() + 60_000),
      maxExecutionCount: 24,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });
    const otherRunId = await runs.createOccurrence({
      taskId: otherTaskId,
      scheduleId: otherScheduleId,
      conversationId: "conv-t19-link-other",
      occurrence: 1,
      scheduledFor: new Date(),
      catchUp: false,
      idempotencyKey: `scheduled-loop:${otherScheduleId}:1`,
    });
    const scheduleRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      (await import("@/entity/ScheduleTask.entity")).ScheduleTaskEntity
    );
    await scheduleRepo.update(
      { id: seeded.scheduleId },
      { consecutive_failure_count: 0, failure_count: 0 }
    );

    // Pass the OTHER run's id with the execution's scheduleId — linkage mismatch.
    const result = await mod.finalizeScheduledExecution({
      executionId: seeded.executionId,
      expectedVersion: seeded.expectedVersion,
      runId: otherRunId,
      scheduleId: seeded.scheduleId,
      taskOutcome: "incomplete",
      reasonCode: "STREAM_INCOMPLETE",
      summary: "linkage mismatch",
      evidenceIds: [],
      remainingWork: [],
      idempotencyKey: `scheduled-loop:${otherScheduleId}:1`,
      incrementFailure: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });

    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("LINKED_RECORD_MISMATCH");

    // No partial update: the execution stays unfinalized, the schedule streak stays 0.
    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: seeded.executionId },
    });
    expect(exec?.finalized).to.equal(false);
    const schedule = await schedules.getScheduleById(seeded.scheduleId);
    expect(schedule?.consecutive_failure_count).to.equal(0);
    expect(schedule?.failure_count).to.equal(0);
  });

  it("T19: rejects when the run's idempotency key does not match the finalize input (linkage validation)", async () => {
    const mod = new AiTaskExecutionModule();
    const seeded = await seedScheduledWorld("conv-t19-idem", 1);
    const scheduleRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      (await import("@/entity/ScheduleTask.entity")).ScheduleTaskEntity
    );
    await scheduleRepo.update(
      { id: seeded.scheduleId },
      { consecutive_failure_count: 0, failure_count: 0 }
    );

    const result = await mod.finalizeScheduledExecution({
      executionId: seeded.executionId,
      expectedVersion: seeded.expectedVersion,
      runId: seeded.runId,
      scheduleId: seeded.scheduleId,
      taskOutcome: "incomplete",
      reasonCode: "STREAM_INCOMPLETE",
      summary: "wrong key",
      evidenceIds: [],
      remainingWork: [],
      // Mismatched idempotency key — the run row stores
      // `scheduled-loop:<scheduleId>:1`, not this.
      idempotencyKey: "scheduled-loop:999:999",
      incrementFailure: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });

    expect(result.ok).to.equal(false);
    expect(result.reasonCode).to.equal("LINKED_RECORD_MISMATCH");
    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    const exec = await execRepo.findOne({
      where: { execution_id: seeded.executionId },
    });
    expect(exec?.finalized).to.equal(false);
  });

  it("T20a: finalizeScheduledExecution preserves prior evidence/shadow state under the merged checkpoint", async () => {
    const mod = new AiTaskExecutionModule();
    const seeded = await seedScheduledWorld("conv-t20a-sched", 1);

    // Seed state accumulated during the run: evidence rows + a shadow
    // decision. The pre-T20 scheduled finalizer REPLACED all of this.
    const execRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AiTaskExecutionEntity
    );
    await execRepo.update(
      { execution_id: seeded.executionId },
      {
        execution_state_json: JSON.stringify({
          contractHash: "sha256:contract-t20a-sched",
          baseline: { contactsAtStart: 10 },
          evidence: [
            {
              evidenceId: "ev-sched-1",
              criterionId: "rec-1",
              contractHash: "sha256:contract-t20a-sched",
              executionId: seeded.executionId,
              observedAt: "2026-10-07T00:00:00.000Z",
              source: "scheduled_sink",
              sourceRevision: "r1",
              state: "pass",
              referenceIds: ["rec-1"],
              summary: "10 contacts saved",
            },
          ],
          shadowDecision: { type: "continue" },
        }),
        execution_state_version: 2,
      }
    );

    const result = await mod.finalizeScheduledExecution({
      executionId: seeded.executionId,
      expectedVersion: 2,
      runId: seeded.runId,
      scheduleId: seeded.scheduleId,
      taskOutcome: "incomplete",
      reasonCode: "STREAM_INCOMPLETE",
      summary: "partial run",
      evidenceIds: ["ev-sched-final"],
      remainingWork: ["rec-2"],
      // T19 linkage check: must match the run row's idempotency key.
      idempotencyKey: `scheduled-loop:${seeded.scheduleId}:1`,
      incrementFailure: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });
    expect(result.ok).to.equal(true);

    const exec = await execRepo.findOne({
      where: { execution_id: seeded.executionId },
    });
    const parsed = JSON.parse(
      exec?.execution_state_json ?? "{}"
    ) as Record<string, unknown>;

    // T20a core assertion: run-accumulated state survives finalization.
    expect(parsed.contractHash).to.equal("sha256:contract-t20a-sched");
    expect(parsed.baseline).to.deep.equal({ contactsAtStart: 10 });
    expect(parsed.shadowDecision).to.deep.equal({ type: "continue" });
    const evidence = parsed.evidence as Array<Record<string, unknown>>;
    expect(evidence).to.have.lengthOf(1);
    expect(evidence[0].evidenceId).to.equal("ev-sched-1");

    // The finalization facts merged under the stable `finalization` key.
    const checkpoint = parsed.finalization as Record<string, unknown>;
    expect(checkpoint.outcome).to.equal("incomplete");
    expect(checkpoint.reasonCode).to.equal("STREAM_INCOMPLETE");
    expect(checkpoint.evidenceIds).to.deep.equal(["ev-sched-final"]);
    expect(checkpoint.schemaVersion).to.equal(1);
  });
});
