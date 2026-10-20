/**
 * Google Maps results-readiness helpers.
 *
 * Waiting only on `[role="feed"]` is brittle: consent walls, single-place
 * landings, and hydration races where `a.hfpxzc` cards appear before the feed
 * landmark all produce `Waiting for selector [role="feed"] failed`.
 *
 * This module:
 * 1. Dismisses consent dialogs first
 * 2. Waits for any stable ready signal (feed, result cards, or place detail)
 * 3. Returns diagnostics for debug logs / error messages
 */
import type { ElementHandle, Page } from "puppeteer";

export const MAPS_FEED_SELECTORS = [
  '[role="feed"]',
  'div[role="feed"]',
] as const;

/** Canonical place-link anchors in the results side panel. */
export const MAPS_CARD_SELECTORS = ["a.hfpxzc"] as const;

/** Place-detail landings (single result or direct place URL). */
export const MAPS_PLACE_SELECTORS = [
  "h1.DUwDvf",
  'h1[class*="fontHeadline"]',
  'button[data-item-id="address"]',
] as const;

export const MAPS_CONSENT_SELECTORS = [
  'button[aria-label*="Accept all"]',
  'button[aria-label*="Accept"]',
  'button[aria-label*="Agree"]',
  'button[aria-label*="agree"]',
  "button#L2AGLb",
  "button#introAgreeButton",
  'form[action*="consent"] button',
  '[aria-modal="true"] button[jsname]',
] as const;

export type MapsReadyState = "feed" | "cards" | "place";

export interface MapsPageDiagnostics {
  url: string;
  title: string;
  readyState: string;
  hasFeed: boolean;
  hasCards: boolean;
  hasPlace: boolean;
  hasConsent: boolean;
  bodySnippet: string;
}

export interface WaitForMapsResultsReadyOptions {
  /** Total budget for readiness (includes consent dismiss + waits). Default 45000. */
  timeoutMs?: number;
  /** Optional logger (defaults to console.log). */
  log?: (message: string) => void;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

async function anySelectorPresent(
  page: Page,
  selectors: readonly string[]
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const handle = await page.$(selector);
      if (handle) {
        await handle.dispose().catch(() => undefined);
        return true;
      }
    } catch {
      // ignore selector evaluation failures
    }
  }
  return false;
}

