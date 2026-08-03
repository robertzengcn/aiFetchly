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

/** Hard cap on a single page load before the worker is killed. */
const SCRAPING_TIMEOUT_MS = 600000; // 10 minutes

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
}

interface WorkerScrapeMessage {
  type: "SCRAPE_WEBSITE";
  url: string;
  requestId: string;
}

interface ChildProcessPathRuntime {
  dirname: string;
  cwd: string;
  resourcesPath?: string;
  existsSync: (candidate: string) => boolean;
}

const WEBSITE_CONTENT_SCRAPER_FILE = "websiteContentScraper.js";

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
        env: {
          ...process.env,
          NODE_OPTIONS: "",
        },
      });

      const requestId = `scrape-${uuidv4()}-${Date.now()}`;
      const timeout = setTimeout(() => {
        childProcess.kill();
        reject(new Error("Website scraping timeout"));
      }, SCRAPING_TIMEOUT_MS);

      const messageHandler = (rawMessage: unknown) => {
        let message: WorkerScrapeResponse;
        try {
          message =
            typeof rawMessage === "string"
              ? (JSON.parse(rawMessage) as WorkerScrapeResponse)
              : (rawMessage as WorkerScrapeResponse);
        } catch {
          clearTimeout(timeout);
          childProcess.removeListener("message", messageHandler);
          childProcess.kill();
          reject(new Error("Error parsing child process message"));
          return;
        }

        if (message.requestId !== requestId) {
          return; // Ignore messages for other requests.
        }

        clearTimeout(timeout);
        childProcess.removeListener("message", messageHandler);
        childProcess.kill();

        if (message.type === "SCRAPE_ERROR") {
          reject(new Error(message.error || "Failed to scrape website"));
          return;
        }

        if (!message.markdown) {
          reject(new Error("No content extracted from website"));
          return;
        }

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
        clearTimeout(timeout);
        childProcess.removeListener("message", messageHandler);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        reject(new Error(`Child process error: ${errorMessage}`));
      });

      childProcess.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          childProcess.removeListener("message", messageHandler);
          reject(new Error(`Child process exited with code ${code}`));
        }
      });

      childProcess.on("spawn", () => {
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
   * Resolve the compiled websiteContentScraper worker path. Tries the bundled
   * location first, then relative/cwd fallbacks used by different build modes.
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
    runtime: ChildProcessPathRuntime
  ): string | null {
    const candidates =
      WebsiteContentScrapeService.getChildProcessPathCandidates(runtime);

    for (const candidate of candidates) {
      if (runtime.existsSync(candidate)) {
        return candidate;
      }
    }

    console.warn(
      `Child process file not found. Tried: ${candidates.join(", ")}`
    );
    return null;
  }

  private static getChildProcessPathCandidates(
    runtime: ChildProcessPathRuntime
  ): string[] {
    const candidates: string[] = [];
    const addCandidate = (candidate: string): void => {
      const normalized = path.normalize(candidate);
      const unpacked =
        WebsiteContentScrapeService.mirrorAppAsarUnpackedPath(normalized);
      if (unpacked !== normalized && !candidates.includes(unpacked)) {
        candidates.push(unpacked);
      }
      if (!candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    };

    addCandidate(
      path.join(runtime.dirname, "childprocess", WEBSITE_CONTENT_SCRAPER_FILE)
    );
    addCandidate(
      path.join(runtime.dirname, "../childprocess", WEBSITE_CONTENT_SCRAPER_FILE)
    );
    addCandidate(
      path.join(
        runtime.dirname,
        "../../dist/childprocess",
        WEBSITE_CONTENT_SCRAPER_FILE
      )
    );
    addCandidate(
      path.join(runtime.cwd, "dist/childprocess", WEBSITE_CONTENT_SCRAPER_FILE)
    );
    addCandidate(
      path.join(
        runtime.cwd,
        ".vite/build/childprocess",
        WEBSITE_CONTENT_SCRAPER_FILE
      )
    );

    if (runtime.resourcesPath) {
      addCandidate(
        path.join(
          runtime.resourcesPath,
          "app.asar.unpacked",
          "dist/childprocess",
          WEBSITE_CONTENT_SCRAPER_FILE
        )
      );
      addCandidate(
        path.join(
          runtime.resourcesPath,
          "app.asar.unpacked",
          ".vite/build/childprocess",
          WEBSITE_CONTENT_SCRAPER_FILE
        )
      );
      addCandidate(
        path.join(
          runtime.resourcesPath,
          "app.asar",
          "dist/childprocess",
          WEBSITE_CONTENT_SCRAPER_FILE
        )
      );
    }

    return candidates;
  }

  static mirrorAppAsarUnpackedPath(candidate: string): string {
    return candidate.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  }
}
