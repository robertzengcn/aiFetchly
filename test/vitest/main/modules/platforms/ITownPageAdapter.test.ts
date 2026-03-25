import { describe, test, expect, beforeEach, vi } from "vitest";
import { ITownPageAdapter } from "@/modules/platforms/ITownPageAdapter";
import { Platform_itownpage_jp } from "@/config/platforms/itownpage-jp";
import { Page } from "puppeteer";

describe("ITownPageAdapter", () => {
  let adapter: ITownPageAdapter;
  let mockPage: Page;

  beforeEach(() => {
    adapter = new ITownPageAdapter(Platform_itownpage_jp);
    mockPage = {
      $: vi.fn(),
      waitForFunction: vi.fn(),
    } as unknown as Page;
  });

  test("should create adapter with correct configuration", () => {
    expect(adapter).toBeInstanceOf(ITownPageAdapter);
    expect(adapter.config).toEqual(Platform_itownpage_jp);
  });

  test("should have correct platform ID", () => {
    expect(adapter.config.id).toBe("itownpage-jp");
  });

  test("should have correct base URL", () => {
    expect(adapter.config.base_url).toBe("https://itp.ne.jp");
  });

  test("should be configured for Japan", () => {
    expect(adapter.config.country).toBe("Japan");
    expect(adapter.config.language).toBe("ja");
  });

  test("should have appropriate rate limiting", () => {
    expect(adapter.config.rate_limit).toBe(60);
    expect(adapter.config.delay_between_requests).toBe(2500);
    expect(adapter.config.max_concurrent_requests).toBe(1);
  });

  test("should have search form selectors defined", () => {
    expect(adapter.config.selectors.searchForm.keywordInput).toBeTruthy();
    expect(adapter.config.selectors.searchForm.locationInput).toBeTruthy();
    expect(adapter.config.selectors.searchForm.searchButton).toBeTruthy();
  });

  test("should have business data selectors defined", () => {
    expect(adapter.config.selectors.businessList).toBeTruthy();
    expect(adapter.config.selectors.businessItem).toBeTruthy();
    expect(adapter.config.selectors.businessName).toBeTruthy();
    expect(adapter.config.selectors.phone).toBeTruthy();
    expect(adapter.config.selectors.website).toBeTruthy();
    expect(adapter.config.selectors.address).toBeTruthy();
  });

  test("should have pagination selectors defined", () => {
    expect(adapter.config.selectors.pagination.nextButton).toBeTruthy();
    expect(adapter.config.selectors.pagination.currentPage).toBeTruthy();
  });

  test("should support proxy", () => {
    expect(adapter.config.settings.supportsProxy).toBe(true);
  });

  test("should support cookies", () => {
    expect(adapter.config.settings.supportsCookies).toBe(true);
  });

  test("should not require authentication", () => {
    expect(adapter.config.settings.requiresAuthentication).toBe(false);
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
    expect(adapter.config.metadata.category).toBe("business-directory");
    expect(adapter.config.metadata.tags).toContain("japan");
    expect(adapter.config.metadata.tags).toContain("yellow-pages");
  });

  test("should have search URL pattern configured", () => {
    expect(
      adapter.config.settings.searchUrlPattern
    ).toContain("https://itp.ne.jp/search");
    expect(adapter.config.settings.searchUrlPattern).toContain("{keywords}");
    expect(adapter.config.settings.searchUrlPattern).toContain("{location}");
  });

  test("should have result URL pattern configured", () => {
    expect(adapter.config.settings.resultUrlPattern).toContain(
      "https://itp.ne.jp"
    );
    expect(adapter.config.settings.resultUrlPattern).toContain("{path}");
  });
});