async function clickFirstPresent(
  page: Page,
  selectors: readonly string[]
): Promise<string | null> {
  for (const selector of selectors) {
    let handle: ElementHandle<Element> | null = null;
    try {
      handle = await page.$(selector);
      if (!handle) continue;
      await handle.click();
      return selector;
    } catch {
      // try next selector
    } finally {
      if (handle) {
        await handle.dispose().catch(() => undefined);
      }
    }
  }
  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Snapshot page state for debug logs. Never includes cookies or credentials.
 */
export async function collectMapsPageDiagnostics(
  page: Page
): Promise<MapsPageDiagnostics> {
  let url = "";
  let title = "";
  let readyState = "unknown";
  let bodySnippet = "";

  try {
    url = page.url();
  } catch {
    url = "<unavailable>";
  }
  try {
    title = await page.title();
  } catch {
    title = "<unavailable>";
  }
  try {
    const snapshot = await page.evaluate(() => {
      const bodyText = (document.body?.innerText ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
      return {
        readyState: document.readyState,
        bodySnippet: bodyText,
      };
    });
    readyState = snapshot.readyState;
    bodySnippet = snapshot.bodySnippet;
  } catch {
    // page may be mid-navigation
  }

  const [hasFeed, hasCards, hasPlace, hasConsent] = await Promise.all([
    anySelectorPresent(page, MAPS_FEED_SELECTORS),
    anySelectorPresent(page, MAPS_CARD_SELECTORS),
    anySelectorPresent(page, MAPS_PLACE_SELECTORS),
    anySelectorPresent(page, MAPS_CONSENT_SELECTORS),
  ]);

  return {
    url,
    title,
    readyState,
    hasFeed,
    hasCards,
    hasPlace,
    hasConsent,
    bodySnippet,
  };
}

export function formatMapsPageDiagnostics(diag: MapsPageDiagnostics): string {
  return [
    `url=${diag.url}`,
    `title=${JSON.stringify(diag.title)}`,
    `readyState=${diag.readyState}`,
    `hasFeed=${diag.hasFeed}`,
    `hasCards=${diag.hasCards}`,
    `hasPlace=${diag.hasPlace}`,
    `hasConsent=${diag.hasConsent}`,
    `bodySnippet=${JSON.stringify(diag.bodySnippet)}`,
  ].join(" ");
}

/**
 * Detect current Maps UI state without waiting.
 */
export async function detectMapsReadyState(
  page: Page
): Promise<MapsReadyState | null> {
  if (await anySelectorPresent(page, MAPS_FEED_SELECTORS)) return "feed";
  if (await anySelectorPresent(page, MAPS_CARD_SELECTORS)) return "cards";
  if (await anySelectorPresent(page, MAPS_PLACE_SELECTORS)) return "place";
  return null;
}

/**
 * Dismiss a consent / cookie wall when present. Returns the selector clicked,
 * or null when no consent UI was found.
 */
export async function dismissMapsConsentIfPresent(
  page: Page,
  opts: {
    log?: (message: string) => void;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<string | null> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const sleep = opts.sleep ?? defaultSleep;

  const clicked = await clickFirstPresent(page, MAPS_CONSENT_SELECTORS);
  if (clicked) {
    log(`[mapsResultsReady] dismissed consent via ${clicked}`);
    await sleep(1500);
  }
  return clicked;
}

/**
 * Wait until Google Maps shows a scrapable results/place UI.
 *
 * Order:
 * 1. Best-effort consent dismiss
 * 2. Poll for feed / cards / place until timeout
 */
export async function waitForMapsResultsReady(
  page: Page,
  opts: WaitForMapsResultsReadyOptions = {}
): Promise<MapsReadyState> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const log = opts.log ?? ((m: string) => console.log(m));
  const sleep = opts.sleep ?? defaultSleep;
  const startedAt = Date.now();

  await dismissMapsConsentIfPresent(page, { log, sleep });

  // Immediate check after consent
  const immediate = await detectMapsReadyState(page);
  if (immediate) {
    log(`[mapsResultsReady] ready immediately state=${immediate}`);
    return immediate;
  }

  let lastConsentAttemptAt = startedAt;
  while (Date.now() - startedAt < timeoutMs) {
    // Retry consent periodically — some locales show it after first paint.
    if (Date.now() - lastConsentAttemptAt >= 8_000) {
      lastConsentAttemptAt = Date.now();
      await dismissMapsConsentIfPresent(page, { log, sleep });
    }

    const state = await detectMapsReadyState(page);
    if (state) {
      log(
        `[mapsResultsReady] ready state=${state} after ${
          Date.now() - startedAt
        }ms`
      );
      return state;
    }

    await sleep(500);
  }

  const diag = await collectMapsPageDiagnostics(page);
  const detail = formatMapsPageDiagnostics(diag);
  log(`[mapsResultsReady] timeout after ${timeoutMs}ms ${detail}`);
  throw new Error(
    `Google Maps results UI not ready after ${timeoutMs}ms. ${detail}`
  );
}

/**
 * Card selectors used after readiness.
 *
 * Place anchors (`a.hfpxzc`) come first. The results feed also contains
 * `div[jsaction]` wrappers and spacers that have no layout box. Clicking
 * those wrappers throws "Node is either not clickable or not an Element".
 * The jsaction selector is only a fallback when no place link is present.
 */
export const MAPS_RESULT_CARD_SELECTORS = [
  'div[role="feed"] a.hfpxzc',
  "a.hfpxzc",
  'div[role="feed"] > div > div[jsaction]',
] as const;

/**
 * Count visible result cards using the first selector that matches.
 */
export async function countMapsResultCards(page: Page): Promise<number> {
  return page.evaluate(
    (selectors: string[]) => {
      for (const selector of selectors) {
        const count = document.querySelectorAll(selector).length;
        if (count > 0) return count;
      }
      return 0;
    },
    [...MAPS_RESULT_CARD_SELECTORS]
  );
}

/**
 * Return ElementHandles for result cards using the first selector that matches.
 */
export async function queryMapsResultCards(
  page: Page
): Promise<ElementHandle<Element>[]> {
  for (const selector of MAPS_RESULT_CARD_SELECTORS) {
    try {
      const handles = await page.$$(selector);
      if (handles.length > 0) return handles;
    } catch {
      // try next selector
    }
  }
  return [];
}

export async function disposeElementHandles(
  handles: ReadonlyArray<{ dispose: () => Promise<void> }>
): Promise<void> {
  await Promise.all(
    handles.map((handle) => handle.dispose().catch(() => undefined))
  );
}

/**
 * True for the Puppeteer click failures caused by a virtualized Maps feed:
 * the node has no viewport box, or Maps replaced it during scrollIntoView.
 */
export function isStaleMapsCardClickError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("not clickable") ||
    message.includes("detached from document")
  );
}

