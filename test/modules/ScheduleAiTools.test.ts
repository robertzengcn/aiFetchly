"use strict";

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";

import {
  listSchedulesForAi,
  getScheduleDetailsForAi,
  listScheduleExecutionsForAi,
  createScheduleForAi,
  updateScheduleForAi,
  deleteScheduleForAi,
  pauseScheduleForAi,
  resumeScheduleForAi,
  runScheduleNowForAi,
  toSafeSchedulePayload,
  toSafeExecutionPayload,
  validateTaskReference,
  toolFailure,
  validationFailure,
} from "@/service/ScheduleAiTools";

import { ScheduleTaskModule } from "@/modules/ScheduleTaskModule";
import { ScheduleManager } from "@/modules/ScheduleManager";
import { ScheduleExecutionLogModule } from "@/modules/ScheduleExecutionLogModule";
import { SearchTaskModule } from "@/modules/SearchTaskModule";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import { YellowPagesTaskModule } from "@/modules/YellowPagesTaskModule";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import { YandexMapsModule } from "@/modules/YandexMapsModule";

import {
  ScheduleTaskEntity,
  TaskType,
  ScheduleStatus,
  TriggerType,
} from "@/entity/ScheduleTask.entity";
import { ScheduleToolErrorCode } from "@/entityTypes/scheduleAiToolTypes";
import {
  ExecutionStatus,
  TriggerType as LogTriggerType,
} from "@/entity/ScheduleExecutionLog.entity";
import { ZodError, ZodIssue } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSchedule(
  overrides: Record<string, unknown> = {}
): ScheduleTaskEntity {
  return {
    id: 1,
    name: "Test Schedule",
    description: null,
    task_type: TaskType.SEARCH,
    task_id: 10,
    cron_expression: "0 9 * * *",
    is_active: true,
    status: ScheduleStatus.ACTIVE,
    trigger_type: TriggerType.CRON,
    parent_schedule_id: null,
    dependency_condition: null,
    delay_minutes: 0,
    last_run_time: null,
    next_run_time: new Date("2026-06-10T09:00:00.000Z"),
    execution_count: 0,
    failure_count: 0,
    last_error_message: null,
    last_modified: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  } as unknown as ScheduleTaskEntity;
}

/**
 * Create a stub that returns a fake ScheduleManager instance whose methods
 * are themselves stubs.  This avoids calling the real constructor which tries
 * to open a database connection.
 */
