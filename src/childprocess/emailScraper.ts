export {};
import {
  EmailClusterdata,
  EmailResult,
  EmailAiCandidate,
} from "@/entityTypes/emailextraction-type";
import type { EmailAiResponse } from "@/modules/EmailAiEnrichmentHandler";
import { Page, InterceptResolutionAction } from "puppeteer";
import useProxy from "@lem0-packages/puppeteer-page-proxy";
import { convertProxyServertourl } from "@/modules/lib/function";
import {
  scoreCandidate,
  generateContentHash,
  meetsMinimumScore,
} from "@/childprocess/email-ai-enrichment/candidateScorer";

type UtilityParentMessage = {
  data: string;
};

type UtilityParentPort = {
  on: (
    event: "message",
    handler: (event: UtilityParentMessage) => void
  ) => void;
  removeListener: (
    event: "message",
    handler: (event: UtilityParentMessage) => void
  ) => void;
  postMessage: (message: string) => void;
};

const BLOCKED_EMAIL_SEARCH_RESOURCE_TYPES = new Set([
  "stylesheet",
  "font",
  "image",
  "media",
]);

export function shouldBlockEmailSearchResource(resourceType: string): boolean {
  return BLOCKED_EMAIL_SEARCH_RESOURCE_TYPES.has(resourceType);
}

export const extractLink = async (page: Page, val: EmailClusterdata) => {
  const url = val.url;
  if (!url) return;
  const maxPageNumber = val.maxPageNumber ? val.maxPageNumber : 0;

  // Note: proxy interception is set up by crawlSite() before calling extractLink.
  // Do NOT set up proxy interception here to avoid duplicate handlers that cause
  // race conditions and browser crashes.

  console.log(`[extractLink] Navigating to ${url}`);
  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  console.log(`[extractLink] Page loaded successfully: ${url}`);
  const pageTitle = await page.evaluate(() => document.title);

  // Extract all links from the page
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a")).map(
      (anchor) => anchor.href
    );
  });
  console.log(`[extractLink] Found ${links.length} total links on ${url}`);

  // Filter links with page level less than 3
  const filteredLinks = links.filter((link) => {
    try {
      const furl = new URL(link);
      const pathSegments = furl.pathname
        .split("/")
        .filter((segment) => segment.length > 0);
      return (
        pathSegments.length < val.maxPageLevel &&
        furl.hostname.endsWith(val.domain)
      );
    } catch (e) {
      return false;
    }
  });
  console.log(
    `[extractLink] Filtered to ${filteredLinks.length} internal links on ${url}`
  );
  const emails = await page.evaluate(() => {
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/g;
    const bodyText = document.body.innerText;
    return bodyText.match(emailRegex) || [];
  });

  // Collect page content for AI candidate scoring if AI support is enabled
  let pageContent: string | undefined;
  if (val.aiSupportEnabled) {
    pageContent = await page.evaluate(() => document.body.innerText);
  }

  console.log(`[extractLink] Found ${emails.length} emails on ${url}`);
  if (val.callback) {
    if (emails.length > 0) {
      const er: EmailResult = {
        url: url,
        pageTitle: pageTitle,
        filteredLinks: filteredLinks,
        emails: emails,
      };
      val.callback(er);
    }
  }

  return {
    pageTitle,
    filteredLinks,
    emails,
    pageContent,
  };
};

/**
 * Score a page as an AI enrichment candidate and track the best one.
 */
function updateBestCandidate(
  bestCandidate: EmailAiCandidate | undefined,
  url: string,
  pageTitle: string,
  emails: string[],
  pageContent: string | undefined
): EmailAiCandidate | undefined {
  if (!pageContent) return bestCandidate;

  const score = scoreCandidate(url, pageContent, pageTitle, emails);
  if (!meetsMinimumScore(score)) return bestCandidate;

  if (!bestCandidate || score > bestCandidate.score) {
    return {
      url,
      content: pageContent,
      title: pageTitle,
      score,
      contentHash: generateContentHash(pageContent),
    };
  }
  return bestCandidate;
}

