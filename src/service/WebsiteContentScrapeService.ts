/**
 * WebsiteContentScrapeService — shared facade for the websiteContentScraper
 * child process.
 *
 * This is the single home of the `utilityProcess.fork` + IPC handshake used to
 * load a webpage with Puppeteer and convert it to markdown. Two consumers share
 * it:
 *
 *   - `WebsiteAnalysisService.getPageContentAsMarkdown()` — chat-context
 *     reader; truncates the returned markdown for prompt limits.
 *   - `WebsiteKnowledgeImportService` — knowledge-library import; keeps the
 *     full bounded markdown plus title / final URL / canonical URL / links.
 *
 * Layering: this service performs NO database access and NO embedding work. It
 * only loads a page, converts it, and returns safe metadata. The caller decides
 * how much to keep and whether to persist it.
 *
 * Security: the URL is validated with `UrlGuard.validateWithDns` before the
 * worker is spawned, and the worker re-validates (see applySsrfNavigationGuard
 * + UrlGuard checks inside websiteContentScraper.ts). This is defense in depth.
 */

import { utilityProcess } from "electron";
import * as path from "path";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { UrlGuard } from "@/service/UrlGuard";
import {
  buildPackagedWorkerEnv,
  mirrorAppAsarUnpackedPath,
  resolvePackagedWorkerPath,
  type PackagedWorkerPathRuntime,
} from "@/utils/packagedWorkerPath";

/** Hard cap on a single page load before the worker is killed. */
const SCRAPING_TIMEOUT_MS = 600000; // 10 minutes

/** Bound child output captured for diagnostics so noisy pages cannot flood logs. */
const MAX_CHILD_OUTPUT_CHARS = 12000;

/** Full scrape result returned by the worker, normalized for callers. */
export interface WebsitePageScrapeResult {
  /** The URL the caller requested (post-UrlGuard normalization). */
  readonly sourceUrl: string;
  /** The URL the browser ended on after redirects. */
  readonly finalUrl: string;
  /** Canonical URL from <link rel="canonical"> if present and absolute. */
  readonly canonicalUrl?: string;
  /** Rendered page title. */
  readonly title?: string;
  /** Converted markdown (full, untruncated). */
  readonly markdown: string;
  /** Rendered anchor hrefs, for same-origin crawl discovery. */
  readonly links: readonly string[];
}

interface WorkerScrapeResponse {
  type: "SCRAPE_SUCCESS" | "SCRAPE_ERROR";
  requestId: string;
  markdown?: string;
  title?: string;
  finalUrl?: string;
  canonicalUrl?: string;
  links?: string[];
  error?: string;
  stack?: string;
}

interface WorkerScrapeMessage {
  type: "SCRAPE_WEBSITE";
  url: string;
  requestId: string;
}

const WEBSITE_CONTENT_SCRAPER_FILE = "websiteContentScraper.js";

const WEBSITE_CONTENT_SCRAPER_PATH_OPTIONS = {
  dirnameRelativePaths: [
    path.join("childprocess", WEBSITE_CONTENT_SCRAPER_FILE),
    path.join("..", "childprocess", WEBSITE_CONTENT_SCRAPER_FILE),
    path.join("..", "..", "dist", "childprocess", WEBSITE_CONTENT_SCRAPER_FILE),
  ],
  cwdRelativePaths: [
    path.join("dist", "childprocess", WEBSITE_CONTENT_SCRAPER_FILE),
    path.join(".vite", "build", "childprocess", WEBSITE_CONTENT_SCRAPER_FILE),
    path.join(".vite", "build", WEBSITE_CONTENT_SCRAPER_FILE),
  ],
} as const;

interface ChildOutputCapture {
  readonly getStdout: () => string;
  readonly getStderr: () => string;
  readonly appendStdout: (chunk: unknown) => void;
  readonly appendStderr: (chunk: unknown) => void;
}

function appendBoundedOutput(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  if (combined.length <= MAX_CHILD_OUTPUT_CHARS) {
    return combined;
  }
  return combined.slice(combined.length - MAX_CHILD_OUTPUT_CHARS);
}

function stringifyOutputChunk(chunk: unknown): string {
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }
  if (typeof chunk === "string") {
    return chunk;
  }
  return String(chunk);
}

function createChildOutputCapture(): ChildOutputCapture {
  let stdout = "";
  let stderr = "";

  return {
    getStdout: () => stdout,
    getStderr: () => stderr,
    appendStdout: (chunk: unknown): void => {
      stdout = appendBoundedOutput(stdout, stringifyOutputChunk(chunk));
    },
    appendStderr: (chunk: unknown): void => {
      stderr = appendBoundedOutput(stderr, stringifyOutputChunk(chunk));
    },
  };
}

function describeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function formatChildProcessDiagnostic(params: {
  requestId: string;
  childProcessPath: string;
  url: string;
  pid: number | null;
  reason: string;
  stdout: string;
  stderr: string;
}): string {
  const lines = [
    params.reason,
    `requestId=${params.requestId}`,
    `pid=${params.pid ?? "unknown"}`,
    `workerPath=${params.childProcessPath}`,
    `url=${describeUrlForLog(params.url)}`,
  ];

  const stderr = params.stderr.trim();
  if (stderr) {
    lines.push(`stderr:\n${stderr}`);
  }

  const stdout = params.stdout.trim();
  if (stdout) {
    lines.push(`stdout:\n${stdout}`);
  }

  return lines.join("\n");
}

function parseWorkerScrapeResponse(rawMessage: unknown): WorkerScrapeResponse {
  if (typeof rawMessage === "string") {
    return JSON.parse(rawMessage) as WorkerScrapeResponse;
  }

  if (
    rawMessage !== null &&
    typeof rawMessage === "object" &&
    "data" in rawMessage &&
    typeof (rawMessage as { data?: unknown }).data === "string"
  ) {
    return JSON.parse(
      (rawMessage as { data: string }).data
    ) as WorkerScrapeResponse;
  }

  return rawMessage as WorkerScrapeResponse;
}


export class WebsiteContentScrapeService {
  /**
   * Scrape a single URL through the worker and return the converted markdown
   * plus page metadata. The URL is validated with DNS before the worker spawns.
   *
   * @throws when the URL is empty, fails the SSRF guard, the worker errors, or
   *   no content is extracted.
   */
  async scrapePage(inputUrl: string): Promise<WebsitePageScrapeResult> {
    const trimmed = typeof inputUrl === "string" ? inputUrl.trim() : "";
    if (!trimmed) {
      throw new Error("url is required and must be a non-empty string");
    }

    const urlCheck = await UrlGuard.validateWithDns(trimmed);
    if (!urlCheck.safe) {
      throw new Error(`URL rejected by SSRF guard: ${urlCheck.error}`);
    }
    const safeUrl = urlCheck.normalizedUrl!;

    const workerResult = await this.forkScrapeWorker(safeUrl);
    return {
      sourceUrl: safeUrl,
      finalUrl: workerResult.finalUrl ?? safeUrl,
      canonicalUrl: workerResult.canonicalUrl,
      title: workerResult.title,
      markdown: workerResult.markdown,
      links: workerResult.links ?? [],
    };
  }