export interface RevealedMapsResultCard {
  href: string | null;
  found: boolean;
}

/**
 * Scroll the feed so the card at `cardIndex` is laid out near the top of the
 * results panel, and return that card's place URL.
 *
 * This function is passed to `page.evaluate`. It must stay self-contained:
 * Puppeteer stringifies it and runs it in the page, so it cannot read module
 * constants. Selectors are passed in as an argument.
 *
 * Padding is 48px so the card clears the sticky search header inside the feed.
 */
export function revealMapsResultCard(
  cardIndex: number,
  selectors: readonly string[]
): RevealedMapsResultCard {
  let nodes: Element[] = [];
  for (const selector of selectors) {
    const found = Array.from(document.querySelectorAll(selector));
    if (found.length > 0) {
      nodes = found;
      break;
    }
  }

  const card = nodes[cardIndex];
  if (!(card instanceof HTMLElement)) {
    return { href: null, found: false };
  }

  const feed = card.closest('[role="feed"]');
  if (feed instanceof HTMLElement) {
    const rect = card.getBoundingClientRect();
    if (rect.width >= 1 && rect.height >= 1) {
      const feedTop = feed.getBoundingClientRect().top;
      feed.scrollTop += rect.top - feedTop - 48;
    } else {
      feed.scrollTop = Math.max(0, cardIndex * 132);
    }
  }

  const anchor =
    card instanceof HTMLAnchorElement ? card : card.querySelector("a.hfpxzc");
  const href =
    anchor instanceof HTMLAnchorElement && anchor.href.length > 0
      ? anchor.href
      : null;
  return { href, found: true };
}

async function queryMapsResultCardAt(
  page: Page,
  index: number
): Promise<ElementHandle<Element> | null> {
  for (const selector of MAPS_RESULT_CARD_SELECTORS) {
    let handles: ElementHandle<Element>[] = [];
    try {
      handles = await page.$$(selector);
    } catch {
      continue;
    }
    if (handles.length === 0) continue;

    const selected =
      index >= 0 && index < handles.length ? handles[index] : null;
    await Promise.all(
      handles.map((handle) => {
        if (handle === selected) return Promise.resolve();
        return handle.dispose().catch(() => undefined);
      })
    );
    return selected;
  }
  return null;
}

/**
 * Click using the element's current viewport box.
 *
 * `ElementHandle.click()` always calls `scrollIntoViewIfNeeded()` first.
 * On a virtualized Maps feed that scroll destroys the node and Puppeteer
 * then throws "Node is detached from document". A mouse click at an
 * already-visible box does not scroll.
 */
