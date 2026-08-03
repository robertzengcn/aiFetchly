/**
 * Website Content Scraper Child Process
 *
 * This child process handles fetching website content using Puppeteer
 * and converting HTML to markdown format. It communicates results back
 * to the parent process via IPC.
 *
 * Usage:
 * - Parent process sends URL via IPC message
 * - Child process fetches HTML content using Puppeteer
 * - Converts HTML to markdown using HtmlConversionService
 * - Returns markdown content via IPC message
 */

import { Browser, Page } from "puppeteer";
import { BrowserManager } from "@/modules/browserManager";
import { HtmlConversionService } from "@/service/HtmlConversionService";
import { UrlGuard } from "@/service/UrlGuard";
import { applySsrfNavigationGuard } from "@/service/PuppeteerSsrfGuard";

interface ScrapeWebsiteMessage {
  type: "SCRAPE_WEBSITE";
  url: string;
  requestId: string;
}

interface ScrapeWebsiteResult {
  markdown: string;
  title?: string;
  finalUrl?: string;
  canonicalUrl?: string;
  links?: string[];
}

interface ScrapeWebsiteResponse {
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

let browserManager: BrowserManager | null = null;
let browser: Browser | null = null;
const htmlConversionService = new HtmlConversionService();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * Initialize browser instance
 */
async function initializeBrowser(): Promise<Browser> {
  if (!browser) {
    browserManager = new BrowserManager();
    browser = await browserManager.launchWithoutStealth({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
      ],
    });
  }
  return browser;
}

/**
 * Candidate main-content selectors, in priority order. The first selector that
 * resolves to an element with meaningful text (>200 chars) is used as the
 * conversion root so imported documents skip repeated nav/footer/sidebar
 * chrome. Falls back to `<body>` / `<html>` when none match.
 */
const MAIN_CONTENT_SELECTORS: readonly string[] = [
  "article",
  "main",
  '[role="main"]',
  ".markdown-body",
  ".docs-content",
  ".doc-content",
  ".content",
  ".post",
  ".entry-content",
];

/** Minimum visible-text length (chars) for a main-content selector to win. */
const MAIN_CONTENT_MIN_TEXT_LENGTH = 200;

/**
 * Cap on anchor hrefs returned per page. Bounds IPC payload size and crawl
 * link-processing when a page (e.g. a sitemap-like index) has thousands of
 * links. 500 is far above any normal crawl need.
 */
const MAX_LINKS_PER_PAGE = 500;

/**
 * Select a likely main-content root from the rendered DOM and return its
 * outerHTML for conversion. Falls back to the full body when no candidate
 * selector matches a sufficiently large region.
 */
async function selectMainContentHtml(page: Page): Promise<string> {
  return await page.evaluate(
    (config: { selectors: readonly string[]; minTextLength: number }) => {
      for (const selector of config.selectors) {
        const element = document.querySelector(selector);
        const text = element?.textContent?.trim() ?? "";
        if (element && text.length > config.minTextLength) {
          return (element as HTMLElement).outerHTML;
        }
      }
      return document.body?.outerHTML || document.documentElement.outerHTML;
    },
    {
      selectors: MAIN_CONTENT_SELECTORS,
      minTextLength: MAIN_CONTENT_MIN_TEXT_LENGTH,
    }
  );
}

