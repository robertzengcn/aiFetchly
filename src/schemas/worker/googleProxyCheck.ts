import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Google Proxy Check Worker inbound message contract (WS-4 R4.6 Zod migration).
 *
 * Previously the worker did a bare `JSON.parse` + `as CheckGooglePassMessage`
 * cast with no validation — a malformed payload would crash deep inside
 * checkGooglePass. Now validated via `parseWorkerMessage` (malformed → dropped
 * with a CHECK_GOOGLE_PASS_RESULT error reply). `proxy` is modeled on the fields
 * the worker accesses (host, port) + passthrough for the rest.
 */
export const googleProxyCheckWorkerInboundSchema = lazySchema(() =>
  z.object({
    type: z.literal("CHECK_GOOGLE_PASS"),
    requestId: z.string().min(1, "requestId is required"),
    proxy: z
      .object({
        host: z.string(),
        port: z.number(),
      })
      .passthrough(),
    timeout: z.number().optional(),
  })
);

export type GoogleProxyCheckWorkerInbound = z.infer<
  ReturnType<typeof googleProxyCheckWorkerInboundSchema>
>;
