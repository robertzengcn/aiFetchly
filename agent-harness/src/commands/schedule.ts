/**
 * Schedule commands - manage scheduled tasks.
 * Maps to IPC channels from scheduleIpc.ts:
 *   SCHEDULE_LIST, SCHEDULE_DETAIL, SCHEDULE_CREATE, SCHEDULE_UPDATE,
 *   SCHEDULE_DELETE, SCHEDULE_ENABLE, SCHEDULE_DISABLE, EXECUTION_HISTORY
 */

import { Command } from "commander";
import { CliDatabase } from "../adapter/cli-database";
import { ScheduleTaskEntity } from "@/entity/ScheduleTask.entity";
import { ScheduleExecutionLogEntity } from "@/entity/ScheduleExecutionLog.entity";
import {
  formatPaginated,
  formatItem,
  formatSuccess,
  formatError,
} from "../output/formatter";
import type { TableConfig } from "../common/types";
import { ReadOnlyError } from "../common/errors";

const SCHEDULE_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "name", header: "Name", width: 30 },
    { key: "cronExpression", header: "Cron", width: 18 },
    { key: "enabled", header: "Enabled", width: 8 },
    { key: "taskType", header: "Task Type", width: 14 },
    { key: "lastRunAt", header: "Last Run", width: 20 },
    { key: "nextRunAt", header: "Next Run", width: 20 },
  ],
};

const SCHEDULE_DETAIL_FIELDS = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "cron_expression", label: "Cron Expression" },
  { key: "is_active", label: "Enabled" },
  { key: "task_type", label: "Task Type" },
  { key: "task_id", label: "Task ID" },
  { key: "last_run_time", label: "Last Run At" },
  { key: "next_run_time", label: "Next Run At" },
  { key: "status", label: "Status" },
  { key: "execution_count", label: "Executions" },
  { key: "failure_count", label: "Failures" },
  { key: "createdAt", label: "Created" },
];

const EXECUTION_HISTORY_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "status", header: "Status", width: 10 },
    { key: "triggered_by", header: "Trigger", width: 10 },
    { key: "execution_time", header: "Started", width: 20 },
    { key: "completion_time", header: "Completed", width: 20 },
    { key: "result_message", header: "Result", width: 30 },
  ],
};

export function registerScheduleCommands(parent: Command): void {
  const schedule = parent
    .command("schedule")
    .description("Manage scheduled tasks");

  schedule
    .command("list")
    .description("List all schedules")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ScheduleTaskEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo
          .createQueryBuilder("schedule")
          .orderBy("schedule.id", "DESC")
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "schedule:list",
          SCHEDULE_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "schedule:list");
      }
    });

  schedule
    .command("detail <id>")
    .description("Get schedule detail")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ScheduleTaskEntity);
        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(`Schedule not found: ${id}`);
        }
        formatItem(
          item as unknown as Record<string, unknown>,
          opts.json,
          "schedule:detail",
          SCHEDULE_DETAIL_FIELDS
        );
      } catch (error) {
        formatError(error, opts.json, "schedule:detail");
      }
    });

  schedule
    .command("create")
    .description("Create a new schedule")
    .requiredOption("--name <name>", "Schedule name")
    .requiredOption("--cron <expression>", "Cron expression")
    .requiredOption(
      "--task-type <type>",
      "Task type (search, email_extract, etc.)"
    )
    .requiredOption("--task-id <id>", "Task ID to schedule")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      if (opts.parent?.parent?.readOnly)
        throw new ReadOnlyError("schedule:create");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ScheduleTaskEntity);
        const entity = repo.create({
          name: opts.name,
          cron_expression: opts.cron,
          task_type: opts.taskType,
          task_id: parseInt(opts.taskId),
          is_active: true,
          status: "active",
          trigger_type: "cron",
          execution_count: 0,
          failure_count: 0,
          delay_minutes: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const saved = await repo.save(entity);
        formatSuccess(
          `Schedule created with ID: ${saved.id}`,
          opts.json,
          "schedule:create"
        );
      } catch (error) {
        formatError(error, opts.json, "schedule:create");
      }
    });

  schedule
    .command("update <id>")
    .description("Update a schedule")
    .option("--name <name>", "Schedule name")
    .option("--cron <expression>", "Cron expression")
    .option("--enabled <boolean>", "Enable (true/false)")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      if (opts.parent?.parent?.readOnly)
        throw new ReadOnlyError("schedule:update");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ScheduleTaskEntity);
        const existing = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!existing) throw new Error(`Schedule not found: ${id}`);

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (opts.name) updates.name = opts.name;
        if (opts.cron) updates.cron_expression = opts.cron;
        if (opts.enabled !== undefined) {
          const isEnabled = opts.enabled === "true";
          updates.is_active = isEnabled;
          updates.status = isEnabled ? "active" : "inactive";
        }

        await repo.update(parseInt(id), updates);
        formatSuccess(`Schedule ${id} updated`, opts.json, "schedule:update");
      } catch (error) {
        formatError(error, opts.json, "schedule:update");
      }
    });

  schedule
    .command("delete <id>")
    .description("Delete a schedule")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      if (opts.parent?.parent?.readOnly)
        throw new ReadOnlyError("schedule:delete");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ScheduleTaskEntity);
        const result = await repo.delete(parseInt(id));
        if (result.affected === 0) throw new Error(`Schedule not found: ${id}`);
        formatSuccess(`Schedule ${id} deleted`, opts.json, "schedule:delete");
      } catch (error) {
        formatError(error, opts.json, "schedule:delete");
      }
    });

  schedule
    .command("enable <id>")
    .description("Enable a schedule")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      if (opts.parent?.parent?.readOnly)
        throw new ReadOnlyError("schedule:enable");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ScheduleTaskEntity);
        const existing = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!existing) throw new Error(`Schedule not found: ${id}`);

        await repo.update(parseInt(id), {
          is_active: true,
          status: "active",
          updatedAt: new Date(),
        });
        formatSuccess(`Schedule ${id} enabled`, opts.json, "schedule:enable");
      } catch (error) {
        formatError(error, opts.json, "schedule:enable");
      }
    });

  schedule
    .command("disable <id>")
    .description("Disable a schedule")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      if (opts.parent?.parent?.readOnly)
        throw new ReadOnlyError("schedule:disable");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ScheduleTaskEntity);
        const existing = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!existing) throw new Error(`Schedule not found: ${id}`);

        await repo.update(parseInt(id), {
          is_active: false,
          status: "inactive",
          updatedAt: new Date(),
        });
        formatSuccess(`Schedule ${id} disabled`, opts.json, "schedule:disable");
      } catch (error) {
        formatError(error, opts.json, "schedule:disable");
      }
    });

  schedule
    .command("execution-history <scheduleId>")
    .description("Get execution history for a schedule")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--json", "Output as JSON")
    .action(async (scheduleId, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ScheduleExecutionLogEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo.findAndCount({
          where: { schedule_id: parseInt(scheduleId) } as Record<
            string,
            unknown
          >,
          order: { id: "DESC" } as Record<string, string>,
          skip,
          take: size,
        });

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "schedule:execution-history",
          EXECUTION_HISTORY_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "schedule:execution-history");
      }
    });
}
