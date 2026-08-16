import { TimeoutError, type Page } from "puppeteer";

function isNavigationTimeout(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (!(error instanceof Error)) return false;

  return (
    error.name === "TimeoutError" ||
    /Navigation timeout of \d+ ms exceeded/i.test(error.message)
  );
}

/**
 * Navigate far enough to extract the rendered DOM without requiring every
 * analytics, advertising, or long-polling request to become idle.
 */
export async function navigateForContactExtraction(
  page: Page,
  url: string
): Promise<void> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (error) {
    if (!isNavigationTimeout(error)) {
      throw error;
    }

    let readyState = "unknown";
    try {
      readyState = await page.evaluate(() => document.readyState);
    } catch {
      // Preserve the original timeout when the page context is unusable.
    }

    if (readyState !== "complete") {
      throw error;
    }

    console.warn(
      `ContactDiscovery: Navigation timed out after the document loaded; continuing extraction for ${url}`
    );
  }
}
