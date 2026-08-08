/**
 * Local AI Runtime — catalog fetch + cache (design §11).
 *
 * Fetches the runtime catalog over HTTPS from a trusted origin with host,
 * timeout, redirect, and size policy. Responses are parsed as `unknown` and
 * validated with Zod. A valid cache is served until its TTL expires; an
 * invalid response never replaces a valid cache.
 */
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeCatalog,
  type RuntimeCatalogSourceConfig,
} from "@/entityTypes/localAiRuntimeTypes";
import { localAiRuntimeCatalogSchema } from "@/schemas/localAiRuntime";
import type { LocalAiRuntimeStateStore, CatalogCacheMeta } from "./LocalAiRuntimeStateStore";
import {
  RUNTIME_CATALOG_MAX_BYTES,
  RUNTIME_CATALOG_TIMEOUT_MS,
  RUNTIME_CATALOG_CACHE_TTL_MS,
} from "./localAiRuntimeConstants";

export interface CatalogServiceOptions {
  enforceHttps?: boolean;
  timeoutMs?: number;
  /** Test hook to override fetch. */
  fetchImpl?: typeof fetch;
}

export class LocalAiRuntimeCatalogService {
  constructor(
    private readonly source: RuntimeCatalogSourceConfig,
    private readonly state: LocalAiRuntimeStateStore,
    private readonly options: CatalogServiceOptions = {},
  ) {}

  async getCatalog(forceRefresh = false): Promise<LocalAiRuntimeCatalog> {
    const now = Date.now();
    if (!forceRefresh) {
      const cached = await this.state.readCatalogCache();
      const meta = await this.state.readCatalogCacheMeta();
      if (cached && meta && now - Date.parse(meta.fetchedAt) < (this.source.cacheTtlMs || RUNTIME_CATALOG_CACHE_TTL_MS)) {
        return cached;
      }
    }

    const meta = await this.state.readCatalogCacheMeta();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (meta?.etag) headers["If-None-Match"] = meta.etag;
    if (meta?.lastModified) headers["If-Modified-Since"] = meta.lastModified;

    const enforceHttps = this.options.enforceHttps ?? true;
    this.validateSourceUrl(enforceHttps);

    const timeoutMs = this.options.timeoutMs ?? RUNTIME_CATALOG_TIMEOUT_MS;
    const fetchImpl = this.options.fetchImpl ?? fetch;

    let res: Response;
    try {
      res = await fetchImpl(this.source.catalogUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
    } catch (error) {
      throw new LocalAiRuntimeError(
        "runtime_catalog_unavailable",
        `Catalog fetch failed: ${(error as Error).message}`,
      );
    }

    if (res.status === 304) {
      const cached = await this.state.readCatalogCache();
      if (cached) {
        await this.state.writeCatalogCacheMeta({ ...meta, fetchedAt: new Date(now).toISOString() } as CatalogCacheMeta);
        return cached;
      }
      // No cache to fall back on; treat as unavailable.
      throw new LocalAiRuntimeError("runtime_catalog_unavailable", "Catalog returned 304 with no cached entry.");
    }

    if (!res.ok) {
      throw new LocalAiRuntimeError(
        "runtime_catalog_unavailable",
        `Catalog fetch failed with HTTP ${res.status}.`,
      );
    }

    const text = await this.readBoundedText(res);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LocalAiRuntimeError("runtime_catalog_invalid", "Catalog response is not valid JSON.");
    }

    const result = localAiRuntimeCatalogSchema.safeParse(parsed);
    if (!result.success) {
      // Never replace a valid cache with an invalid response.
      throw new LocalAiRuntimeError(
        "runtime_catalog_invalid",
        "Catalog response failed schema validation.",
      );
    }

    const newMeta: CatalogCacheMeta = {
      fetchedAt: new Date(now).toISOString(),
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
    };
    await this.state.writeCatalogCache(result.data);
    await this.state.writeCatalogCacheMeta(newMeta);
    return result.data;
  }

  private async readBoundedText(res: Response): Promise<string> {
    const lenHeader = res.headers.get("content-length");
    if (lenHeader !== null) {
      const declared = Number(lenHeader);
      if (Number.isFinite(declared) && declared > RUNTIME_CATALOG_MAX_BYTES) {
        throw new LocalAiRuntimeError("runtime_catalog_invalid", "Catalog response exceeds size limit.");
      }
    }
    const reader = res.body?.getReader();
    if (!reader) {
      // Body already consumed by .text() path fallback.
      return res.text();
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > RUNTIME_CATALOG_MAX_BYTES) {
        throw new LocalAiRuntimeError("runtime_catalog_invalid", "Catalog response exceeds size limit.");
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return new TextDecoder().decode(merged);
  }

  private validateSourceUrl(enforceHttps: boolean): void {
    let parsed: URL;
    try {
      parsed = new URL(this.source.catalogUrl);
    } catch {
      throw new LocalAiRuntimeError("runtime_catalog_invalid", "Invalid catalog URL.");
    }
    if (enforceHttps && parsed.protocol !== "https:") {
      throw new LocalAiRuntimeError("runtime_catalog_invalid", "Catalog URL must use HTTPS.");
    }
    if (parsed.username || parsed.password) {
      throw new LocalAiRuntimeError("runtime_catalog_invalid", "Catalog URL must not carry credentials.");
    }
    if (this.source.allowedHosts.length > 0 && !this.source.allowedHosts.includes(parsed.host)) {
      throw new LocalAiRuntimeError("runtime_catalog_invalid", `Catalog host not allowed: ${parsed.host}`);
    }
  }
}
