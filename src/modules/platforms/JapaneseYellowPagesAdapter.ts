import { Page } from "puppeteer";
import { BasePlatformAdapter } from "@/modules/BasePlatformAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";

/**
 * Base adapter for Japanese yellow pages platforms.
 * Provides common functionality for handling Japanese-specific cookie consent
 * and page loading patterns.
 */
export abstract class JapaneseYellowPagesAdapter extends BasePlatformAdapter {
  // Constants for timeouts and delays (in milliseconds)
  protected readonly COOKIE_ACCEPT_DELAY = 800;
  protected readonly PAGE_LOAD_TIMEOUT = 8000;

  // Japanese-specific cookie selectors
  private readonly COOKIE_SELECTORS: string[] = [
    "#onetrust-accept-btn-handler",
    "button[aria-label='Accept']",
    "button[aria-label='同意']", // Japanese "Agree"
    ".cookie-accept",
    ".accept-cookies",
  ];

  // Loading indicators to wait for removal
  private readonly LOADING_SELECTORS = ".loading, .spinner";

  constructor(config: PlatformConfig) {
    super(config);
  }

  /**
   * Handle page load events for Japanese yellow pages platforms.
   * Handles cookie consent dialogs and waits for page to fully load.
   *
   * @param page - The Puppeteer page instance
   */
  async onPageLoad(page: Page): Promise<void> {
    try {
      await this.handleCookieConsent(page);
      await this.waitForPageLoad(page);
    } catch (error: unknown) {
      const className = this.constructor.name;
      console.warn(
        `${className}.onPageLoad warning:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Handle cookie consent dialogs by trying multiple selector patterns.
   * Stops at the first successful cookie acceptance.
   *
   * @param page - The Puppeteer page instance
   * @private
   */
  private async handleCookieConsent(page: Page): Promise<void> {
    for (const selector of this.COOKIE_SELECTORS) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          // Wait for cookie dialog to dismiss
          await new Promise((resolve) =>
            setTimeout(resolve, this.COOKIE_ACCEPT_DELAY)
          );
          break; // Stop after first successful click
        }
      } catch (clickError: unknown) {
        // Silently continue to next selector if click fails
        // This is expected as some selectors may not exist on the page
      }
    }
  }

  /**
   * Wait for the page to fully load and all loading indicators to disappear.
   *
   * @param page - The Puppeteer page instance
   * @private
   */
  private async waitForPageLoad(page: Page): Promise<void> {
    await page
      .waitForFunction(
        () => {
          return (
            document.readyState === "complete" &&
            !document.querySelector(".loading, .spinner")
          );
        },
        { timeout: this.PAGE_LOAD_TIMEOUT }
      )
      .catch(() => {
        // Non-blocking: continue even if wait times out
        // Some pages may not have loading indicators
      });
  }
}
