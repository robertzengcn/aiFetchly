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
      on: vi.fn(),
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

  test("should click itownpage notice consent agree when present", async () => {
    const mockCookieButton = {
      click: vi.fn().mockResolvedValue(undefined),
    };
    const mockNoticeAgree = {
      click: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(mockPage.$)
      .mockResolvedValueOnce(mockCookieButton as any)
      .mockResolvedValueOnce(mockNoticeAgree as any);
    vi.mocked(mockPage.waitForFunction).mockResolvedValueOnce(undefined as any);

    await adapter.onPageLoad(mockPage);

    expect(mockCookieButton.click).toHaveBeenCalled();
    expect(mockNoticeAgree.click).toHaveBeenCalled();
  });

  test("should auto-accept dialog alerts when they appear", async () => {
    const mockCookieButton = {
      click: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(mockPage.$).mockResolvedValueOnce(mockCookieButton as any);
    vi.mocked(mockPage.waitForFunction).mockResolvedValueOnce(undefined as any);

    let dialogHandler:
      | ((dialog: { accept: () => Promise<void> }) => void)
      | null = null;
    vi.mocked(mockPage.on as any).mockImplementation(
      (event: any, handler: (...args: unknown[]) => void) => {
        if (event === "dialog") {
          dialogHandler = handler as (dialog: {
            accept: () => Promise<void>;
          }) => void;
        }
        return mockPage;
      }
    );

    await adapter.onPageLoad(mockPage);

    const mockDialog = { accept: vi.fn().mockResolvedValue(undefined) };
    if (!dialogHandler) {
      throw new Error("dialog handler should be attached");
    }
    (dialogHandler as (dialog: { accept: () => Promise<void> }) => void)(
      mockDialog
    );

    // allow fire-and-forget accept() to flush
    await Promise.resolve();

    expect(mockDialog.accept).toHaveBeenCalled();
  });

  test("should only attach dialog handler once per page", async () => {
    const mockCookieButton = {
      click: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(mockPage.$).mockResolvedValue(mockCookieButton as any);
    vi.mocked(mockPage.waitForFunction).mockResolvedValue(undefined as any);

    await adapter.onPageLoad(mockPage);
    await adapter.onPageLoad(mockPage);

    const dialogOnCalls = (mockPage.on as unknown as any).mock.calls.filter(
      (c: unknown[]) => c[0] === "dialog"
    );
    expect(dialogOnCalls.length).toBe(1);
  });

  test("should handle page load errors gracefully", async () => {
    vi.mocked(mockPage.$).mockRejectedValueOnce(new Error("Network error"));

    await expect(adapter.onPageLoad(mockPage)).resolves.not.toThrow();
  });

  test("should have correct platform metadata", () => {
    expect(adapter.config.metadata!.category).toBe("business-directory");
    expect(adapter.config.metadata!.tags).toContain("japan");
    expect(adapter.config.metadata!.tags).toContain("yellow-pages");
  });

  test("should have search URL pattern configured", () => {
    expect(adapter.config.settings!.searchUrlPattern).toContain(
      "https://itp.ne.jp/search"
    );
    expect(adapter.config.settings!.searchUrlPattern).toContain("{keywords}");
    expect(adapter.config.settings!.searchUrlPattern).toContain("{location}");
  });

  test("should have result URL pattern configured", () => {
    expect(adapter.config.settings!.resultUrlPattern).toContain(
      "https://itp.ne.jp"
    );
    expect(adapter.config.settings!.resultUrlPattern).toContain("{path}");
  });
});
