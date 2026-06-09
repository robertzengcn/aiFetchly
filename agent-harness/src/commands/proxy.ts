/**
 * Proxy commands - manage proxy servers.
 * Maps to IPC channels from proxy-ipc.ts:
 *   PROXYLIST, PROXYDETAIL, PROXYSAVE, PROXYDELETE,
 *   PROXYIMPORT, PROXYCHECK
 */

import { Command } from "commander";
import fs from "fs";
import { CliDatabase } from "../adapter/cli-database";
import { ProxyEntity } from "@/entity/Proxy.entity";
import {
  formatPaginated,
  formatItem,
  formatSuccess,
  formatError,
} from "../output/formatter";
import type { TableConfig } from "../common/types";
import { ReadOnlyError } from "../common/errors";

const PROXY_LIST_CONFIG: TableConfig = {
  columns: [
    { key: "id", header: "ID", width: 6 },
    { key: "host", header: "Host", width: 30 },
    { key: "port", header: "Port", width: 8 },
    { key: "protocol", header: "Type", width: 8 },
    { key: "country_code", header: "Status", width: 10 },
    { key: "addtime", header: "Last Checked", width: 20 },
  ],
};

const PROXY_DETAIL_FIELDS = [
  { key: "id", label: "ID" },
  { key: "host", label: "Host" },
  { key: "port", label: "Port" },
  { key: "user", label: "Username" },
  { key: "protocol", label: "Type" },
  { key: "country_code", label: "Status" },
  { key: "addtime", label: "Last Checked" },
  { key: "createdAt", label: "Created" },
];

export function registerProxyCommands(parent: Command): void {
  const proxy = parent.command("proxy").description("Manage proxy servers");

  proxy
    .command("list")
    .description("List all proxies")
    .option("-p, --page <number>", "Page number", "1")
    .option("-s, --size <number>", "Page size", "20")
    .option("--search <query>", "Search by host or port")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ProxyEntity);
        const page = parseInt(opts.page) || 1;
        const size = parseInt(opts.size) || 20;
        const skip = (page - 1) * size;

        const qb = repo.createQueryBuilder("proxy");
        if (opts.search) {
          qb.where("proxy.host LIKE :search OR proxy.port LIKE :search", {
            search: `%${opts.search}%`,
          });
        }
        const [items, total] = await qb
          .orderBy("proxy.id", "DESC")
          .skip(skip)
          .take(size)
          .getManyAndCount();

        formatPaginated(
          { items, total, page, size, totalPages: Math.ceil(total / size) },
          opts.json,
          "proxy:list",
          PROXY_LIST_CONFIG
        );
      } catch (error) {
        formatError(error, opts.json, "proxy:list");
      }
    });

  proxy
    .command("detail <id>")
    .description("Get proxy detail")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ProxyEntity);
        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(`Proxy not found: ${id}`);
        }
        formatItem(
          item as unknown as Record<string, unknown>,
          opts.json,
          "proxy:detail",
          PROXY_DETAIL_FIELDS
        );
      } catch (error) {
        formatError(error, opts.json, "proxy:detail");
      }
    });

  proxy
    .command("add")
    .description("Add a proxy server")
    .requiredOption("--host <host>", "Proxy host")
    .requiredOption("--port <port>", "Proxy port")
    .option("--username <user>", "Proxy username")
    .option("--password <pass>", "Proxy password")
    .option("--type <type>", "Proxy type (http, https, socks5, etc.)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      if (opts.parent?.parent?.readOnly) throw new ReadOnlyError("proxy:add");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ProxyEntity);
        const entity = repo.create({
          host: opts.host,
          port: opts.port,
          user: opts.username || null,
          pass: opts.password || null,
          protocol: opts.type || "http",
          addtime: new Date().toISOString(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const saved = await repo.save(entity);
        formatSuccess(
          `Proxy added with ID: ${saved.id}`,
          opts.json,
          "proxy:add"
        );
      } catch (error) {
        formatError(error, opts.json, "proxy:add");
      }
    });

  proxy
    .command("delete <id>")
    .description("Delete a proxy")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      if (opts.parent?.parent?.readOnly)
        throw new ReadOnlyError("proxy:delete");
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ProxyEntity);
        const result = await repo.delete(parseInt(id));
        if (result.affected === 0) throw new Error(`Proxy not found: ${id}`);
        formatSuccess(`Proxy ${id} deleted`, opts.json, "proxy:delete");
      } catch (error) {
        formatError(error, opts.json, "proxy:delete");
      }
    });

  proxy
    .command("import <filePath>")
    .description(
      "Import proxies from file (one proxy per line: host:port:user:pass)"
    )
    .option("--json", "Output as JSON")
    .action(async (filePath, opts) => {
      if (opts.parent?.parent?.readOnly)
        throw new ReadOnlyError("proxy:import");
      try {
        await CliDatabase.ensureInitialized();

        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content
          .split("\n")
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0 && !line.startsWith("#"));

        if (lines.length === 0) {
          throw new Error("No proxy entries found in file");
        }

        const repo = CliDatabase.getRepository(ProxyEntity);
        const entities = lines.map((line: string) => {
          const parts = line.split(":");
          if (parts.length < 2) {
            throw new Error(
              `Invalid proxy format: ${line}. Expected host:port[:user[:pass]]`
            );
          }
          return repo.create({
            host: parts[0],
            port: parts[1],
            user: parts[2] || null,
            pass: parts[3] || null,
            protocol: "http",
            addtime: new Date().toISOString(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        });

        const saved = await repo.save(entities);
        formatSuccess(
          `Imported ${saved.length} proxy server(s)`,
          opts.json,
          "proxy:import"
        );
      } catch (error) {
        formatError(error, opts.json, "proxy:import");
      }
    });

  proxy
    .command("check <id>")
    .description("Check proxy connectivity")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        await CliDatabase.ensureInitialized();
        const repo = CliDatabase.getRepository(ProxyEntity);
        const item = await repo.findOne({
          where: { id: parseInt(id) } as Record<string, unknown>,
        });
        if (!item) {
          throw new Error(`Proxy not found: ${id}`);
        }

        // CLI cannot perform real connectivity check (no Electron net module).
        // Report current stored status instead.
        const proxyData = item as unknown as Record<string, unknown>;
        const statusMessage =
          `Proxy ${proxyData.host}:${proxyData.port} - stored status: ${
            proxyData.country_code || "unknown"
          }. ` +
          `Note: live connectivity check requires the full Electron application.`;

        formatSuccess(statusMessage, opts.json, "proxy:check");
      } catch (error) {
        formatError(error, opts.json, "proxy:check");
      }
    });
}
