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

import { z, ZodError } from "zod";
import { ProxyModule } from "@/modules/ProxyModule";
import { ProxyController } from "@/controller/proxy-controller";
import type { IProxyApi } from "@/modules/interface/IProxyApi";
import type {
  ProxyEntity,
  ProxyListEntity,
  ProxyParseItem,
} from "@/entityTypes/proxyType";
import {
  proxyListSchema,
  proxyGetSchema,
  proxyCreateSchema,
  proxyUpdateSchema,
  proxyDeleteSchema,
  toSafeProxySummary,
  mapBasicStatus,
  mapGooglePassStatus,
  normalizePort,
  type SafeProxySummary,
  type SafeProxySummaryInput,
  type ProxyToolError,
  type ProxyListToolResult,
  type ProxyGetToolResult,
  type ProxyCreateToolResult,
  type ProxyUpdateToolResult,
  type ProxyDeleteToolResult,
  type ProxyImportToolResult,
  type ProxyImportInvalidRow,
  type ProxyProtocol,
  type ProxyCheckToolResult,
  type ProxyCheckItemResult,
  type ProxyRemoveFailedToolResult,
  proxyCheckSchema,
  proxyRemoveFailedSchema,
} from "@/entityTypes/proxyAiToolTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

/**
 * Import wrapper validates only array length and duplicate policy here; each
 * row is validated individually with `proxyCreateSchema.safeParse` so the tool
 * can return per-row invalid details (AC-6) instead of rejecting wholesale.
 */
const proxyImportWrapperSchema = z.object({
  proxies: z.array(z.record(z.unknown())).min(1).max(500),
  duplicatePolicy: z.enum(["skip", "fail"]).default("skip"),
});

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
  error: string
): ProxyToolError {
  return { success: false, code, error };
}

