/**
 * Task commands - manage automation tasks.
 * Maps to IPC channels: task:create, task:list, task:detail, task:update,
 * task:delete, task:run, task:cancel, task:results
 */

import { Command } from "commander";
import { CliDatabase } from "../adapter/cli-database";
import { TaskEntity } from "@/entity/Task.entity";
import {
  formatPaginated,
  formatItem,
  formatSuccess,
  formatError,
} from "../output/formatter";
import type { TableConfig } from "../common/types";
import { ReadOnlyError } from "../common/errors";

const TASK_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "name", header: "Name", width: 30 },
    { key: "platform", header: "Platform", width: 12 },
    { key: "status", header: "Status", width: 10 },
    { key: "createdAt", header: "Created", width: 20 },
  ],
};

const TASK_DETAIL_FIELDS = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "platform", label: "Platform" },
  { key: "status", label: "Status" },
  { key: "keywords", label: "Keywords" },
  { key: "description", label: "Description" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Updated" },
];

export function registerTaskCommands(parent: Command): void {
  const task = parent.command("task").description("Manage automation tasks");

  task
    .command("list")
    .description("List all tasks")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--search <query>", "Search term")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(TaskEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const qb = repo.createQueryBuilder("task");
        if (opts.search) {
          qb.where("task.name LIKE :search OR task.description LIKE :search", {
            search: `%${opts.search}%`,
          });
        }
        const [items, total] = await qb
          .orderBy("task.id", "DESC")
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "task:list",
          TASK_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "task:list");
      }
    });

  task
    .command("detail <id>")
    .description("Get task detail")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(TaskEntity);
        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(`Task not found: ${id}`);
        }
        formatItem(
          item as unknown as Record<string, unknown>,
          opts.json,
          "task:detail",
          TASK_DETAIL_FIELDS
        );
      } catch (error) {
        formatError(error, opts.json, "task:detail");
      }
    });

  task
    .command("results <id>")
    .description("Get task results")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const { TaskRunEntity } = await import("@/entity/TaskRun.entity");
        const repo = CliDatabase.getRepository(TaskRunEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo.findAndCount({
          where: { taskId: parseInt(id) } as Record<string, unknown>,
          order: { id: "DESC" } as Record<string, string>,
          skip,
          take: size,
        });

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "task:results",
          {
            columns: [
              { key: "id", header: "ID", width: 6 },
              { key: "status", header: "Status", width: 10 },
              { key: "result", header: "Result", width: 50 },
              { key: "createdAt", header: "Created", width: 20 },
            ],
          }
        );
      } catch (error) {
        formatError(error, opts.json, "task:results");
      }
    });

  task
    .command("create")
    .description("Create a new task")
    .requiredOption("--name <name>", "Task name")
    .requiredOption(
      "--platform <platform>",
      "Platform (google, linkedin, etc.)"
    )
    .option("--keywords <kw1,kw2>", "Comma-separated keywords")
    .option("--description <desc>", "Task description")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      if (CliDatabase.isReadOnly()) throw new ReadOnlyError("task:create");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(TaskEntity);
        const entity = repo.create({
          name: opts.name,
          platform: opts.platform,
          keywords: opts.keywords ? opts.keywords.split(",") : [],
          description: opts.description || "",
          status: "pending",
        } as any);
        const saved = await repo.save(entity);
        const savedId = (saved as any).id;
        formatSuccess(
          `Task created with ID: ${savedId}`,
          opts.json,
          "task:create"
        );
      } catch (error) {
        formatError(error, opts.json, "task:create");
      }
    });

  task
    .command("update <id>")
    .description("Update a task")
    .option("--name <name>", "Task name")
    .option("--status <status>", "Task status")
    .option("--description <desc>", "Task description")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      if (CliDatabase.isReadOnly()) throw new ReadOnlyError("task:update");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(TaskEntity);
        const task = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!task) throw new Error(`Task not found: ${id}`);

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (opts.name) updates.name = opts.name;
        if (opts.status) updates.status = opts.status;
        if (opts.description) updates.description = opts.description;

        await repo.update(parseInt(id), updates);
        formatSuccess(`Task ${id} updated`, opts.json, "task:update");
      } catch (error) {
        formatError(error, opts.json, "task:update");
      }
    });

  task
    .command("delete <id>")
    .description("Delete a task")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      if (CliDatabase.isReadOnly()) throw new ReadOnlyError("task:delete");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(TaskEntity);
        const result = await repo.delete(parseInt(id));
        if (result.affected === 0) throw new Error(`Task not found: ${id}`);
        formatSuccess(`Task ${id} deleted`, opts.json, "task:delete");
      } catch (error) {
        formatError(error, opts.json, "task:delete");
      }
    });
}
