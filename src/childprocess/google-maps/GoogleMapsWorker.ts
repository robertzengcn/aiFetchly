/**
 * Google Maps Worker — Puppeteer-based child process scraper.
 *
 * Scrapes Google Maps for local business data. Runs in a child process
 * spawned by GoogleMapsModule. Never accesses the database directly.
 *
 * Communication:
 * - Receives: { type: 'start', ... } | { type: 'cancel', requestId }
 * - Sends:    { type: 'progress', ... } | { type: 'result', ... }
 */

import { launch, type Browser, type Page } from "puppeteer";
import type {
  GoogleMapsSearchResult,
  GoogleMapsBusinessResult,
  GoogleMapsProgressStatus,
} from "@/entityTypes/googleMapsTypes";

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
  cookies?: unknown[];
}

interface CancelMessage {
  type: "cancel";
  requestId: string;
}

type WorkerMessage = StartMessage | CancelMessage;

interface ProgressMessage {
  type: "progress";
  requestId: string;
  status: GoogleMapsProgressStatus;
  current: number;
  total: number;
  message: string;
}

interface ResultMessage {
  type: "result";
  requestId: string;
  success: boolean;
  data?: GoogleMapsSearchResult;
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
  status: GoogleMapsProgressStatus,
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

/** Apply cookies to the page before navigation (same pattern as YellowPagesScraper). */
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
      console.error(`Failed to set cookie:`, err);
    }
  }
  console.log(`Applied ${cookies.length} cookies`);
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

/** Parse a number from a string (e.g. "4.5 stars" → 4.5, "123 reviews" → 123). */
function parseNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.match(/[\d,.]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0].replace(/,/g, ""));
  return isNaN(num) ? undefined : num;
}

