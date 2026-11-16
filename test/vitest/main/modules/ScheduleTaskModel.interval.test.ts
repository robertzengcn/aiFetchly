import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { AiMessageTaskModel } from "@/model/AiMessageTask.model";
import { AiMessageTaskRunModel } from "@/model/AiMessageTaskRun.model";

const tmpDir = path.join(os.tmpdir(), "aifetchly-scheduled-loop-model");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

const DAY = 24 * 60 * 60 * 1000;

async function createTask(
  model: AiMessageTaskModel,
  convId: string
): Promise<number> {
  return await model.createChatScheduledTask({
    name: "test-loop",
    message: "check deployment",
    conversationId: convId,
    allowedTools: [],
    autoApproveTools: false,
    allowSkills: false,
    allowMcp: false,
    allowSubagents: false,
    maxToolCalls: 5,
    maxRuntimeMs: 300_000,
    maxContinueCalls: 5,
    sourceType: "chat_scheduled_loop",
  });
}

describe("ScheduleTaskModel interval operations", () => {
  it("creates an interval schedule and finds it by conversation", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-find");

    const anchor = new Date();
    const id = await schedules.createIntervalSchedule({
      name: "loop",
      taskId,
      conversationId: "v2-conv-find",
      intervalMs: 60_000,
      anchorAt: anchor,
      nextRunAt: new Date(anchor.getTime() + 60_000),
      maxExecutionCount: 24,
      expiresAt: new Date(anchor.getTime() + DAY),
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });
    expect(typeof id).toBe("number");

    const found = await schedules.findChatScheduledLoop("v2-conv-find");
    expect(found?.id).toBe(id);
    expect(found?.trigger_type).toBe("interval");
    expect(found?.source_conversation_id).toBe("v2-conv-find");
  });

  it("returns not_due when next_run_time is in the future", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-notdue");
    const anchor = new Date();
    const id = await schedules.createIntervalSchedule({
      name: "loop",
      taskId,
      conversationId: "v2-conv-notdue",
      intervalMs: 60_000,
      anchorAt: anchor,
      nextRunAt: new Date(anchor.getTime() + 60_000),
      maxExecutionCount: 24,
      expiresAt: new Date(anchor.getTime() + DAY),
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });

    const result = await schedules.claimIntervalOccurrence({
      scheduleId: id,
      now: anchor,
    });
    expect(result.kind).toBe("not_due");
  });

  it("claims a due occurrence and advances next_run_time to the future", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-claim");
    const anchor = new Date();
    const due = new Date(anchor.getTime() + 60_000);
    const id = await schedules.createIntervalSchedule({
      name: "loop",
      taskId,
      conversationId: "v2-conv-claim",
      intervalMs: 60_000,
      anchorAt: anchor,
      nextRunAt: due,
      maxExecutionCount: 24,
      expiresAt: new Date(anchor.getTime() + DAY),
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });

    const result = await schedules.claimIntervalOccurrence({
      scheduleId: id,
      now: new Date(due.getTime() + 5_000),
    });
    expect(result.kind).toBe("claimed");
    if (result.kind === "claimed") {
      expect(result.occurrence).toBe(1);
      expect(result.idempotencyKey).toBe(`scheduled-loop:${id}:1`);
    }

    // next_run_time must now be in the future relative to the claim time, so a
    // second immediate claim returns not_due.
    const again = await schedules.claimIntervalOccurrence({
      scheduleId: id,
      now: new Date(due.getTime() + 6_000),
    });
    expect(again.kind).toBe("not_due");
  });

  it("coalesces a due slot when a run is already pending", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    const runs = new AiMessageTaskRunModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-coalesce");
    const anchor = new Date();
    const due = new Date(anchor.getTime() + 60_000);
    const id = await schedules.createIntervalSchedule({
      name: "loop",
      taskId,
      conversationId: "v2-conv-coalesce",
      intervalMs: 60_000,
      anchorAt: anchor,
      nextRunAt: due,
      maxExecutionCount: 24,
      expiresAt: new Date(anchor.getTime() + DAY),
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });

    // First claim creates the pending run.
    const first = await schedules.claimIntervalOccurrence({
      scheduleId: id,
      now: new Date(due.getTime() + 1_000),
    });
    expect(first.kind).toBe("claimed");

    // Force the next slot to be due again while the run is still pending.
    await schedules.updateNextRunTime(id, new Date(due.getTime() + 60_000));
    const second = await schedules.claimIntervalOccurrence({
      scheduleId: id,
      now: new Date(due.getTime() + 61_000),
    });
    expect(second.kind).toBe("coalesced");

    // Only one run row exists for the schedule.
    const { total } = await runs.listBySchedule(id);
    expect(total).toBe(1);
  });

  it("expires the schedule when lifetime has elapsed", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-expire");
    const anchor = new Date();
    const id = await schedules.createIntervalSchedule({
      name: "loop",
      taskId,
      conversationId: "v2-conv-expire",
      intervalMs: 60_000,
      anchorAt: anchor,
      nextRunAt: anchor, // due now
      maxExecutionCount: 24,
      expiresAt: new Date(anchor.getTime() - 1), // already expired
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });

    const result = await schedules.claimIntervalOccurrence({
      scheduleId: id,
      now: anchor,
    });
    expect(result.kind).toBe("expired");
    if (result.kind === "expired") {
      expect(result.reason).toBe("SCHEDULE_EXPIRED");
    }
    const after = await schedules.getScheduleById(id);
    expect(after?.status).toBe("expired");
    expect(after?.is_active).toBe(false);
  });

  it("expires the schedule when max runs is reached", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-maxruns");
    const anchor = new Date();
    const firstSlot = new Date(anchor.getTime() + 60_000);
    const id = await schedules.createIntervalSchedule({
      name: "loop",
      taskId,
      conversationId: "v2-conv-maxruns",
      intervalMs: 60_000,
      anchorAt: anchor,
      nextRunAt: firstSlot,
      maxExecutionCount: 1,
      expiresAt: new Date(anchor.getTime() + DAY),
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });

    // First claim consumes the single allowed execution.
    const first = await schedules.claimIntervalOccurrence({
      scheduleId: id,
      now: new Date(firstSlot.getTime() + 1_000),
    });
    expect(first.kind).toBe("claimed");

    // Force another due slot; the execution bound is now exceeded.
    await schedules.updateNextRunTime(
      id,
      new Date(firstSlot.getTime() + 60_000)
    );
    const second = await schedules.claimIntervalOccurrence({
      scheduleId: id,
      now: new Date(firstSlot.getTime() + 61_000),
    });
    expect(second.kind).toBe("expired");
    if (second.kind === "expired") {
      expect(second.reason).toBe("MAX_RUNS_REACHED");
    }
  });
});

