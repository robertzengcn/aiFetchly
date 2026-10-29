/**
 * WS-4 R4.5 — unit tests for the active-browser registry.
 *
 * Verifies the worker can close every in-flight Puppeteer browser on shutdown
 * (SIGTERM/fatal) so `cleanupContactExtractionWorker().kill()` does not orphan
 * them. Uses fake Browser objects (an EventEmitter + a close mock).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Browser } from "puppeteer";
import {
  registerActiveBrowser,
  unregisterActiveBrowser,
  closeAllActiveBrowsers,
  getActiveBrowserCount,
} from "@/childprocess/contact-extraction/activeBrowserRegistry";

function makeFakeBrowser(closeImpl?: () => Promise<void>): Browser {
  const ee = new EventEmitter() as EventEmitter & {
    close: () => Promise<void>;
  };
  ee.close = closeImpl ?? (async () => undefined);
  return ee as unknown as Browser;
}

describe("activeBrowserRegistry (WS-4 R4.5)", () => {
  // The registry is module-level state; reset between tests. closeAll is safe
  // on fakes (allSettled) so leaked browsers from a prior test are cleared.
  beforeEach(async () => {
    await closeAllActiveBrowsers();
  });

  it("tracks registered/unregistered browsers", () => {
    expect(getActiveBrowserCount()).toBe(0);
    const b1 = makeFakeBrowser();
    const b2 = makeFakeBrowser();
    registerActiveBrowser(b1);
    registerActiveBrowser(b2);
    expect(getActiveBrowserCount()).toBe(2);
    unregisterActiveBrowser(b1);
    expect(getActiveBrowserCount()).toBe(1);
    unregisterActiveBrowser(b2);
    expect(getActiveBrowserCount()).toBe(0);
  });

  it("auto-removes a browser that emits 'disconnected'", () => {
    const b = makeFakeBrowser();
    registerActiveBrowser(b);
    expect(getActiveBrowserCount()).toBe(1);
    (b as unknown as EventEmitter).emit("disconnected");
    expect(getActiveBrowserCount()).toBe(0);
    // a second disconnect is a no-op (once handler)
    (b as unknown as EventEmitter).emit("disconnected");
    expect(getActiveBrowserCount()).toBe(0);
  });

  it("closeAllActiveBrowsers closes every tracked browser and clears the set", async () => {
    const close1 = vi.fn().mockResolvedValue(undefined);
    const close2 = vi.fn().mockResolvedValue(undefined);
    registerActiveBrowser(makeFakeBrowser(close1));
    registerActiveBrowser(makeFakeBrowser(close2));

    await closeAllActiveBrowsers();

    expect(close1).toHaveBeenCalledTimes(1);
    expect(close2).toHaveBeenCalledTimes(1);
    expect(getActiveBrowserCount()).toBe(0);
  });

  it("closeAllActiveBrowsers never rejects even if a browser close throws", async () => {
    const failingClose = vi.fn().mockRejectedValue(new Error("boom"));
    const okClose = vi.fn().mockResolvedValue(undefined);
    registerActiveBrowser(makeFakeBrowser(failingClose));
    registerActiveBrowser(makeFakeBrowser(okClose));

    await expect(closeAllActiveBrowsers()).resolves.toBeUndefined();
    // the failing browser did not block the healthy one
    expect(okClose).toHaveBeenCalledTimes(1);
    expect(getActiveBrowserCount()).toBe(0);
  });

  it("closeAllActiveBrowsers is a no-op when nothing is tracked", async () => {
    await expect(closeAllActiveBrowsers()).resolves.toBeUndefined();
    expect(getActiveBrowserCount()).toBe(0);
  });
});
