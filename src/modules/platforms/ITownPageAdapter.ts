import { JapaneseYellowPagesAdapter } from "@/modules/platforms/JapaneseYellowPagesAdapter";
import { PlatformConfig } from "@/modules/interface/IPlatformConfig";
import { Dialog, Page } from "puppeteer";

/**
 * Adapter for iTownPage (Japan) yellow pages platform.
 * Extends JapaneseYellowPagesAdapter for common Japanese platform functionality.
 *
 * Platform: https://itp.ne.jp
 */
export class ITownPageAdapter extends JapaneseYellowPagesAdapter {
  private static readonly ITP_NOTICE_CONSENT_AGREE_SELECTOR =
    "div.notice-consent-cts__agree";
  private static readonly dialogHandlerAttachedPages = new WeakSet<Page>();

  constructor(config: PlatformConfig) {
    super(config);
  }

  override async onPageLoad(page: Page): Promise<void> {
    this.attachDialogAutoAcceptOnce(page);
    await super.onPageLoad(page);
    await this.clickItpNoticeConsentAgreeIfPresent(page);
  }

  private attachDialogAutoAcceptOnce(page: Page): void {
    if (ITownPageAdapter.dialogHandlerAttachedPages.has(page)) return;
    ITownPageAdapter.dialogHandlerAttachedPages.add(page);

    page.on("dialog", (dialog: Dialog) => {
      // Fire-and-forget: puppeteer expects sync handler; we accept async side-effects.
      void (async (): Promise<void> => {
        try {
          await dialog.accept();
        } catch (error: unknown) {
          const className = this.constructor.name;
          console.warn(
            `${className}.dialog.accept warning:`,
            error instanceof Error ? error.message : error
          );
        }
      })();
    });
  }

  private async clickItpNoticeConsentAgreeIfPresent(page: Page): Promise<void> {
    try {
      const el = await page.$(
        ITownPageAdapter.ITP_NOTICE_CONSENT_AGREE_SELECTOR
      );
      if (!el) return;

      await el.click();
    } catch (error: unknown) {
      // Best-effort: consent UI may not exist or may be non-clickable.
      const className = this.constructor.name;
      console.warn(
        `${className}.clickItpNoticeConsentAgreeIfPresent warning:`,
        error instanceof Error ? error.message : error
      );
    }
  }
}