  /** Fork the worker, send the scrape request, and resolve the response. */
  private async forkScrapeWorker(url: string): Promise<{
    markdown: string;
    title?: string;
    finalUrl?: string;
    canonicalUrl?: string;
    links?: string[];
  }> {
    const childProcessPath = WebsiteContentScrapeService.getChildProcessPath();
    if (!childProcessPath) {
      throw new Error("Child process file not found");
    }

    return new Promise((resolve, reject) => {
      const childProcess = utilityProcess.fork(childProcessPath, [], {
        stdio: "pipe",
        execArgv: ["puppeteer-cluster:*"],
        env: buildPackagedWorkerEnv(),
      });

      const requestId = `scrape-${uuidv4()}-${Date.now()}`;
      const outputCapture = createChildOutputCapture();
      let settled = false;

      const rejectWithDiagnostic = (reason: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        childProcess.removeListener("message", messageHandler);
        const diagnostic = formatChildProcessDiagnostic({
          requestId,
          childProcessPath,
          url,
          pid: childProcess.pid,
          reason,
          stdout: outputCapture.getStdout(),
          stderr: outputCapture.getStderr(),
        });
        console.error(`[WebsiteContentScrapeService] ${diagnostic}`);
        reject(new Error(diagnostic));
      };

      const timeout = setTimeout(() => {
        childProcess.kill();
        rejectWithDiagnostic("Website scraping timeout");
      }, SCRAPING_TIMEOUT_MS);

      childProcess.stdout?.on("data", (data: unknown) => {
        outputCapture.appendStdout(data);
        const chunk = stringifyOutputChunk(data).trim();
        if (chunk) {
          console.log(
            `[WebsiteContentScrapeService:${requestId}:stdout] ${chunk}`
          );
        }
      });

      childProcess.stderr?.on("data", (data: unknown) => {
        outputCapture.appendStderr(data);
        const chunk = stringifyOutputChunk(data).trim();
        if (chunk) {
          console.error(
            `[WebsiteContentScrapeService:${requestId}:stderr] ${chunk}`
          );
        }
      });

      const messageHandler = (rawMessage: unknown) => {
        let message: WorkerScrapeResponse;
        try {
          message = parseWorkerScrapeResponse(rawMessage);
        } catch (parseError) {
          childProcess.kill();
          const parseMessage =
            parseError instanceof Error
              ? parseError.message
              : String(parseError);
          rejectWithDiagnostic(
            `Error parsing child process message: ${parseMessage}`
          );
          return;
        }

        if (message.requestId !== requestId) {
          return; // Ignore messages for other requests.
        }

        settled = true;
        clearTimeout(timeout);
        childProcess.removeListener("message", messageHandler);
        childProcess.kill();

        if (message.type === "SCRAPE_ERROR") {
          const diagnostic = formatChildProcessDiagnostic({
            requestId,
            childProcessPath,
            url,
            pid: childProcess.pid,
            reason: [message.error || "Failed to scrape website", message.stack]
              .filter((part): part is string => Boolean(part))
              .join("\n"),
            stdout: outputCapture.getStdout(),
            stderr: outputCapture.getStderr(),
          });
          console.error(`[WebsiteContentScrapeService] ${diagnostic}`);
          reject(new Error(diagnostic));
          return;
        }

        if (!message.markdown) {
          const diagnostic = formatChildProcessDiagnostic({
            requestId,
            childProcessPath,
            url,
            pid: childProcess.pid,
            reason: "No content extracted from website",
            stdout: outputCapture.getStdout(),
            stderr: outputCapture.getStderr(),
          });
          console.error(`[WebsiteContentScrapeService] ${diagnostic}`);
          reject(new Error(diagnostic));
          return;
        }

        console.log(
          `[WebsiteContentScrapeService] Scrape worker completed requestId=${requestId} pid=${
            childProcess.pid ?? "unknown"
          } url=${describeUrlForLog(url)}`
        );
        resolve({
          markdown: message.markdown,
          title: message.title,
          finalUrl: message.finalUrl,
          canonicalUrl: message.canonicalUrl,
          links: message.links,
        });
      };

      childProcess.on("message", messageHandler);

      childProcess.on("error", (error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        rejectWithDiagnostic(`Child process error: ${errorMessage}`);
      });

      childProcess.on("exit", (code, signal) => {
        if (settled) {
          return;
        }
        if (code !== 0 || signal) {
          const codeDetail = code === null ? "unknown" : String(code);
          const signalDetail = signal ? ` signal ${signal}` : "";
          rejectWithDiagnostic(
            `Child process exited with code ${codeDetail}${signalDetail}`
          );
        }
      });

      childProcess.on("spawn", () => {
        console.log(
          `[WebsiteContentScrapeService] Spawned scrape worker requestId=${requestId} pid=${
            childProcess.pid ?? "unknown"
          } workerPath=${childProcessPath} url=${describeUrlForLog(url)}`
        );
        const scrapeMessage: WorkerScrapeMessage = {
          type: "SCRAPE_WEBSITE",
          url,
          requestId,
        };
        childProcess.postMessage(JSON.stringify(scrapeMessage));
      });
    });
  }

  /**
   * Resolve the compiled websiteContentScraper worker path. Prefers the
   * app.asar virtual path in packaged builds so Electron's module resolution
   * can reach app.asar/node_modules (puppeteer, etc.).
   */
  private static getChildProcessPath(): string | null {
    const electronProcess = process as NodeJS.Process & {
      resourcesPath?: string;
    };

    return WebsiteContentScrapeService.resolveChildProcessPath({
      dirname: __dirname,
      cwd: process.cwd(),
      resourcesPath: electronProcess.resourcesPath,
      existsSync: fs.existsSync,
    });
  }

  static resolveChildProcessPath(
    runtime: PackagedWorkerPathRuntime
  ): string | null {
    const resolved = resolvePackagedWorkerPath(
      runtime,
      WEBSITE_CONTENT_SCRAPER_PATH_OPTIONS
    );
    if (!resolved) {
      console.warn(
        `Child process file not found: ${WEBSITE_CONTENT_SCRAPER_FILE}`
      );
    }
    return resolved;
  }

  static mirrorAppAsarUnpackedPath(candidate: string): string {
    return mirrorAppAsarUnpackedPath(candidate);
  }
}
