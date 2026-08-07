import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * IPC input schemas for the secure-session metadata + browser-profile import
 * channels (PRD §8.4). All inputs are strict; callers may never supply cookie
 * domains, browser-profile paths, or cookie values — only an account id and an
 * explicit confirmation flag.
 */

/** Session metadata / availability: account id only. */
export const sessionMetadataInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
  })
);

export const browserImportAvailabilityInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
  })
);

/**
 * Start pairing: requires an explicit `confirmed: true` user gesture. The
 * renderer cannot choose domains, a platform, or a browser profile path.
 */
export const browserImportStartPairingInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("id is required"),
    confirmed: z.literal(true),
  })
);

/** Cancel: bound to the one-time requestId returned by start-pairing. */
export const browserImportCancelInputSchema = lazySchema(() =>
  z.strictObject({
    requestId: z.string().min(1, "requestId is required"),
  })
);
