import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Google Maps Worker inbound contract (WS-4 R4.6 Zod migration).
 *
 * Replaces the bare `process.on("message", (msg: WorkerMessage) => ...)` cast.
 * Now validated via parseWorkerMessage — malformed → dropped (never crash).
 * process.send transport (objects, not JSON strings).
 */
export const googleMapsWorkerInboundSchema = lazySchema(() =>
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
      cookies: z.array(z.unknown()).optional(),
      proxies: z.array(z.unknown()).optional(),
    }),
    z.object({
      type: z.literal("cancel"),
      requestId: z.string().min(1, "requestId is required"),
    }),
  ])
);

export type GoogleMapsWorkerInbound = z.infer<
  ReturnType<typeof googleMapsWorkerInboundSchema>
>;
