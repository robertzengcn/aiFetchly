import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * YellowPages Scraper inbound contract (WS-4 R4.6 Zod migration).
 *
 * The scraper handles only 5 inbound types (START, PAUSE, RESUME,
 * AI_SUPPORT_RESPONSE, EXIT) — the other 13 types in BackgroundProcessMessages
 * are OUTBOUND (worker→main). The START payload (taskData + platformInfo) is
 * large and consumed by the scraper internals; modeled permissively here. The
 * key validation: the discriminator + essential fields (START needs taskData +
 * platformInfo; AI_SUPPORT_RESPONSE needs requestId).
 */
export const yellowPagesScraperInboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("START"),
        taskData: z.unknown(),
        platformInfo: z.unknown(),
      })
      .passthrough(),
    z.object({ type: z.literal("PAUSE") }).passthrough(),
    z.object({ type: z.literal("RESUME") }).passthrough(),
    z
      .object({
        type: z.literal("AI_SUPPORT_RESPONSE"),
        requestId: z.string(),
      })
      .passthrough(),
    z.object({ type: z.literal("EXIT") }).passthrough(),
  ])
);

export type YellowPagesScraperInbound = z.infer<
  ReturnType<typeof yellowPagesScraperInboundSchema>
>;
