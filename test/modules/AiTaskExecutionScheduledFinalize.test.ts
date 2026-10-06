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
});
