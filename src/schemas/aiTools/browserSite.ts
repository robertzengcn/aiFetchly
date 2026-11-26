/**
 * Browser site registry tool (PRD S-FR-03/04).
 *
 * The model may register a NEW site for its own registrable domain. Domain
 * guardrails are enforced in the main process: HTTPS-only, eTLD+1 identity,
 * dedupe by registrable domain, and no caller-supplied domain lists — extra
 * domains come only from observed login redirects with user confirmation.
 */
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

export const browserSiteUpsertToolSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1).max(200),
    url: z.string().url().max(2048),
  })
);

export const browserSiteUpsertResultSchema = lazySchema(() =>
  z.strictObject({
    site_id: z.number().int().positive(),
    registrable_domain: z.string().min(1).max(253),
    status: z.enum(["unverified", "verified"]),
    created: z.boolean(),
  })
);
