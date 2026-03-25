import { describe, test, expect, beforeEach, vi } from "vitest";
import { JapaneseYellowPagesAdapter } from "@/modules/platforms/JapaneseYellowPagesAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";
import { Page } from "puppeteer";

// Concrete implementation for testing
class TestJapaneseAdapter extends JapaneseYellowPagesAdapter {
  public getCookieAcceptDelay(): number {
    return this.COOKIE_ACCEPT_DELAY;
  }

  public getPageLoadTimeout(): number {
    return this.PAGE_LOAD_TIMEOUT;
  }
}

describe("JapaneseYellowPagesAdapter", () => {
  let mockConfig: PlatformConfig;
  let mockPage: Page;
  let adapter: TestJapaneseAdapter;

  beforeEach(() => {
    // Mock platform configuration
    mockConfig = {
      id: "test-japanese-platform",
      name: "Test Japanese Platform",
      display_name: "Test Japanese Platform",
      base_url: "https://test.example.co.jp",
      country: "Japan",
      language: "ja",
      is_active: true,
      version: "1.0.0",
      type: "class",
      adapter_class: TestJapaneseAdapter,
      documentation: "https://test.example.co.jp",
      maintainer: "Test Team",
      rate_limit: 60,
      delay_between_requests: 2500,
      max_concurrent_requests: 1,
      selectors: {
        searchForm: {
          keywordInput: 'input[name="keyword"]',
          locationInput: 'input[name="address"]',
          searchButton: 'button[type="submit"]',
          formContainer: "form",
        },
        businessList: ".search-results",
        businessItem: ".result-item",
        businessName: "h2 a",
        detailPageLink: "h2 a",
        phone: 'a[href^="tel:"]',
        website: 'a[href^="http"]',
        address: ".address",
        categories: ".category",
        pagination: {
          nextButton: "a.next",
          currentPage: ".current",
          maxPages: ".total",
          pageNumbers: ".pagination a",
          container: ".pagination",
        },
      },
      settings: {
        requiresAuthentication: false,
        supportsProxy: true,
        supportsCookies: true,
        searchUrlPattern: "https://test.example.co.jp/search",
        resultUrlPattern: "https://test.example.co.jp{path}",
        supportedFeatures: [],
      },
      metadata: {
        lastUpdated: new Date(),
        version: "1.0.0",
        category: "business-directory",
        priority: "medium",
        tags: ["japan", "test"],
      },
      description: "Test configuration",
    };

    // Mock page object
    mockPage = {
      $: vi.fn(),
      waitForFunction: vi.fn(),
    } as unknown as Page;

    adapter = new TestJapaneseAdapter(mockConfig);
  });

  describe("Constants", () => {
    test("should have correct cookie accept delay constant", () => {
      expect(adapter.getCookieAcceptDelay()).toBe(800);
    });

    test("should have correct page load timeout constant", () => {
      expect(adapter.getPageLoadTimeout()).toBe(8000);
    });
  });

  describe("onPageLoad", () => {
    test("should handle cookie consent when button found", async () => {
      const mockButton = {
        click: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockPage.$).mockResolvedValueOnce(mockButton as any);
      vi.mocked(
        mockPage.waitForFunction
      ).mockResolvedValueOnce(undefined as any);

      await adapter.onPageLoad(mockPage);

      expect(mockPage.$).toHaveBeenCalledWith("#onetrust-accept-btn-handler");
      expect(mockButton.click).toHaveBeenCalled();
      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });

    test("should try multiple cookie selectors", async () => {
      vi.mocked(mockPage.$)
        .mockResolvedValueOnce(null) // First selector not found
        .mockResolvedValueOnce(null) // Second selector not found
        .mockResolvedValueOnce({
          click: vi.fn().mockResolvedValue(undefined),
        } as any); // Third selector found

      vi.mocked(
        mockPage.waitForFunction
      ).mockResolvedValueOnce(undefined as any);

      await adapter.onPageLoad(mockPage);

      expect(mockPage.$).toHaveBeenCalledTimes(3);
    });

    test("should wait for page load after cookie acceptance", async () => {
      const mockButton = {
        click: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockPage.$).mockResolvedValueOnce(mockButton as any);
      vi.mocked(
        mockPage.waitForFunction
      ).mockResolvedValueOnce(undefined as any);

      const startTime = Date.now();
      await adapter.onPageLoad(mockPage);
      const endTime = Date.now();

      // Should wait at least COOKIE_ACCEPT_DELAY (800ms)
      expect(endTime - startTime).toBeGreaterThanOrEqual(700);
      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });

    test("should handle errors gracefully", async () => {
      vi.mocked(mockPage.$).mockRejectedValueOnce(
        new Error("Network error")
      );

      // Should not throw
      await expect(adapter.onPageLoad(mockPage)).resolves.not.toThrow();
    });

    test("should continue if waitForFunction times out", async () => {
      const mockButton = {
        click: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockPage.$).mockResolvedValueOnce(mockButton as any);
      vi.mocked(mockPage.waitForFunction).mockRejectedValueOnce(
        new Error("Timeout")
      );

      // Should not throw
      await expect(adapter.onPageLoad(mockPage)).resolves.not.toThrow();
    });

    test("should not fail if no cookie button is found", async () => {
      vi.mocked(mockPage.$).mockResolvedValue(null);
      vi.mocked(
        mockPage.waitForFunction
      ).mockResolvedValueOnce(undefined as any);

      await expect(adapter.onPageLoad(mockPage)).resolves.not.toThrow();
      expect(mockPage.waitForFunction).toHaveBeenCalled();
    });
  });

  describe("Cookie Selectors", () => {
    test("should try OneTrust accept button handler first", async () => {
      vi.mocked(mockPage.$).mockResolvedValueOnce({
        click: vi.fn().mockResolvedValue(undefined),
      } as any);
      vi.mocked(
        mockPage.waitForFunction
      ).mockResolvedValueOnce(undefined as any);

      await adapter.onPageLoad(mockPage);

      expect(mockPage.$).toHaveBeenCalledWith("#onetrust-accept-btn-handler");
    });

    test("should include Japanese 'Agree' button selector", async () => {
      // All selectors fail until Japanese selector
      vi.mocked(mockPage.$)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          click: vi.fn().mockResolvedValue(undefined),
        } as any);
      vi.mocked(
        mockPage.waitForFunction
      ).mockResolvedValueOnce(undefined as any);

      await adapter.onPageLoad(mockPage);

      expect(mockPage.$).toHaveBeenCalledWith("button[aria-label='同意']");
    });
  });

  describe("Page Load Detection", () => {
    test("should wait for document ready state complete", async () => {
      const mockButton = {
        click: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockPage.$).mockResolvedValueOnce(mockButton as any);
      vi.mocked(
        mockPage.waitForFunction
      ).mockResolvedValueOnce(undefined as any);

      await adapter.onPageLoad(mockPage);

      expect(mockPage.waitForFunction).toHaveBeenCalledWith(
        expect.any(Function),
        { timeout: 8000 }
      );
    });

    test("should check for loading indicators", async () => {
      const mockButton = {
        click: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockPage.$).mockResolvedValueOnce(mockButton as any);
      vi.mocked(
        mockPage.waitForFunction
      ).mockResolvedValueOnce(undefined as any);

      await adapter.onPageLoad(mockPage);

      const waitFunction = vi.mocked(mockPage.waitForFunction).mock.calls[0][0];
      expect(waitFunction.toString()).toContain(".loading");
      expect(waitFunction.toString()).toContain(".spinner");
    });
  });
});