/** Deduplicate results by place_id or name+address. */
function deduplicate(
  results: GoogleMapsBusinessResult[]
): GoogleMapsBusinessResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.place_id ?? `${r.name}|${r.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main scraping logic
// ---------------------------------------------------------------------------

async function scrapeGoogleMaps(msg: StartMessage): Promise<void> {
  const { requestId, query, location, maxResults, showBrowser } = msg;
  isCancelled = false;

  try {
    // Launch browser
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

    // Apply cookies if provided (from a logged-in Google account)
    if (msg.cookies && msg.cookies.length > 0) {
      await applyCookies(page, msg.cookies);
    }

    // Navigate to Google Maps search
    sendProgress(requestId, "loading", 0, maxResults, "Loading Google Maps...");
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(
      query
    )}+${encodeURIComponent(location)}`;
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for results feed to load
    sendProgress(requestId, "loading", 0, maxResults, "Waiting for results...");

    try {
      await page.waitForSelector('[role="feed"]', { timeout: 15000 });
    } catch {
      // Try dismissing consent dialog if present
      const consentBtn = await page.$(
        'button[aria-label*="Accept"], button[aria-label*="agree"], form[action*="consent"] button'
      );
      if (consentBtn) {
        await consentBtn.click();
        await consentBtn.dispose();
        await sleep(2000);
        await page.waitForSelector('[role="feed"]', { timeout: 15000 });
      } else {
        throw new Error(
          "Google Maps results feed not found. The page structure may have changed."
        );
      }
    }

    // Scroll to load more results
    sendProgress(
      requestId,
      "extracting",
      0,
      maxResults,
      "Loading result cards..."
    );

    const collectedCards: GoogleMapsBusinessResult[] = [];
    let noNewCardsCount = 0;
    const maxNoNewCards = 3;
    let previousCardCount = 0;
    const scrollStartTime = Date.now();
    const maxScrollTimeMs = 60_000; // Hard timeout: 60s max for scrolling

    console.log(
      `[DEBUG] Starting scroll loop — maxResults=${maxResults}, maxNoNewCards=${maxNoNewCards}, maxScrollTime=${maxScrollTimeMs}ms`
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

      // Get current card elements on the page
      const cardCount = await page.evaluate(() => {
        const cards = document.querySelectorAll(
          'div[role="feed"] > div > div[jsaction]'
        );
        return cards.length;
      });

      const elapsed = Date.now() - scrollStartTime;
      console.log(
        `[DEBUG] Scroll loop — cardCount=${cardCount}, previousCardCount=${previousCardCount}, noNewCardsCount=${noNewCardsCount}, elapsed=${elapsed}ms`
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

      // Scroll the feed container to load more
      await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) {
          feed.scrollTop = feed.scrollHeight;
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
      `[DEBUG] Scroll loop ended — reason: ${scrollExitReason}, total cards on page: ${previousCardCount}`
    );

    // Get all card elements — capture fresh handles after scrolling is done
    const cardHandles = await page.$$('div[role="feed"] > div > div[jsaction]');
    const limit = Math.min(cardHandles.length, maxResults);
    console.log(
      `[DEBUG] cardHandles.length=${cardHandles.length}, limit=${limit}`
    );

    // Now extract data from each card by clicking into detail view
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
        const freshCards = await page.$$(
          'div[role="feed"] > div > div[jsaction]'
        );
        console.log(`[DEBUG] Fresh card handles on page: ${freshCards.length}`);

        if (i >= freshCards.length) {
          console.log(
            `[DEBUG] Card index ${i} out of range (only ${freshCards.length} cards). Re-navigating to search URL.`
          );
          await page.goto(searchUrl, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
          await page
            .waitForSelector('[role="feed"]', { timeout: 15000 })
            .catch(() => {
              console.log(`[DEBUG] Feed not found after re-navigate`);
            });
          // Scroll down to where we were
          for (let s = 0; s < Math.ceil((i + 1) / 10); s++) {
            await page.evaluate(() => {
              const feed = document.querySelector('[role="feed"]');
              if (feed) feed.scrollTop = feed.scrollHeight;
            });
            await sleep(1000);
          }
          const retryCards = await page.$$(
            'div[role="feed"] > div > div[jsaction]'
          );
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

        // Wait for detail panel
        try {
          await page.waitForSelector('h1[class*="fontHeadline"]', {
            timeout: 10000,
          });
          console.log(`[DEBUG] Detail panel h1.fontHeadline found`);
        } catch {
          // Fallback: wait for any h1
          console.log(
            `[DEBUG] h1.fontHeadline not found, trying fallback h1...`
          );
          await page.waitForSelector("h1", { timeout: 5000 });
          console.log(`[DEBUG] Fallback h1 found`);
        }

        await randomDelay(500, 1000);

        // Extract business data
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

        // Wait for feed again
        await page
          .waitForSelector('[role="feed"]', { timeout: 10000 })
          .catch(() => {
            console.log(`[DEBUG] Feed did not re-appear after goBack`);
          });
        console.log(
          `[DEBUG] Back on results page, collectedCards so far: ${collectedCards.length}`
        );
      } catch (err) {
        console.error(
          `[DEBUG] Error extracting card ${i + 1}:`,
          err instanceof Error ? err.message : err
        );
        // Continue to next card
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

    // Deduplicate results
    const finalResults = deduplicate(collectedCards);

    // Build summary
    const summary = buildSummary(query, location, finalResults);

    // Send completion
    sendProgress(
      requestId,
      "completed",
      finalResults.length,
      maxResults,
      `Found ${finalResults.length} businesses`
    );

    const result: GoogleMapsSearchResult = {
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
      error: `Google Maps scraping failed: ${errorMessage}`,
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
): Promise<GoogleMapsBusinessResult> {
  const name = await extractText(page, 'h1[class*="fontHeadline"]', "h1");

  const ratingText = await extractAriaLabel(
    page,
    'div[role="img"][aria-label*="star"]',
    'span[role="img"][aria-label*="star"]'
  );
  const rating = ratingText?.match(/[\d.]+/)?.[0];

  const reviewText = await extractAriaLabel(
    page,
    'button[aria-label*="review"]',
    'button[aria-label*="Review"]'
  );
  const reviewCount = parseNumber(reviewText);

  const category = await extractText(
    page,
    'button[jsaction*="category"]',
    'button[data-hovercard-id*="category"]',
    "div.YrPBMc" // fallback class
  );

  const addressAria = await extractAriaLabel(
    page,
    'button[data-item-id*="address"]'
  );
  const addressText = await extractText(
    page,
    'button[data-item-id*="address"]'
  );
  const address = addressAria ?? addressText;

  const phoneAria = await extractAriaLabel(
    page,
    'button[data-item-id*="phone"]'
  );
  const phoneText = await extractText(page, 'button[data-item-id*="phone"]');
  const phone = phoneAria ?? phoneText;

  let website: string | undefined;
  try {
    const websiteEl = await page.$('a[data-item-id*="authority"]');
    if (websiteEl) {
      website = await websiteEl.evaluate(
        (e) => e.getAttribute("href") ?? undefined
      );
      await websiteEl.dispose();
    }
  } catch {
    website = undefined;
  }

  const hoursText = await extractAriaLabel(
    page,
    'div[aria-label*="Hours"]',
    'div[aria-label*="hours"]'
  );
  const hours = hoursText;

  const mapsUrl = page.url();

  // Extract place_id from URL
  let placeId: string | undefined;
  const cidMatch = mapsUrl.match(/0x[a-f0-9]+:0x[a-f0-9]+/i);
  if (cidMatch) {
    placeId = cidMatch[0];
  }

  // Extract coordinates from URL
  let latitude: number | undefined;
  let longitude: number | undefined;
  const coordMatch = mapsUrl.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/);
  if (coordMatch) {
    latitude = parseFloat(coordMatch[1]);
    longitude = parseFloat(coordMatch[2]);
    if (isNaN(latitude)) latitude = undefined;
    if (isNaN(longitude)) longitude = undefined;
  }

  return {
    name: name ?? "",
    rating,
    review_count: reviewCount,
    category,
    address,
    phone,
    website,
    maps_url: mapsUrl,
    place_id: placeId,
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
  results: GoogleMapsBusinessResult[]
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

  return header + lines.join("\n") + footer;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

process.on("message", (msg: WorkerMessage) => {
  if (msg.type === "start") {
    scrapeGoogleMaps(msg).catch((err) => {
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
    send({
      type: "result",
      requestId: msg.requestId,
      success: false,
      error: "Search cancelled by user",
    });
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