export async function crawlSite({
  page,
  data,
}: {
  page: Page;
  data: EmailClusterdata;
}) {
  try {
    if (data.url.length == 0) {
      console.log("[crawlSite] Empty URL, skipping");
      return;
    }
    if (!data.visited) {
      data.visited = new Set();
    }
    if (data.visited.has(data.url)) {
      console.log(`[crawlSite] Already visited ${data.url}, skipping`);
      return;
    }
    data.visited.add(data.url);

    // Check if we've exceeded maxPageNumber
    const maxPageNumber = data.maxPageNumber ?? 0;
    if (maxPageNumber > 0 && data.visited.size > maxPageNumber) {
      console.log(`[crawlSite] Reached maximum page limit of ${maxPageNumber}`);
      return;
    }

    // Set up request interception only ONCE per page (not per recursive call)
    if (
      (data.proxy || data.blockAssets) &&
      !(page as unknown as Record<string, unknown>).__proxyInterceptionSet
    ) {
      console.log(`[crawlSite] Setting up request interception for page`);
      await page.setRequestInterception(true);
      page.on("request", async (interceptedRequest) => {
        if (
          interceptedRequest.interceptResolutionState().action ===
          InterceptResolutionAction.AlreadyHandled
        )
          return;
        if (
          data.blockAssets &&
          shouldBlockEmailSearchResource(interceptedRequest.resourceType())
        ) {
          await interceptedRequest.abort();
          return;
        }
        try {
          if (data.proxy) {
            await useProxy(
              interceptedRequest,
              convertProxyServertourl(data.proxy)
            );
          }
        } catch (proxyErr) {
          console.error("[crawlSite] Proxy request error:", proxyErr);
        }
        if (
          interceptedRequest.interceptResolutionState().action ===
          InterceptResolutionAction.AlreadyHandled
        )
          return;
        interceptedRequest.continue();
      });
      // Mark page so we don't set up interception again on recursive calls
      (page as unknown as Record<string, unknown>).__proxyInterceptionSet =
        true;
    }

    console.log(
      `[crawlSite] Extracting links from ${data.url} (visited: ${data.visited.size})`
    );
    const result = await extractLink(page, {
      url: data.url,
      domain: data.domain,
      maxPageLevel: data.maxPageLevel,
      callback: data.callback,
      aiSupportEnabled: data.aiSupportEnabled,
    });
    console.log(
      `[crawlSite] Extract link result for ${data.url}:`,
      result
        ? `found ${result.emails?.length ?? 0} emails, ${
            result.filteredLinks?.length ?? 0
          } links`
        : "no result"
    );
    if (!result) return;

    console.log(
      `[crawlSite] Page Title: ${result.pageTitle}, URL: ${data.url}`
    );

    // Score this page as an AI candidate
    if (data.aiSupportEnabled && result.pageContent) {
      data.bestCandidate = updateBestCandidate(
        data.bestCandidate,
        data.url,
        result.pageTitle,
        result.emails,
        result.pageContent
      );
    }

    for (const link of result.filteredLinks) {
      data.url = link;
      await crawlSite({ page: page, data: data });
    }

    // After all recursive crawling is done for the root domain, request AI enrichment
    // Only do this once per domain — at the root call when visited size indicates we're back at the start
    if (
      data.aiSupportEnabled &&
      data.bestCandidate &&
      !data.aiEnrichmentRequested
    ) {
      console.log(
        `[crawlSite] Requesting AI enrichment for best candidate: ${data.bestCandidate.url} (score: ${data.bestCandidate.score})`
      );
      data.aiEnrichmentRequested = true;
      await requestAiEnrichmentForBestCandidate(data);

      // After enrichment, send a result with the enrichment data via callback
      // so the main process can save it alongside the domain's email results
      if (data.aiEnrichmentResult && data.callback) {
        console.log(
          `[crawlSite] AI enrichment result status: ${data.aiEnrichmentResult.status}`
        );
        const enrichmentResult: EmailResult = {
          url: data.bestCandidate.url,
          pageTitle: data.bestCandidate.title,
          filteredLinks: [],
          emails: [],
          aiEnrichment: {
            phone: data.aiEnrichmentResult.phone,
            address: data.aiEnrichmentResult.address,
            socialLinks: data.aiEnrichmentResult.socialLinks,
            status: data.aiEnrichmentResult.status,
            error: data.aiEnrichmentResult.error,
            confidence: data.aiEnrichmentResult.confidence,
          },
        };
        data.callback(enrichmentResult);
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[crawlSite] Error crawling ${data.url}: ${errMsg}`);
    // Re-throw so puppeteer-cluster can handle the task failure
    throw error;
  }
}

/**
 * Request AI enrichment for the best scored candidate page.
 * Sends request to main process via parentPort and waits for response.
 */
async function requestAiEnrichmentForBestCandidate(
  data: EmailClusterdata
): Promise<void> {
  const candidate = data.bestCandidate;
  if (!candidate) return;

  try {
    // Dynamic import to avoid issues if process.parentPort is unavailable
    const parentPort = (
      process as NodeJS.Process & {
        parentPort?: UtilityParentPort;
      }
    ).parentPort;
    if (!parentPort) {
      console.warn("No parentPort available for AI enrichment request");
      data.aiEnrichmentResult = {
        status: "skipped",
        error: "No parent process channel available for AI enrichment",
      };
      return;
    }

    const requestId = `email-ai-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)}`;
    const request = {
      type: "EMAIL_AI_ENRICHMENT_REQUEST",
      requestId,
      url: candidate.url,
      pageContent: candidate.content,
      pageTitle: candidate.title,
    };

    // Store the pending response handler
    const responsePromise = new Promise<EmailAiResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("AI enrichment request timed out"));
      }, 60_000);

      const handler = (e: UtilityParentMessage) => {
        try {
          const msg = JSON.parse(e.data) as Partial<EmailAiResponse>;
          if (
            msg.type === "EMAIL_AI_ENRICHMENT_RESPONSE" &&
            msg.requestId === requestId
          ) {
            clearTimeout(timeout);
            parentPort.removeListener("message", handler);
            resolve(msg as EmailAiResponse);
          }
        } catch {
          return;
        }
      };
      parentPort.on("message", handler);
    });

    parentPort.postMessage(JSON.stringify(request));
    console.log(
      `[Email AI] Sent enrichment request for ${candidate.url} (score: ${candidate.score})`
    );

    const response = await responsePromise;
    if (response.success) {
      // Store enrichment data on the cluster data for the callback to use
      data.aiEnrichmentResult = {
        phone: response.phone,
        address: response.address,
        socialLinks: response.socialLinks,
        status: "completed" as const,
        confidence: response.confidence,
      };
      console.log(`[Email AI] Enrichment successful for ${candidate.url}`);
    } else {
      console.warn(`[Email AI] Enrichment failed: ${response.errorMessage}`);
      data.aiEnrichmentResult = {
        status: "failed" as const,
        error: response.errorMessage || "AI enrichment failed",
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    data.aiEnrichmentResult = {
      status: "failed",
      error: message,
    };
    console.error(`[Email AI] Enrichment error: ${message}`);
  }
}
