import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Website Content Scraper Worker inbound contract (WS-4 R4.6 Zod migration).
 * Replaces the bare JSON.parse + `as ScrapeWebsiteMessage` cast. Now validated
 * via parseWorkerMessage (malformed → dropped with SCRAPE_ERROR, never crash).
 */
export const websiteContentScraperInboundSchema = lazySchema(() =>
  z.object({
    type: z.literal("SCRAPE_WEBSITE"),
    requestId: z.string().min(1, "requestId is required"),
    url: z.string().url("url must be a valid URL"),
  })
);

export type WebsiteContentScraperInbound = z.infer<
  ReturnType<typeof websiteContentScraperInboundSchema>
>;
