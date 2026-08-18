/**
 * WebsiteKnowledgeImportService — turns validated website import options into
 * app-owned staged markdown files ready for the RAG upload pipeline.
 *
 * It owns the ingestion that happens BEFORE RAG upload:
 *   - validate + normalize URLs (UrlGuard SSRF defense, shared with the worker)
 *   - coordinate single_page / url_list / site_crawl modes
 *   - call WebsiteContentScrapeService (the shared scrape facade)
 *   - stage one .md file per page under app-owned storage with source metadata
 *
 * It does NOT create RAG documents, chunks, embeddings, or vectors, and it does
 * NOT touch TypeORM repositories. Each staged file is handed to
 * `RagSearchModule.uploadDocument()`, which is the only RAG ingestion path.
 *
 * See:
 *   docs/prd/knowledge-library-website-import-ai-tool-prd.md
 *   docs/prd/knowledge-library-website-import-ai-tool-technical-design.md
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { UrlGuard } from "@/service/UrlGuard";
import {
  WebsiteContentScrapeService,
  type WebsitePageScrapeResult,
} from "@/service/WebsiteContentScrapeService";

// ---------------------------------------------------------------------------
// Limits & constants
// ---------------------------------------------------------------------------

/** Staging lives under app userData (configurable for tests). */
const STAGING_DIR_NAME = "website-imports";

/** Minimum normalized markdown length for a page to be worth importing. */
const MIN_USEFUL_MARKDOWN_LENGTH = 200;

/** Hard cap on staged markdown size per page. */
const MAX_MARKDOWN_BYTES_PER_PAGE = 10 * 1024 * 1024; // 10 MB

/** Staged files older than this are removed opportunistically. */
const STAGING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Default author recorded for imported webpage documents. */
export const WEBSITE_DEFAULT_AUTHOR = "Website";

/** Max length of the generated base filename (before extension). */
const MAX_FILENAME_BASE_LENGTH = 160;

// ---------------------------------------------------------------------------
// Public interfaces (consumed by KnowledgeLibraryAiTools.importWebsite)
// ---------------------------------------------------------------------------

export type WebsiteImportMode = "single_page" | "url_list" | "site_crawl";

export interface WebsiteImportPrepareOptions {
  readonly mode: WebsiteImportMode;
  readonly url?: string;
  readonly urls?: readonly string[];
  readonly maxPages: number;
  readonly maxDepth: number;
}

/** Reason codes the service can emit for a skipped page. */
export type WebsiteImportSkipCode =
  | "URL_BLOCKED"
  | "SCRAPE_FAILED"
  | "EMPTY_CONTENT"
  | "FILE_TOO_LARGE";

/** One webpage successfully scraped and staged, ready for RAG upload. */
export interface WebsiteImportSource {
  readonly sourceUrl: string;
  readonly finalUrl?: string;
  readonly canonicalUrl?: string;
  readonly title?: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  /** SHA-256 of the normalized markdown body (stable duplicate key). */
  readonly contentSha256: string;
  readonly importGroupId: string;
  readonly sourceRootUrl?: string;
  readonly crawledAt: Date;
}

/** One webpage that could not be scraped/staged. */
export interface WebsiteImportSkippedSource {
  readonly url: string;
  readonly reason: string;
  readonly code: WebsiteImportSkipCode;
}

export interface WebsiteImportPrepareResult {
  readonly mode: WebsiteImportMode;
  readonly sources: readonly WebsiteImportSource[];
  readonly skipped: readonly WebsiteImportSkippedSource[];
  readonly requestedCount: number;
  /** Present for site_crawl — unique same-origin links discovered. */
  readonly discoveredCount?: number;
}

export interface WebsiteImportPageStartEvent {
  readonly url: string;
  readonly depth?: number;
  readonly processedPages: number;
  readonly maxPages: number;
  readonly discoveredCount?: number;
}

export interface WebsiteImportPagePreparedEvent {
  readonly url: string;
  readonly depth?: number;
  readonly processedPages: number;
  readonly maxPages: number;
  readonly discoveredCount?: number;
  readonly source?: WebsiteImportSource;
  readonly skipped?: WebsiteImportSkippedSource;
}

