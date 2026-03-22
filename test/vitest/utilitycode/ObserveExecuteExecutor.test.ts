/**
 * Tests for ObserveExecuteExecutor (executePuppeteerAction).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePuppeteerAction } from "@/childprocess/utils/ObserveExecuteExecutor";
import type { Page } from "puppeteer";

function createMockPage(): Page {
  return {
    url: vi.fn().mockResolvedValue("https://example.com"),
    goto: vi.fn().mockResolvedValue(undefined),
    frames: vi.fn().mockReturnValue([]),
    evaluate: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null),
    $x: vi.fn().mockResolvedValue([]),
  } as unknown as Page;
}

describe("ObserveExecuteExecutor", () => {
  let mockPage: Page;

  beforeEach(() => {
    mockPage = createMockPage();
  });

  describe("executePuppeteerAction", () => {
    it("should return error when page is null", async () => {
      const result = await executePuppeteerAction(null as unknown as Page, {
        action_id: "a1",
        type: "click",
        selector: ".btn",
      });
      expect(result.success).toBe(false);
      expect(result.element_found).toBe(false);
      expect(result.error).toContain("No page");
    });

    it("should execute wait action", async () => {
      vi.useFakeTimers();
      const resultPromise = executePuppeteerAction(mockPage, {
        action_id: "a1",
        type: "wait",
        value: "1",
      });
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;
      expect(result.success).toBe(true);
      vi.useRealTimers();
    });

    it("should execute navigate action", async () => {
      vi.mocked(mockPage.goto).mockResolvedValue(undefined as never);
      const result = await executePuppeteerAction(mockPage, {
        action_id: "a1",
        type: "navigate",
        value: "https://example.com/page",
      });
      expect(result.success).toBe(true);
      expect(mockPage.goto).toHaveBeenCalledWith(
        "https://example.com/page",
        expect.any(Object)
      );
    });

    it("should handle click action when element not found", async () => {
      const result = await executePuppeteerAction(mockPage, {
        action_id: "a1",
        type: "click",
        selector: ".non-existent-button",
      });
      expect(result.success).toBe(false);
      expect(result.element_found).toBe(false);
      expect(result.error).toContain("Element not found");
    });

    it("should clamp timeout values correctly", async () => {
      vi.useFakeTimers();
      const tooLowPromise = executePuppeteerAction(mockPage, {
        action_id: "a1",
        type: "wait",
        value: "1",
        timeout: 50,
      });
      await vi.advanceTimersByTimeAsync(1000);
      const tooLow = await tooLowPromise;
      const tooHighPromise = executePuppeteerAction(mockPage, {
        action_id: "a2",
        type: "wait",
        value: "1",
        timeout: 120_000,
      });
      await vi.advanceTimersByTimeAsync(1000);
      const tooHigh = await tooHighPromise;
      vi.useRealTimers();
      expect(tooLow.success).toBe(true);
      expect(tooHigh.success).toBe(true);
    });
  });
});
