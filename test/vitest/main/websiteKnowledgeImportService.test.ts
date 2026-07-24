"use strict";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// electron is only used for the default staging root, which we override.
vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test-appdata") },
}));

// Replace UrlGuard so tests never hit the network/DNS. "blocked" hosts mirror
// the real guard's blocked classes; everything else is treated as safe.
vi.mock("@/service/UrlGuard", () => ({
  UrlGuard: {
    validate: vi.fn((u: string) => {
      if (
        typeof u !== "string" ||
        u.includes("localhost") ||
        u.includes("127.0.0.1") ||
        u.includes("169.254.") ||
        u.startsWith("file:")
      ) {
        return { safe: false, error: "blocked", code: "BLOCKED_IP" };
      }
      return { safe: true, normalizedUrl: u, resolvedHost: "example.com" };
    }),
    validateWithDns: vi.fn(async (u: string) => {
      if (
        typeof u !== "string" ||
        u.includes("localhost") ||
        u.includes("127.0.0.1") ||
        u.includes("169.254.") ||
        u.startsWith("file:")
      ) {
        return {
          safe: false,
          error: "blocked by SSRF guard",
          code: "BLOCKED_IP",
        };
      }
      return { safe: true, normalizedUrl: u, resolvedHost: "example.com" };
    }),
  },
}));

import { WebsiteKnowledgeImportService } from "@/service/WebsiteKnowledgeImportService";
import type {
  WebsiteContentScrapeService,
  WebsitePageScrapeResult,
} from "@/service/WebsiteContentScrapeService";

interface FakePage {
  readonly markdown?: string;
  readonly title?: string;
  readonly finalUrl?: string;
  readonly links?: readonly string[];
  readonly throw?: string;
}

function makeScrapeService(pages: Record<string, FakePage>): {
  service: WebsiteContentScrapeService;
  scrapePage: ReturnType<typeof vi.fn>;
} {
  const scrapePage = vi.fn();
  scrapePage.mockImplementation(
    async (url: string): Promise<WebsitePageScrapeResult> => {
      const page = pages[url];
      if (page?.throw) throw new Error(page.throw);
      return {
        sourceUrl: url,
        finalUrl: page?.finalUrl ?? url,
        markdown: page?.markdown ?? "",
        title: page?.title,
        links: page?.links ?? [],
      };
    }
  );
  return {
    service: { scrapePage } as unknown as WebsiteContentScrapeService,
    scrapePage,
  };
}

const BODY_500 = "# Heading\n" + "x".repeat(500);

