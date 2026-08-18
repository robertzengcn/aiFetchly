/**
 * Unit tests for Google Maps results-readiness helpers.
 *
 * Locks in the multi-signal wait that replaces a brittle
 * waitForSelector('[role="feed"]') which timed out on consent walls,
 * single-place landings, and card-before-feed hydration races.
 */
import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer";
import {
  collectMapsPageDiagnostics,
  detectMapsReadyState,
  dismissMapsConsentIfPresent,
  formatMapsPageDiagnostics,
  waitForMapsResultsReady,
} from "@/childprocess/google-maps/mapsResultsReady";

function makeHandle(): {
  click: () => Promise<void>;
  dispose: () => Promise<void>;
} {
  return {
    click: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
}

function makePage(overrides: Record<string, unknown> = {}): Page {
  const defaults = {
    url: vi.fn(() => "https://www.google.com/maps/search/test"),
    title: vi.fn(async () => "Google Maps"),
    evaluate: vi.fn(async () => ({
      readyState: "complete",
      bodySnippet: "Results",
    })),
    $: vi.fn(async () => null),
  };
  return { ...defaults, ...overrides } as unknown as Page;
}

describe("detectMapsReadyState", () => {
  it("returns feed when role=feed is present", async () => {
    const page = makePage({
      $: vi.fn(async (sel: string) =>
        sel.includes('role="feed"') ? makeHandle() : null
      ),
    });
    await expect(detectMapsReadyState(page)).resolves.toBe("feed");
  });

  it("returns cards when only a.hfpxzc is present", async () => {
    const page = makePage({
      $: vi.fn(async (sel: string) =>
        sel === "a.hfpxzc" ? makeHandle() : null
      ),
    });
    await expect(detectMapsReadyState(page)).resolves.toBe("cards");
  });

  it("returns place when place-detail selectors are present", async () => {
    const page = makePage({
      $: vi.fn(async (sel: string) =>
        sel === "h1.DUwDvf" ? makeHandle() : null
      ),
    });
    await expect(detectMapsReadyState(page)).resolves.toBe("place");
  });

  it("returns null when nothing scrapable is present", async () => {
    const page = makePage({ $: vi.fn(async () => null) });
    await expect(detectMapsReadyState(page)).resolves.toBeNull();
  });
});

describe("dismissMapsConsentIfPresent", () => {
  it("clicks the first matching consent button and logs it", async () => {
    const handle = makeHandle();
    const log = vi.fn();
    const sleep = vi.fn(async () => undefined);
    const page = makePage({
      $: vi.fn(async (sel: string) =>
        sel.includes("Accept all") ? handle : null
      ),
    });

    const clicked = await dismissMapsConsentIfPresent(page, { log, sleep });
    expect(clicked).toContain("Accept all");
    expect(handle.click).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("dismissed consent")
    );
  });

  it("returns null when no consent UI exists", async () => {
    const page = makePage({ $: vi.fn(async () => null) });
    await expect(dismissMapsConsentIfPresent(page)).resolves.toBeNull();
  });
});

describe("waitForMapsResultsReady", () => {
  it("returns feed after dismissing consent", async () => {
    const consentHandle = makeHandle();
    let calls = 0;
    const page = makePage({
      $: vi.fn(async (sel: string) => {
        calls += 1;
        // First few lookups hit consent; later lookups see the feed.
        if (calls <= 2 && sel.includes("Accept all")) return consentHandle;
        if (calls > 2 && sel.includes('role="feed"')) return makeHandle();
        return null;
      }),
    });
    const sleep = vi.fn(async () => undefined);
    const log = vi.fn();

    await expect(
      waitForMapsResultsReady(page, { timeoutMs: 5000, sleep, log })
    ).resolves.toBe("feed");
    expect(consentHandle.click).toHaveBeenCalled();
  });

  it("accepts cards-only readiness (no role=feed)", async () => {
    const page = makePage({
      $: vi.fn(async (sel: string) =>
        sel === "a.hfpxzc" ? makeHandle() : null
      ),
    });
    const sleep = vi.fn(async () => undefined);

    await expect(
      waitForMapsResultsReady(page, { timeoutMs: 2000, sleep })
    ).resolves.toBe("cards");
  });

  it("throws with diagnostics when nothing becomes ready", async () => {
    const page = makePage({
      url: vi.fn(() => "https://consent.google.com/"),
      title: vi.fn(async () => "Before you continue"),
      $: vi.fn(async () => null),
      evaluate: vi.fn(async () => ({
        readyState: "complete",
        bodySnippet: "Before you continue to Google",
      })),
    });
    const sleep = vi.fn(async () => undefined);
    const log = vi.fn();

    await expect(
      waitForMapsResultsReady(page, { timeoutMs: 100, sleep, log })
    ).rejects.toThrow(/results UI not ready/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("timeout after"));
  });
});

describe("collectMapsPageDiagnostics / formatMapsPageDiagnostics", () => {
  it("formats a non-secret page snapshot", async () => {
    const page = makePage({
      url: vi.fn(() => "https://www.google.com/maps/search/IT+reseller"),
      title: vi.fn(async () => "IT reseller - Google Maps"),
      $: vi.fn(async () => null),
      evaluate: vi.fn(async () => ({
        readyState: "complete",
        bodySnippet: "No results found",
      })),
    });

    const diag = await collectMapsPageDiagnostics(page);
    const formatted = formatMapsPageDiagnostics(diag);
    expect(formatted).toContain("hasFeed=false");
    expect(formatted).toContain("IT reseller - Google Maps");
    expect(formatted).not.toContain("cookie");
  });
});

describe("regression: feed-only wait fails on cards/consent", () => {
  it("documents why Waiting for selector [role=feed] was insufficient", async () => {
    // Cards visible without role=feed — old worker would time out at 15s.
    const page = makePage({
      $: vi.fn(async (sel: string) =>
        sel === "a.hfpxzc" ? makeHandle() : null
      ),
    });
    const sleep = vi.fn(async () => undefined);

    await expect(
      waitForMapsResultsReady(page, { timeoutMs: 2000, sleep })
    ).resolves.toBe("cards");
  });
});
