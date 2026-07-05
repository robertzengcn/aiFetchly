/**
 * Unit tests for Google Maps worker navigation helpers.
 *
 * These lock in the recovery behavior that turns a spurious
 * `networkidle2` "Navigation timeout of 30000 ms exceeded" into a no-op
 * when the page has actually loaded.
 */
import { describe, it, expect, vi } from "vitest";
import { TimeoutError, type Page } from "puppeteer";
import {
  safeGoto,
  isNavigationTimeoutError,
} from "@/childprocess/google-maps/mapsNavigation";

/**
 * Build a minimal Page mock. `overrides` is keyed loosely so each vi.fn keeps
 * its exact inferred Mock generic (e.g. `Mock<[], Promise<string>>`) without a
 * rigid field type rejecting it; the merged object is cast to `Page`.
 */
function makePage(overrides: Record<string, unknown> = {}): Page {
  const defaults = {
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => "complete"),
    $: vi.fn(async () => null),
  };
  return { ...defaults, ...overrides } as unknown as Page;
}

describe("isNavigationTimeoutError", () => {
  it("detects a real TimeoutError instance", () => {
    expect(
      isNavigationTimeoutError(
        new TimeoutError("Navigation timeout of 30000 ms exceeded")
      )
    ).toBe(true);
  });

  it("detects an error with name TimeoutError", () => {
    const e = new Error("something");
    e.name = "TimeoutError";
    expect(isNavigationTimeoutError(e)).toBe(true);
  });

  it("detects an error by message pattern", () => {
    expect(
      isNavigationTimeoutError(
        new Error("Navigation timeout of 30000 ms exceeded")
      )
    ).toBe(true);
  });

  it("rejects unrelated errors and non-errors", () => {
    expect(
      isNavigationTimeoutError(new Error("net::ERR_CONNECTION_RESET"))
    ).toBe(false);
    expect(isNavigationTimeoutError("a string")).toBe(false);
    expect(isNavigationTimeoutError(null)).toBe(false);
    expect(isNavigationTimeoutError(undefined)).toBe(false);
  });
});

describe("safeGoto", () => {
  it("resolves when page.goto resolves and forwards default options", async () => {
    const goto = vi.fn(async () => undefined);
    const page = makePage({ goto });

    await expect(safeGoto(page, "https://maps.test")).resolves.toBeUndefined();

    expect(goto).toHaveBeenCalledWith("https://maps.test", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  });

  it("honors a custom waitUntil and timeout", async () => {
    const goto = vi.fn(async () => undefined);
    const page = makePage({ goto });

    await safeGoto(page, "https://maps.test", {
      waitUntil: "networkidle2",
      timeout: 9000,
    });

    expect(goto).toHaveBeenCalledWith("https://maps.test", {
      waitUntil: "networkidle2",
      timeout: 9000,
    });
  });

  it("recovers when networkidle2 times out but readyState is complete", async () => {
    const page = makePage({
      goto: vi.fn(async () => {
        throw new TimeoutError("Navigation timeout of 30000 ms exceeded");
      }),
      evaluate: vi.fn(async () => "complete"),
    });

    await expect(
      safeGoto(page, "https://maps.test", { waitUntil: "networkidle2" })
    ).resolves.toBeUndefined();
  });

  it("recovers when readyState is complete and readySelector is present", async () => {
    const $ = vi.fn(async () => ({} as unknown)); // truthy element handle
    const page = makePage({
      goto: vi.fn(async () => {
        throw new TimeoutError("Navigation timeout");
      }),
      evaluate: vi.fn(async () => "complete"),
      $,
    });

    await expect(
      safeGoto(page, "u", { readySelector: '[role="feed"]' })
    ).resolves.toBeUndefined();
    expect($).toHaveBeenCalledWith('[role="feed"]');
  });

  it("throws when timed out and readyState is not complete", async () => {
    const page = makePage({
      goto: vi.fn(async () => {
        throw new TimeoutError("Navigation timeout of 30000 ms exceeded");
      }),
      evaluate: vi.fn(async () => "loading"),
    });

    await expect(safeGoto(page, "u")).rejects.toThrow(/Navigation timeout/);
  });

  it("throws when timed out, readyState complete, but readySelector absent", async () => {
    const page = makePage({
      goto: vi.fn(async () => {
        throw new TimeoutError("Navigation timeout");
      }),
      evaluate: vi.fn(async () => "complete"),
      $: vi.fn(async () => null),
    });

    await expect(
      safeGoto(page, "u", { readySelector: '[role="feed"]' })
    ).rejects.toThrow(/Navigation timeout/);
  });

  it("propagates non-timeout errors unchanged", async () => {
    const page = makePage({
      goto: vi.fn(async () => {
        throw new Error("net::ERR_NAME_NOT_RESOLVED");
      }),
    });

    await expect(safeGoto(page, "u")).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
  });

  it("throws when timed out and page.evaluate throws (page unusable)", async () => {
    const page = makePage({
      goto: vi.fn(async () => {
        throw new TimeoutError("Navigation timeout");
      }),
      evaluate: vi.fn(async () => {
        throw new Error("Execution context was destroyed");
      }),
    });

    await expect(safeGoto(page, "u")).rejects.toThrow(/Navigation timeout/);
  });

  it("throws when timed out and readySelector check throws", async () => {
    const page = makePage({
      goto: vi.fn(async () => {
        throw new TimeoutError("Navigation timeout");
      }),
      evaluate: vi.fn(async () => "complete"),
      $: vi.fn(async () => {
        throw new Error("Cannot find context");
      }),
    });

    await expect(
      safeGoto(page, "u", { readySelector: '[role="feed"]' })
    ).rejects.toThrow(/Navigation timeout/);
  });
});
