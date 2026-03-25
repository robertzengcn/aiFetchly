import { Page } from "puppeteer";
import { BasePlatformAdapter } from "@/modules/BasePlatformAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";

export class YellowPagesJpAdapter extends BasePlatformAdapter {
  constructor(config: PlatformConfig) {
    super(config);
  }

  async onPageLoad(page: Page): Promise<void> {
    try {
      const cookieSelectors: string[] = [
        "#onetrust-accept-btn-handler",
        "button[aria-label='Accept']",
        "button[aria-label='同意']",
        ".cookie-accept",
        ".accept-cookies",
      ];

      for (const selector of cookieSelectors) {
        const button = await page.$(selector);
        if (button) {
          await button.click().catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 800));
          break;
        }
      }

      await page
        .waitForFunction(
          () =>
            document.readyState === "complete" &&
            !document.querySelector(".loading, .spinner"),
          { timeout: 8000 }
        )
        .catch(() => undefined);
    } catch (error: unknown) {
      console.warn("YellowPagesJpAdapter.onPageLoad warning:", error);
    }
  }
}
