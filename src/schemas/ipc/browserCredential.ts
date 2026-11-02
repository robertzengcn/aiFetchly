/**
 * Secure credential card payloads (PRD A-FR-05/06).
 *
 * Renderer-only channel modeled on SKILL_INSTALL_SUBMIT_SECRET: Zod-validated,
 * single-use request id bound to the owner conversation. Values travel
 * straight to encrypted account storage or a one-time in-memory store and
 * never enter chat messages, tool results, transcripts, or logs.
 */
import { z } from "zod";

export const browserCredentialRequestEventSchema = z.strictObject({
  requestId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(64),
  siteDomain: z.string().min(1).max(253),
  mode: z.enum(["login", "register"]),
  prefillUsername: z.string().max(256).nullable(),
});

export const browserCredentialSubmitSchema = z.strictObject({
  requestId: z.string().min(1).max(128),
  /** Owner conversation binding (single-use match, A-FR-06). */
  conversationId: z.string().min(1).max(128),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
  save: z.boolean(),
  cancelled: z.boolean().default(false),
});

export type BrowserCredentialSubmitInput = z.infer<
  ReturnType<typeof browserCredentialSubmitSchema>
>;
