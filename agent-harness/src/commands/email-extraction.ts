/**
 * Email extraction commands - manage email search tasks and results.
 * Queries emailsearch_task and emailsearch_result tables.
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { CliDatabase } from "../adapter/cli-database";
import { EmailSearchTaskEntity } from "@/entity/EmailSearchTask.entity";
import { EmailSearchResultEntity } from "@/entity/EmailSearchResult.entity";
import { EmailSearchTaskUrlEntity } from "@/entity/EmailSearchTaskUrl.entity";
import {
  formatPaginated,
  formatItem,
  formatSuccess,
  formatError,
} from "../output/formatter";
import type { TableConfig } from "../common/types";

const SEARCH_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "status", header: "Status", width: 10 },
    { key: "urlsCount", header: "URLs", width: 8 },
    { key: "emailsFound", header: "Emails", width: 8 },
    { key: "createdAt", header: "Created", width: 20 },
  ],
};

const RESULT_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "email", header: "Email", width: 30 },
    { key: "url", header: "Source", width: 30 },
    { key: "status", header: "Status", width: 12 },
    { key: "createdAt", header: "Created", width: 20 },
  ],
};

const TASK_DETAIL_FIELDS = [
  { key: "id", label: "ID" },
  { key: "task_name", label: "Task Name" },
  { key: "status", label: "Status" },
  { key: "concurrency", label: "Concurrency" },
  { key: "pagelength", label: "Page Length" },
  { key: "is_active", label: "Active" },
  { key: "aiSupportEnabled", label: "AI Support" },
  { key: "record_time", label: "Record Time" },
  { key: "runtime_log", label: "Runtime Log" },
  { key: "error_log", label: "Error Log" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Updated" },
];

export function registerEmailExtractionCommands(parent: Command): void {
  const emailExtraction = parent
    .command("email-extraction")
    .description("Manage email extraction tasks and results");

  emailExtraction
    .command("list-searches")
    .description("List email search tasks")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const taskRepo = CliDatabase.getRepository(EmailSearchTaskEntity);
        const urlRepo = CliDatabase.getRepository(EmailSearchTaskUrlEntity);
        const resultRepo = CliDatabase.getRepository(EmailSearchResultEntity);

        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [tasks, total] = await taskRepo.findAndCount({
          order: { id: "DESC" } as Record<string, string>,
          skip,
          take: size,
        });

        const items = await Promise.all(
          tasks.map(async (task: any) => {
            const urlsCount = await urlRepo.count({
              where: { task_id: task.id } as Record<string, unknown>,
            });
            const emailsFound = await resultRepo.count({
              where: { task_id: task.id } as Record<string, unknown>,
            });
            return {
              ...task,
              urlsCount,
              emailsFound,
            };
          })
        );

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "email-extraction:list-searches",
          SEARCH_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "email-extraction:list-searches");
      }
    });

  emailExtraction
    .command("get-results <taskId>")
    .description("Get extraction results for a task")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--json", "Output as JSON")
    .action(async (taskId, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(EmailSearchResultEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const [items, total] = await repo.findAndCount({
          where: { task_id: parseInt(taskId) } as Record<string, unknown>,
          order: { id: "DESC" } as Record<string, string>,
          skip,
          take: size,
        });

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "email-extraction:get-results",
          RESULT_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "email-extraction:get-results");
      }
    });

  emailExtraction
    .command("get-task <id>")
    .description("Get email search task detail")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(EmailSearchTaskEntity);
        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(`Email search task not found: ${id}`);
        }
        formatItem(
          item as unknown as Record<string, unknown>,
          opts.json,
          "email-extraction:get-task",
          TASK_DETAIL_FIELDS
        );
      } catch (error) {
        formatError(error, opts.json, "email-extraction:get-task");
      }
    });

  emailExtraction
    .command("export <taskId>")
    .description("Export extraction results")
    .option("-f, --format <format>", "Export format (csv or json)", "csv")
    .option("-o, --output <path>", "Output file path")
    .option("--json", "Output as JSON")
    .action(async (taskId, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(EmailSearchResultEntity);

        const results = await repo.find({
          where: { task_id: parseInt(taskId) } as Record<string, unknown>,
          order: { id: "ASC" } as Record<string, string>,
        });

        if (results.length === 0) {
          throw new Error(`No results found for task: ${taskId}`);
        }

        const format = (opts.format || "csv").toLowerCase() as string;
        let content: string;
        let defaultExt: string;

        if (format === "json") {
          content = JSON.stringify(results, null, 2);
          defaultExt = "json";
        } else {
          const headers = [
            "id",
            "email",
            "name",
            "domain",
            "url",
            "title",
            "phone",
            "address",
            "socialLinks",
            "aiEnrichmentStatus",
            "aiConfidence",
            "createdAt",
          ];
          const rows = results.map((r: any) =>
            headers
              .map((h) => {
                const val = r[h];
                if (val === null || val === undefined) return "";
                const str = String(val);
                return str.includes(",") ||
                  str.includes('"') ||
                  str.includes("\n")
                  ? `"${str.replace(/"/g, '""')}"`
                  : str;
              })
              .join(",")
          );
          content = [headers.join(","), ...rows].join("\n");
          defaultExt = "csv";
        }

        if (opts.output) {
          const outputPath = path.resolve(opts.output);
          fs.writeFileSync(outputPath, content, "utf-8");
          formatSuccess(
            `Exported ${results.length} results to ${outputPath}`,
            opts.json,
            "email-extraction:export"
          );
        } else {
          const filename = `email-results-task-${taskId}.${defaultExt}`;
          fs.writeFileSync(filename, content, "utf-8");
          formatSuccess(
            `Exported ${results.length} results to ${filename}`,
            opts.json,
            "email-extraction:export"
          );
        }
      } catch (error) {
        formatError(error, opts.json, "email-extraction:export");
      }
    });
}
