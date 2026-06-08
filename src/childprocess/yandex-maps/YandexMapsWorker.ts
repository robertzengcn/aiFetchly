/**
 * Yandex Maps Worker -- Puppeteer-based child process scraper.
 *
 * Scrapes Yandex Maps for local business data. Runs in a child process
 * spawned by YandexMapsModule. Never accesses the database directly.
 *
 * Communication:
 * - Receives: { type: 'start', ... } | { type: 'cancel', requestId }
 * - Sends:    { type: 'progress', ... } | { type: 'result', ... }
 */

import { type Browser, type Page } from "puppeteer";
import useProxy from "@lem0-packages/puppeteer-page-proxy";
import { BrowserManager } from "@/modules/browserManager";
import type {
  YandexMapsSearchResult,
  YandexMapsBusinessResult,
  YandexMapsProgressStatus,
} from "@/entityTypes/yandexMapsTypes";
import type { YellowPagesTaskProxyConfig } from "@/entityTypes/yellowPagesTaskProxyType";

// ---------------------------------------------------------------------------
// Message types (internal)
// ---------------------------------------------------------------------------

interface StartMessage {
  type: "start";
  requestId: string;
  query: string;
  location: string;
  maxResults: number;
  includeWebsite: boolean;
  includeReviews: boolean;
  showBrowser: boolean;
  language?: string;
  region?: string;
  cookies?: unknown[];
  proxies?: YellowPagesTaskProxyConfig[];
}

interface CancelMessage {
  type: "cancel";
  requestId: string;
}

type WorkerMessage = StartMessage | CancelMessage;

interface ProgressMessage {
  type: "progress";
  requestId: string;
  status: YandexMapsProgressStatus;
  current: number;
  total: number;
  message: string;
}