function mapZodError(error: ZodError): ProxyToolError {
  return proxyToolError(
    "INVALID_INPUT",
    `Invalid input: ${error.issues.map((issue) => issue.message).join("; ")}`
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

function basicStatusOf(
  record: ProxyListEntity
): ReturnType<typeof mapBasicStatus> {
  return mapBasicStatus(record.status, Boolean(record.checktime));
}

function googlePassOf(
  record: ProxyListEntity
): ReturnType<typeof mapGooglePassStatus> {
  return mapGooglePassStatus(record.googlePass);
}

/** A proxy entity whose nullable fields may be explicitly nulled to clear. */
type ClearableProxyEntity = Omit<
  ProxyEntity,
  "user" | "pass" | "country_code"
> & {
  user?: string | null;
  pass?: string | null;
  country_code?: string | null;
};

/** Map a detail entity (user/pass shape) to a redacted safe summary. */
function summaryFromDetail(proxy: ProxyEntity): SafeProxySummary {
  if (proxy.id === undefined) {
    throw new Error("Cannot map proxy without an id to safe summary");
  }
  return toSafeProxySummary({
    id: proxy.id,
    host: proxy.host,
    port: proxy.port,
    protocol: proxy.protocol,
    user: proxy.user,
    pass: proxy.pass,
    country_code: proxy.country_code,
    addtime: proxy.addtime,
  });
}

/**
 * Validate optional expected_host / expected_port guards against the current
 * record. Returns a ProxyToolError on mismatch, or undefined when guards pass
 * (or are absent).
 */
function checkExpectedMatch(
  current: { host: string; port: string },
  expectedHost: string | undefined,
  expectedPort: string | number | undefined
): ProxyToolError | undefined {
  if (expectedHost !== undefined && expectedHost !== current.host) {
    return proxyToolError(
      "EXPECTED_PROXY_MISMATCH",
      `Proxy host is ${current.host}, not ${expectedHost}.`
    );
  }
  if (expectedPort !== undefined) {
    const expected = normalizePort(expectedPort);
    const actual = normalizePort(current.port) ?? current.port;
    if (expected !== actual) {
      return proxyToolError(
        "EXPECTED_PROXY_MISMATCH",
        `Proxy port is ${actual}, not ${expectedPort}.`
      );
    }
  }
  return undefined;
}

/** Filter enriched list records by optional status/googlePass, returning ids. */
function filterRecordsByCheckStatus(
  records: readonly ProxyListEntity[],
  status: "unknown" | "pass" | "failure" | undefined,
  googlePass: "not_checked" | "pass" | "fail" | undefined
): number[] {
  const ids: number[] = [];
  for (const record of records) {
    if (status !== undefined && basicStatusOf(record) !== status) {
      continue;
    }
    if (googlePass !== undefined && googlePassOf(record) !== googlePass) {
      continue;
    }
    if (record.id !== undefined) {
      ids.push(record.id);
    }
  }
  return ids;
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
    args: Record<string, unknown>
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
    let truncated = false;

    if (needsFilterScan) {
      const scanned = await this.boundedScan(controller, input.search);
      truncated = scanned.truncated;
      const filtered = scanned.records.filter((record) => {
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
      // Controller returns the bare {records,total} payload (it unwraps the
      // module envelope) and throws on module error.
      try {
        const resp = await controller.getProxylist(
          input.page + 1,
          input.size,
          input.search ?? ""
        );
        records = resp.records;
        total = resp.total;
      } catch (err) {
        return proxyToolError(
          "UNSUPPORTED_OPERATION",
          err instanceof Error ? err.message : "Failed to read proxy list"
        );
      }
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
      ...(truncated ? { truncated: true } : {}),
    };
  }

  /** Inspect a single proxy by exact ID. Credentials are never revealed. */
  async getProxy(
    args: Record<string, unknown>
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
        `Proxy #${input.proxy_id} was not found.`
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

  /** Create one proxy. Returns the redacted new summary on success. */
  async createProxy(
    args: Record<string, unknown>
  ): Promise<ProxyCreateToolResult | ProxyToolError> {
    let input;
    try {
      input = proxyCreateSchema.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return mapZodError(error);
      }
      throw error;
    }

    const module = this.getProxyModule();
    const saved = await module.saveProxy({
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      user: input.user,
      pass: input.pass,
      country_code: input.country_code,
    });
    if (!saved.status) {
      if (saved.code === 409) {
        return proxyToolError(
          "DUPLICATE_PROXY",
          saved.msg || "A proxy with this host and port already exists."
        );
      }
      return proxyToolError(
        "INTERNAL_ERROR",
        saved.msg || "Failed to create proxy."
      );
    }

    const detail = await module.getProxyDetail(saved.data.id);
    if (!detail.status || !detail.data || detail.data.id === undefined) {
      return proxyToolError(
        "INTERNAL_ERROR",
        "Proxy was created but could not be reloaded."
      );
    }
    return {
      success: true,
      created: true,
      proxy: summaryFromDetail(detail.data),
    };
  }

  /** Update one proxy by exact ID with optional expected-host/port guards. */
  async updateProxy(
    args: Record<string, unknown>
  ): Promise<ProxyUpdateToolResult | ProxyToolError> {
    let input;
    try {
      input = proxyUpdateSchema.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return mapZodError(error);
      }
      throw error;
    }

    const module = this.getProxyModule();
    const current = await module.getProxyDetail(input.proxy_id);
    if (!current.status || !current.data || current.data.id === undefined) {
      return proxyToolError(
        "PROXY_NOT_FOUND",
        `Proxy #${input.proxy_id} was not found.`
      );
    }
    const cur = current.data;

    const mismatch = checkExpectedMatch(
      cur,
      input.expected_host,
      input.expected_port
    );
    if (mismatch) {
      return mismatch;
    }

    // Build a full merged entity. Null clears a field (TypeORM writes NULL);
    // undefined (unchanged) is avoided by initializing from current values.
    const merged: ClearableProxyEntity = {
      id: cur.id,
      host: cur.host,
      port: cur.port,
      protocol: cur.protocol,
      user: cur.user ?? null,
      pass: cur.pass ?? null,
      country_code: cur.country_code ?? null,
      addtime: cur.addtime,
    };
    const changedFields: string[] = [];
    const curPort = normalizePort(cur.port) ?? cur.port;

    if (input.host !== undefined && input.host !== cur.host) {
      merged.host = input.host;
      changedFields.push("host");
    }
    if (input.port !== undefined && input.port !== curPort) {
      merged.port = input.port;
      changedFields.push("port");
    }
    if (input.protocol !== undefined && input.protocol !== cur.protocol) {
      merged.protocol = input.protocol;
      changedFields.push("protocol");
    }
    if (
      input.user !== undefined &&
      (input.user ?? null) !== (cur.user ?? null)
    ) {
      merged.user = input.user;
      changedFields.push("user");
    }
    if (
      input.pass !== undefined &&
      (input.pass ?? null) !== (cur.pass ?? null)
    ) {
      merged.pass = input.pass;
      changedFields.push("pass");
    }
    if (
      input.country_code !== undefined &&
      (input.country_code ?? null) !== (cur.country_code ?? null)
    ) {
      merged.country_code = input.country_code;
      changedFields.push("country_code");
    }

    const updated = await module.saveProxy(merged as unknown as ProxyEntity);
    if (!updated.status) {
      return proxyToolError(
        "INTERNAL_ERROR",
        updated.msg || "Failed to update proxy."
      );
    }

    const reloaded = await module.getProxyDetail(input.proxy_id);
    if (!reloaded.status || !reloaded.data || reloaded.data.id === undefined) {
      return proxyToolError(
        "INTERNAL_ERROR",
        "Proxy was updated but could not be reloaded."
      );
    }
    return {
      success: true,
      updated: true,
      proxy: summaryFromDetail(reloaded.data),
      changedFields,
    };
  }

  /** Delete one proxy by exact ID with optional expected-host/port guards. */
  async deleteProxy(
    args: Record<string, unknown>
  ): Promise<ProxyDeleteToolResult | ProxyToolError> {
    let input;
    try {
      input = proxyDeleteSchema.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return mapZodError(error);
      }
      throw error;
    }

    const module = this.getProxyModule();
    const controller = this.getProxyController();
    const current = await module.getProxyDetail(input.proxy_id);
    if (!current.status || !current.data || current.data.id === undefined) {
      return proxyToolError(
        "PROXY_NOT_FOUND",
        `Proxy #${input.proxy_id} was not found.`
      );
    }
    const cur = current.data;

    const mismatch = checkExpectedMatch(
      cur,
      input.expected_host,
      input.expected_port
    );
    if (mismatch) {
      return mismatch;
    }

    const summary = summaryFromDetail(cur);
    const ok = await controller.deleteProxyWithCheck(input.proxy_id);
    if (!ok) {
      return proxyToolError(
        "DELETE_FAILED",
        `Failed to delete proxy #${input.proxy_id}.`
      );
    }
    return { success: true, deleted: true, proxy: summary };
  }

  /**
   * Import multiple proxies from LLM-parsed structured input. Each row is
   * validated individually so invalid rows are reported (AC-6) rather than
   * rejecting the whole call. Duplicates are detected via a single batch
   * query and skipped or, when duplicatePolicy is "fail", reject the call.
   */
  async importProxies(
    args: Record<string, unknown>
  ): Promise<ProxyImportToolResult | ProxyToolError> {
    let wrapped;
    try {
      wrapped = proxyImportWrapperSchema.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return mapZodError(error);
      }
      throw error;
    }
    const duplicatePolicy = wrapped.duplicatePolicy;

    interface ValidRow {
      host: string;
      port: string;
      protocol: ProxyProtocol;
      user?: string;
      pass?: string;
      country_code?: string;
    }
    const valid: ValidRow[] = [];
    const invalidRows: ProxyImportInvalidRow[] = [];
    wrapped.proxies.forEach((row, index) => {
      const parsed = proxyCreateSchema.safeParse(row);
      if (parsed.success) {
        valid.push(parsed.data as ValidRow);
      } else {
        invalidRows.push({
          index,
          error: parsed.error.issues.map((issue) => issue.message).join("; "),
        });
      }
    });

    // Deduplicate within the batch (first occurrence wins).
    const seen = new Set<string>();
    const unique: ValidRow[] = [];
    let intraSkipped = 0;
    for (const row of valid) {
      const key = `${row.host}:${row.port}`;
      if (seen.has(key)) {
        intraSkipped += 1;
        continue;
      }
      seen.add(key);
      unique.push(row);
    }

    const module = this.getProxyModule();
    const pairs = unique.map((row) => ({ host: row.host, port: row.port }));
    const existing = await module.getProxiesByHostPortPairs(pairs);
    const existingKeys = new Set(
      existing.map((entity) => `${entity.host}:${entity.port}`)
    );
    const dbDuplicates = unique.filter((row) =>
      existingKeys.has(`${row.host}:${row.port}`)
    );

    if (duplicatePolicy === "fail" && dbDuplicates.length > 0) {
      return proxyToolError(
        "IMPORT_FAILED",
        `${dbDuplicates.length} proxy/proxies already exist (duplicatePolicy=fail).`
      );
    }

    const toImport = unique.filter(
      (row) => !existingKeys.has(`${row.host}:${row.port}`)
    );
    const skippedDuplicateCount = dbDuplicates.length + intraSkipped;

    let importedCount = 0;
    let proxies: SafeProxySummary[] = [];
    if (toImport.length > 0) {
      const items: ProxyParseItem[] = toImport.map((row) => ({
        host: row.host,
        port: row.port,
        protocol: row.protocol,
        user: row.user,
        pass: row.pass,
      }));
      const result = await module.importProxy(items);
      if (!result.status) {
        return proxyToolError(
          "IMPORT_FAILED",
          result.msg || "Failed to import proxies."
        );
      }
      const reloaded = await module.getProxiesByHostPortPairs(
        toImport.map((row) => ({ host: row.host, port: row.port }))
      );
      importedCount = reloaded.length;
      proxies = reloaded
        .map((entity) =>
          entity.id === undefined ? null : summaryFromDetail(entity)
        )
        .filter((summary): summary is SafeProxySummary => summary !== null);
    }

    return {
      success: true,
      importedCount,
      skippedDuplicateCount,
      invalidCount: invalidRows.length,
      ...(invalidRows.length > 0 ? { invalidRows } : {}),
      proxies,
      credentialsRedacted: true,
    };
  }

  /**
   * Validate stored proxies and update check status. MVP runs synchronously
   * with a small-batch limit per mode (basic <= 20, google/both <= 5); larger
   * scopes return UNSUPPORTED_OPERATION until async job wiring is added.
   * Progress is emitted via the skill execution context when available.
   */
  async checkProxies(
    args: Record<string, unknown>,
    context?: SkillExecutionContext
  ): Promise<ProxyCheckToolResult | ProxyToolError> {
    let input;
    try {
      input = proxyCheckSchema.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return mapZodError(error);
      }
      throw error;
    }

    const module = this.getProxyModule();
    const controller = this.getProxyController();
    const emit = context?.emitProgress;
    const limit = input.mode === "basic" ? 20 : 5;

    let targetIds: number[] | undefined;
    let useCheckAll = false;
    let expectedCount: number;

    if (input.proxy_ids) {
      targetIds = [...input.proxy_ids];
      expectedCount = targetIds.length;
    } else if (input.check_all) {
      useCheckAll = true;
      const count = await module.getProxycount();
      expectedCount = count;
      if (count > limit) {
        return proxyToolError(
          "UNSUPPORTED_OPERATION",
          `Sync check supports up to ${limit} proxies for mode "${input.mode}"; ${count} are stored. Narrow the scope with proxy_ids or filters.`
        );
      }
    } else if (input.filters) {
      const scanned = await this.boundedScan(controller, input.filters.search);
      if (scanned.truncated) {
        return proxyToolError(
          "UNSUPPORTED_OPERATION",
          "Proxy scan was truncated by a read error; cannot reliably determine check targets. Retry, or narrow with proxy_ids / check_all."
        );
      }
      targetIds = filterRecordsByCheckStatus(
        scanned.records,
        input.filters.status,
        input.filters.googlePass
      );
      expectedCount = targetIds.length;
    } else {
      return proxyToolError(
        "INVALID_INPUT",
        "No check target selector provided."
      );
    }

    if (targetIds !== undefined && targetIds.length > limit) {
      return proxyToolError(
        "UNSUPPORTED_OPERATION",
        `Sync check supports up to ${limit} proxies for mode "${input.mode}"; ${targetIds.length} were selected. Split the request.`
      );
    }

    emit?.({
      phase: "running",
      message: `Checking ${expectedCount} proxy/proxies`,
      progress: 0,
      partialCount: 0,
      expectedCount,
    });

    const batch = await controller.checkProxyBatch({
      ...(targetIds !== undefined
        ? { proxyIds: targetIds }
        : { checkAll: true }),
      ...(useCheckAll ? { checkAll: true } : {}),
      mode: input.mode,
      timeoutMs: input.timeout_ms,
      concurrency: input.concurrency,
      onProgress: (p) =>
        emit?.({
          phase: "running",
          message: `Checked ${p.checked} of ${p.total}`,
          progress:
            p.total > 0 ? Math.round((p.checked / p.total) * 100) : null,
          partialCount: p.checked,
          expectedCount: p.total,
        }),
    });

    emit?.({
      phase: "finalizing",
      message: `Finalizing ${batch.results.length} results`,
      progress: 100,
      partialCount: batch.results.length,
      expectedCount,
    });

    // Load redacted summaries for each checked proxy.
    const detailMap = new Map<number, SafeProxySummary | null>();
    for (const item of batch.results) {
      if (!detailMap.has(item.proxyId)) {
        const detail = await module.getProxyDetail(item.proxyId);
        if (detail.status && detail.data && detail.data.id !== undefined) {
          detailMap.set(item.proxyId, summaryFromDetail(detail.data));
        } else {
          detailMap.set(item.proxyId, null);
        }
      }
    }

    let basicPassCount = 0;
    let basicFailCount = 0;
    let googlePassCount = 0;
    let googleFailCount = 0;
    const results: ProxyCheckItemResult[] = [];
    for (const item of batch.results) {
      const proxy = detailMap.get(item.proxyId);
      if (proxy) {
        results.push({
          proxy,
          ...(item.basic !== undefined ? { basic: item.basic } : {}),
          ...(item.googlePass !== undefined
            ? { googlePass: item.googlePass }
            : {}),
          ...(item.error !== undefined ? { error: item.error } : {}),
        });
      }
      if (item.basic === "pass") {
        basicPassCount += 1;
      } else if (item.basic === "failure") {
        basicFailCount += 1;
      }
      if (item.googlePass === "pass") {
        googlePassCount += 1;
      } else if (item.googlePass === "fail") {
        googleFailCount += 1;
      }
    }

    return {
      success: true,
      checkedCount: results.length,
      basicPassCount,
      basicFailCount,
      googlePassCount,
      googleFailCount,
      results,
    };
  }

  /**
   * Delete proxies whose latest check failed. Defaults to a dry run so the
   * assistant can show candidates before the user authorizes deletion. Respects
   * max_delete as a hard cap. Requires exact proxy IDs (resolved from check
   * records) — no fuzzy deletion.
   */
  async removeFailedProxies(
    args: Record<string, unknown>
  ): Promise<ProxyRemoveFailedToolResult | ProxyToolError> {
    let input;
    try {
      input = proxyRemoveFailedSchema.parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return mapZodError(error);
      }
      throw error;
    }

    const module = this.getProxyModule();
    const controller = this.getProxyController();
    const candidateIds = await controller.getFailedProxyCandidateIds(
      input.failureType
    );
    const limitedIds = candidateIds.slice(0, input.max_delete);

    const candidates: SafeProxySummary[] = [];
    for (const id of limitedIds) {
      const detail = await module.getProxyDetail(id);
      if (detail.status && detail.data && detail.data.id !== undefined) {
        candidates.push(summaryFromDetail(detail.data));
      }
    }

    if (input.dry_run) {
      return {
        success: true,
        dryRun: true,
        candidateCount: candidateIds.length,
        deletedCount: 0,
        proxies: candidates,
      };
    }

    const deleted: SafeProxySummary[] = [];
    for (const summary of candidates) {
      const ok = await controller.deleteProxyWithCheck(summary.id);
      if (ok) {
        deleted.push(summary);
      }
    }
    return {
      success: true,
      dryRun: false,
      candidateCount: candidateIds.length,
      deletedCount: deleted.length,
      proxies: deleted,
    };
  }

  /**
   * Fetch up to BOUNDED_SCAN_LIMIT enriched records across pages. Used when
   * SQL-level status filtering is unavailable.
   */
  private async boundedScan(
    controller: ProxyController,
    search: string | undefined
  ): Promise<{ records: ProxyListEntity[]; truncated: boolean }> {
    const pageSize = 100;
    const collected: ProxyListEntity[] = [];
    let truncated = false;
    for (let page = 0; page * pageSize < BOUNDED_SCAN_LIMIT; page += 1) {
      // Controller returns bare {records,total} and throws on module error. A
      // throw mid-scan means the collected set is incomplete — stop fetching,
      // but signal `truncated` so callers never silently act on partial data.
      let resp: { records: ProxyListEntity[]; total: number };
      try {
        resp = await controller.getProxylist(page + 1, pageSize, search ?? "");
      } catch {
        truncated = true;
        break;
      }
      if (resp.records.length === 0) {
        break;
      }
      collected.push(...resp.records);
      if (collected.length >= resp.total) {
        break;
      }
      if (resp.records.length < pageSize) {
        break;
      }
    }
    return { records: collected.slice(0, BOUNDED_SCAN_LIMIT), truncated };
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
  args: Record<string, unknown>
): Promise<ProxyListToolResult | ProxyToolError> {
  return getDefaultTools().listProxies(args);
}

