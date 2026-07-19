/**
 * ProxyAiTools — LLM-facing proxy management tool service.
 *
 * Architecture boundary: this service is the ONLY AI layer over proxies. It
 * validates tool arguments, calls `ProxyModule` / `ProxyController` for all
 * business logic and database access, and maps every result to a credential-
 * redacted payload. It never imports TypeORM repositories, never reads the
 * proxy DB directly, and never drives the Vue proxy page.
 *
 * Dependency-injectable (`ProxyAiToolsDeps`) so logic can be unit-tested with
 * mocked module/controller instances and no SQLite.
 */

import { ZodError } from "zod";
import { ProxyModule } from "@/modules/ProxyModule";
import { ProxyController } from "@/controller/proxy-controller";
import type { IProxyApi } from "@/modules/interface/IProxyApi";
import type { ProxyListEntity } from "@/entityTypes/proxyType";
import {
  proxyListSchema,
  proxyGetSchema,
  toSafeProxySummary,
  mapBasicStatus,
  mapGooglePassStatus,
  type SafeProxySummary,
  type SafeProxySummaryInput,
  type ProxyToolError,
  type ProxyListToolResult,
  type ProxyGetToolResult,
} from "@/entityTypes/proxyAiToolTypes";

/** Hard cap for bounded in-memory scans when filtering by check status. */
const BOUNDED_SCAN_LIMIT = 500;

export interface ProxyAiToolsDeps {
  readonly proxyModule?: IProxyApi;
  readonly proxyController?: ProxyController;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export function proxyToolError(
  code: ProxyToolError["code"],
  error: string,
): ProxyToolError {
  return { success: false, code, error };
}

function mapZodError(error: ZodError): ProxyToolError {
  return proxyToolError(
    "INVALID_INPUT",
    `Invalid input: ${error.issues.map((issue) => issue.message).join("; ")}`,
  );
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function summaryFromList(record: ProxyListEntity): SafeProxySummary | null {
  if (record.id === undefined || !record.host || !record.port) {
    return null;
  }
  const input: SafeProxySummaryInput = {
    id: record.id,
    host: record.host,
    port: record.port,
    protocol: record.protocol,
    username: record.username,
    password: record.password,
    country_code: record.country_code,
    addtime: record.addtime,
    checktime: record.checktime,
    status: record.status,
    googlePass: record.googlePass,
  };
  return toSafeProxySummary(input);
}

function basicStatusOf(record: ProxyListEntity): ReturnType<typeof mapBasicStatus> {
  return mapBasicStatus(record.status, Boolean(record.checktime));
}

function googlePassOf(record: ProxyListEntity): ReturnType<typeof mapGooglePassStatus> {
  return mapGooglePassStatus(record.googlePass);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProxyAiTools {
  constructor(private readonly deps: ProxyAiToolsDeps = {}) {}

  protected getProxyModule(): IProxyApi {
    return this.deps.proxyModule ?? new ProxyModule();
  }

  protected getProxyController(): ProxyController {
    return this.deps.proxyController ?? new ProxyController();
  }

  /**
   * List proxies without exposing credentials. When a status or googlePass
   * filter is supplied, perform a bounded scan (<= BOUNDED_SCAN_LIMIT rows) and
   * filter in memory, since the proxy table is not pre-joined with check
   * status in SQL.
   */
  async listProxies(
    args: Record<string, unknown>,
  ): Promise<ProxyListToolResult | ProxyToolError> {
    let input;
    try {
      input = proxyListSchema.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return mapZodError(error);
      }
      throw error;
    }

    const controller = this.getProxyController();
    const needsFilterScan =
      input.status !== undefined || input.googlePass !== undefined;

    let records: ProxyListEntity[];
    let total: number;

    if (needsFilterScan) {
      const scanned = await this.boundedScan(controller, input.search);
      const filtered = scanned.filter((record) => {
        if (
          input.status !== undefined &&
          basicStatusOf(record) !== input.status
        ) {
          return false;
        }
        if (
          input.googlePass !== undefined &&
          googlePassOf(record) !== input.googlePass
        ) {
          return false;
        }
        return true;
      });
      total = filtered.length;
      const start = input.page * input.size;
      records = filtered.slice(start, start + input.size);
    } else {
      // Controller enriches records with check status; page is 0-based here and
      // converted to the 1-based page the model layer expects.
      const resp = await controller.getProxylist(
        input.page + 1,
        input.size,
        input.search ?? "",
      );
      if (!resp.status || !resp.data) {
        return proxyToolError(
          "UNSUPPORTED_OPERATION",
          resp.msg || "Failed to read proxy list",
        );
      }
      records = resp.data.records;
      total = resp.data.total;
    }

    const proxies = records
      .map(summaryFromList)
      .filter((summary): summary is SafeProxySummary => summary !== null);

    return {
      success: true,
      proxies,
      total,
      page: input.page,
      size: input.size,
      credentialsRedacted: true,
    };
  }

  /** Inspect a single proxy by exact ID. Credentials are never revealed. */
  async getProxy(
    args: Record<string, unknown>,
  ): Promise<ProxyGetToolResult | ProxyToolError> {
    let input;
    try {
      input = proxyGetSchema.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return mapZodError(error);
      }
      throw error;
    }

    const module = this.getProxyModule();
    const detail = await module.getProxyDetail(input.proxy_id);
    if (!detail.status || !detail.data) {
      return proxyToolError(
        "PROXY_NOT_FOUND",
        `Proxy #${input.proxy_id} was not found.`,
      );
    }

    const proxy = detail.data;
    const summary = toSafeProxySummary({
      id: proxy.id,
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol,
      user: proxy.user,
      pass: proxy.pass,
      country_code: proxy.country_code,
      addtime: proxy.addtime,
    });

    return {
      success: true,
      proxy: summary,
      credentialsRedacted: true,
    };
  }

  /**
   * Fetch up to BOUNDED_SCAN_LIMIT enriched records across pages. Used when
   * SQL-level status filtering is unavailable.
   */
  private async boundedScan(
    controller: ProxyController,
    search: string | undefined,
  ): Promise<ProxyListEntity[]> {
    const pageSize = 100;
    const collected: ProxyListEntity[] = [];
    for (let page = 0; page * pageSize < BOUNDED_SCAN_LIMIT; page += 1) {
      const resp = await controller.getProxylist(page + 1, pageSize, search ?? "");
      if (!resp.status || !resp.data || resp.data.records.length === 0) {
        break;
      }
      collected.push(...resp.data.records);
      if (collected.length >= resp.data.total) {
        break;
      }
      if (resp.data.records.length < pageSize) {
        break;
      }
    }
    return collected.slice(0, BOUNDED_SCAN_LIMIT);
  }
}

// ---------------------------------------------------------------------------
// Free-function wrappers (consumed by skillsRegistry)
// ---------------------------------------------------------------------------

let defaultTools: ProxyAiTools | null = null;

function getDefaultTools(): ProxyAiTools {
  if (!defaultTools) {
    defaultTools = new ProxyAiTools();
  }
  return defaultTools;
}

/** Test-only: reset the cached default instance between unit tests. */
export function resetProxyAiToolsDefault(): void {
  defaultTools = null;
}

export async function listProxiesForAi(
  args: Record<string, unknown>,
): Promise<ProxyListToolResult | ProxyToolError> {
  return getDefaultTools().listProxies(args);
}

export async function getProxyForAi(
  args: Record<string, unknown>,
): Promise<ProxyGetToolResult | ProxyToolError> {
  return getDefaultTools().getProxy(args);
}
