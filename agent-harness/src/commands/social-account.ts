/**
 * Social Account commands - manage social media platform accounts.
 * Uses SocialAccountEntity.
 */

import { Command } from "commander";
import { CliDatabase } from "../adapter/cli-database";
import { SocialAccountEntity } from "@/entity/SocialAccount.entity";
import {
  formatOutput,
  formatItem,
  formatSuccess,
  formatError,
} from "../output/formatter";
import type { TableConfig } from "../common/types";
import { ReadOnlyError } from "../common/errors";

const SOCIAL_ACCOUNT_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "social_type_id", header: "Platform", width: 12 },
    { key: "user", header: "Username", width: 20 },
    { key: "status", header: "Status", width: 10 },
    { key: "updatedAt", header: "Last Used", width: 20 },
  ],
};

const SOCIAL_ACCOUNT_DETAIL_FIELDS = [
  { key: "id", label: "ID" },
  { key: "social_type_id", label: "Platform" },
  { key: "user", label: "Username" },
  { key: "name", label: "Display Name" },
  { key: "status", label: "Status" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "pass", label: "Password" },
  { key: "proxy", label: "Proxy" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last Used" },
];

export function registerSocialAccountCommands(parent: Command): void {
  const sa = parent
    .command("social-account")
    .description("Manage social media accounts");

  // ── social-account list ────────────────────────────────────────────────
  sa.command("list")
    .description("List social accounts")
    .option("--platform <platform>", "Filter by platform type ID")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(SocialAccountEntity);

        const findOptions: Record<string, unknown> = {
          order: { id: "DESC" },
        };

        if (opts.platform) {
          const typeId = parseInt(opts.platform);
          if (!isNaN(typeId)) {
            findOptions.where = { social_type_id: typeId };
          }
        }

        const items = await repo.find(findOptions);

        formatOutput(
          items,
          opts.json,
          "social-account:list",
          SOCIAL_ACCOUNT_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "social-account:list");
      }
    });

  // ── social-account detail <id> ─────────────────────────────────────────
  sa.command("detail <id>")
    .description("Get account detail")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(SocialAccountEntity);

        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(`Social account not found: ${id}`);
        }

        const record = item as unknown as Record<string, unknown>;

        // Mask password in detail output for security
        const safeRecord: Record<string, unknown> = {
          ...record,
          pass: record.pass ? "********" : "",
          // Proxy is a relation (array), show a summary instead of raw objects
          proxy: Array.isArray(record.proxy)
            ? `${record.proxy.length} proxy(s) configured`
            : record.proxy ?? "None",
        };

        formatItem(
          safeRecord,
          opts.json,
          "social-account:detail",
          SOCIAL_ACCOUNT_DETAIL_FIELDS
        );
      } catch (error) {
        formatError(error, opts.json, "social-account:detail");
      }
    });

  // ── social-account delete <id> ─────────────────────────────────────────
  sa.command("delete <id>")
    .description("Delete a social account")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      if (opts.parent?.parent?.readOnly)
        throw new ReadOnlyError("social-account:delete");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(SocialAccountEntity);

        const result = await repo.delete(parseInt(id));
        if (result.affected === 0) {
          throw new Error(`Social account not found: ${id}`);
        }

        formatSuccess(
          `Social account ${id} deleted`,
          opts.json,
          "social-account:delete"
        );
      } catch (error) {
        formatError(error, opts.json, "social-account:delete");
      }
    });
}
