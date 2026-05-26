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

import { launch, type Browser, type Page } from "puppeteer";
import type {
  YandexMapsSearchResult,
  YandexMapsBusinessResult,
  YandexMapsProgressStatus,
} from "@/entityTypes/yandexMapsTypes";

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

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Extract text content from an element matching one of several selectors. */
async function extractText(
  page: Page,
  ...selectors: string[]
): Promise<string | undefined> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.evaluate((e) => e.textContent?.trim() ?? "");
        await el.dispose();
        if (text) return text;
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

      return false;
    });

    if (hasCaptchaElement) return true;

    // Check page title for CAPTCHA indicators (case-insensitive)
    const title = (await page.title()).toLowerCase();
    if (
      title.includes("captcha") ||
      title.includes("verification") ||
      title.includes("verify you are human")
    ) {
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
  'div[class*="search-business-list"]',
  'div[class*="search-list"]',
  "div.search-list",
  'div[class*="business-snippet"]',
];

/**
 * Selectors for individual business card elements within the results list.
 */
const CARD_SELECTORS = [
  'div[class*="search-business-snippet-view"]',
  'a[class*="search-snippet"]',
  'div[class*="business-snippet"]',
  'li[class*="search-snippet"]',
];

/**
 * Selectors for the detail panel that opens after clicking a card.
 */
