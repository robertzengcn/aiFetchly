import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { browserActionProgramSchema } from "@/schemas/worker/managedBrowser";

/**
 * Managed-browser AI tool input schemas (technical design §15).
 *
 * Tool arguments are UNTRUSTED (model-generated). Every schema is strict and
 * carries the session id + page revision contract:
 *  - `session_id` is required for every tool after `browser_start_session`;
 *  - element references are valid only with the `page_revision` that produced
 *    them (FR-TOOL-002);
 *  - no tool accepts cookie values, filesystem paths, or proxy credentials.
 */

const sessionIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^mb_[A-Za-z0-9_-]+$/, "session_id must be an opaque mb_ token");

/** Navigation targets must be http(s); file:/data:/javascript: are rejected. */
const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "https:" || protocol === "http:";
      } catch {
        return false;
      }
    },
    { message: "url must be an http(s) URL" }
  );

export const browserStartSessionToolSchema = lazySchema(() =>
  z.strictObject({
    account_id: z.number().int().positive(),
    purpose: z.string().min(1).max(300),
    requested_start_url: z.string().url().max(2048).optional(),
  })
);

export const browserGetStatusToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
  })
);

export const browserObserveToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
  })
);

export const browserNavigateToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
    url: httpUrlSchema,
    page_revision: z.number().int().positive().optional(),
  })
);

export const browserRunActionsToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
    page_revision: z.number().int().positive(),
    program: browserActionProgramSchema,
  })
);

export const browserCaptureScreenshotToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
  })
);

export const browserRequestHandoffToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
    reason: z.string().max(64).optional(),
  })
);

export const browserResumeAfterHandoffToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
  })
);

export const browserClearCacheToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
    confirmation_id: z.string().min(8).max(96),
  })
);

export const browserStopSessionToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: sessionIdSchema,
    reason: z.enum(["user_stop", "cancelled"]).optional(),
  })
);

export type BrowserStartSessionToolInput = z.infer<
  ReturnType<typeof browserStartSessionToolSchema>
>;
export type BrowserRunActionsToolInput = z.infer<
  ReturnType<typeof browserRunActionsToolSchema>
>;
