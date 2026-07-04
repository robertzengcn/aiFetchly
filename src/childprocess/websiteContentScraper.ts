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

import { Page, Browser } from "puppeteer";
import { BrowserManager } from "@/modules/browserManager";
import { HtmlConversionService } from "@/service/HtmlConversionService";
import { UrlGuard } from "@/service/UrlGuard";

interface ScrapeWebsiteMessage {
  type: "SCRAPE_WEBSITE";
  url: string;
  requestId: string;
}

interface ScrapeWebsiteResponse {
  type: "SCRAPE_SUCCESS" | "SCRAPE_ERROR";
  requestId: string;
  markdown?: string;
  error?: string;
}

let browserManager: BrowserManager | null = null;
let browser: Browser | null = null;
const htmlConversionService = new HtmlConversionService();

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
 * Scrape website content and convert to markdown
 */
async function scrapeWebsite(url: string): Promise<string> {
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
      await applySsrfNavigationGuard(page);

      // Navigate to URL with timeout
      await page.goto(safeUrl, {
        waitUntil: "networkidle2",
        timeout: 30000, // 30 seconds timeout
      });

      // Verify the final post-redirect URL is still safe.
      const finalCheck = await UrlGuard.validateWithDns(page.url());
      if (!finalCheck.safe) {
        throw new Error(
          `Final URL after redirect rejected by SSRF guard: ${finalCheck.error}`
        );
      }

      // Wait a bit for dynamic content to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Extract HTML content
      const htmlContent = await page.content();

      // Convert HTML to markdown
      const markdown = htmlConversionService.convertHtmlToMarkdown(htmlContent);

      return markdown;
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
 * F3 fix — block any request whose URL (after redirects) targets a
 * loopback / link-local / RFC1918 / cloud-metadata destination. UrlGuard
 * performs the structural + DNS-range check; this interceptor applies the
 * same rule to every subrequest and redirect the browser issues.
 */
async function applySsrfNavigationGuard(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const verdict = UrlGuard.validate(req.url());
    if (!verdict.safe) {
      req.abort("accessdenied");
      return;
    }
    req.continue();
  });
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
if (parentPort) {
  parentPort.on("message", async (e: { data: string }) => {
    try {
      const message: ScrapeWebsiteMessage = JSON.parse(e.data);

      if (message.type === "SCRAPE_WEBSITE" && message.url) {
        console.log(`📄 Scraping website: ${message.url}`);

        try {
          const markdown = await scrapeWebsite(message.url);

          const response: ScrapeWebsiteResponse = {
            type: "SCRAPE_SUCCESS",
            requestId: message.requestId,
            markdown,
          };

          if (parentPort) {
            parentPort.postMessage(JSON.stringify(response));
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error("Scraping error:", errorMessage);

          const response: ScrapeWebsiteResponse = {
            type: "SCRAPE_ERROR",
            requestId: message.requestId,
            error: errorMessage,
          };

          if (parentPort) {
            parentPort.postMessage(JSON.stringify(response));
          }
        }
      } else {
        console.warn("⚠️ Unknown message type:", message);
      }
    } catch (error) {
      console.error("Error processing message:", error);
      const errorResponse: ScrapeWebsiteResponse = {
        type: "SCRAPE_ERROR",
        requestId: "unknown",
        error: error instanceof Error ? error.message : String(error),
      };
      if (parentPort) {
        (parentPort as any).postMessage(JSON.stringify(errorResponse));
      }
    }
  });
}

// Handle process termination
process.on("SIGTERM", async () => {
  console.log("🛑 Received SIGTERM, cleaning up...");
  await cleanupBrowser();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 Received SIGINT, cleaning up...");
  await cleanupBrowser();
  process.exit(0);
});

// Cleanup on exit
process.on("exit", async () => {
  await cleanupBrowser();
});