async function clickMapsCardHandle(
  page: Page,
  handle: ElementHandle<Element>
): Promise<void> {
  const readBox =
    "boundingBox" in handle && typeof handle.boundingBox === "function"
      ? handle.boundingBox.bind(handle)
      : null;
  const box = readBox ? await readBox().catch(() => null) : null;
  const viewport =
    typeof page.viewport === "function" ? page.viewport() : null;
  const viewportWidth = viewport?.width ?? 1280;
  const viewportHeight = viewport?.height ?? 800;
  const centerX = box ? box.x + box.width / 2 : 0;
  const centerY = box ? box.y + box.height / 2 : 0;
  const boxIsClickable =
    box !== null &&
    box.width >= 1 &&
    box.height >= 1 &&
    centerX >= 0 &&
    centerY >= 0 &&
    centerX <= viewportWidth &&
    centerY <= viewportHeight;

  if (boxIsClickable && box) {
    const connected = await handle
      .evaluate((element) => element.isConnected)
      .catch((error: unknown) => {
        if (isStaleMapsCardClickError(error)) return false;
        throw error;
      });
    if (!connected) {
      throw new Error("Node is detached from document");
    }
    await page.mouse.click(centerX, centerY);
    return;
  }
  await handle.click();
}

export interface OpenMapsResultCardOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Attempts before opening the place URL directly. Default 3. */
  maxAttempts?: number;
  log?: (message: string) => void;
  /** Open the place URL when the feed node cannot be clicked. */
  goto?: (url: string) => Promise<void>;
}

/**
 * Open one results-list card.
 *
 * The scroll-to-load loop leaves the feed at the bottom, so early cards are
 * outside the viewport and later cards are recycled when Puppeteer scrolls
 * them into view. Scroll the target card into the feed, click a freshly
 * queried node, and if Maps detaches it, open the place URL captured before
 * the click.
 */
export async function openMapsResultCard(
  page: Page,
  index: number,
  options: OpenMapsResultCardOptions = {}
): Promise<"clicked" | "navigated"> {
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 3;
  const log = options.log ?? ((message: string) => console.log(message));
  let stableHref: string | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const revealed = await page.evaluate(
      revealMapsResultCard,
      index,
      [...MAPS_RESULT_CARD_SELECTORS]
    );
    if (!revealed.found) {
      throw new Error(
        `Google Maps result card ${index + 1} is not in the results list`
      );
    }
    if (revealed.href && stableHref === null) {
      stableHref = revealed.href;
    }

    await sleep(attempt === 0 ? 200 : 450);

    const handle = await queryMapsResultCardAt(page, index);
    if (!handle) {
      lastError = new Error(
        `Google Maps result card ${index + 1} disappeared after scroll`
      );
      log(
        `[mapsResultsReady] card ${index + 1} missing after scroll; ` +
          `retry ${attempt + 1}/${maxAttempts}`
      );
      continue;
    }

    try {
      await clickMapsCardHandle(page, handle);
      await handle.dispose().catch(() => undefined);
      return "clicked";
    } catch (error: unknown) {
      await handle.dispose().catch(() => undefined);
      lastError = error;
      if (!isStaleMapsCardClickError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      log(
        `[mapsResultsReady] card ${index + 1} click failed (${message}); ` +
          `retry ${attempt + 1}/${maxAttempts}`
      );
    }
  }

  if (stableHref && options.goto) {
    log(
      `[mapsResultsReady] opening card ${index + 1} via place URL ` +
        `after click failed`
    );
    await options.goto(stableHref);
    return "navigated";
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`Failed to open Google Maps result card ${index + 1}`);
}

/**
 * Scroll the results list (feed preferred, then common side-panel containers).
 */
export async function scrollMapsResultsList(page: Page): Promise<void> {
  await page.evaluate(() => {
    const feed = document.querySelector('[role="feed"]');
    if (feed instanceof HTMLElement) {
      feed.scrollTop = feed.scrollHeight;
      return;
    }
    const panel =
      document.querySelector(".m6QErb[aria-label]") ??
      document.querySelector('div[role="main"]') ??
      document.querySelector(".m6QErb");
    if (panel instanceof HTMLElement) {
      panel.scrollTop = panel.scrollHeight;
      return;
    }
    window.scrollBy(0, window.innerHeight);
  });
}
