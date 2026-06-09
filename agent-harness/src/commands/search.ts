/**
 * Search commands - manage search tasks and results.
 * Maps to IPC channels from search-ipc.ts and search-result-ipc.ts.
 * Uses SearchTaskEntity and SearchResultEntity.
 */

import { Command } from "commander";
import * as fs from "fs";
import { stringify } from "csv-stringify";
import { CliDatabase } from "../adapter/cli-database";
import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import {
  formatPaginated,
  formatItem,
  formatError,
  formatSuccess,
} from "../output/formatter";
import type { TableConfig } from "../common/types";

/** Status label map matching SearchTaskStatusValue from entityTypes. */
const STATUS_LABEL: Record<number, string> = {
  1: "processing",
  2: "complete",
  3: "error",
  4: "pending",
};

function statusLabel(raw: unknown): string {
  if (raw === null || raw === undefined) return "-";
  return STATUS_LABEL[Number(raw)] ?? String(raw);
}

function engineLabel(raw: unknown): string {
  if (raw === null || raw === undefined) return "-";
  const map: Record<string, string> = {
    1: "Google",
    2: "Bing",
    3: "Yandex",
    4: "Baidu",
  };
  return map[String(raw)] ?? String(raw);
}

const SEARCH_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "enginer_id", header: "Engine", width: 10, transform: engineLabel },
    { key: "status", header: "Status", width: 10, transform: statusLabel },
    { key: "createdAt", header: "Created", width: 20 },
  ],
};

const SEARCH_DETAIL_FIELDS = [
  { key: "id", label: "ID" },
  { key: "enginer_id", label: "Engine" },
  { key: "status", label: "Status" },
  { key: "num_pages", label: "Pages" },
  { key: "concurrency", label: "Concurrency" },
  { key: "notShowBrowser", label: "Headless" },
  { key: "pid", label: "PID" },
  { key: "error_log", label: "Error Log" },
  { key: "runtime_log", label: "Runtime Log" },
  { key: "record_time", label: "Record Time" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Updated" },
];

const SEARCH_RESULT_COLUMNS: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "link", header: "URL", width: 50 },
    { key: "title", header: "Title", width: 30 },
    { key: "snippet", header: "Description", width: 40 },
    { key: "createdAt", header: "Created", width: 20 },
  ],
};

export function registerSearchCommands(parent: Command): void {
  const search = parent
    .command("search")
    .description("Manage search tasks and results");

  // ── search list ────────────────────────────────────────────────────────
  search
    .command("list")
    .description("List search tasks")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--search <query>", "Search term")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(SearchTaskEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const qb = repo.createQueryBuilder("task");
        if (opts.search) {
          qb.where(
            "task.enginer_id LIKE :search OR task.error_log LIKE :search",
            {
              search: `%${opts.search}%`,
            }
          );
        }
        const [items, total] = await qb
          .orderBy("task.id", "DESC")
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "search:list",
          SEARCH_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "search:list");
      }
    });

  // ── search detail <id> ─────────────────────────────────────────────────
  search
    .command("detail <id>")
    .description("Get search task detail")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(SearchTaskEntity);
        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(`Search task not found: ${id}`);
        }
        formatItem(
          item as unknown as Record<string, unknown>,
          opts.json,
          "search:detail",
          SEARCH_DETAIL_FIELDS
        );
      } catch (error) {
        formatError(error, opts.json, "search:detail");
      }
    });

  // ── search results <id> ────────────────────────────────────────────────
  search
    .command("results <id>")
    .description("Get search results for a task")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const { SearchResultEntity } = await import(
          "@/entity/SearchResult.entity"
        );
        const repo = CliDatabase.getRepository(SearchResultEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const qb = repo
          .createQueryBuilder("result")
          .where("result.task_id = :taskId", { taskId: parseInt(id) });

        const [items, total] = await qb
          .orderBy("result.id", "DESC")
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "search:results",
          SEARCH_RESULT_COLUMNS
        );
      } catch (error) {
        formatError(error, opts.json, "search:results");
      }
    });

  // ── search export <id> ─────────────────────────────────────────────────
  search
    .command("export <id>")
    .description("Export search results")
    .option("--format <fmt>", "Export format: csv or json", "csv")
    .option("--output <path>", "Output file path (defaults to stdout)")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const { SearchResultEntity } = await import(
          "@/entity/SearchResult.entity"
        );
        const repo = CliDatabase.getRepository(SearchResultEntity);

        const items = await repo.find({
          where: { task_id: parseInt(id) } as Record<string, unknown>,
          order: { id: "ASC" } as Record<string, string>,
        });

        if (items.length === 0) {
          formatError(
            new Error(`No results found for search task: ${id}`),
            opts.json,
            "search:export"
          );
          return;
        }

        const format = (opts.format || "csv").toLowerCase();

        if (format === "json") {
          const payload = JSON.stringify(items, null, 2);
          if (opts.output) {
            fs.writeFileSync(opts.output, payload, "utf-8");
            formatSuccess(
              `Exported ${items.length} results to ${opts.output}`,
              opts.json,
              "search:export"
            );
          } else {
            if (opts.json) {
              const { printJson } = await import("../output/envelope");
              printJson(items, "search:export");
            } else {
              process.stdout.write(payload + "\n");
            }
          }
          return;
        }

        // CSV format
        const columns = [
          "id",
          "task_id",
          "keyword_id",
          "title",
          "link",
          "snippet",
          "domain",
          "createdAt",
        ];
        const rows = items.map((item) =>
          columns.map((col) => {
            const value = (item as unknown as Record<string, unknown>)[col];
            return value === null || value === undefined ? "" : String(value);
          })
        );

        const csvOutput = await new Promise<string>((resolve, reject) => {
          stringify([columns, ...rows], {}, (err, output) => {
            if (err) reject(err);
            else resolve(output);
          });
        });

        if (opts.output) {
          fs.writeFileSync(opts.output, csvOutput, "utf-8");
          formatSuccess(
            `Exported ${items.length} results to ${opts.output}`,
            opts.json,
            "search:export"
          );
        } else {
          if (opts.json) {
            const { printJson } = await import("../output/envelope");
            printJson({ csv: csvOutput }, "search:export");
          } else {
            process.stdout.write(csvOutput);
          }
        }
      } catch (error) {
        formatError(error, opts.json, "search:export");
      }
    });
}