export async function getProxyForAi(
  args: Record<string, unknown>
): Promise<ProxyGetToolResult | ProxyToolError> {
  return getDefaultTools().getProxy(args);
}

export async function createProxyForAi(
  args: Record<string, unknown>
): Promise<ProxyCreateToolResult | ProxyToolError> {
  return getDefaultTools().createProxy(args);
}

export async function updateProxyForAi(
  args: Record<string, unknown>
): Promise<ProxyUpdateToolResult | ProxyToolError> {
  return getDefaultTools().updateProxy(args);
}

export async function deleteProxyForAi(
  args: Record<string, unknown>
): Promise<ProxyDeleteToolResult | ProxyToolError> {
  return getDefaultTools().deleteProxy(args);
}

export async function importProxiesForAi(
  args: Record<string, unknown>
): Promise<ProxyImportToolResult | ProxyToolError> {
  return getDefaultTools().importProxies(args);
}

export async function checkProxiesForAi(
  args: Record<string, unknown>,
  context?: SkillExecutionContext
): Promise<ProxyCheckToolResult | ProxyToolError> {
  return getDefaultTools().checkProxies(args, context);
}

export async function removeFailedProxiesForAi(
  args: Record<string, unknown>
): Promise<ProxyRemoveFailedToolResult | ProxyToolError> {
  return getDefaultTools().removeFailedProxies(args);
}