function stubScheduleManager(): {
  instance: Record<string, sinon.SinonStub>;
  getInstanceStub: sinon.SinonStub;
} {
  const instance: Record<string, sinon.SinonStub> = {
    validateCronExpression: sinon.stub().returns(true),
    addSchedule: sinon.stub().resolves(),
    removeSchedule: sinon.stub().resolves(),
    updateSchedule: sinon.stub().resolves(),
    pauseSchedule: sinon.stub().resolves(),
    resumeSchedule: sinon.stub().resolves(),
    executeSchedule: sinon.stub().resolves(),
  };
  const getInstanceStub = sinon
    .stub(ScheduleManager, "getInstance")
    .returns(instance as unknown as ScheduleManager);
  return { instance, getInstanceStub };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ScheduleAiTools", () => {
  beforeEach(() => {
    sinon.restore();
  });

  afterEach(() => {
    sinon.restore();
  });

  // =========================================================================
  // Helper function tests
  // =========================================================================

  describe("toolFailure", () => {
    it("should return a ScheduleToolFailure with the given code and message", () => {
      const result = toolFailure(
        ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
        "Schedule 42 not found"
      );
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.SCHEDULE_NOT_FOUND);
        expect(result.error).to.equal("Schedule 42 not found");
      }
    });
  });

  describe("validationFailure", () => {
    it("should return VALIDATION_FAILED with field messages from ZodError", () => {
      const issues: ZodIssue[] = [
        {
          code: "too_small" as const,
          minimum: 0,
          type: "number",
          inclusive: true,
          exact: false,
          message: "Number must be greater than or equal to 0",
          path: ["page"],
        },
        {
          code: "too_big" as const,
          maximum: 100,
          type: "number",
          inclusive: true,
          exact: false,
          message: "Number must be less than or equal to 100",
          path: ["size"],
        },
      ];
      const zodError = new ZodError(issues);
      const result = validationFailure(zodError);
      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
        expect(result.error).to.contain("page:");
        expect(result.error).to.contain("size:");
      }
    });
  });

  describe("toSafeSchedulePayload", () => {
    it("should map entity fields to safe payload with ISO date strings", () => {
      const schedule = mockSchedule({
        last_run_time: new Date("2026-06-05T09:00:00.000Z"),
        next_run_time: new Date("2026-06-06T09:00:00.000Z"),
      });
      const payload = toSafeSchedulePayload(schedule);
      expect(payload.id).to.equal(1);
      expect(payload.name).to.equal("Test Schedule");
      expect(payload.task_type).to.equal(TaskType.SEARCH);
      expect(payload.is_active).to.be.true;
      expect(payload.last_run_time).to.equal("2026-06-05T09:00:00.000Z");
      expect(payload.next_run_time).to.equal("2026-06-06T09:00:00.000Z");
    });

    it("should convert null dates to null", () => {
      const schedule = mockSchedule({
        last_run_time: null,
        next_run_time: null,
      });
      const payload = toSafeSchedulePayload(schedule);
      expect(payload.last_run_time).to.be.null;
      expect(payload.next_run_time).to.be.null;
    });
  });

  describe("toSafeExecutionPayload", () => {
    it("should map execution record to safe payload", () => {
      const record = {
        id: 100,
        schedule_id: 1,
        status: "success",
        result_message: "Done",
        execution_duration: 5000,
        parent_execution_id: null,
        triggered_by: "cron",
        task_output_id: 42,
        createdAt: new Date("2026-06-05T09:00:00.000Z"),
        updatedAt: new Date("2026-06-05T09:00:05.000Z"),
      };
      const payload = toSafeExecutionPayload(record);
      expect(payload.id).to.equal(100);
      expect(payload.schedule_id).to.equal(1);
      expect(payload.status).to.equal("success");
      expect(payload.result_message).to.equal("Done");
      expect(payload.execution_duration).to.equal(5000);
      expect(payload.triggered_by).to.equal("cron");
      expect(payload.createdAt).to.equal("2026-06-05T09:00:00.000Z");
    });

    it("should handle null date fields", () => {
      const record = {
        id: 101,
        schedule_id: 2,
        status: "pending",
        result_message: null,
        execution_duration: null,
        parent_execution_id: null,
        triggered_by: "manual",
        task_output_id: null,
        createdAt: null,
        updatedAt: null,
      };
      const payload = toSafeExecutionPayload(record);
      expect(payload.createdAt).to.be.null;
      expect(payload.updatedAt).to.be.null;
    });
  });

  // =========================================================================
  // listSchedulesForAi
  // =========================================================================

  describe("listSchedulesForAi", () => {
    it("should return paginated schedules on valid input", async () => {
      const schedule = mockSchedule();
      sinon
        .stub(ScheduleTaskModule.prototype, "listSchedules")
        .resolves({ records: [schedule], num: 1 });
      stubScheduleManager();

      const result = await listSchedulesForAi({ page: 0, size: 20 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.schedules).to.have.length(1);
        expect(result.data.total).to.equal(1);
        expect(result.data.page).to.equal(0);
        expect(result.data.size).to.equal(20);
        expect(result.data.schedules[0].id).to.equal(1);
      }
    });

    it("should reject negative page numbers with VALIDATION_FAILED", async () => {
      const result = await listSchedulesForAi({ page: -1, size: 20 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });

    it("should reject size > 100 with VALIDATION_FAILED", async () => {
      const result = await listSchedulesForAi({ page: 0, size: 101 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });

    it("should return empty list when no schedules exist", async () => {
      sinon
        .stub(ScheduleTaskModule.prototype, "listSchedules")
        .resolves({ records: [], num: 0 });
      stubScheduleManager();

      const result = await listSchedulesForAi({ page: 0, size: 20 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.schedules).to.have.length(0);
        expect(result.data.total).to.equal(0);
      }
    });

    it("should apply defaults when page and size are omitted", async () => {
      const listStub = sinon
        .stub(ScheduleTaskModule.prototype, "listSchedules")
        .resolves({ records: [], num: 0 });
      stubScheduleManager();

      await listSchedulesForAi({});

      expect(listStub.calledOnce).to.be.true;
      expect(listStub.firstCall.args[0]).to.equal(0); // page default
      expect(listStub.firstCall.args[1]).to.equal(20); // size default
    });
  });

  // =========================================================================
  // getScheduleDetailsForAi
  // =========================================================================

  describe("getScheduleDetailsForAi", () => {
    it("should return schedule details for a valid ID", async () => {
      const schedule = mockSchedule();
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(schedule);
      stubScheduleManager();

      const result = await getScheduleDetailsForAi({ schedule_id: 1 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.schedule.id).to.equal(1);
        expect(result.data.schedule.name).to.equal("Test Schedule");
      }
    });

    it("should return SCHEDULE_NOT_FOUND for a missing ID", async () => {
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(null);
      stubScheduleManager();

      const result = await getScheduleDetailsForAi({ schedule_id: 999 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.SCHEDULE_NOT_FOUND);
        expect(result.error).to.contain("999");
      }
    });

    it("should reject non-positive schedule_id", async () => {
      const result = await getScheduleDetailsForAi({ schedule_id: -5 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });

    it("should reject missing schedule_id", async () => {
      const result = await getScheduleDetailsForAi({});

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });
  });

  // =========================================================================
  // listScheduleExecutionsForAi
  // =========================================================================

  describe("listScheduleExecutionsForAi", () => {
    it("should return paginated executions", async () => {
      const execution = {
        id: 50,
        schedule_id: 1,
        status: "success",
        result_message: "OK",
        execution_duration: 1000,
        parent_execution_id: null,
        triggered_by: "cron",
        task_output_id: null,
        createdAt: new Date("2026-06-05T09:00:00.000Z"),
        updatedAt: null,
      };
      sinon
        .stub(ScheduleExecutionLogModule.prototype, "listExecutions")
        .resolves({ records: [execution as any], num: 1 });
      stubScheduleManager();

      const result = await listScheduleExecutionsForAi({ page: 0, size: 20 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.executions).to.have.length(1);
        expect(result.data.executions[0].id).to.equal(50);
        expect(result.data.total).to.equal(1);
      }
    });

    it("should handle optional schedule_id filter", async () => {
      const listStub = sinon
        .stub(ScheduleExecutionLogModule.prototype, "listExecutions")
        .resolves({ records: [], num: 0 });
      stubScheduleManager();

      await listScheduleExecutionsForAi({
        page: 0,
        size: 10,
        schedule_id: 5,
      });

      expect(listStub.calledOnce).to.be.true;
      expect(listStub.firstCall.args[2]).to.equal(5); // schedule_id filter
    });

    it("should handle optional status filter", async () => {
      const listStub = sinon
        .stub(ScheduleExecutionLogModule.prototype, "listExecutions")
        .resolves({ records: [], num: 0 });
      stubScheduleManager();

      await listScheduleExecutionsForAi({
        page: 0,
        size: 10,
        status: ExecutionStatus.FAILED,
      });

      expect(listStub.calledOnce).to.be.true;
      expect(listStub.firstCall.args[3]).to.equal(ExecutionStatus.FAILED);
    });

    it("should handle optional triggered_by filter", async () => {
      const listStub = sinon
        .stub(ScheduleExecutionLogModule.prototype, "listExecutions")
        .resolves({ records: [], num: 0 });
      stubScheduleManager();

      await listScheduleExecutionsForAi({
        page: 0,
        size: 10,
        triggered_by: LogTriggerType.MANUAL,
      });

      expect(listStub.calledOnce).to.be.true;
      expect(listStub.firstCall.args[4]).to.equal(LogTriggerType.MANUAL);
    });

    it("should reject invalid size parameter", async () => {
      const result = await listScheduleExecutionsForAi({ page: 0, size: 0 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });
  });

  // =========================================================================
  // createScheduleForAi
  // =========================================================================

  describe("createScheduleForAi", () => {
    const validInput = {
      name: "Daily Search",
      task_type: TaskType.SEARCH,
      task_id: 10,
      cron_expression: "0 9 * * *",
    };

    function stubCreateDependencies(): {
      managerStubs: ReturnType<typeof stubScheduleManager>;
    } {
      const managerStubs = stubScheduleManager();
      // Stub task validation — SearchTaskModule.read
      sinon.stub(SearchTaskModule.prototype, "read").resolves({} as any);
      // Stub create + reload
      sinon.stub(ScheduleTaskModule.prototype, "createSchedule").resolves(1);
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(mockSchedule());
      return { managerStubs };
    }

    it("should return success with safe payload on valid input", async () => {
      stubCreateDependencies();

      const result = await createScheduleForAi(validInput);

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.schedule.name).to.equal("Test Schedule");
        expect(result.data.schedule.id).to.equal(1);
      }
    });

    it("should reject invalid cron expressions with INVALID_CRON", async () => {
      const { managerStubs } = stubCreateDependencies();
      managerStubs.instance.validateCronExpression.returns(false);

      const result = await createScheduleForAi({
        ...validInput,
        cron_expression: "not-a-cron",
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.INVALID_CRON);
        expect(result.error).to.contain("not-a-cron");
      }
    });

    it("should reject missing task references with TASK_NOT_FOUND", async () => {
      stubScheduleManager();
      sinon.stub(SearchTaskModule.prototype, "read").resolves(null);

      const result = await createScheduleForAi(validInput);

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.TASK_NOT_FOUND);
        expect(result.error).to.contain("10");
      }
    });

    it("should default is_active to false when not provided", async () => {
      const createStub = sinon
        .stub(ScheduleTaskModule.prototype, "createSchedule")
        .resolves(1);
      stubScheduleManager();
      sinon.stub(SearchTaskModule.prototype, "read").resolves({} as any);
      const inactiveSchedule = mockSchedule({ is_active: false });
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(inactiveSchedule);

      await createScheduleForAi(validInput);

      // Verify the create request has is_active: false
      expect(createStub.calledOnce).to.be.true;
      const createArg = createStub.firstCall.args[0];
      expect(createArg.is_active).to.be.false;
    });

    it("should reject missing name with VALIDATION_FAILED", async () => {
      const result = await createScheduleForAi({
        task_type: TaskType.SEARCH,
        task_id: 10,
        cron_expression: "0 9 * * *",
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });

    it("should reject empty name with VALIDATION_FAILED", async () => {
      const result = await createScheduleForAi({
        name: "   ",
        task_type: TaskType.SEARCH,
        task_id: 10,
        cron_expression: "0 9 * * *",
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });

    it("should return DEPENDENCY_CONFLICT when parent schedule not found", async () => {
      stubScheduleManager();
      sinon.stub(SearchTaskModule.prototype, "read").resolves({} as any);
      const getByIdStub = sinon.stub(
        ScheduleTaskModule.prototype,
        "getScheduleById"
      );
      // First call: parent_schedule_id lookup (returns null)
      getByIdStub.onFirstCall().resolves(null);

      const result = await createScheduleForAi({
        ...validInput,
        parent_schedule_id: 999,
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.DEPENDENCY_CONFLICT);
      }
    });

    it("should include warning when scheduler sync fails for active schedule", async () => {
      const { managerStubs } = stubCreateDependencies();
      managerStubs.instance.addSchedule.rejects(
        new Error("Scheduler unavailable")
      );
      // Make the created schedule active
      sinon.restore();
      // Re-stub everything
      const { managerStubs: mgr2 } = ((): {
        managerStubs: ReturnType<typeof stubScheduleManager>;
      } => {
        const managerStubs = stubScheduleManager();
        managerStubs.instance.validateCronExpression.returns(true);
        managerStubs.instance.addSchedule.rejects(
          new Error("Scheduler unavailable")
        );
        sinon.stub(SearchTaskModule.prototype, "read").resolves({} as any);
        sinon.stub(ScheduleTaskModule.prototype, "createSchedule").resolves(1);
        const activeSchedule = mockSchedule({ is_active: true });
        sinon
          .stub(ScheduleTaskModule.prototype, "getScheduleById")
          .resolves(activeSchedule);
        return { managerStubs };
      })();

      const result = await createScheduleForAi({
        ...validInput,
        is_active: true,
      });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.warning).to.contain("Scheduler unavailable");
      }
    });
  });

  // =========================================================================
  // updateScheduleForAi
  // =========================================================================

  describe("updateScheduleForAi", () => {
    it("should return SCHEDULE_NOT_FOUND for missing schedule", async () => {
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(null);
      stubScheduleManager();

      const result = await updateScheduleForAi({
        schedule_id: 999,
        name: "Updated",
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.SCHEDULE_NOT_FOUND);
      }
    });

    it("should validate task reference when task_type changes", async () => {
      const existing = mockSchedule();
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(existing);
      stubScheduleManager();
      // Task not found
      sinon.stub(SearchTaskModule.prototype, "read").resolves(null);

      const result = await updateScheduleForAi({
        schedule_id: 1,
        task_type: TaskType.SEARCH,
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.TASK_NOT_FOUND);
      }
    });

    it("should validate cron expression when cron changes", async () => {
      const existing = mockSchedule();
      const getByIdStub = sinon.stub(
        ScheduleTaskModule.prototype,
        "getScheduleById"
      );
      getByIdStub.onFirstCall().resolves(existing);
      getByIdStub.onSecondCall().resolves(existing);
      const { instance } = stubScheduleManager();
      instance.validateCronExpression.returns(false);
      sinon.stub(SearchTaskModule.prototype, "read").resolves({} as any);

      const result = await updateScheduleForAi({
        schedule_id: 1,
        cron_expression: "bad cron",
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.INVALID_CRON);
      }
    });

    it("should return success with updated safe payload", async () => {
      const existing = mockSchedule();
      const updated = mockSchedule({ name: "Updated Name" });
      const getByIdStub = sinon.stub(
        ScheduleTaskModule.prototype,
        "getScheduleById"
      );
      getByIdStub.onFirstCall().resolves(existing);
      getByIdStub.onSecondCall().resolves(updated);
      sinon.stub(ScheduleTaskModule.prototype, "updateSchedule").resolves();
      stubScheduleManager();

      const result = await updateScheduleForAi({
        schedule_id: 1,
        name: "Updated Name",
      });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.schedule.name).to.equal("Updated Name");
      }
    });

    it("should reject invalid schedule_id", async () => {
      const result = await updateScheduleForAi({
        schedule_id: 0,
        name: "Test",
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });

    it("should validate task reference when task_id changes", async () => {
      const existing = mockSchedule();
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(existing);
      stubScheduleManager();
      // Task not found for the new task_id
      sinon.stub(SearchTaskModule.prototype, "read").resolves(null);

      const result = await updateScheduleForAi({
        schedule_id: 1,
        task_id: 99,
      });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.TASK_NOT_FOUND);
      }
    });

    it("should include warning when scheduler sync fails", async () => {
      const existing = mockSchedule();
      const getByIdStub = sinon.stub(
        ScheduleTaskModule.prototype,
        "getScheduleById"
      );
      getByIdStub.onFirstCall().resolves(existing);
      getByIdStub.onSecondCall().resolves(existing);
      sinon.stub(ScheduleTaskModule.prototype, "updateSchedule").resolves();
      const { instance } = stubScheduleManager();
      instance.updateSchedule.rejects(new Error("Sync failed"));

      const result = await updateScheduleForAi({
        schedule_id: 1,
        name: "Updated",
      });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.warning).to.contain("Sync failed");
      }
    });
  });

  // =========================================================================
  // deleteScheduleForAi
  // =========================================================================

  describe("deleteScheduleForAi", () => {
    it("should return SCHEDULE_NOT_FOUND for missing ID", async () => {
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(null);
      stubScheduleManager();

      const result = await deleteScheduleForAi({ schedule_id: 999 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.SCHEDULE_NOT_FOUND);
      }
    });

    it("should return DEPENDENCY_CONFLICT for schedules with children", async () => {
      const schedule = mockSchedule();
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(schedule);
      const { instance } = stubScheduleManager();
      instance.removeSchedule.resolves();
      sinon
        .stub(ScheduleTaskModule.prototype, "deleteSchedule")
        .rejects(new Error("Cannot delete schedule with child schedules"));

      const result = await deleteScheduleForAi({ schedule_id: 1 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.DEPENDENCY_CONFLICT);
      }
    });

    it("should return success with deleted=true on valid deletion", async () => {
      const schedule = mockSchedule();
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(schedule);
      const { instance } = stubScheduleManager();
      instance.removeSchedule.resolves();
      sinon.stub(ScheduleTaskModule.prototype, "deleteSchedule").resolves();

      const result = await deleteScheduleForAi({ schedule_id: 1 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.deleted).to.be.true;
        expect(result.data.schedule_id).to.equal(1);
      }
    });

    it("should reject non-positive schedule_id", async () => {
      const result = await deleteScheduleForAi({ schedule_id: -1 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.VALIDATION_FAILED);
      }
    });
  });

  // =========================================================================
  // pauseScheduleForAi
  // =========================================================================

  describe("pauseScheduleForAi", () => {
    it("should return SCHEDULE_NOT_FOUND for missing ID", async () => {
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(null);
      stubScheduleManager();

      const result = await pauseScheduleForAi({ schedule_id: 999 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.SCHEDULE_NOT_FOUND);
      }
    });

    it("should return success with updated status", async () => {
      const schedule = mockSchedule({ status: ScheduleStatus.ACTIVE });
      const pausedSchedule = mockSchedule({ status: ScheduleStatus.PAUSED });
      const getByIdStub = sinon.stub(
        ScheduleTaskModule.prototype,
        "getScheduleById"
      );
      getByIdStub.onFirstCall().resolves(schedule);
      getByIdStub.onSecondCall().resolves(pausedSchedule);
      const { instance } = stubScheduleManager();
      instance.pauseSchedule.resolves();

      const result = await pauseScheduleForAi({ schedule_id: 1 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.schedule.status).to.equal(ScheduleStatus.PAUSED);
      }
    });

    it("should return EXECUTION_FAILED when pauseSchedule throws", async () => {
      const schedule = mockSchedule();
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(schedule);
      const { instance } = stubScheduleManager();
      instance.pauseSchedule.rejects(new Error("Pause failed"));

      const result = await pauseScheduleForAi({ schedule_id: 1 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.EXECUTION_FAILED);
        expect(result.error).to.contain("Pause failed");
      }
    });
  });

  // =========================================================================
  // resumeScheduleForAi
  // =========================================================================

  describe("resumeScheduleForAi", () => {
    it("should return SCHEDULE_NOT_FOUND for missing ID", async () => {
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(null);
      stubScheduleManager();

      const result = await resumeScheduleForAi({ schedule_id: 999 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.SCHEDULE_NOT_FOUND);
      }
    });

    it("should return success with updated status", async () => {
      const pausedSchedule = mockSchedule({ status: ScheduleStatus.PAUSED });
      const resumedSchedule = mockSchedule({ status: ScheduleStatus.ACTIVE });
      const getByIdStub = sinon.stub(
        ScheduleTaskModule.prototype,
        "getScheduleById"
      );
      getByIdStub.onFirstCall().resolves(pausedSchedule);
      getByIdStub.onSecondCall().resolves(resumedSchedule);
      const { instance } = stubScheduleManager();
      instance.resumeSchedule.resolves();

      const result = await resumeScheduleForAi({ schedule_id: 1 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.schedule.status).to.equal(ScheduleStatus.ACTIVE);
      }
    });

    it("should return EXECUTION_FAILED when resumeSchedule throws", async () => {
      const schedule = mockSchedule();
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(schedule);
      const { instance } = stubScheduleManager();
      instance.resumeSchedule.rejects(new Error("Resume error"));

      const result = await resumeScheduleForAi({ schedule_id: 1 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.EXECUTION_FAILED);
      }
    });
  });

  // =========================================================================
  // runScheduleNowForAi
  // =========================================================================

  describe("runScheduleNowForAi", () => {
    it("should return SCHEDULE_NOT_FOUND for missing ID", async () => {
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(null);
      stubScheduleManager();

      const result = await runScheduleNowForAi({ schedule_id: 999 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.SCHEDULE_NOT_FOUND);
      }
    });

    it("should return EXECUTION_FAILED for inactive schedule", async () => {
      const inactiveSchedule = mockSchedule({ is_active: false });
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(inactiveSchedule);
      stubScheduleManager();

      const result = await runScheduleNowForAi({ schedule_id: 1 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.EXECUTION_FAILED);
        expect(result.error).to.contain("not active");
      }
    });

    it("should return success for active schedule", async () => {
      const activeSchedule = mockSchedule({ is_active: true });
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(activeSchedule);
      const { instance } = stubScheduleManager();
      instance.executeSchedule.resolves();

      const result = await runScheduleNowForAi({ schedule_id: 1 });

      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.executed).to.be.true;
        expect(result.data.schedule_id).to.equal(1);
        expect(result.data.schedule_name).to.equal("Test Schedule");
      }
    });

    it("should return EXECUTION_FAILED when executeSchedule throws", async () => {
      const activeSchedule = mockSchedule({ is_active: true });
      sinon
        .stub(ScheduleTaskModule.prototype, "getScheduleById")
        .resolves(activeSchedule);
      const { instance } = stubScheduleManager();
      instance.executeSchedule.rejects(new Error("Execution error"));

      const result = await runScheduleNowForAi({ schedule_id: 1 });

      expect(result.success).to.be.false;
      if (!result.success) {
        expect(result.code).to.equal(ScheduleToolErrorCode.EXECUTION_FAILED);
        expect(result.error).to.contain("Execution error");
      }
    });
  });

  // =========================================================================
  // validateTaskReference
  // =========================================================================

  describe("validateTaskReference", () => {
    it("should throw for SEARCH task when task not found", async () => {
      sinon.stub(SearchTaskModule.prototype, "read").resolves(null);

      try {
        await validateTaskReference(TaskType.SEARCH, 99);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as Error).message).to.contain("99");
        expect((error as Error).message).to.contain("not found");
      }
    });

    it("should not throw for SEARCH task when task exists", async () => {
      sinon.stub(SearchTaskModule.prototype, "read").resolves({} as any);

      // Should not throw
      await validateTaskReference(TaskType.SEARCH, 10);
    });

    it("should throw for EMAIL_EXTRACT task when task not found", async () => {
      sinon
        .stub(EmailSearchTaskModule.prototype, "getTaskDetail")
        .resolves(undefined);

      try {
        await validateTaskReference(TaskType.EMAIL_EXTRACT, 50);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as Error).message).to.contain("50");
      }
    });

    it("should not throw for EMAIL_EXTRACT task when task exists", async () => {
      sinon
        .stub(EmailSearchTaskModule.prototype, "getTaskDetail")
        .resolves({} as any);

      await validateTaskReference(TaskType.EMAIL_EXTRACT, 50);
    });

    it("should throw for BUCK_EMAIL task when task not found", async () => {
      sinon.stub(BuckEmailTaskModule.prototype, "read").resolves(undefined);

      try {
        await validateTaskReference(TaskType.BUCK_EMAIL, 30);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as Error).message).to.contain("30");
      }
    });

    it("should throw for YELLOW_PAGES task when task not found", async () => {
      sinon
        .stub(YellowPagesTaskModule.prototype, "getTaskById")
        .resolves(undefined);

      try {
        await validateTaskReference(TaskType.YELLOW_PAGES, 40);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as Error).message).to.contain("40");
      }
    });

    it("should throw for GOOGLE_MAPS task when task not found", async () => {
      sinon.stub(GoogleMapsModule.prototype, "getSearchRecord").resolves(null);

      try {
        await validateTaskReference(TaskType.GOOGLE_MAPS, 60);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as Error).message).to.contain("60");
      }
    });

    it("should not throw for GOOGLE_MAPS task when task exists", async () => {
      sinon
        .stub(GoogleMapsModule.prototype, "getSearchRecord")
        .resolves({} as any);

      await validateTaskReference(TaskType.GOOGLE_MAPS, 60);
    });

    it("should throw for YANDEX_MAPS task when task not found", async () => {
      sinon.stub(YandexMapsModule.prototype, "getSearchRecord").resolves(null);

      try {
        await validateTaskReference(TaskType.YANDEX_MAPS, 70);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as Error).message).to.contain("70");
      }
    });

    it("should throw for unsupported task type", async () => {
      try {
        await validateTaskReference("unsupported_type" as TaskType, 1);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        expect((error as Error).message).to.contain("Unsupported task type");
      }
    });
  });
});
