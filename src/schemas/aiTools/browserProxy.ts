/**
 * Browser proxy tools (PRD §6.10).
 *
 * `browser_set_proxy` performs a CONTROLLED switch (stop + fresh start under
 * the same account/owner). Selections are validated server-side; the model
 * can never inject host/port/credentials — only a proxy id, "direct", or an
 * auto-selection with a country hint.
 */
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

export const browserProxySelectionSchema = lazySchema(() =>
  z.union([
    z.object({ proxy_id: z.number().int().positive() }),
    z.object({
      auto: z.literal(true),
      country_code: z
        .string()
        .regex(/^[A-Za-z]{2}$/)
        .optional(),
    }),
    z.literal("direct"),
  ])
);

export const browserSetProxyToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string().min(1).max(64),
    proxy: browserProxySelectionSchema(),
  })
);

export type BrowserProxySelectionArgs = z.infer<
  ReturnType<typeof browserSetProxyToolSchema>
>;