/** Read the page's <link rel="canonical"> href, if present. */
async function extractCanonicalUrl(page: Page): Promise<string | undefined> {
  try {
    const href = await page.$eval(
      'link[rel="canonical"]',
      (el) => (el as HTMLLinkElement).href
    );
    return typeof href === "string" && href.length > 0 ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Collect rendered anchor hrefs for same-origin crawl discovery. */
async function extractAnchorLinks(page: Page): Promise<string[]> {
  try {
    const hrefs = await page.$$eval(
      "a[href]",
      (anchors, limit: number) =>
        anchors
          .map((anchor) => (anchor as HTMLAnchorElement).href)
          .filter(
            (href): href is string =>
              typeof href === "string" && href.length > 0
          )
          .slice(0, limit),
      MAX_LINKS_PER_PAGE
    );
    return hrefs;
  } catch {
    return [];
  }
}

/**
 * Scrape website content and convert to markdown
 */
async function scrapeWebsite(url: string): Promise<ScrapeWebsiteResult> {
  try {
    // F3 fix — validate URL before any navigation. Block file://, data://,
    // chrome://, and any host resolving to loopback / link-local / RFC1918 /
    // cloud-metadata ranges. This worker returns page content to callers, so
    // an unrestricted URL is an SSRF vector.
    const urlCheck = await UrlGuard.validateWithDns(url);
    if (!urlCheck.safe) {
      throw new Error(`URL rejected by SSRF guard: ${urlCheck.error}`);
    }
    const safeUrl = urlCheck.normalizedUrl!;

    // Initialize browser if needed
    const browserInstance = await initializeBrowser();

    // Create new page
    const page = await browserInstance.newPage();

    try {
      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // F3 fix — intercept every outgoing request so redirects and
      // subresources targeting private/internal destinations are blocked.
      // F3 follow-up — the interceptor is DNS-aware (shared guard), so a
      // public URL that redirects or embeds subresources pointing at a host
      // resolving to loopback / RFC1918 / link-local / metadata is aborted
      // before the browser issues the request, not just after navigation.
      await applySsrfNavigationGuard(page);

      // Navigate to URL with timeout
      await page.goto(safeUrl, {
        waitUntil: "networkidle2",
        timeout: 30000, // 30 seconds timeout
      });

      // Verify the final post-redirect URL is still safe.
      const finalUrl = page.url();
      const finalCheck = await UrlGuard.validateWithDns(finalUrl);
      if (!finalCheck.safe) {
        throw new Error(
          `Final URL after redirect rejected by SSRF guard: ${finalCheck.error}`
        );
      }

      // Wait a bit for dynamic content to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Capture page metadata for import/crawl callers.
      const title = (await page.title()).trim() || undefined;
      const canonicalUrl = await extractCanonicalUrl(page);

      // Select a likely main-content root before converting so imported
      // documents skip repeated nav/footer/sidebar chrome.
      const htmlContent = await selectMainContentHtml(page);
      const markdown = htmlConversionService.convertHtmlToMarkdown(htmlContent);

      const links = await extractAnchorLinks(page);

      return { markdown, title, finalUrl, canonicalUrl, links };
    } finally {
      // Always close the page
      await page.close();
    }
  } catch (error) {
    console.error("Error scraping website:", error);
    throw error;
  }
}

/**
 * Cleanup browser instance
 */
async function cleanupBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      console.error("Error closing browser:", error);
    }
    browser = null;
  }
  if (browserManager) {
    browserManager = null;
  }
}

// Handle process messages from parent
const parentPort = (
  process as unknown as {
    parentPort?: {
      on: (event: string, handler: (e: { data: string }) => void) => void;
      postMessage: (message: string) => void;
    };
  }
).parentPort;

if (!parentPort) {
  console.error(
    "[websiteContentScraper] Missing Electron utilityProcess parentPort; worker cannot receive scrape requests."
  );
}

if (parentPort) {
  parentPort.on("message", async (e: { data: string }) => {
    try {
      const message: ScrapeWebsiteMessage = JSON.parse(e.data);

      if (message.type === "SCRAPE_WEBSITE" && message.url) {
        console.log(
          `[websiteContentScraper] Starting scrape requestId=${message.requestId} url=${message.url}`
        );

        try {
          const result = await scrapeWebsite(message.url);

          const response: ScrapeWebsiteResponse = {
            type: "SCRAPE_SUCCESS",
            requestId: message.requestId,
            markdown: result.markdown,
            title: result.title,
            finalUrl: result.finalUrl,
            canonicalUrl: result.canonicalUrl,
            links: result.links,
          };

          if (parentPort) {
            parentPort.postMessage(JSON.stringify(response));
          }
          console.log(
            `[websiteContentScraper] Finished scrape requestId=${message.requestId} finalUrl=${
              result.finalUrl ?? message.url
            } markdownLength=${result.markdown.length}`
          );
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          const stack = getErrorStack(error);
          console.error(
            `[websiteContentScraper] Scraping error requestId=${message.requestId}: ${errorMessage}`
          );
          if (stack) {
            console.error(stack);
          }

          const response: ScrapeWebsiteResponse = {
            type: "SCRAPE_ERROR",
            requestId: message.requestId,
            error: errorMessage,
            stack,
          };

          if (parentPort) {
            parentPort.postMessage(JSON.stringify(response));
          }
        }
      } else {
        console.warn("[websiteContentScraper] Unknown message type:", message);
      }
    } catch (error) {
      console.error("[websiteContentScraper] Error processing message:", error);
      const errorResponse: ScrapeWebsiteResponse = {
        type: "SCRAPE_ERROR",
        requestId: "unknown",
        error: getErrorMessage(error),
        stack: getErrorStack(error),
      };
      if (parentPort) {
        parentPort.postMessage(JSON.stringify(errorResponse));
      }
    }
  });
}

process.on("uncaughtException", (error: Error) => {
  console.error("[websiteContentScraper] Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[websiteContentScraper] Unhandled rejection:", reason);
  process.exit(1);
});

// Handle process termination
process.on("SIGTERM", async () => {
  console.log("[websiteContentScraper] Received SIGTERM, cleaning up...");
  await cleanupBrowser();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[websiteContentScraper] Received SIGINT, cleaning up...");
  await cleanupBrowser();
  process.exit(0);
});

// Cleanup on exit
process.on("exit", async () => {
  await cleanupBrowser();
});
