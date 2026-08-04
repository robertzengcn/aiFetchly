/**
 * Navigation helpers for the Google Maps worker.
 *
 * Google Maps is a heavily-dynamic SPA that keeps several network connections
 * alive indefinitely (websockets, telemetry, polling). Puppeteer's
 * `networkidle2` waitUntil therefore often never resolves within the timeout
 * even though the page has fully loaded — producing a spurious
 * "Navigation timeout of 30000 ms exceeded". These helpers detect that case
 * and recover by inspecting the actual page state instead of failing the run.
 *
 * Mirrors the recovery strategy already used in bingScraper.ts
 * ("Navigation timeout occurred but page appears to be loaded and functional").
 */
import { TimeoutError, type Page } from "puppeteer";

export interface SafeGotoOptions {
  /** Puppeteer navigation timeout in ms. Default 30000. */
  timeout?: number;
  /**
   * waitUntil event. Default "domcontentloaded" — reliable for SPAs because
   * it fires as soon as the DOM is parsed, without waiting for the network
   * to go idle (which never happens on Google Maps).
   */
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  /**
   * Optional selector used to confirm the page is functional after a timeout.
   * If omitted, only `document.readyState === "complete"` is required.
   */
  readySelector?: string;
}

/**
 * Returns true when `err` is a Puppeteer navigation timeout error.
 *
 * Detects via `instanceof`, the `name` property, and the message pattern —
 * belt-and-suspenders so a rebundler/duplicate-class edge case cannot mask it.
 */
export function isNavigationTimeoutError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof Error && err.name === "TimeoutError") return true;
  if (
    err instanceof Error &&
    /Navigation timeout of \d+ ms exceeded/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

/**
 * Navigate to `url`, recovering gracefully when the navigation's `waitUntil`
 * event never fires (common for Google Maps).
 *
 * On a timeout, inspects `document.readyState` (and optionally `readySelector`);
 * if the page is actually loaded, the timeout is treated as spurious and the
 * function resolves. Otherwise the original timeout error is propagated.
 */
export async function safeGoto(
  page: Page,
  url: string,
  opts: SafeGotoOptions = {}
): Promise<void> {
  const { timeout = 30000, waitUntil = "domcontentloaded", readySelector } =
    opts;

  try {
    await page.goto(url, { waitUntil, timeout });
  } catch (err) {
    if (!isNavigationTimeoutError(err)) {
      throw err;
    }

    // Inspect actual page state — the timeout is often spurious for Google Maps.
    let readyState = "unknown";
    try {
      readyState = await page.evaluate(() => document.readyState);
    } catch {
      /* page/context may be unusable — leave readyState as "unknown" */
    }

    let selectorPresent = !readySelector; // no selector requirement → treat as pass
    if (readySelector) {
      try {
        selectorPresent = (await page.$(readySelector)) !== null;
      } catch {
        selectorPresent = false;
      }
    }

    const pageLoaded = readyState === "complete";
    if (!(pageLoaded && selectorPresent)) {
      // Page genuinely not loaded — propagate the original timeout error.
      throw err;
    }
  }
}
