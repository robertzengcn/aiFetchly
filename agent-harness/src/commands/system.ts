/**
 * System commands - inspect settings, database path, statistics, and status.
 * Queries system_setting and system_setting_group tables.
 * Uses cli-config for database path and stats.
 */

import { Command } from "commander";
import chalk from "chalk";
import { CliDatabase } from "../adapter/cli-database";
import { SystemSettingEntity } from "@/entity/SystemSetting.entity";
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity";
import { getDatabaseStats, isDatabaseInUse } from "../adapter/cli-config";
import { formatOutput, formatError } from "../output/formatter";
import type { TableConfig } from "../common/types";

const SETTINGS_TABLE_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "key", header: "Key", width: 30 },
    { key: "value", header: "Value", width: 30 },
    { key: "type", header: "Type", width: 10 },
    { key: "description", header: "Description", width: 30 },
  ],
};

export function registerSystemCommands(parent: Command): void {
  const system = parent
    .command("system")
    .description("System information and settings");

  system
    .command("settings")
    .description("List system settings")
    .option("-g, --group <group>", "Filter by setting group name")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(SystemSettingEntity);

        let items: Record<string, unknown>[];

        if (opts.group) {
          const groupRepo = CliDatabase.getRepository(SystemSettingGroupEntity);
          const group = await groupRepo.findOne({
            where: { name: opts.group } as Record<string, unknown>,
            relations: ["settings"],
          });
          if (!group) {
            throw new Error(`Setting group not found: ${opts.group}`);
          }
          items = (group.settings || []) as unknown as Record<
            string,
            unknown
          >[];
        } else {
          items = (await repo.find({
            order: { id: "ASC" } as Record<string, string>,
          })) as unknown as Record<string, unknown>[];
        }

        formatOutput(
          items,
          opts.json,
          "system:settings",
          SETTINGS_TABLE_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "system:settings");
      }
    });

  system
    .command("db-path")
    .description("Show database path")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const dbPath = CliDatabase.getCurrentDbPath();
        const data = {
          dbDirectory: dbPath,
          dbFile: dbPath + "/scraper.db",
        };
        formatOutput(data, opts.json, "system:db-path");
      } catch (error) {
        formatError(error, opts.json, "system:db-path");
      }
    });

  system
    .command("db-stats")
    .description("Show database statistics")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const dbPath = CliDatabase.getCurrentDbPath();
        const stats = getDatabaseStats(dbPath);
        if (!stats) {
          throw new Error("Could not read database statistics");
        }

        const data = {
          dbPath: dbPath + "/scraper.db",
          dbSize: stats.dbSize,
          dbSizeHuman: formatBytes(stats.dbSize),
          walSizeBytes: stats.walSize,
          walSizeHuman: formatBytes(stats.walSize),
          lastModified: stats.lastModified,
        };
        formatOutput(data, opts.json, "system:db-stats");
      } catch (error) {
        formatError(error, opts.json, "system:db-stats");
      }
    });

  system
    .command("status")
    .description("Show overall system status")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const dbPath = CliDatabase.getCurrentDbPath();
        const stats = getDatabaseStats(dbPath);
        const dbInUse = isDatabaseInUse(dbPath);

        const data = {
          status: "ok",
          database: {
            directory: dbPath,
            file: dbPath + "/scraper.db",
            sizeBytes: stats?.dbSize ?? 0,
            sizeHuman: stats ? formatBytes(stats.dbSize) : "unknown",
            walSizeBytes: stats?.walSize ?? 0,
            walSizeHuman: stats ? formatBytes(stats.walSize) : "unknown",
            lastModified: stats?.lastModified ?? null,
            inUse: dbInUse,
          },
        };

        if (opts.json) {
          formatOutput(data, true, "system:status");
        } else {
          console.log(chalk.bold("System Status"));
          console.log(chalk.cyan("  Database:"), data.database.file);
          console.log(chalk.cyan("  Size:"), data.database.sizeHuman);
          console.log(
            chalk.cyan("  Last Modified:"),
            data.database.lastModified
              ? new Date(data.database.lastModified).toLocaleString()
              : "unknown"
          );
          console.log(
            chalk.cyan("  In Use:"),
            data.database.inUse
              ? chalk.yellow("Yes (WAL/SHM files present - app may be running)")
              : chalk.green("No")
          );
        }
      } catch (error) {
        formatError(error, opts.json, "system:status");
      }
    });
}

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
