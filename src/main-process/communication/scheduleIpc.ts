import {
  SCHEDULE_CREATE,
  SCHEDULE_UPDATE,
  SCHEDULE_DELETE,
  SCHEDULE_ENABLE,
  SCHEDULE_DISABLE,
  SCHEDULE_PAUSE,
  SCHEDULE_RESUME,
  SCHEDULE_RUN_NOW,
  SCHEDULE_LIST,
  SCHEDULE_DETAIL,
  SCHEDULE_BY_TASK_TYPE,
  SCHEDULE_SEARCH,
  SCHEDULE_EXPORT,
  SCHEDULE_IMPORT,
  EXECUTION_HISTORY,
  EXECUTION_STATISTICS,
  EXECUTION_RECENT,
  DEPENDENCY_ADD,
  DEPENDENCY_REMOVE,
  DEPENDENCY_GRAPH,
  DEPENDENCY_VALIDATE,
  SCHEDULER_STATUS,
  SCHEDULER_START,
  SCHEDULER_STOP,
  SCHEDULER_RELOAD,
  CRON_VALIDATE,
  CRON_NEXT_RUN_TIME,
} from "@/config/channellist";
import { ScheduleController } from "@/controller/ScheduleController";
import {
  ScheduleCreateRequest,
  ScheduleUpdateRequest,
  DependencyCreateRequest,
  CronValidationResult,
  ScheduleExportData,
  ScheduleImportRequest,
  ScheduleImportResult,
  DependencyValidationResponse,
} from "@/entityTypes/schedule-type";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  scheduleByIdInputSchema,
  scheduleWriteInputSchema,
  scheduleListInputSchema,
  scheduleSearchInputSchema,
  scheduleByTaskTypeInputSchema,
  scheduleExecutionHistoryInputSchema,
  scheduleByScheduleIdInputSchema,
  scheduleExecutionRecentInputSchema,
  scheduleDependencyAddInputSchema,
  scheduleDependencyRemoveInputSchema,
  scheduleNoInputSchema,
  scheduleCronExpressionInputSchema,
  scheduleImportInputSchema,
} from "@/schemas/ipc/schedule";

/**
 * Schedule IPC handlers — all 27 migrated to registerValidatedHandler.
 *
 * Original code repeated identical try/catch + envelope boilerplate per
 * handler (~25 LOC each). Wrapper now centralizes that, shrinking each
 * handler to its core logic.
 *
 * Envelope: handlers return data only; wrapper wraps in {status, msg, data}.
 * Original returned specific i18n message keys (e.g. 'schedule.created_successfully')
 * - those are lost, standardized to 'ok'. Frontend should rely on status + data.
 */