export interface WebsiteImportPrepareCallbacks {
  readonly onPageStart?: (
    event: WebsiteImportPageStartEvent
  ) => void | Promise<void>;
  readonly onPagePrepared?: (
    event: WebsiteImportPagePreparedEvent
  ) => void | Promise<void>;
}

/** Outcome of staging a single page. */
interface StageOutcome {
  readonly source?: WebsiteImportSource;
  readonly skipped?: WebsiteImportSkippedSource;
  /** Raw anchor hrefs from the rendered page (for crawl discovery). */
  readonly links: readonly string[];
}

/** Constructor-injectable dependencies (test seams). */
export interface WebsiteKnowledgeImportServiceDeps {
  /** Override the scrape facade to avoid forking a real browser in tests. */
  readonly scrapeService?: WebsiteContentScrapeService;
  /** Override the staging root (tests use a temp dir). */
  readonly stagingRoot?: string;
}

interface NormalizedUrl {
  readonly normalized: string;
  readonly origin: string;
  readonly host: string;
  readonly pathname: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WebsiteKnowledgeImportService {
  constructor(private readonly deps: WebsiteKnowledgeImportServiceDeps = {}) {}

  /**
   * Validate URLs, scrape pages through the worker, and stage one markdown file
   * per page. Returns staged sources (for RAG upload) and per-page skips. Never
   * throws for a single bad page — failures become skipped entries so multi-page
   * imports can partially succeed.
   */
  async prepareImportSources(
    options: WebsiteImportPrepareOptions,
    callbacks: WebsiteImportPrepareCallbacks = {}
  ): Promise<WebsiteImportPrepareResult> {
    const importGroupId = `web-${Date.now()}-${crypto.randomUUID()}`;
    this.cleanupExpiredStaging();

    if (options.mode === "url_list") {
      return await this.prepareUrlList(options, importGroupId, callbacks);
    }
    if (options.mode === "site_crawl") {
      return await this.prepareSiteCrawl(options, importGroupId, callbacks);
    }
    return await this.prepareSinglePage(options, importGroupId, callbacks);
  }

  // -------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------

  private async prepareSinglePage(
    options: WebsiteImportPrepareOptions,
    importGroupId: string,
    callbacks: WebsiteImportPrepareCallbacks
  ): Promise<WebsiteImportPrepareResult> {
    const runDir = this.createRunDir(importGroupId);
    await callbacks.onPageStart?.({
      url: options.url!,
      processedPages: 0,
      maxPages: 1,
    });
    const outcome = await this.scrapeAndStage(
      options.url!,
      runDir,
      importGroupId
    );
    await callbacks.onPagePrepared?.({
      url: options.url!,
      processedPages: 1,
      maxPages: 1,
      source: outcome.source,
      skipped: outcome.skipped,
    });

    return {
      mode: "single_page",
      sources: outcome.source ? [outcome.source] : [],
      skipped: outcome.skipped ? [outcome.skipped] : [],
      requestedCount: 1,
    };
  }

  private async prepareUrlList(
    options: WebsiteImportPrepareOptions,
    importGroupId: string,
    callbacks: WebsiteImportPrepareCallbacks
  ): Promise<WebsiteImportPrepareResult> {
    const runDir = this.createRunDir(importGroupId);
    const deduped = dedupeUrlsStable(options.urls ?? []);

    // Honor maxPages even if more URLs were provided (stable input order).
    const targeted = deduped.slice(0, Math.max(0, options.maxPages));

    const sources: WebsiteImportSource[] = [];
    const skipped: WebsiteImportSkippedSource[] = [];
    let processedPages = 0;
    for (const rawUrl of targeted) {
      await callbacks.onPageStart?.({
        url: rawUrl,
        processedPages,
        maxPages: targeted.length,
      });
      const outcome = await this.scrapeAndStage(rawUrl, runDir, importGroupId);
      processedPages++;
      if (outcome.source) sources.push(outcome.source);
      if (outcome.skipped) skipped.push(outcome.skipped);
      await callbacks.onPagePrepared?.({
        url: rawUrl,
        processedPages,
        maxPages: targeted.length,
        source: outcome.source,
        skipped: outcome.skipped,
      });
    }

    return {
      mode: "url_list",
      sources,
      skipped,
      requestedCount: targeted.length,
    };
  }

  private async prepareSiteCrawl(
    options: WebsiteImportPrepareOptions,
    importGroupId: string,
    callbacks: WebsiteImportPrepareCallbacks
  ): Promise<WebsiteImportPrepareResult> {
    const seedRaw = options.url!;
    const seedCheck = await UrlGuard.validateWithDns(seedRaw);
    if (!seedCheck.safe) {
      await callbacks.onPagePrepared?.({
        url: seedRaw,
        processedPages: 0,
        maxPages: options.maxPages,
        discoveredCount: 0,
        skipped: {
          url: seedRaw,
          reason: seedCheck.error ?? "Seed URL rejected by SSRF guard",
          code: "URL_BLOCKED",
        },
      });
      return {
        mode: "site_crawl",
        sources: [],
        skipped: [
          {
            url: seedRaw,
            reason: seedCheck.error ?? "Seed URL rejected by SSRF guard",
            code: "URL_BLOCKED",
          },
        ],
        requestedCount: 1,
        discoveredCount: 0,
      };
    }

    const seed = normalizeUrl(seedCheck.normalizedUrl!);
    if (!seed) {
      await callbacks.onPagePrepared?.({
        url: seedRaw,
        processedPages: 0,
        maxPages: options.maxPages,
        discoveredCount: 0,
        skipped: {
          url: seedRaw,
          reason: "Invalid seed URL",
          code: "URL_BLOCKED",
        },
      });
      return {
        mode: "site_crawl",
        sources: [],
        skipped: [
          { url: seedRaw, reason: "Invalid seed URL", code: "URL_BLOCKED" },
        ],
        requestedCount: 1,
        discoveredCount: 0,
      };
    }

    const origin = seed.origin;
    const runDir = this.createRunDir(importGroupId);

    interface QueueItem {
      readonly url: string;
      readonly depth: number;
    }
    const queue: QueueItem[] = [{ url: seed.normalized, depth: 0 }];
    const seen = new Set<string>([seed.normalized]);
    let discoveredCount = 0;
    let processedPages = 0;

    const sources: WebsiteImportSource[] = [];
    const skipped: WebsiteImportSkippedSource[] = [];

    while (queue.length > 0 && processedPages < options.maxPages) {
      const item = queue.shift()!;
      await callbacks.onPageStart?.({
        url: item.url,
        depth: item.depth,
        processedPages,
        maxPages: options.maxPages,
        discoveredCount,
      });
      const outcome = await this.scrapeAndStage(
        item.url,
        runDir,
        importGroupId,
        origin
      );
      if (outcome.source) sources.push(outcome.source);
      if (outcome.skipped) skipped.push(outcome.skipped);
      processedPages++;

      await callbacks.onPagePrepared?.({
        url: item.url,
        depth: item.depth,
        processedPages,
        maxPages: options.maxPages,
        discoveredCount,
        source: outcome.source,
        skipped: outcome.skipped,
      });

      if (item.depth >= options.maxDepth) continue;

      for (const rawLink of outcome.links) {
        const linkNorm = normalizeUrl(rawLink);
        if (!linkNorm) continue;
        if (linkNorm.origin !== origin) continue; // same-origin only (MVP)
        if (seen.has(linkNorm.normalized)) continue;
        // Cheap structural guard before queueing; DNS check happens at scrape.
        if (!UrlGuard.validate(linkNorm.normalized).safe) continue;
        seen.add(linkNorm.normalized);
        discoveredCount++;
        queue.push({ url: linkNorm.normalized, depth: item.depth + 1 });
      }
    }

    return {
      mode: "site_crawl",
      sources,
      skipped,
      requestedCount: 1,
      discoveredCount,
    };
  }

  // -------------------------------------------------------------------------
  // Per-page scrape + stage
  // -------------------------------------------------------------------------

  private async scrapeAndStage(
    rawUrl: string,
    runDir: string,
    importGroupId: string,
    sourceRootUrl?: string
  ): Promise<StageOutcome> {
    // DNS-aware SSRF validation before spawning the worker.
    const urlCheck = await UrlGuard.validateWithDns(rawUrl);
    if (!urlCheck.safe) {
      console.warn(
        `[WebsiteImport] scrape skip URL_BLOCKED url=${rawUrl} reason=${
          urlCheck.error ?? "URL rejected by SSRF guard"
        }`
      );
      return {
        skipped: {
          url: rawUrl,
          reason: urlCheck.error ?? "URL rejected by SSRF guard",
          code: "URL_BLOCKED",
        },
        links: [],
      };
    }
    const safeUrl = urlCheck.normalizedUrl!;

    let scrape: WebsitePageScrapeResult;
    try {
      scrape = await this.getScrapeService().scrapePage(safeUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[WebsiteImport] scrape skip SCRAPE_FAILED url=${safeUrl} reason=${reason}`
      );
      return {
        skipped: { url: safeUrl, reason, code: "SCRAPE_FAILED" },
        links: [],
      };
    }

    const body = scrape.markdown ?? "";
    if (!isUsefulMarkdown(body)) {
      console.warn(
        `[WebsiteImport] scrape skip EMPTY_CONTENT url=${safeUrl} ` +
          `markdownLength=${body.length}`
      );
      return {
        skipped: {
          url: safeUrl,
          reason: "No readable content was extracted from the page.",
          code: "EMPTY_CONTENT",
        },
        links: scrape.links,
      };
    }

    const staged = buildStagedMarkdown({
      title: scrape.title,
      sourceUrl: safeUrl,
      finalUrl: scrape.finalUrl,
      body,
      crawledAt: new Date(),
    });
    if (Buffer.byteLength(staged, "utf8") > MAX_MARKDOWN_BYTES_PER_PAGE) {
      return {
        skipped: {
          url: safeUrl,
          reason: `Page content exceeds the ${MAX_MARKDOWN_BYTES_PER_PAGE} byte limit.`,
          code: "FILE_TOO_LARGE",
        },
        links: scrape.links,
      };
    }

    const contentSha256 = sha256NormalizedBody(body);
    const fileName = buildFileNameFromUrl(scrape.finalUrl ?? safeUrl, safeUrl);
    const filePath = path.join(runDir, fileName);
    try {
      fs.writeFileSync(filePath, staged, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        skipped: { url: safeUrl, reason, code: "SCRAPE_FAILED" },
        links: scrape.links,
      };
    }

    const rootUrl = sourceRootUrl ?? safeOriginOf(safeUrl);
    const canonicalUrl = sanitizeCanonicalUrl(scrape.canonicalUrl);

    const stats = fs.statSync(filePath);
    console.log(
      `[WebsiteImport] scrape staged url=${safeUrl} ` +
        `finalUrl=${scrape.finalUrl ?? "(same)"} ` +
        `canonical=${canonicalUrl ?? "(none)"} ` +
        `file=${fileName} sizeBytes=${stats.size} ` +
        `markdownLength=${body.length} links=${scrape.links.length}`
    );
    return {
      source: {
        sourceUrl: safeUrl,
        finalUrl: scrape.finalUrl,
        canonicalUrl,
        title: scrape.title,
        fileName,
        filePath,
        sizeBytes: stats.size,
        contentSha256,
        importGroupId,
        sourceRootUrl: rootUrl,
        crawledAt: new Date(),
      },
      links: scrape.links,
    };
  }

  // -------------------------------------------------------------------------
  // Staging directory management
  // -------------------------------------------------------------------------

  private getScrapeService(): WebsiteContentScrapeService {
    return this.deps.scrapeService ?? new WebsiteContentScrapeService();
  }

  private getStagingRoot(): string {
    return (
      this.deps.stagingRoot ??
      path.join(app.getPath("userData"), STAGING_DIR_NAME)
    );
  }

  private createRunDir(importGroupId: string): string {
    const runDir = path.join(
      this.getStagingRoot(),
      sanitizeDirName(importGroupId)
    );
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true });
    }
    return runDir;
  }

  /**
   * Best-effort cleanup of staging run directories older than the TTL. Never
   * throws and only ever deletes inside the website-imports staging root.
   */
  private cleanupExpiredStaging(): void {
    const root = this.getStagingRoot();
    let entries: string[];
    try {
      entries = fs.readdirSync(root);
    } catch {
      return;
    }
    const cutoff = Date.now() - STAGING_TTL_MS;
    for (const entry of entries) {
      const entryPath = path.join(root, entry);
      try {
        const stats = fs.statSync(entryPath);
        if (stats.isDirectory() && stats.mtimeMs < cutoff) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore individual cleanup failures — staging cleanup is best-effort.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (module-private, easily unit-testable)
// ---------------------------------------------------------------------------

/** Parse + normalize an absolute http(s) URL with hash stripped. */
function normalizeUrl(raw: string): NormalizedUrl | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  parsed.hash = "";
  return {
    normalized: parsed.toString(),
    origin: parsed.origin,
    host: parsed.hostname,
    pathname: parsed.pathname,
  };
}

/** De-duplicate URLs in stable input order using the normalized form. */
function dedupeUrlsStable(rawUrls: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawUrls) {
    const norm = normalizeUrl(raw);
    if (!norm) continue;
    if (seen.has(norm.normalized)) continue;
    seen.add(norm.normalized);
    result.push(norm.normalized);
  }
  return result;
}

/** Whitespace-normalized length check for "useful" markdown. */
function isUsefulMarkdown(markdown: string): boolean {
  const normalized = markdown.replace(/\s+/g, " ").trim();
  return normalized.length >= MIN_USEFUL_MARKDOWN_LENGTH;
}

/** SHA-256 of the whitespace-normalized markdown body (stable duplicate key). */
function sha256NormalizedBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Extract the origin (scheme://host[:port]) of a URL, or undefined. */
function safeOriginOf(url: string): string | undefined {
  return normalizeUrl(url)?.origin;
}

/** Keep a canonical URL only if it is a safe absolute http(s) URL. */
function sanitizeCanonicalUrl(
  canonicalUrl: string | undefined
): string | undefined {
  if (!canonicalUrl) return undefined;
  const verdict = UrlGuard.validate(canonicalUrl);
  if (!verdict.safe) return undefined;
  return verdict.normalizedUrl;
}

/** Build the staged markdown document with lightweight source front matter. */
function buildStagedMarkdown(args: {
  title?: string;
  sourceUrl: string;
  finalUrl?: string;
  body: string;
  crawledAt: Date;
}): string {
  const heading = args.title?.trim() || args.sourceUrl;
  const lines: string[] = [`# ${heading}`, "", `Source URL: ${args.sourceUrl}`];
  if (args.finalUrl && args.finalUrl !== args.sourceUrl) {
    lines.push(`Final URL: ${args.finalUrl}`);
  }
  lines.push(`Imported At: ${args.crawledAt.toISOString()}`);
  lines.push("", args.body.trimEnd(), "");
  return lines.join("\n");
}

/**
 * Deterministic readable filename: {host}-{pathSlug}-{urlHash8}.md
 *
 * `readableUrl` supplies the host/path segments (prefers the post-redirect
 * final URL so the name reflects where content actually came from). `hashUrl`
 * is the deduped SOURCE URL — hashed for the uniqueness suffix. Hashing the
 * source URL (not the final URL) guarantees uniqueness within one import run:
 * url_list dedupes by source URL, and site_crawl's seen-set never re-scrapes
 * one. Two distinct source URLs that both redirect to the same final URL must
 * not collide, or the second staged file would overwrite the first before the
 * tool layer uploads it.
 */
function buildFileNameFromUrl(readableUrl: string, hashUrl?: string): string {
  const norm = normalizeUrl(readableUrl);
  const host = sanitizeFsSegment(norm?.host ?? "site");
  const rawPath = norm?.pathname ?? "";
  const pathSlug =
    sanitizeFsSegment(rawPath.replace(/\.html?$/i, "").replace(/\/+/g, "-")) ||
    "index";
  const urlHash = sha256Hex(hashUrl ?? readableUrl).slice(0, 8);
  const base = `${host}-${pathSlug}-${urlHash}`.slice(
    0,
    MAX_FILENAME_BASE_LENGTH
  );
  return `${base}.md`;
}

/** Collapse to filesystem-safe [a-zA-Z0-9._-] and trim separators. */
function sanitizeFsSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80);
}

/** Sanitize a run-directory name (importGroupId is already URL-safe). */
function sanitizeDirName(value: string): string {
  return sanitizeFsSegment(value) || `run-${sha256Hex(value).slice(0, 8)}`;
}