const DETAIL_PANEL_SELECTORS = [
  'div[class*="business-card"]',
  'div[class*="business-view"]',
  'div[class*="place-card"]',
  'div[class*="sidebar"]',
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
    browser = await launch({
      headless: !showBrowser,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

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

    await page.goto(searchUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

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
    for (const sel of RESULT_LIST_SELECTORS) {
      try {
        await page.waitForSelector(sel, { timeout: 15000 });
        resultListSelector = sel;
        console.log(`[DEBUG] Result list matched selector: ${sel}`);
        break;
      } catch {
        continue;
      }
    }

    if (!resultListSelector) {
      // Try a broader fallback: any container with multiple card-like elements
      try {
        await page.waitForSelector(CARD_SELECTORS.join(", "), {
          timeout: 5000,
        });
        console.log(
          `[DEBUG] No result list container found, but card elements detected directly.`
        );
      } catch {
        throw new Error(
          "Yandex Maps search results not found. The page structure may have changed or no results were returned."
        );
      }
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

    console.log(
      `[DEBUG] Starting scroll loop -- maxResults=${maxResults}, maxNoNewCards=${maxNoNewCards}, maxScrollTime=${maxScrollTimeMs}ms`
    );

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
      console.log(
        `[DEBUG] Scroll loop -- cardCount=${cardCount}, previousCardCount=${previousCardCount}, noNewCardsCount=${noNewCardsCount}, elapsed=${elapsed}ms`
      );

      if (cardCount > previousCardCount) {
        noNewCardsCount = 0;
        previousCardCount = cardCount;
      } else {
        noNewCardsCount++;
        console.log(
          `[DEBUG] No new cards (${noNewCardsCount}/${maxNoNewCards})`
        );
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
    console.log(
      `[DEBUG] Scroll loop ended -- reason: ${scrollExitReason}, total cards on page: ${previousCardCount}`
    );

    // Get all card elements -- capture fresh handles
    const cardHandles = await page.$$(CARD_SELECTORS.join(", "));
    const limit = Math.min(cardHandles.length, maxResults);
    console.log(
      `[DEBUG] cardHandles.length=${cardHandles.length}, limit=${limit}`
    );

    // Extract data from each card by clicking into detail view
    sendProgress(
      requestId,
      "extracting",
      0,
      maxResults,
      `Extracting ${limit} businesses...`
    );

    for (let i = 0; i < limit; i++) {
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

      sendProgress(
        requestId,
        "extracting",
        i,
        maxResults,
        `Extracting business ${i + 1} of ${limit}...`
      );

      console.log(`[DEBUG] === Extracting card ${i + 1}/${limit} ===`);

      try {
        // Re-query fresh card handles each iteration (DOM changes after goBack)
        const freshCards = await page.$$(CARD_SELECTORS.join(", "));
        console.log(`[DEBUG] Fresh card handles on page: ${freshCards.length}`);

        if (i >= freshCards.length) {
          console.log(
            `[DEBUG] Card index ${i} out of range (only ${freshCards.length} cards). Re-navigating to search URL.`
          );
          await page.goto(searchUrl, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });

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

          // Wait for cards to appear again
          await page
            .waitForSelector(CARD_SELECTORS.join(", "), { timeout: 15000 })
            .catch(() => {
              console.log(`[DEBUG] Cards not found after re-navigate`);
            });

          // Scroll down to where we were
          for (let s = 0; s < Math.ceil((i + 1) / 10); s++) {
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

          const retryCards = await page.$$(CARD_SELECTORS.join(", "));
          console.log(
            `[DEBUG] After re-navigate and scroll: ${retryCards.length} cards`
          );
          if (i >= retryCards.length) {
            console.log(`[DEBUG] Still can't find card ${i}. Skipping.`);
            continue;
          }
          await retryCards[i].click();
        } else {
          await freshCards[i].click();
        }

        console.log(
          `[DEBUG] Clicked card ${i + 1}, waiting for detail panel...`
        );
        await randomDelay(1000, 2000);

        // Wait for detail panel to appear
        let detailPanelFound = false;
        for (const panelSel of DETAIL_PANEL_SELECTORS) {
          try {
            await page.waitForSelector(panelSel, { timeout: 5000 });
            console.log(`[DEBUG] Detail panel matched selector: ${panelSel}`);
            detailPanelFound = true;
            break;
          } catch {
            continue;
          }
        }

        if (!detailPanelFound) {
          // Fallback: wait for any h1 (business name usually in detail panel)
          console.log(
            `[DEBUG] No detail panel selector matched, trying fallback h1...`
          );
          try {
            await page.waitForSelector("h1", { timeout: 5000 });
            console.log(`[DEBUG] Fallback h1 found`);
          } catch {
            console.log(
              `[DEBUG] No h1 found either, extracting from current page state.`
            );
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

        // Extract business data from detail panel
        const business = await extractBusinessData(page);
        console.log(
          `[DEBUG] Extracted: name="${business.name}", phone="${
            business.phone ?? "N/A"
          }", website="${business.website ?? "N/A"}"`
        );
        if (business.name) {
          collectedCards.push(business);
        }

        // Go back to results list
        console.log(`[DEBUG] Navigating back to results list...`);
        await page
          .goBack({ waitUntil: "networkidle2", timeout: 10000 })
          .catch(async () => {
            // If goBack fails, re-navigate
            console.log(`[DEBUG] goBack failed, re-navigating to searchUrl`);
            await page.goto(searchUrl, {
              waitUntil: "networkidle2",
              timeout: 30000,
            });
          });
        await randomDelay(800, 1500);

        // Check captcha after going back
        const captchaAfterBack = await detectCaptcha(page);
        if (captchaAfterBack) {
          sendProgress(
            requestId,
            "captcha",
            collectedCards.length,
            maxResults,
            "Captcha detected after navigating back."
          );
          send({
            type: "result",
            requestId,
            success: false,
            error: "CAPTCHA",
          });
          return;
        }

        // Wait for results list to re-appear
        await page
          .waitForSelector(CARD_SELECTORS.join(", "), { timeout: 10000 })
          .catch(() => {
            console.log(`[DEBUG] Cards did not re-appear after goBack`);
          });
        console.log(
          `[DEBUG] Back on results page, collectedCards so far: ${collectedCards.length}`
        );
      } catch (err) {
        console.error(
          `[DEBUG] Error extracting card ${i + 1}:`,
          err instanceof Error ? err.message : err
        );
        // Continue to next card -- re-navigate to search URL
        await page
          .goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 })
          .catch(() => {
            /* re-navigation already attempted */
          });
        await sleep(2000);
      }
    }

    console.log(
      `[DEBUG] Extraction complete. collectedCards=${collectedCards.length}, deduplicating...`
    );

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
    "h1",
    '[class*="business-name"]',
    '[class*="title"]',
    '[class*="place-name"]'
  );
  console.log(`[DEBUG] extractBusinessData name: matched="${name ?? "none"}"`);

  // Rating: look for star rating elements
  const ratingText = await extractAriaLabel(
    page,
    'span[class*="rating"]',
    'div[class*="stars"]',
    '[class*="business-rating"]'
  );
  const rating = ratingText?.match(/[\d.]+/)?.[0];
  console.log(
    `[DEBUG] extractBusinessData rating: raw="${
      ratingText ?? "none"
    }", parsed="${rating ?? "none"}"`
  );

  // Review count
  const reviewText = await extractText(
    page,
    'span[class*="rating__count"]',
    'a[class*="reviews"]',
    '[class*="review-count"]',
    'span[class*="business-rating"] span:last-child'
  );
  const reviewCount = parseNumber(reviewText);
  console.log(
    `[DEBUG] extractBusinessData review_count: raw="${
      reviewText ?? "none"
    }", parsed=${reviewCount ?? "none"}`
  );

  // Category / rubric
  const category = await extractText(
    page,
    '[class*="category"]',
    '[class*="rubric"]',
    '[class*="business-category"]',
    'a[class*="rubric"]'
  );
  console.log(
    `[DEBUG] extractBusinessData category: matched="${category ?? "none"}"`
  );

  // Address
  const address = await extractText(
    page,
    '[class*="address"]',
    '[itemprop="address"]',
    '[class*="business-address"]',
    'span[class*="address"]'
  );
  console.log(
    `[DEBUG] extractBusinessData address: matched="${address ?? "none"}"`
  );

  // Phone
  const phoneText = await extractText(
    page,
    '[class*="phone"]',
    'a[href^="tel:"]',
    '[class*="business-phone"]',
    'span[class*="phone"]'
  );
  const phoneHref = await extractAttribute(page, "href", 'a[href^="tel:"]');
  const phone =
    phoneText ?? (phoneHref ? phoneHref.replace("tel:", "") : undefined);
  console.log(
    `[DEBUG] extractBusinessData phone: matched="${phone ?? "none"}"`
  );

  // Website
  let website: string | undefined;
  try {
    const websiteEl = await page.$(
      'a[class*="website"], a[class*="link__text"], a[href]:not([href^="tel:"]):not([href^="mailto:"]):not([href^="#"])'
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
  console.log(
    `[DEBUG] extractBusinessData website: matched="${website ?? "none"}"`
  );

  // Hours / schedule
  const hours = await extractText(
    page,
    '[class*="schedule"]',
    '[class*="hours"]',
    '[class*="work-time"]',
    'div[class*="business-status"]'
  );
  console.log(
    `[DEBUG] extractBusinessData hours: matched="${hours ?? "none"}"`
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
  console.log(
    `[DEBUG] extractBusinessData yandex_id: matched="${yandexId ?? "none"}"`
  );

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
  console.log(
    `[DEBUG] extractBusinessData coords: lat=${latitude ?? "none"}, lng=${
      longitude ?? "none"
    }`
  );

  return {
    name: name ?? "",
    rating,
    review_count: reviewCount,
    category,
    address,
    phone,
    website,
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