describe("WebsiteKnowledgeImportService", () => {
  let stagingRoot: string;

  beforeEach(() => {
    stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "website-import-"));
  });
  afterEach(() => {
    try {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function makeService(pages: Record<string, FakePage>) {
    const { service, scrapePage } = makeScrapeService(pages);
    const svc = new WebsiteKnowledgeImportService({
      scrapeService: service,
      stagingRoot,
    });
    return { svc, scrapePage };
  }

  // -------------------------------------------------------------------------
  // single_page
  // -------------------------------------------------------------------------

  describe("single_page", () => {
    test("stages one markdown file with source front matter", async () => {
      const { svc } = makeService({
        "https://example.com/pricing": { markdown: BODY_500, title: "Pricing" },
      });

      const res = await svc.prepareImportSources({
        mode: "single_page",
        url: "https://example.com/pricing",
        maxPages: 20,
        maxDepth: 2,
      });

      expect(res.mode).toBe("single_page");
      expect(res.requestedCount).toBe(1);
      expect(res.sources).toHaveLength(1);
      const src = res.sources[0];
      expect(src.fileName).toMatch(/^example\.com-pricing-[0-9a-f]{8}\.md$/);
      expect(src.filePath.endsWith(".md")).toBe(true);
      expect(fs.existsSync(src.filePath)).toBe(true);
      const content = fs.readFileSync(src.filePath, "utf8");
      expect(content).toContain("Source URL: https://example.com/pricing");
      expect(content).toContain("# Pricing");
      expect(src.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(src.importGroupId).toMatch(/^web-/);
      expect(src.sourceRootUrl).toBe("https://example.com");
    });

    test("rejects an SSRF-blocked URL before scraping (URL_BLOCKED)", async () => {
      const { svc, scrapePage } = makeService({});
      const res = await svc.prepareImportSources({
        mode: "single_page",
        url: "http://localhost:5173",
        maxPages: 20,
        maxDepth: 2,
      });
      expect(res.sources).toHaveLength(0);
      expect(res.skipped).toHaveLength(1);
      expect(res.skipped[0].code).toBe("URL_BLOCKED");
      expect(scrapePage).not.toHaveBeenCalled();
    });

    test("skips pages with empty content (EMPTY_CONTENT)", async () => {
      const { svc } = makeService({
        "https://example.com/empty": { markdown: "too short" },
      });
      const res = await svc.prepareImportSources({
        mode: "single_page",
        url: "https://example.com/empty",
        maxPages: 20,
        maxDepth: 2,
      });
      expect(res.sources).toHaveLength(0);
      expect(res.skipped[0].code).toBe("EMPTY_CONTENT");
    });

    test("maps a worker failure to SCRAPE_FAILED", async () => {
      const { svc } = makeService({
        "https://example.com/boom": { throw: "navigation timeout" },
      });
      const res = await svc.prepareImportSources({
        mode: "single_page",
        url: "https://example.com/boom",
        maxPages: 20,
        maxDepth: 2,
      });
      expect(res.skipped[0].code).toBe("SCRAPE_FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // url_list
  // -------------------------------------------------------------------------

  describe("url_list", () => {
    test("deduplicates fragment-only duplicates and preserves order", async () => {
      const { svc, scrapePage } = makeService({
        "https://example.com/a": { markdown: BODY_500 },
        "https://example.com/b": { markdown: BODY_500 },
      });

      const res = await svc.prepareImportSources({
        mode: "url_list",
        urls: [
          "https://example.com/a",
          "https://example.com/a#section", // same URL after hash strip
          "https://example.com/b",
        ],
        maxPages: 20,
        maxDepth: 2,
      });

      expect(res.sources).toHaveLength(2);
      const scraped = scrapePage.mock.calls.map((c) => c[0]);
      expect(scraped).toEqual([
        "https://example.com/a",
        "https://example.com/b",
      ]);
    });

    test("honors maxPages even when more URLs are provided", async () => {
      const { svc, scrapePage } = makeService({
        "https://example.com/a": { markdown: BODY_500 },
        "https://example.com/b": { markdown: BODY_500 },
        "https://example.com/c": { markdown: BODY_500 },
      });

      const res = await svc.prepareImportSources({
        mode: "url_list",
        urls: [
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
        ],
        maxPages: 2,
        maxDepth: 2,
      });

      expect(res.sources).toHaveLength(2);
      expect(scrapePage).toHaveBeenCalledTimes(2);
      expect(res.requestedCount).toBe(2);
    });

    test("returns partial success when some pages fail", async () => {
      const { svc } = makeService({
        "https://example.com/good": { markdown: BODY_500 },
        "https://example.com/bad": { throw: "boom" },
      });

      const res = await svc.prepareImportSources({
        mode: "url_list",
        urls: ["https://example.com/good", "https://example.com/bad"],
        maxPages: 20,
        maxDepth: 2,
      });

      expect(res.sources).toHaveLength(1);
      expect(res.skipped).toHaveLength(1);
      expect(res.skipped[0].code).toBe("SCRAPE_FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // site_crawl
  // -------------------------------------------------------------------------

  describe("site_crawl", () => {
    test("follows same-origin links and respects maxPages", async () => {
      const { svc, scrapePage } = makeService({
        "https://example.com/docs": {
          markdown: BODY_500,
          links: [
            "https://example.com/docs/a",
            "https://example.com/about",
            "https://other.com/x", // cross-origin — must be ignored
            "mailto:hi@example.com", // non-http — must be ignored
          ],
        },
        "https://example.com/docs/a": { markdown: BODY_500 },
        "https://example.com/about": { markdown: BODY_500 },
      });

      const res = await svc.prepareImportSources({
        mode: "site_crawl",
        url: "https://example.com/docs",
        maxPages: 2,
        maxDepth: 2,
      });

      // Seed + docs/a reach the page cap (2). about is discovered but not scraped.
      expect(res.sources).toHaveLength(2);
      const scraped = scrapePage.mock.calls.map((c) => c[0]);
      expect(scraped).toContain("https://example.com/docs");
      expect(scraped).toContain("https://example.com/docs/a");
      expect(scraped).not.toContain("https://other.com/x");
      expect(res.discoveredCount).toBeGreaterThanOrEqual(2);
    });

    test("respects maxDepth and does not descend further", async () => {
      const { svc, scrapePage } = makeService({
        "https://example.com/docs": {
          markdown: BODY_500,
          links: ["https://example.com/docs/a"],
        },
        "https://example.com/docs/a": {
          markdown: BODY_500,
          links: ["https://example.com/docs/a/b"], // depth 2 — beyond maxDepth 1
        },
        "https://example.com/docs/a/b": { markdown: BODY_500 },
      });

      const res = await svc.prepareImportSources({
        mode: "site_crawl",
        url: "https://example.com/docs",
        maxPages: 10,
        maxDepth: 1,
      });

      const scraped = scrapePage.mock.calls.map((c) => c[0]);
      expect(scraped).toContain("https://example.com/docs/a");
      expect(scraped).not.toContain("https://example.com/docs/a/b");
    });

    test("excludes cross-origin links from discovery", async () => {
      const { svc } = makeService({
        "https://example.com/docs": {
          markdown: BODY_500,
          links: ["https://blog.example.com/post", "https://example.com/x"],
        },
        "https://example.com/x": { markdown: BODY_500 },
      });

      const res = await svc.prepareImportSources({
        mode: "site_crawl",
        url: "https://example.com/docs",
        maxPages: 5,
        maxDepth: 2,
      });

      // blog.example.com is a different origin (exact-origin MVP rule).
      expect(res.discoveredCount).toBe(1);
    });

    test("rejects a blocked seed URL as URL_BLOCKED", async () => {
      const { svc, scrapePage } = makeService({});
      const res = await svc.prepareImportSources({
        mode: "site_crawl",
        url: "http://169.254.169.254/latest/meta-data/",
        maxPages: 5,
        maxDepth: 2,
      });
      expect(res.sources).toHaveLength(0);
      expect(res.skipped[0].code).toBe("URL_BLOCKED");
      expect(scrapePage).not.toHaveBeenCalled();
    });
  });
});
