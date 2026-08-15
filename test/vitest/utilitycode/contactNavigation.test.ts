import { describe, expect, it, vi } from "vitest";
import { TimeoutError, type Page } from "puppeteer";
import { navigateForContactExtraction } from "@/childprocess/contact-extraction/ContactNavigation";

function makePage(overrides: Record<string, unknown> = {}): Page {
  return {
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => "complete"),
    ...overrides,
  } as unknown as Page;
}

describe("navigateForContactExtraction", () => {
  it("does not wait for network idleness before extracting from a page", async () => {
    const goto = vi.fn(async () => undefined);
    const page = makePage({ goto });

    await navigateForContactExtraction(page, "https://example.com");

    expect(goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  });

  it("continues when navigation times out after the document completed", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const page = makePage({
      goto: vi.fn(async () => {
        throw new TimeoutError("Navigation timeout of 30000 ms exceeded");
      }),
      evaluate: vi.fn(async () => "complete"),
    });

    try {
      await expect(
        navigateForContactExtraction(page, "https://example.com")
      ).resolves.toBeUndefined();
    } finally {
      warning.mockRestore();
    }
  });

  it("preserves a timeout when the document is not usable", async () => {
    const page = makePage({
      goto: vi.fn(async () => {
        throw new TimeoutError("Navigation timeout of 30000 ms exceeded");
      }),
      evaluate: vi.fn(async () => "loading"),
    });

    await expect(
      navigateForContactExtraction(page, "https://example.com")
    ).rejects.toThrow(/Navigation timeout/);
  });

  it("preserves non-timeout navigation failures", async () => {
    const page = makePage({
      goto: vi.fn(async () => {
        throw new Error("net::ERR_NAME_NOT_RESOLVED");
      }),
    });

    await expect(
      navigateForContactExtraction(page, "https://example.com")
    ).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
  });
});
