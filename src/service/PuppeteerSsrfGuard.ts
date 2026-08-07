/**
 * PuppeteerSsrfGuard — F3/F7 follow-up: DNS-aware request interception.
 *
 * The original fixes validated the initial navigation URL with
 * UrlGuard.validateWithDns, and the website scraper installed a request
 * interceptor that called the *synchronous* UrlGuard.validate — which blocks
 * bad schemes and IP literals but does NOT resolve DNS. A public URL that
 * redirects (or embeds subresources pointing) to a host resolving to an
 * internal range could therefore still be fetched by the browser.
 *
 * This shared guard makes every outgoing request (main frame, redirect
 * targets, subresources) pass UrlGuard.validateWithDns before it is allowed
 * to continue, aborting anything that resolves to loopback / link-local /
 * RFC1918 / cloud-metadata ranges. Both Puppeteer workers
 * (websiteContentScraper, contact-extraction) use it.
 *
 * Notes:
 *   - The handler is async; Puppeteer holds each intercepted request until
 *     continue()/abort() is called, and DNS lookup is fast (ms), so this is
 *     well within the default interception timeout.
 *   - Fail-closed: if validation itself throws, the request is aborted.
 */
import type { Page, HTTPRequest } from "puppeteer";
import { UrlGuard } from "@/service/UrlGuard";

/** Puppeteer's resource-type union (e.g. "document", "stylesheet"). */
type PuppeteerResourceType = ReturnType<HTTPRequest["resourceType"]>;

export interface SsrfGuardOptions {
  /**
   * Optional resource types to abort purely for performance (e.g. heavy
   * assets the worker does not need). Aborted before the DNS check runs.
   */
  blockResourceTypes?: PuppeteerResourceType[];
}

export async function applySsrfNavigationGuard(
  page: Page,
  options: SsrfGuardOptions = {}
): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", async (req: HTTPRequest) => {
    // Perf optimization: abort unneeded resource types before doing DNS work.
    const blockedTypes = options.blockResourceTypes;
    if (blockedTypes && blockedTypes.includes(req.resourceType())) {
      req.abort("blockedbyclient");
      return;
    }

    let verdict;
    try {
      verdict = await UrlGuard.validateWithDns(req.url());
    } catch {
      // Validation failure (e.g. DNS unreachable) — fail-closed.
      req.abort("accessdenied");
      return;
    }

    if (!verdict.safe) {
      req.abort("accessdenied");
      return;
    }
    req.continue();
  });
}
