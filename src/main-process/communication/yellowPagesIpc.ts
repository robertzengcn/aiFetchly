import {
  YELLOW_PAGES_CREATE,
  YELLOW_PAGES_UPDATE,
  YELLOW_PAGES_DELETE,
  YELLOW_PAGES_START,
  YELLOW_PAGES_STOP,
  YELLOW_PAGES_PAUSE,
  YELLOW_PAGES_RESUME,
  YELLOW_PAGES_LIST,
  YELLOW_PAGES_DETAIL,
  YELLOW_PAGES_PROGRESS,
  YELLOW_PAGES_RESULTS,
  YELLOW_PAGES_EXPORT,
  YELLOW_PAGES_BULK,
  YELLOW_PAGES_HEALTH,
  YELLOW_PAGES_PLATFORMS,
  YELLOW_PAGES_STATISTICS,
  YELLOW_PAGES_KILL_PROCESS,
  YELLOW_PAGES_CHECK_ORPHANED_PROCESSES,
} from "@/config/channellist";
import { YellowPagesController } from "@/controller/YellowPagesController";
import {
  YellowPagesTaskData,
  YellowPagesTask,
  TaskFilters,
} from "@/modules/interface/ITaskManager";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  yellowPagesTaskByIdInputSchema,
  yellowPagesTaskCreateInputSchema,
  yellowPagesTaskUpdateInputSchema,
  yellowPagesByPidInputSchema,
  yellowPagesListInputSchema,
  yellowPagesResultsInputSchema,
  yellowPagesExportInputSchema,
  yellowPagesBulkInputSchema,
  yellowPagesNoInputSchema,
} from "@/schemas/ipc/yellowPages";

/**
 * Yellow Pages IPC handlers — all 20 migrated to registerValidatedHandler.
 *
 * 8 task by-id ops share taskByIdInputSchema (massive dedup).
 *
 * Envelope: handlers return data only; wrapper wraps. Original returned
 * i18n message keys - standardized to 'ok'. Frontend should rely on
 * status + data.
 */
export function registerYellowPagesIpcHandlers(): void {
  console.log("Yellow Pages IPC handlers registered");
  const ctrl = (): YellowPagesController => YellowPagesController.getInstance();

  // ── Task CRUD ────────────────────────────────────────────────────────

  registerValidatedHandler(
    YELLOW_PAGES_CREATE,
    yellowPagesTaskCreateInputSchema,
    async (input) => {
      return ctrl().createTask(input as unknown as YellowPagesTaskData);
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_UPDATE,
    yellowPagesTaskUpdateInputSchema,
    async (input) => {
      const { id, ...taskData } = input as { id: number } & Partial<YellowPagesTask>;
      await ctrl().updateTask(id, taskData);
      return id;
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_DELETE,
    yellowPagesTaskByIdInputSchema,
    async (input) => {
      await ctrl().deleteTask(input.id);
      return null;
    },
  );

  // ── Task state ops (5 share byId schema) ─────────────────────────────

  registerValidatedHandler(
    YELLOW_PAGES_START,
    yellowPagesTaskByIdInputSchema,
    async (input) => { await ctrl().startTask(input.id); return input.id; },
  );

  registerValidatedHandler(
    YELLOW_PAGES_STOP,
    yellowPagesTaskByIdInputSchema,
    async (input) => { await ctrl().stopTask(input.id); return null; },
  );

  registerValidatedHandler(
    YELLOW_PAGES_PAUSE,
    yellowPagesTaskByIdInputSchema,
    async (input) => { await ctrl().pauseTask(input.id); return null; },
  );

  registerValidatedHandler(
    YELLOW_PAGES_RESUME,
    yellowPagesTaskByIdInputSchema,
    async (input) => { await ctrl().resumeTask(input.id); return input.id; },
  );

  // ── Process management ───────────────────────────────────────────────

  registerValidatedHandler(
    YELLOW_PAGES_KILL_PROCESS,
    yellowPagesByPidInputSchema,
    async (input) => {
      return ctrl().killProcessByPID(input.pid);
    },
  );

  registerValidatedHandler(
    "yellow_pages:get_process_status",
    yellowPagesByPidInputSchema,
    async (input) => {
      return ctrl().getProcessStatusByPID(input.pid);
    },
  );

  // ── Task queries ─────────────────────────────────────────────────────

  registerValidatedHandler(
    YELLOW_PAGES_LIST,
    yellowPagesListInputSchema,
    async (input) => {
      // LIST filters are optional; passthrough schema allows empty object.
      // Original behavior: `data ? JSON.parse : undefined`. With wrapper
      // we always receive an object; pass it through as filters.
      return ctrl().listTasks(input as unknown as TaskFilters | undefined);
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_DETAIL,
    yellowPagesTaskByIdInputSchema,
    async (input) => {
      return ctrl().getTask(input.id);
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_PROGRESS,
    yellowPagesTaskByIdInputSchema,
    async (input) => {
      return ctrl().getTaskProgress(input.id);
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_RESULTS,
    yellowPagesResultsInputSchema,
    async (input) => {
      return ctrl().getTaskResults(input.id, {
        page: input.page ?? 0,
        size: input.size ?? 20,
      });
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_EXPORT,
    yellowPagesExportInputSchema,
    async (input) => {
      return ctrl().exportTaskResults(input.id, input.format ?? "json");
    },
  );

  // ── Bulk operations ──────────────────────────────────────────────────

  registerValidatedHandler(
    YELLOW_PAGES_BULK,
    yellowPagesBulkInputSchema,
    async (input) => {
      return ctrl().bulkOperations(input.operation, input.taskIds);
    },
  );

  // ── System operations ────────────────────────────────────────────────

  registerValidatedHandler(
    YELLOW_PAGES_HEALTH,
    yellowPagesNoInputSchema,
    async () => {
      return ctrl().getHealthStatus();
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_PLATFORMS,
    yellowPagesNoInputSchema,
    async () => {
      return ctrl().getAvailablePlatforms();
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_STATISTICS,
    yellowPagesNoInputSchema,
    async () => {
      return ctrl().getTaskStatistics();
    },
  );

  registerValidatedHandler(
    YELLOW_PAGES_CHECK_ORPHANED_PROCESSES,
    yellowPagesNoInputSchema,
    async () => {
      return ctrl().checkForOrphanedProcesses();
    },
  );

  registerValidatedHandler(
    "yellow_pages:handle_previous_session",
    yellowPagesNoInputSchema,
    async () => {
      return ctrl().handleTasksFromPreviousSession();
    },
  );
}
