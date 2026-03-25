import { describe, test, expect, beforeEach, vi } from "vitest";
import { USonarYellowPageAdapter } from "@/modules/platforms/USonarYellowPageAdapter";
import { Platform_usonar_yellowpage_jp } from "@/config/platforms/usonar-yellowpage-jp";
import { Page } from "puppeteer";

describe("USonarYellowPageAdapter", () => {
  let adapter: USonarYellowPageAdapter;
  let mockPage: Page;

  beforeEach(() => {
    adapter = new USonarYellowPageAdapter(Platform_usonar_yellowpage_jp);
    mockPage = {
      $: vi.fn(),
      waitForFunction: vi.fn(),
    } as unknown as Page;
  });

  test("should create adapter with correct configuration", () => {
    expect(adapter).toBeInstanceOf(USonarYellowPageAdapter);
    expect(adapter.config).toEqual(Platform_usonar_yellowpage_jp);
  });

  test("should have correct platform ID", () => {
    expect(adapter.config.id).toBe("usonar-yellowpage-jp");
  });

  test("should have correct base URL", () => {
    expect(adapter.config.base_url).toBe("https://yellowpage.usonar.co.jp");
  });

  test("should be configured for Japan", () => {
    expect(adapter.config.country).toBe("Japan");
    expect(adapter.config.language).toBe("ja");
  });

  test("should have appropriate rate limiting", () => {
    expect(adapter.config.rate_limit).toBe(50);
    expect(adapter.config.delay_between_requests).toBe(3000);
    expect(adapter.config.max_concurrent_requests).toBe(1);
  });

  test("should have search form selectors defined", () => {
    expect(adapter.config.selectors!.searchForm).toBeTruthy();
    const searchForm = adapter.config.selectors!.searchForm as {
      keywordInput?: string;
      locationInput?: string;
      searchButton?: string;
    };
    expect(searchForm.keywordInput).toBeTruthy();
    expect(searchForm.locationInput).toBeTruthy();
    expect(searchForm.searchButton).toBeTruthy();
  });

  test("should have business data selectors defined", () => {
    expect(adapter.config.selectors!.businessList).toBeTruthy();
    expect(adapter.config.selectors!.businessItem).toBeTruthy();
    expect(adapter.config.selectors!.businessName).toBeTruthy();
    expect(adapter.config.selectors!.phone).toBeTruthy();
    expect(adapter.config.selectors!.website).toBeTruthy();
    expect(adapter.config.selectors!.address).toBeTruthy();
  });

  test("should have pagination selectors defined", () => {
    expect(adapter.config.selectors!.pagination).toBeTruthy();
    const pagination = adapter.config.selectors!.pagination as {
      nextButton?: string;
      currentPage?: string;
    };
    expect(pagination.nextButton).toBeTruthy();
    expect(pagination.currentPage).toBeTruthy();
  });

  test("should support proxy", () => {
    expect(adapter.config.settings!.supportsProxy).toBe(true);
  });

  test("should support cookies", () => {
    expect(adapter.config.settings!.supportsCookies).toBe(true);
  });

  test("should not require authentication", () => {
    expect(adapter.config.settings!.requiresAuthentication).toBe(false);
  });

  test("should handle page load with cookie consent", async () => {
    const mockButton = {
      click: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(mockPage.$).mockResolvedValueOnce(mockButton as any);
    vi.mocked(mockPage.waitForFunction).mockResolvedValueOnce(undefined as any);

    await adapter.onPageLoad(mockPage);

    expect(mockButton.click).toHaveBeenCalled();
    expect(mockPage.waitForFunction).toHaveBeenCalled();
  });

  test("should handle page load errors gracefully", async () => {
    vi.mocked(mockPage.$).mockRejectedValueOnce(new Error("Network error"));

    await expect(adapter.onPageLoad(mockPage)).resolves.not.toThrow();
  });

  test("should have correct platform metadata", () => {
    expect(adapter.config.metadata!.category).toBe("business-directory");
    expect(adapter.config.metadata!.tags).toContain("japan");
    expect(adapter.config.metadata!.tags).toContain("yellow-pages");
    expect(adapter.config.metadata!.tags).toContain("usonar");
  });

  test("should have search URL pattern configured", () => {
    expect(adapter.config.settings!.searchUrlPattern).toContain(
      "https://yellowpage.usonar.co.jp/search"
    );
    expect(adapter.config.settings!.searchUrlPattern).toContain("{keywords}");
    expect(adapter.config.settings!.searchUrlPattern).toContain("{area}");
  });

  test("should have result URL pattern configured", () => {
    expect(adapter.config.settings!.resultUrlPattern).toContain(
      "https://yellowpage.usonar.co.jp"
    );
    expect(adapter.config.settings!.resultUrlPattern).toContain("{path}");
  });

  test("should use specific selectors for uSonar platform", () => {
    // uSonar uses 'keyword' and 'area' parameters
    expect(adapter.config.selectors!.searchForm).toBeTruthy();
    const searchForm = adapter.config.selectors!.searchForm as {
      keywordInput?: string;
      locationInput?: string;
    };
    expect(searchForm.keywordInput).toContain('input[name="q"]');
    expect(searchForm.locationInput).toContain('input[name="area"]');
  });
});
