import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Yandex Maps Worker inbound contract (WS-4 R4.6 Zod migration).
 * Same start|cancel pattern as GoogleMapsWorker. process.send transport.
 */
export const yandexMapsWorkerInboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("start"),
      requestId: z.string().min(1, "requestId is required"),
      query: z.string(),
      location: z.string(),
      maxResults: z.number(),
      includeWebsite: z.boolean(),
      includeReviews: z.boolean(),
      showBrowser: z.boolean(),
      language: z.string().optional(),
      region: z.string().optional(),
      cookies: z.array(z.unknown()).optional(),
      proxies: z.array(z.unknown()).optional(),
    }),
    z.object({
      type: z.literal("cancel"),
      requestId: z.string().min(1, "requestId is required"),
    }),
  ])
);

export type YandexMapsWorkerInbound = z.infer<
  ReturnType<typeof yandexMapsWorkerInboundSchema>
>;
