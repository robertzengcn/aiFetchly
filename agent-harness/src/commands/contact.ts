/**
 * Contact commands - manage contact extraction data.
 * Maps to contact extraction IPC channels.
 * Uses ContactInfoEntity and SearchResultEntity.
 */

import { Command } from "commander";
import * as fs from "fs";
import { stringify } from "csv-stringify";
import { CliDatabase } from "../adapter/cli-database";
import {
  formatPaginated,
  formatItem,
  formatError,
  formatSuccess,
} from "../output/formatter";
import type { TableConfig } from "../common/types";

const CONTACT_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "email", header: "Email", width: 30 },
    { key: "phone", header: "Phone", width: 16 },
    { key: "address", header: "Address", width: 30 },
    { key: "extractionStatus", header: "Status", width: 10 },
    { key: "extractionDate", header: "Created", width: 20 },
  ],
};

const CONTACT_DETAIL_FIELDS = [
  { key: "id", label: "ID" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "socialLinks", label: "Social Links" },
  { key: "extractionStatus", label: "Status" },
  { key: "extractionError", label: "Error" },
  { key: "extractionDate", label: "Extraction Date" },
  { key: "resultId", label: "Result ID" },
  { key: "extractionMetadata", label: "Metadata" },
];

export function registerContactCommands(parent: Command): void {
  const contact = parent
    .command("contact")
    .description("Manage contact extraction data");

  // ── contact list ───────────────────────────────────────────────────────
  contact
    .command("list")
    .description("List contacts with pagination")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--search <query>", "Search term")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const { ContactInfoEntity } = await import(
          "@/entity/ContactInfo.entity"
        );
        const repo = CliDatabase.getRepository(ContactInfoEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const qb = repo.createQueryBuilder("contact");
        if (opts.search) {
          qb.where(
            "contact.email LIKE :search OR contact.phone LIKE :search OR contact.address LIKE :search",
            { search: `%${opts.search}%` }
          );
        }
        const [items, total] = await qb
          .orderBy("contact.id", "DESC")
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "contact:list",
          CONTACT_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "contact:list");
      }
    });

  // ── contact search <query> ─────────────────────────────────────────────
  contact
    .command("search <query>")
    .description("Search contacts by name, email, or company")
    .option("--json", "Output as JSON")
    .action(async (query, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const { ContactInfoEntity } = await import(
          "@/entity/ContactInfo.entity"
        );
        const repo = CliDatabase.getRepository(ContactInfoEntity);

        const items = await repo
          .createQueryBuilder("contact")
          .where(
            "contact.email LIKE :q OR contact.phone LIKE :q OR contact.address LIKE :q",
            { q: `%${query}%` }
          )
          .orderBy("contact.id", "DESC")
          .getMany();

        if (items.length === 0) {
          formatError(
            new Error(`No contacts found matching: ${query}`),
            opts.json,
            "contact:search"
          );
          return;
        }

        formatPaginated(
          {
            items,
            total: items.length,
            page: 1,
            size: items.length,
            totalPages: 1,
          },
          opts.json,
          "contact:search",
          CONTACT_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "contact:search");
      }
    });

  // ── contact export ─────────────────────────────────────────────────────
  contact
    .command("export")
    .description("Export all contacts")
    .option("--format <fmt>", "Export format: csv or json", "csv")
    .option("--output <path>", "Output file path (defaults to stdout)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const { ContactInfoEntity } = await import(
          "@/entity/ContactInfo.entity"
        );
        const repo = CliDatabase.getRepository(ContactInfoEntity);

        const items = await repo.find({
          order: { id: "ASC" } as Record<string, string>,
        });

        if (items.length === 0) {
          formatError(
            new Error("No contacts to export"),
            opts.json,
            "contact:export"
          );
          return;
        }

        const format = (opts.format || "csv").toLowerCase();

        if (format === "json") {
          const payload = JSON.stringify(items, null, 2);
          if (opts.output) {
            fs.writeFileSync(opts.output, payload, "utf-8");
            formatSuccess(
              `Exported ${items.length} contacts to ${opts.output}`,
              opts.json,
              "contact:export"
            );
          } else {
            if (opts.json) {
              const { printJson } = await import("../output/envelope");
              printJson(items, "contact:export");
            } else {
              process.stdout.write(payload + "\n");
            }
          }
          return;
        }

        // CSV format
        const columns = [
          "id",
          "resultId",
          "email",
          "phone",
          "address",
          "extractionStatus",
          "extractionDate",
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
            `Exported ${items.length} contacts to ${opts.output}`,
            opts.json,
            "contact:export"
          );
        } else {
          if (opts.json) {
            const { printJson } = await import("../output/envelope");
            printJson({ csv: csvOutput }, "contact:export");
          } else {
            process.stdout.write(csvOutput);
          }
        }
      } catch (error) {
        formatError(error, opts.json, "contact:export");
      }
    });

  // ── contact detail <id> ────────────────────────────────────────────────
  contact
    .command("detail <id>")
    .description("Get contact detail")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const { ContactInfoEntity } = await import(
          "@/entity/ContactInfo.entity"
        );
        const repo = CliDatabase.getRepository(ContactInfoEntity);

        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(`Contact not found: ${id}`);
        }
        formatItem(
          item as unknown as Record<string, unknown>,
          opts.json,
          "contact:detail",
          CONTACT_DETAIL_FIELDS
        );
      } catch (error) {
        formatError(error, opts.json, "contact:detail");
      }
    });
}