interface ResultMessage {
  type: "result";
  requestId: string;
  success: boolean;
  data?: YandexMapsSearchResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let browser: Browser | null = null;
let isCancelled = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(msg: ProgressMessage | ResultMessage): void {
  if (process.send) {
    process.send(msg);
  }
}

function sendProgress(
  requestId: string,
  status: YandexMapsProgressStatus,
  current: number,
  total: number,
  message: string
): void {
  send({ type: "progress", requestId, status, current, total, message });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

/** Build a proxy URL string from config for useProxy. */
function proxyToUrl(cfg: YellowPagesTaskProxyConfig): string {
  const proto = (cfg.protocol || "http").toLowerCase();
  if (cfg.username && cfg.password) {
    const u = encodeURIComponent(cfg.username);
    const p = encodeURIComponent(cfg.password);
    return `${proto}://${u}:${p}@${cfg.host}:${cfg.port}`;
  }
  return `${proto}://${cfg.host}:${cfg.port}`;
}

/** Apply cookies to the page before navigation. */
async function applyCookies(page: Page, cookies: unknown[]): Promise<void> {
  if (!Array.isArray(cookies) || cookies.length === 0) return;

  for (const raw of cookies) {
    try {
      const cookie = raw as Record<string, unknown>;
      const cookieData = {
        name: String(cookie.name),
        value: String(cookie.value),
        domain: cookie.domain ? String(cookie.domain) : undefined,
        path: (cookie.path as string) || "/",
        expires: cookie.expirationDate
          ? (cookie.expirationDate as number) * 1000
          : undefined,
        httpOnly: (cookie.httpOnly as boolean) || false,
        secure: (cookie.secure as boolean) || false,
        sameSite: cookie.sameSite as "Strict" | "Lax" | "None" | undefined,
      };
      await page.setCookie(cookieData);
    } catch (err) {
      console.error("[YandexMapsWorker] Failed to set cookie:", err);
    }
  }
  console.log(`[YandexMapsWorker] Applied ${cookies.length} cookies`);
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Extract text content from an element matching one of several selectors.
 *  Strips script/style content and validates the result is clean text. */
async function extractText(
  page: Page,
  ...selectors: string[]
): Promise<string | undefined> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.evaluate((e) => {
          // Clone and remove script/style/noscript to avoid extracting JS/HTML content
          const clone = e.cloneNode(true) as HTMLElement;
          for (const child of Array.from(
            clone.querySelectorAll("script, style, noscript, svg")
          )) {
            child.remove();
          }
          return clone.textContent?.trim() ?? "";
        });
        await el.dispose();
        if (text && isCleanText(text)) return text;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Extract an attribute from an element matching one of several selectors. */
async function extractAttribute(
  page: Page,
  attr: string,
  ...selectors: string[]
): Promise<string | undefined> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const value = await el.evaluate(
          (e, a) => e.getAttribute(a) ?? undefined,
          attr
        );
        await el.dispose();
        if (value) return value;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Extract aria-label text from an element matching one of several selectors. */
async function extractAriaLabel(
  page: Page,
  ...selectors: string[]
): Promise<string | undefined> {
  return extractAttribute(page, "aria-label", ...selectors);
}

/** Parse a number from a string (e.g. "4.5 stars" -> 4.5, "123 reviews" -> 123). */
function parseNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.match(/[\d,.]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0].replace(/,/g, ""));
  return isNaN(num) ? undefined : num;
}

/** Validate that extracted text is clean (not raw HTML/JS content). */
function isCleanText(text: string | undefined, maxLength = 500): boolean {
  if (!text || text.length === 0) return false;
  if (text.length > maxLength) return false;
  // Reject text that looks like JavaScript or HTML source
  if (
    text.includes("window.") ||
    text.includes("function(") ||
    text.includes("var ")
  )
    return false;
  if (text.includes("document.") || text.includes("addEventListener"))
    return false;
  if ((text.match(/{/g) ?? []).length > 3) return false;
  return true;
}

/** Deduplicate results by yandex_id or name+address fallback. */
function deduplicate(
  results: YandexMapsBusinessResult[]
): YandexMapsBusinessResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.yandex_id ?? `${r.name}|${r.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Normalize all string fields: trim whitespace. */
function normalizeResult(
  result: YandexMapsBusinessResult
): YandexMapsBusinessResult {
  return {
    name: result.name?.trim() ?? "",
    rating: result.rating?.trim() || undefined,
    review_count: result.review_count,
    category: result.category?.trim() || undefined,
    address: result.address?.trim() || undefined,
    phone: result.phone?.trim() || undefined,
    website: result.website?.trim() || undefined,
    maps_url: result.maps_url?.trim() || undefined,
    yandex_id: result.yandex_id?.trim() || undefined,
    hours: result.hours?.trim() || undefined,
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

// ---------------------------------------------------------------------------
// Detail page content helpers
// ---------------------------------------------------------------------------

/**
 * Expand hidden content on the detail page.
 * Yandex Maps hides phone numbers behind a "Show phone" button.
 */
async function expandHiddenContent(page: Page): Promise<void> {
  const phoneRevealSelectors = [
    'button[class*="phone"]',
    'a[class*="phone"]',
    '[class*="show-phone"]',
    '[class*="phones-view__show"]',
    '[class*="phone-number__show"]',
    '[class*="collapse__button"]',
    'button[class*="expand"]',
  ];

  for (const sel of phoneRevealSelectors) {
    try {
      const buttons = await page.$$(sel);
      for (const btn of buttons) {
        try {
          const text = await btn.evaluate(
            (el) => el.textContent?.trim().toLowerCase() ?? ""
          );
          if (
            text.includes("phone") ||
            text.includes("show") ||
            text.includes("телефон") ||
            text.includes("показать")
          ) {
            await btn.click();
            await sleep(800);
          }
          await btn.dispose();
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// Captcha detection
// ---------------------------------------------------------------------------

/**
 * Check whether the current page is a captcha / bot detection challenge.
 * Returns true if actual CAPTCHA form elements are found on the page.
 */
async function detectCaptcha(page: Page): Promise<boolean> {
  try {
    // Check for visible CAPTCHA DOM elements (iframes, form fields, images)
    const hasCaptchaElement = await page.evaluate(() => {
      // reCAPTCHA / hCaptcha / Yandex SmartCaptcha iframes
      const captchaIframes = document.querySelectorAll(
        'iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="smartcaptcha"]'
      );
      if (captchaIframes.length > 0) return true;

      // Yandex-specific CAPTCHA elements (form fields, images, containers)
      const captchaElements = document.querySelectorAll(
        'div[class*="captcha"], form[action*="captcha"], img[src*="captcha"], input[name*="captcha"], div[id*="captcha"]'
      );
      if (captchaElements.length > 0) return true;

      // Check for "not a robot" / verification text on the page
      const bodyText = document.body?.textContent?.toLowerCase() ?? "";
      if (
        bodyText.includes("confirm that you are not a robot") ||
        bodyText.includes("confirm you're not a robot") ||
        bodyText.includes("verify you are human") ||
        bodyText.includes("are you a robot") ||
        bodyText.includes("are you human") ||
        bodyText.includes("checking your browser") ||
        bodyText.includes("please confirm") ||
        bodyText.includes("smartcaptcha")
      ) {
        return true;
      }

      return false;
    });

    if (hasCaptchaElement) return true;

    // Check page title for CAPTCHA indicators (case-insensitive)
    const title = (await page.title()).toLowerCase();
    if (
      title.includes("captcha") ||
      title.includes("verification") ||
      title.includes("verify you are human") ||
      title.includes("attention") ||
      title.includes("please confirm")
    ) {
      return true;
    }

    // Check URL for captcha redirect
    const url = page.url().toLowerCase();
    if (url.includes("captcha") || url.includes("showcaptcha")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Yandex Maps result selectors (multiple fallback strategies)
// ---------------------------------------------------------------------------

/**
 * Selectors for the search results list container.
 * Ordered by specificity; tried sequentially until one matches.
 */
const RESULT_LIST_SELECTORS = [
  "ul.search-list-view__list",
  "div.search-list-view",
  'ul[class*="search-list"]',
  'div[class*="search-list"]',
];

/**
 * Selectors for individual business card elements within the results list.
 */
const CARD_SELECTORS = [
  "li.search-snippet-view",
  "li[class*='search-snippet']",
  'div[class*="search-business-snippet"]',
];

/**
 * Selectors for the detail panel that opens after clicking a card.
 */
const DETAIL_PANEL_SELECTORS = [
  "div.business-card-view",
  'div[class*="business-card"]',
  'div[class*="business-view"]',
  'div[class*="place-card"]',
];

// ---------------------------------------------------------------------------
// Main scraping logic
// ---------------------------------------------------------------------------

async function scrapeYandexMaps(msg: StartMessage): Promise<void> {
  const { requestId, query, location, maxResults, showBrowser, language } = msg;
  isCancelled = false;

  try {
    // Stage: validating
    sendProgress(
      requestId,
      "validating",
      0,
      maxResults,
      "Validating search parameters..."
    );

    if (!query || !location) {
      send({
        type: "result",
        requestId,
        success: false,
        error: "Query and location are required.",
      });
      return;
    }

    // Stage: launching browser
    sendProgress(requestId, "launching", 0, maxResults, "Launching browser...");
    const browserManager = new BrowserManager();
    browser = await browserManager.launchWithStealth({
      headless: !showBrowser,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Set a realistic user agent
    await page.setUserAgent(browserManager.getRandomUserAgent());

    // ── Yandex-specific anti-detection (mirrors yandexScraper.ts) ──
    // These evaluateOnNewDocument scripts run BEFORE any page JS executes.
    await page.evaluateOnNewDocument(() => {
      // Hide navigator.webdriver
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
        configurable: true,
      });

      // Realistic navigator properties
      Object.defineProperty(navigator, "platform", {
        get: () => "Win32",
      });
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => 8,
        configurable: true,
      });
      Object.defineProperty(navigator, "deviceMemory", {
        get: () => 8,
        configurable: true,
      });
      Object.defineProperty(navigator, "maxTouchPoints", {
        get: () => 0,
        configurable: true,
      });

      // Hide CDP / Puppeteer detection vectors
      const originalHasOwnProperty = Object.prototype.hasOwnProperty;
      Object.prototype.hasOwnProperty = function (prop: string) {
        if (
          prop === "__cdpBindings__" ||
          prop === "__puppeteer_evaluation_script__"
        ) {
          return false;
        }
        return originalHasOwnProperty.call(this, prop);
      };

      // Jitter Date.now to defeat timing-based fingerprinting
      const originalDateNow = Date.now;
      const offset = Math.floor(Math.random() * 3);
      Date.now = function () {
        return originalDateNow() + offset;
      };
    });

    // Simulate a realistic mouse position before page loads
    const startX = Math.floor(Math.random() * 640) + 320;
    const startY = Math.floor(Math.random() * 240) + 240;
    await page.mouse.move(startX, startY, { steps: 5 });

    // Apply cookies if provided (from a logged-in account)
    if (msg.cookies && msg.cookies.length > 0) {
      await applyCookies(page, msg.cookies);
    }

    // Set up proxy rotation via request interception
    const proxies = msg.proxies;
    let currentProxyUrl = "";
    if (proxies && proxies.length > 0) {
      currentProxyUrl = proxyToUrl(proxies[0]);
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        useProxy(request, currentProxyUrl).catch(() => {
          if (!request.isInterceptResolutionHandled()) {
            request.abort();
          }
        });
      });
      console.log(
        `[YandexMapsWorker] Proxy rotation enabled with ${proxies.length} proxy(ies). Initial: ${proxies[0].host}:${proxies[0].port}`
      );
    }

    // Construct search URL based on language preference
    const domain =
      language && language !== "ru"
        ? "https://yandex.com/maps"
        : "https://yandex.ru/maps";
    const searchUrl = `${domain}/?text=${encodeURIComponent(
      query + " " + location
    )}`;

    // Stage: loading
    sendProgress(requestId, "loading", 0, maxResults, "Loading Yandex Maps...");

    // Use domcontentloaded (not networkidle2) to capture the page early,
    // before Yandex's SPA can auto-navigate to a business detail page.
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Wait briefly for the SPA to start rendering, then immediately
    // look for selectors. Do NOT use a long sleep — it gives the SPA
    // time to auto-click into a detail page.
    await sleep(1500);

    // If the page auto-navigated to a detail page, go back to search list.
    const currentUrl = page.url();
    const isOnDetailPage = /\/maps\/org\//.test(currentUrl);
    if (isOnDetailPage) {
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await sleep(1500);
    }

    // Captcha check after initial navigation
    const hasCaptchaOnLoad = await detectCaptcha(page);
    if (hasCaptchaOnLoad) {
      sendProgress(
        requestId,
        "captcha",
        0,
        maxResults,
        "Captcha detected. Cannot continue scraping."
      );
      send({
        type: "result",
        requestId,
        success: false,
        error: "CAPTCHA",
      });
      return;
    }

    // Wait for search results list to appear (try multiple selectors with 15s timeout)
    sendProgress(
      requestId,
      "loading",
      0,
      maxResults,
      "Waiting for search results..."
    );

    let resultListSelector: string | undefined;
    // Combine all selectors and wait for ANY of them at once (faster than sequential)
    const allSearchSelectors = [...RESULT_LIST_SELECTORS, ...CARD_SELECTORS];
    const combinedSelector = allSearchSelectors.join(", ");

    try {
      await page.waitForSelector(combinedSelector, { timeout: 20000 });
      // Figure out which specific selector matched
      for (const sel of RESULT_LIST_SELECTORS) {
        const count = await page.evaluate(
          (s: string) => document.querySelectorAll(s).length,
          sel
        );
        if (count > 0) {
          resultListSelector = sel;
          break;
        }
      }
    } catch {
      throw new Error(
        "Yandex Maps search results not found. The page structure may have changed or no results were returned."
      );
    }

    // Stage: extracting -- scroll to load more results
    sendProgress(
      requestId,
      "extracting",
      0,
      maxResults,
      "Loading result cards..."
    );

    const collectedCards: YandexMapsBusinessResult[] = [];
    let noNewCardsCount = 0;
    const maxNoNewCards = 3;
    let previousCardCount = 0;
    const scrollStartTime = Date.now();
    const maxScrollTimeMs = 60_000; // Hard timeout: 60s max for scrolling

    while (
      previousCardCount < maxResults &&
      noNewCardsCount < maxNoNewCards &&
      Date.now() - scrollStartTime < maxScrollTimeMs
    ) {
      if (isCancelled) {
        sendProgress(
          requestId,
          "cancelled",
          collectedCards.length,
          maxResults,
          "Search cancelled"
        );
        send({
          type: "result",
          requestId,
          success: false,
          error: "Search cancelled by user",
        });
        return;
      }

      // Count current card elements on page
      const cardSelectorStr = CARD_SELECTORS.join(", ");
      const cardCount = await page.evaluate((selector: string) => {
        const cards = document.querySelectorAll(selector);
        return cards.length;
      }, cardSelectorStr);

      const elapsed = Date.now() - scrollStartTime;

      if (cardCount > previousCardCount) {
        noNewCardsCount = 0;
        previousCardCount = cardCount;
      } else {
        noNewCardsCount++;
      }

      // Scroll the results container to load more
      await page.evaluate(() => {
        // Try scrolling the search results panel
        const scrollContainer =
          document.querySelector('div[class*="search-list"]') ??
          document.querySelector('div[class*="scroll"]') ??
          document.querySelector('div[class*="search-business"]') ??
          document.scrollingElement;
        if (scrollContainer) {
          (scrollContainer as Element).scrollTop = (
            scrollContainer as Element
          ).scrollHeight;
        }
      });

      await sleep(1500);
    }

    const scrollExitReason =
      previousCardCount >= maxResults
        ? `reached maxResults (${previousCardCount} >= ${maxResults})`
        : noNewCardsCount >= maxNoNewCards
        ? `no new cards after ${maxNoNewCards} scrolls`
        : `scroll timeout (${Date.now() - scrollStartTime}ms)`;

    // Get all card elements -- capture fresh handles
    const cardHandles = await page.$$(CARD_SELECTORS.join(", "));
    const limit = Math.min(cardHandles.length, maxResults);

    // Extract data from each card by clicking into detail view
    sendProgress(
      requestId,
      "extracting",
      0,
      maxResults,
      `Extracting ${limit} businesses...`
    );

    // Track already-clicked card names to prevent clicking the same card twice
    const clickedNames = new Set<string>();
    let consecutiveSkips = 0;
    const maxConsecutiveSkips = limit + 5; // Safety: stop if we skip too many

    for (let i = 0; i < limit && consecutiveSkips < maxConsecutiveSkips; i++) {
      if (isCancelled) {
        sendProgress(
          requestId,
          "cancelled",
          collectedCards.length,
          maxResults,
          "Search cancelled"
        );
        send({
          type: "result",
          requestId,
          success: false,
          error: "Search cancelled by user",
        });
        return;
      }

      // Stop if we've collected enough unique results
      if (collectedCards.length >= maxResults) break;

      sendProgress(
        requestId,
        "extracting",
        collectedCards.length,
        maxResults,
        `Extracting business ${collectedCards.length + 1} of ${maxResults}...`
      );

      // Rotate proxy for this card (round-robin)
      if (proxies && proxies.length > 0 && i > 0) {
        const rotated = proxies[i % proxies.length];
        currentProxyUrl = proxyToUrl(rotated);
      }

      try {
        // ── For i > 0, always re-navigate to search URL (goBack is unreliable in SPA) ──
        if (i > 0) {
          await page.goto(searchUrl, {
            waitUntil: "networkidle2",
            timeout: 60000,
          });
          await randomDelay(500, 1000);

          // Check captcha after re-navigation
          const captchaAfterReNav = await detectCaptcha(page);
          if (captchaAfterReNav) {
            sendProgress(
              requestId,
              "captcha",
              collectedCards.length,
              maxResults,
              "Captcha detected during re-navigation."
            );
            send({
              type: "result",
              requestId,
              success: false,
              error: "CAPTCHA",
            });
            return;
          }

          // Wait for cards to appear
          await page
            .waitForSelector(CARD_SELECTORS.join(", "), { timeout: 15000 })
            .catch(() => {
              /* cards may already be visible */
            });

          // Scroll down to load more cards -- enough to show cards we haven't clicked yet
          const targetLoaded = Math.min(clickedNames.size + 10, maxResults + 5);
          const scrollIterations = Math.max(Math.ceil(targetLoaded / 5), 3);
          for (let s = 0; s < scrollIterations; s++) {
            await page.evaluate(() => {
              const scrollContainer =
                document.querySelector('div[class*="search-list"]') ??
                document.querySelector('div[class*="scroll"]') ??
                document.querySelector('div[class*="search-business"]') ??
                document.scrollingElement;
              if (scrollContainer) {
                (scrollContainer as Element).scrollTop = (
                  scrollContainer as Element
                ).scrollHeight;
              }
            });
            await sleep(1000);
          }
        }

        // Query all visible card handles
        const freshCards = await page.$$(CARD_SELECTORS.join(", "));

        // ── Find the first card that hasn't been clicked yet ──
        let targetIndex = -1;
        for (let c = 0; c < freshCards.length; c++) {
          try {
            const cardName = await freshCards[c].evaluate((el) => {
              // Try to get the business name from the card
              const nameEl =
                el.querySelector(".search-business-snippet-view__title") ??
                el.querySelector("h2") ??
                el.querySelector("h3") ??
                el.querySelector('[class*="title"]') ??
                el.querySelector('[class*="name"]') ??
                el.querySelector("a.link-overlay") ??
                el.querySelector("a");
              return nameEl?.textContent?.trim().slice(0, 80) ?? "";
            });
            if (cardName && !clickedNames.has(cardName)) {
              targetIndex = c;
              break;
            }
          } catch {
            continue;
          }
        }

        if (targetIndex === -1) {
          // Try scrolling more to load new cards
          for (let s = 0; s < 5; s++) {
            await page.evaluate(() => {
              const scrollContainer =
                document.querySelector('div[class*="search-list"]') ??
                document.querySelector('div[class*="scroll"]') ??
                document.scrollingElement;
              if (scrollContainer) {
                (scrollContainer as Element).scrollTop = (
                  scrollContainer as Element
                ).scrollHeight;
              }
            });
            await sleep(1000);
          }

          const moreCards = await page.$$(CARD_SELECTORS.join(", "));
          for (let c = freshCards.length; c < moreCards.length; c++) {
            try {
              const cardName = await moreCards[c].evaluate((el) => {
                const nameEl =
                  el.querySelector(".search-business-snippet-view__title") ??
                  el.querySelector("h2") ??
                  el.querySelector("h3") ??
                  el.querySelector('[class*="title"]') ??
                  el.querySelector('[class*="name"]') ??
                  el.querySelector("a.link-overlay") ??
                  el.querySelector("a");
                return nameEl?.textContent?.trim().slice(0, 80) ?? "";
              });
              if (cardName && !clickedNames.has(cardName)) {
                targetIndex = c;
                break;
              }
            } catch {
              continue;
            }
          }

          if (targetIndex === -1) {
            break;
          }
        }

        // Click the target card
        const allCards = await page.$$(CARD_SELECTORS.join(", "));
        if (targetIndex >= allCards.length) {
          consecutiveSkips++;
          continue;
        }

        const clickPreview = await allCards[targetIndex].evaluate(
          (el) => el.textContent?.trim().slice(0, 80) ?? ""
        );
        await allCards[targetIndex].click();

        await randomDelay(1000, 2000);

        // Wait for detail panel to appear
        let detailPanelFound = false;
        for (const panelSel of DETAIL_PANEL_SELECTORS) {
          try {
            await page.waitForSelector(panelSel, { timeout: 5000 });
            detailPanelFound = true;
            break;
          } catch {
            continue;
          }
        }

        if (!detailPanelFound) {
          // Fallback: wait for any h1 (business name usually in detail panel)
          try {
            await page.waitForSelector("h1", { timeout: 5000 });
          } catch {
            /* proceed with extraction anyway */
          }
        }

        await randomDelay(500, 1000);

        // Check captcha after clicking into detail
        const captchaAfterClick = await detectCaptcha(page);
        if (captchaAfterClick) {
          sendProgress(
            requestId,
            "captcha",
            collectedCards.length,
            maxResults,
            "Captcha detected after clicking business listing."
          );
          send({
            type: "result",
            requestId,
            success: false,
            error: "CAPTCHA",
          });
          return;
        }

        // ── Expand hidden content (phone numbers behind "Show" buttons) ──
        await expandHiddenContent(page);

        // ── Wait for detail page content to fully render ──
        try {
          await page.waitForFunction(
            () => {
              // Check that the detail page has actual content, not just a container
              const h1 = document.querySelector("h1");
              if (!h1 || !h1.textContent?.trim()) return false;
              // Also check for at least some body content beyond the nav
              const body = document.body;
              return body ? body.textContent.length > 200 : false;
            },
            { timeout: 10000 }
          );
        } catch {
          /* proceed with extraction anyway */
        }

        // Extract business data from detail panel
        const business = await extractBusinessData(page);

        // Mark this card as clicked (even if extraction failed, to avoid re-clicking)
        if (business.name) {
          clickedNames.add(business.name);
          collectedCards.push(business);
          consecutiveSkips = 0; // Reset skip counter on success
        } else {
          // Card had no name -- still mark its preview as clicked to avoid re-clicking
          clickedNames.add(clickPreview);
          consecutiveSkips++;
        }
      } catch (err) {
        console.error(
          "[YandexMapsWorker] Error extracting card:",
          err instanceof Error ? err.message : err
        );
        consecutiveSkips++;
        // Continue to next card -- re-navigate to search URL
        await page
          .goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 })
          .catch(() => {
            /* re-navigation already attempted */
          });
        await sleep(2000);
      }
    }

    // Deduplicate results by yandex_id
    const dedupedResults = deduplicate(collectedCards);

    // Normalize all results (trim whitespace, clean fields)
    const finalResults = dedupedResults.map(normalizeResult);

    // Build summary (preserves Cyrillic text as-is)
    const summary = buildSummary(query, location, finalResults);

    // Send completion
    sendProgress(
      requestId,
      "completed",
      finalResults.length,
      maxResults,
      `Found ${finalResults.length} businesses`
    );

    const result: YandexMapsSearchResult = {
      success: true,
      query,
      location,
      totalResults: finalResults.length,
      summary,
      results: finalResults,
    };

    send({ type: "result", requestId, success: true, data: result });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    send({
      type: "result",
      requestId,
      success: false,
      error: `Yandex Maps scraping failed: ${errorMessage}`,
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        /* browser may already be closed */
      });
      browser = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Business data extraction from detail panel
// ---------------------------------------------------------------------------

async function extractBusinessData(
  page: Page
): Promise<YandexMapsBusinessResult> {
  // Name: try multiple selectors
  const name = await extractText(
    page,
    "h1.card-title-view__title",
    "h1",
    '[class*="business-name"]',
    '[class*="title"]',
    '[class*="place-name"]'
  );

  // Rating: look for star rating elements
  const ratingText = await extractAriaLabel(
    page,
    'div[class*="business-rating-badge-view"]',
    'span[class*="rating"]',
    'div[class*="stars"]',
    '[class*="business-rating"]'
  );
  const rating = ratingText?.match(/[\d.]+/)?.[0];

  // Review count
  const reviewText = await extractText(
    page,
    'span[class*="rating__count"]',
    'button[class*="business-rating"]',
    'a[class*="reviews"]',
    '[class*="review-count"]',
    'span[class*="business-rating"] span:last-child'
  );
  const reviewCount = parseNumber(reviewText);

  // Category / rubric -- try most specific selectors first, validate result
  let category = await extractText(
    page,
    "a.business-categories-view__category",
    '[class*="business-categorie"]',
    'a[class*="rubric"]',
    '[class*="business-category"]',
    '[class*="rubric"]',
    '[class*="category"]'
  );
  // Validate category is clean text (not JS/HTML), limit to 200 chars
  if (!isCleanText(category, 200)) {
    category = undefined;
  }

  // Address
  let address = await extractText(
    page,
    "div.business-contacts-view__address-link",
    '[class*="address"]',
    '[class*="business-address"]',
    'span[class*="address"]'
  );
  // Fallback: try meta[itemprop="address"] content attribute
  if (!address) {
    address = await extractAttribute(
      page,
      "content",
      'meta[itemprop="address"]'
    );
  }

  // Phone
  const phoneText = await extractText(
    page,
    "div.card-phones-view__number",
    '[class*="phone"]',
    'a[href^="tel:"]',
    '[class*="business-phone"]',
    'span[class*="phone"]'
  );
  const phoneHref = await extractAttribute(page, "href", 'a[href^="tel:"]');
  const phone =
    phoneText ?? (phoneHref ? phoneHref.replace("tel:", "") : undefined);

  // Website
  let website: string | undefined;
  try {
    const websiteEl = await page.$(
      'div.business-urls-view__url a[itemprop="url"], ' +
        "div.business-urls-view__url a[href], " +
        'a[class*="website"], a[class*="link__text"], ' +
        'a[href]:not([href^="tel:"]):not([href^="mailto:"]):not([href^="#"])'
    );
    if (websiteEl) {
      const href = await websiteEl.evaluate(
        (e) => e.getAttribute("href") ?? undefined
      );
      await websiteEl.dispose();
      // Only accept external URLs (http/https)
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        website = href;
      }
    }
  } catch {
    website = undefined;
  }

  // Hours / schedule
  const hours = await extractText(
    page,
    "._working-status",
    '[class*="schedule"]',
    '[class*="hours"]',
    '[class*="work-time"]',
    'div[class*="business-status"]'
  );

  const mapsUrl = page.url();

  // Extract yandex_id from URL or data attributes
  let yandexId: string | undefined;
  // Try extracting from URL path (e.g. /org/12345678900/)
  const orgMatch = mapsUrl.match(/\/org\/(\d+)/);
  if (orgMatch) {
    yandexId = orgMatch[1];
  }
  // Fallback: try data attributes
  if (!yandexId) {
    yandexId = await extractAttribute(
      page,
      "data-id",
      '[class*="business-card"]',
      '[class*="place-card"]',
      "[data-id]"
    );
  }

  // Extract coordinates from URL (Yandex uses ll=longitude,latitude)
  let latitude: number | undefined;
  let longitude: number | undefined;
  const llMatch = mapsUrl.match(/ll=(-?[\d.]+),(-?[\d.]+)/);
  if (llMatch) {
    longitude = parseFloat(llMatch[1]);
    latitude = parseFloat(llMatch[2]);
    if (isNaN(latitude)) latitude = undefined;
    if (isNaN(longitude)) longitude = undefined;
  }

  // ── Fallback extraction for missing fields ──
  let finalPhone = phone;
  let finalWebsite = website;
  let finalAddress = address;

  if (!finalPhone || !finalWebsite || !finalAddress) {
    try {
      const fallbackData = await page.evaluate(() => {
        const result: Record<string, string | undefined> = {};

        // Phone: look for tel: links (may have appeared after expand)
        const telLinks = document.querySelectorAll('a[href^="tel:"]');
        if (telLinks.length > 0) {
          result.phone = telLinks[0].textContent?.trim();
        }

        // Website: find first non-Yandex external link in a business context
        const extLinks = document.querySelectorAll('a[href^="http"]');
        for (const link of Array.from(extLinks)) {
          const href = link.getAttribute("href") ?? "";
          const cls =
            (link as HTMLElement).className?.toString()?.toLowerCase() ?? "";
          if (
            !href.includes("yandex.") &&
            !href.includes("ya.ru") &&
            !href.includes("yastatic") &&
            !href.includes("avatars") &&
            !href.includes("api-maps") &&
            (cls.includes("url") ||
              cls.includes("link") ||
              cls.includes("website") ||
              cls.includes("business"))
          ) {
            result.website = href;
            break;
          }
        }
        // Broader website fallback: first non-Yandex external link
        if (!result.website) {
          for (const link of Array.from(extLinks)) {
            const href = link.getAttribute("href") ?? "";
            if (
              !href.includes("yandex.") &&
              !href.includes("ya.ru") &&
              !href.includes("yastatic") &&
              !href.includes("avatars") &&
              !href.includes("api-maps") &&
              !href.includes("passport") &&
              !href.includes("oauth")
            ) {
              result.website = href;
              break;
            }
          }
        }

        // Address from meta tag
        const addrMeta = document.querySelector('meta[itemprop="address"]');
        if (addrMeta)
          result.address = addrMeta.getAttribute("content") ?? undefined;

        return result;
      });

      if (!finalPhone && fallbackData.phone) {
        finalPhone = fallbackData.phone;
      }
      if (!finalWebsite && fallbackData.website) {
        finalWebsite = fallbackData.website;
      }
      if (!finalAddress && fallbackData.address) {
        finalAddress = fallbackData.address;
      }
    } catch {
      /* fallback extraction is best-effort */
    }
  }

  return {
    name: name ?? "",
    rating,
    review_count: reviewCount,
    category,
    address: finalAddress,
    phone: finalPhone,
    website: finalWebsite,
    maps_url: mapsUrl,
    yandex_id: yandexId,
    hours,
    latitude,
    longitude,
  };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(
  query: string,
  location: string,
  results: YandexMapsBusinessResult[]
): string {
  if (results.length === 0) {
    return `No businesses found for "${query}" in "${location}".`;
  }

  const lines = results.slice(0, 10).map((r, i) => {
    const parts = [`${i + 1}. **${r.name}**`];
    if (r.category) parts.push(`(${r.category})`);
    if (r.rating) parts.push(`- Rating: ${r.rating}`);
    if (r.review_count) parts.push(`(${r.review_count} reviews)`);
    if (r.address) parts.push(`- ${r.address}`);
    if (r.phone) parts.push(`- Tel: ${r.phone}`);
    if (r.website) parts.push(`- Website: ${r.website}`);
    return parts.join(" ");
  });

  const header = `Found ${results.length} businesses for "${query}" in "${location}":\n\n`;
  const footer =
    results.length > 10
      ? `\n\n...and ${results.length - 10} more results.`
      : "";

  // Cyrillic text is preserved as-is -- no transliteration
  return header + lines.join("\n") + footer;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

process.on("message", (msg: WorkerMessage) => {
  if (msg.type === "start") {
    scrapeYandexMaps(msg).catch((err: unknown) => {
      send({
        type: "result",
        requestId: msg.requestId,
        success: false,
        error: `Worker crashed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    });
  } else if (msg.type === "cancel") {
    isCancelled = true;
    sendProgress(msg.requestId, "cancelled", 0, 0, "Search cancelled");
    // Close browser and exit immediately to kill the Chrome process tree
    if (browser) {
      browser
        .close()
        .catch((err: unknown) => {
          console.error(
            "[YandexMapsWorker] Error closing browser during cancel:",
            err
          );
        })
        .then(() => process.exit(0));
    } else {
      process.exit(0);
    }
  }
});

// ---------------------------------------------------------------------------
// Cleanup on termination
// ---------------------------------------------------------------------------

process.on("SIGTERM", async () => {
  isCancelled = true;
  if (browser) {
    await browser.close().catch(() => {
      /* best-effort cleanup during shutdown */
    });
  }
  process.exit(0);
});

process.on("exit", () => {
  if (browser) {
    browser.close().catch(() => {
      /* best-effort cleanup during exit */
    });
  }
});