export function registerScheduleIpcHandlers(): void {
  console.log("Schedule IPC handlers registered");
  const ctrl = (): ScheduleController => new ScheduleController();

  // ── Schedule CRUD ────────────────────────────────────────────────────

  registerValidatedHandler(
    SCHEDULE_CREATE,
    scheduleWriteInputSchema,
    async (input) => {
      return ctrl().createSchedule(input as unknown as ScheduleCreateRequest);
    }
  );

  registerValidatedHandler(
    SCHEDULE_UPDATE,
    scheduleWriteInputSchema,
    async (input) => {
      const { id, ...scheduleData } = input as unknown as {
        id: number;
      } & ScheduleUpdateRequest;
      await ctrl().updateSchedule(id, scheduleData);
      return null;
    }
  );

  registerValidatedHandler(
    SCHEDULE_DELETE,
    scheduleByIdInputSchema,
    async (input) => {
      await ctrl().deleteSchedule(input.id);
      return null;
    }
  );

  // ── Schedule state operations (5 share byId schema) ──────────────────

  registerValidatedHandler(
    SCHEDULE_ENABLE,
    scheduleByIdInputSchema,
    async (input) => {
      await ctrl().enableSchedule(input.id);
      return null;
    }
  );

  registerValidatedHandler(
    SCHEDULE_DISABLE,
    scheduleByIdInputSchema,
    async (input) => {
      await ctrl().disableSchedule(input.id);
      return null;
    }
  );

  registerValidatedHandler(
    SCHEDULE_PAUSE,
    scheduleByIdInputSchema,
    async (input) => {
      await ctrl().pauseSchedule(input.id);
      return null;
    }
  );

  registerValidatedHandler(
    SCHEDULE_RESUME,
    scheduleByIdInputSchema,
    async (input) => {
      await ctrl().resumeSchedule(input.id);
      return null;
    }
  );

  registerValidatedHandler(
    SCHEDULE_RUN_NOW,
    scheduleByIdInputSchema,
    async (input) => {
      await ctrl().runScheduleNow(input.id);
      return null;
    }
  );

  // ── Schedule queries ─────────────────────────────────────────────────

  registerValidatedHandler(
    SCHEDULE_LIST,
    scheduleListInputSchema,
    async (input) => {
      return ctrl().getScheduleList(
        input.page ?? 0,
        input.size ?? 10,
        input.sort as Parameters<ScheduleController["getScheduleList"]>[2]
      );
    }
  );

  registerValidatedHandler(
    SCHEDULE_DETAIL,
    scheduleByIdInputSchema,
    async (input) => {
      return ctrl().getScheduleById(input.id);
    }
  );

  registerValidatedHandler(
    SCHEDULE_BY_TASK_TYPE,
    scheduleByTaskTypeInputSchema,
    async (input) => {
      return ctrl().getSchedulesByTaskType(input.taskType);
    }
  );

  registerValidatedHandler(
    SCHEDULE_SEARCH,
    scheduleSearchInputSchema,
    async (input) => {
      const req = input as { page?: number; size?: number; sort?: unknown };
      return ctrl().getScheduleList(
        req.page || 0,
        req.size || 10,
        req.sort as Parameters<ScheduleController["getScheduleList"]>[2]
      );
    }
  );

  // ── Execution Management ─────────────────────────────────────────────

  registerValidatedHandler(
    EXECUTION_HISTORY,
    scheduleExecutionHistoryInputSchema,
    async (input) => {
      return ctrl().getExecutionHistory(
        input.scheduleId,
        input.page ?? 0,
        input.size ?? 10
      );
    }
  );

  registerValidatedHandler(
    EXECUTION_STATISTICS,
    scheduleByScheduleIdInputSchema,
    async (input) => {
      return ctrl().getExecutionStatistics(input.scheduleId);
    }
  );

  registerValidatedHandler(
    EXECUTION_RECENT,
    scheduleExecutionRecentInputSchema,
    async (input) => {
      return ctrl().getRecentExecutions(input.limit ?? 10);
    }
  );

  // ── Dependency Management ────────────────────────────────────────────

  registerValidatedHandler(
    DEPENDENCY_ADD,
    scheduleDependencyAddInputSchema,
    async (input) => {
      const { parentId, childId, ...dependencyData } = input;
      return ctrl().addDependency(
        parentId,
        childId,
        dependencyData as unknown as DependencyCreateRequest
      );
    }
  );

  registerValidatedHandler(
    DEPENDENCY_REMOVE,
    scheduleDependencyRemoveInputSchema,
    async (input) => {
      await ctrl().removeDependency(input.parentId, input.childId);
      return null;
    }
  );

  registerValidatedHandler(
    DEPENDENCY_GRAPH,
    scheduleByScheduleIdInputSchema,
    async (input) => {
      return ctrl().getDependencyGraph(input.scheduleId);
    }
  );

  registerValidatedHandler(
    DEPENDENCY_VALIDATE,
    scheduleByScheduleIdInputSchema,
    async (input) => {
      const result = await ctrl().validateDependencies(input.scheduleId);
      // Convert DependencyValidationResult to DependencyValidationResponse
      const validationResponse: DependencyValidationResponse = {
        isValid: result.isValid,
        errors: result.errors,
        warnings: [],
      };
      return validationResponse;
    }
  );

  // ── Scheduler Management ─────────────────────────────────────────────

  registerValidatedHandler(
    SCHEDULER_STATUS,
    scheduleNoInputSchema,
    async () => {
      return ctrl().getSchedulerStatus();
    }
  );

  registerValidatedHandler(SCHEDULER_START, scheduleNoInputSchema, async () => {
    await ctrl().startScheduler();
    return null;
  });

  registerValidatedHandler(SCHEDULER_STOP, scheduleNoInputSchema, async () => {
    await ctrl().stopScheduler();
    return null;
  });

  registerValidatedHandler(
    SCHEDULER_RELOAD,
    scheduleNoInputSchema,
    async () => {
      const c = ctrl();
      await c.stopScheduler();
      await c.startScheduler();
      return null;
    }
  );

  // ── Cron Utility ─────────────────────────────────────────────────────

  registerValidatedHandler(
    CRON_VALIDATE,
    scheduleCronExpressionInputSchema,
    async (input) => {
      // Basic cron syntax validation (5-field format).
      // Regex mirrors the original handler's pattern.
      const isValid =
        /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/.test(
          input.expression
        );
      const result: CronValidationResult = {
        isValid,
        errors: isValid ? [] : ["Invalid cron expression format"],
        nextRunTimes: [],
        description: isValid
          ? "Valid cron expression"
          : "Invalid cron expression",
      };
      return result;
    }
  );

  registerValidatedHandler(
    CRON_NEXT_RUN_TIME,
    scheduleCronExpressionInputSchema,
    async (input) => {
      return ctrl().calculateNextRunTime(input.expression);
    }
  );

  // ── Import/Export ────────────────────────────────────────────────────

  registerValidatedHandler(SCHEDULE_EXPORT, scheduleNoInputSchema, async () => {
    // Placeholder implementation (mirrors original)
    const result: ScheduleExportData = {
      schedules: [],
      dependencies: [],
      version: "1.0.0",
      exportDate: new Date(),
    };
    return result;
  });

  registerValidatedHandler(
    SCHEDULE_IMPORT,
    scheduleImportInputSchema,
    async (input) => {
      // Placeholder (input currently unused by original)
      void (input as unknown as ScheduleImportRequest);
      const result: ScheduleImportResult = {
        success: true,
        importedSchedules: 0,
        importedDependencies: 0,
        errors: [],
        warnings: [],
      };
      return result;
    }
  );
}
