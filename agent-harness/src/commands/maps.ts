/**
 * Maps commands - manage Google Maps and Yandex Maps search records.
 * Uses GoogleMapsSearchRecordEntity, YandexMapsSearchRecordEntity.
 */

import { Command } from "commander";
import { CliDatabase } from "../adapter/cli-database";
import { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import { formatPaginated, formatItem, formatError } from "../output/formatter";
import type { TableConfig } from "../common/types";

const MAPS_HISTORY_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "query", header: "Query", width: 25 },
    { key: "location", header: "Location", width: 20 },
    { key: "totalResults", header: "Results", width: 10 },
    { key: "createdAt", header: "Created", width: 20 },
  ],
};

const MAPS_DETAIL_FIELDS = [
  { key: "id", label: "ID" },
  { key: "query", label: "Query" },
  { key: "location", label: "Location" },
  { key: "totalResults", label: "Results Count" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created" },
  { key: "searchData", label: "Search Data" },
];

type MapsEngine = "google" | "yandex";

function getEntityForEngine(engine: MapsEngine) {
  return engine === "yandex"
    ? YandexMapsSearchRecordEntity
    : GoogleMapsSearchRecordEntity;
}

export function registerMapsCommands(parent: Command): void {
  const maps = parent.command("maps").description("Manage maps search history");

  // ── maps history ───────────────────────────────────────────────────────
  maps
    .command("history")
    .description("List search history")
    .option("--engine <engine>", "Search engine: google or yandex", "google")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const engine: MapsEngine =
          opts.engine === "yandex" ? "yandex" : "google";
        await CliDatabase.ensureInitialized();
        const EntityClass = getEntityForEngine(engine);
        const repo = CliDatabase.getRepository(EntityClass);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const alias = engine === "yandex" ? "ym_record" : "gm_record";
        const [items, total] = await repo
          .createQueryBuilder(alias)
          .orderBy(`${alias}.id`, "DESC")
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          `maps:history:${engine}`,
          MAPS_HISTORY_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "maps:history");
      }
    });

  // ── maps history-detail <id> ───────────────────────────────────────────
  maps
    .command("history-detail <id>")
    .description("Get search record detail")
    .option("--engine <engine>", "Search engine: google or yandex", "google")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        const engine: MapsEngine =
          opts.engine === "yandex" ? "yandex" : "google";
        await CliDatabase.ensureInitialized();
        const EntityClass = getEntityForEngine(engine);
        const repo = CliDatabase.getRepository(EntityClass);

        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(
            `Maps search record not found: ${id} (engine: ${engine})`
          );
        }

        const record = item as unknown as Record<string, unknown>;

        // Build a preview-safe version: truncate the JSON results field
        const recordWithPreview: Record<string, unknown> = {
          id: record.id,
          query: record.query,
          location: record.location,
          totalResults: record.totalResults,
          status: record.status,
          createdAt: record.createdAt,
          searchData: truncatePreview(record.results),
        };

        formatItem(
          recordWithPreview,
          opts.json,
          `maps:history-detail:${engine}`,
          MAPS_DETAIL_FIELDS
        );
      } catch (error) {
        formatError(error, opts.json, "maps:history-detail");
      }
    });
}

/**
 * Truncate a potentially large JSON string to a short preview for table display.
 */
function truncatePreview(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  const MAX_PREVIEW = 200;
  if (str.length <= MAX_PREVIEW) return str;
  return str.slice(0, MAX_PREVIEW) + "...";
}