describe("AiMessageTaskRunModel.createOccurrence idempotency", () => {
  it("returns the same run id for a repeated idempotency key", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const runs = new AiMessageTaskRunModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-idem");

    const input = {
      taskId,
      scheduleId: 4242,
      conversationId: "v2-conv-idem",
      occurrence: 3,
      scheduledFor: new Date(),
      catchUp: false,
      idempotencyKey: "scheduled-loop:4242:3",
    };
    const first = await runs.createOccurrence(input);
    const second = await runs.createOccurrence(input);
    expect(second).toBe(first);

    const byKey = await runs.getByIdempotencyKey(input.idempotencyKey);
    expect(byKey?.id).toBe(first);
    expect(byKey?.occurrence).toBe(3);
  });
});

describe("Bug #2 waiting_for_conversation recovery and retry operations", () => {
  it("claimIntervalOccurrence retires an older waiting_for_conversation run and claims the new slot", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const schedules = new ScheduleTaskModel(tmpDir);
    const runs = new AiMessageTaskRunModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-wait-retire");

    const anchor = new Date();
    const firstSlot = new Date(anchor.getTime() + 60_000);
    const secondSlot = new Date(anchor.getTime() + 120_000);
    const scheduleId = await schedules.createIntervalSchedule({
      name: "loop",
      taskId,
      conversationId: "v2-conv-wait-retire",
      intervalMs: 60_000,
      anchorAt: anchor,
      nextRunAt: firstSlot,
      maxExecutionCount: 10,
      expiresAt: new Date(anchor.getTime() + DAY),
      misfirePolicy: "run_once",
      overlapPolicy: "coalesce",
    });

    // Claim slot 1 and mark it waiting_for_conversation (simulating busy lease).
    const firstClaim = await schedules.claimIntervalOccurrence({
      scheduleId,
      now: new Date(firstSlot.getTime() + 1_000),
    });
    expect(firstClaim.kind).toBe("claimed");
    if (firstClaim.kind !== "claimed") return;
    await runs.updateStatus(firstClaim.runId, "waiting_for_conversation", {
      started_at: new Date(firstSlot.getTime() + 1_000),
      error_code: "CONVERSATION_BUSY",
    });

    // Slot 2 becomes due: claimIntervalOccurrence must retire the waiting run and claim slot 2.
    const secondClaim = await schedules.claimIntervalOccurrence({
      scheduleId,
      now: new Date(secondSlot.getTime() + 1_000),
    });
    expect(secondClaim.kind).toBe("claimed");

    const retired = await runs.getByIdempotencyKey(firstClaim.idempotencyKey);
    expect(retired?.status).toBe("coalesced");
    expect(retired?.error_code).toBe("WAITING_RUN_EXPIRED");
    expect(retired?.finished_at).toBeTruthy();
  });

  it("markInterruptedRuns recovers stale waiting_for_conversation, running, and pending runs", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const runs = new AiMessageTaskRunModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-interrupt");

    const staleTime = new Date(Date.now() - 20 * 60_000);
    const freshTime = new Date(Date.now() - 10_000);

    const waitingRunId = await runs.createOccurrence({
      taskId,
      scheduleId: 901,
      conversationId: "v2-conv-interrupt",
      occurrence: 1,
      scheduledFor: staleTime,
      catchUp: false,
      idempotencyKey: "scheduled-loop:901:1",
    });
    await runs.updateStatus(waitingRunId, "waiting_for_conversation", {
      started_at: staleTime,
      error_code: "CONVERSATION_BUSY",
    });

    const pendingRunId = await runs.createOccurrence({
      taskId,
      scheduleId: 901,
      conversationId: "v2-conv-interrupt",
      occurrence: 2,
      scheduledFor: staleTime,
      catchUp: false,
      idempotencyKey: "scheduled-loop:901:2",
    });
    await runs.updateStatus(pendingRunId, "pending", {
      started_at: staleTime,
    });

    const freshWaitingId = await runs.createOccurrence({
      taskId,
      scheduleId: 902,
      conversationId: "v2-conv-interrupt-fresh",
      occurrence: 1,
      scheduledFor: freshTime,
      catchUp: false,
      idempotencyKey: "scheduled-loop:902:1",
    });
    await runs.updateStatus(freshWaitingId, "waiting_for_conversation", {
      started_at: freshTime,
      error_code: "CONVERSATION_BUSY",
    });

    const cutoff = new Date(Date.now() - 10 * 60_000);
    const affected = await runs.markInterruptedRuns(cutoff);
    expect(affected).toBe(2);

    const w = await runs.getByIdempotencyKey("scheduled-loop:901:1");
    const p = await runs.getByIdempotencyKey("scheduled-loop:901:2");
    const f = await runs.getByIdempotencyKey("scheduled-loop:902:1");
    expect(w?.status).toBe("interrupted");
    expect(p?.status).toBe("interrupted");
    expect(f?.status).toBe("waiting_for_conversation");
  });

  it("findWaitingIntervalRuns, claimWaitingRunForRetry, and retireWaitingRun handle single-winner retries cleanly", async () => {
    const tasks = new AiMessageTaskModel(tmpDir);
    const runs = new AiMessageTaskRunModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const taskId = await createTask(tasks, "v2-conv-retry");

    const runId = await runs.createOccurrence({
      taskId,
      scheduleId: 777,
      conversationId: "v2-conv-retry",
      occurrence: 1,
      scheduledFor: new Date(),
      catchUp: false,
      idempotencyKey: "scheduled-loop:777:1",
    });
    await runs.updateStatus(runId, "waiting_for_conversation", {
      started_at: new Date(),
      error_code: "CONVERSATION_BUSY",
    });

    const waiting = await runs.findWaitingIntervalRuns(10);
    expect(waiting.map((r) => r.id)).toContain(runId);

    const retryNow = new Date();
    const firstClaim = await runs.claimWaitingRunForRetry(runId, retryNow, 3);
    const secondClaim = await runs.claimWaitingRunForRetry(runId, retryNow, 3);
    expect(firstClaim).toBe(true);
    expect(secondClaim).toBe(false);

    const updated = await runs.getByIdempotencyKey("scheduled-loop:777:1");
    expect(updated?.status).toBe("pending");
    expect(updated?.attempt).toBe(2);

    // Exhaust attempts and retire
    await runs.updateStatus(runId, "waiting_for_conversation", {
      error_code: "CONVERSATION_BUSY",
    });
    await runs.retireWaitingRun(runId, "WAITING_MAX_ATTEMPTS", retryNow);
    const retired = await runs.getByIdempotencyKey("scheduled-loop:777:1");
    expect(retired?.status).toBe("coalesced");
    expect(retired?.error_code).toBe("WAITING_MAX_ATTEMPTS");
  });
});
