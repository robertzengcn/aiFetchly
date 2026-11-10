import type { Browser } from "puppeteer";

/**
 * WS-4 R4.5 — track Puppeteer browsers opened by this worker process so they
 * can be closed gracefully on shutdown (SIGTERM/SIGINT/fatal) instead of being
 * orphaned by a hard `process.exit`.
 *
 * `BrowserManager.launchWithStealth()` returns a browser without recording it
 * anywhere, and `discoverAndExtractContactInfo` normally closes its own browser
 * in a `finally`. The gap this closes: when the worker is killed mid-job, that
 * `finally` never runs and the browser leaks. Registering every launch here
 * gives the shutdown handlers a single `closeAllActiveBrowsers()` entry point.
 *
 * This module is puppeteer-type-only (no Electron), so it is unit-testable with
 * fake Browser objects.
 */

const activeBrowsers = new Set<Browser>();

/** Register a browser as in-flight. Auto-removes if it disconnects on its own. */
export function registerActiveBrowser(browser: Browser): void {
  activeBrowsers.add(browser);
  browser.once("disconnected", () => {
    activeBrowsers.delete(browser);
  });
}

/** Remove a browser that has been closed normally. */
export function unregisterActiveBrowser(browser: Browser): void {
  activeBrowsers.delete(browser);
}

/** Number of browsers currently tracked (observability/testing). */
export function getActiveBrowserCount(): number {
  return activeBrowsers.size;
}

/**
 * Close every tracked browser. Never throws — a single failing close (e.g.
 * already-crashed browser) must not block the rest. Resolves once all closes
 * have settled.
 */
export async function closeAllActiveBrowsers(): Promise<void> {
  const snapshot = [...activeBrowsers];
  activeBrowsers.clear();
  await Promise.allSettled(snapshot.map((b) => b.close()));
}
