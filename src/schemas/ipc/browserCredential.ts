/**
 * Secure credential card payloads (PRD A-FR-05/06).
 *
 * Renderer-only channel modeled on SKILL_INSTALL_SUBMIT_SECRET: Zod-validated,
 * single-use request id bound to the owner conversation. Values travel
 * straight to encrypted account storage or a one-time in-memory store and
 * never enter chat messages, tool results, transcripts, or logs.
 */
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

export const browserCredentialRequestEventSchema = lazySchema(() =>
  z.strictObject({
  requestId: z.string().min(1).max(128),
  /** B01: owner conversation — the submit schema requires it (A-FR-06). */
  conversationId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(64),
  /** B01: creation time (epoch ms) — the renderer prunes expired cards. */
  createdAt: z.number().int().positive(),
  siteDomain: z.string().min(1).max(253),
    mode: z.enum(["login", "register"]),
    prefillUsername: z.string().max(256).nullable(),
    /** A-FR-05/N03: a username-only saved account asks for the password. */
    passwordOnly: z.boolean(),
  })
);

export const browserCredentialSubmitSchema = lazySchema(() =>
  z.strictObject({
  requestId: z.string().min(1).max(128),
  /** Owner conversation binding (single-use match, A-FR-06). */
  conversationId: z.string().min(1).max(128),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
    save: z.boolean(),
    cancelled: z.boolean().default(false),
  })
);

export type BrowserCredentialSubmitInput = z.infer<
  ReturnType<typeof browserCredentialSubmitSchema>
>;

/**
 * B02/A-FR-03: saved-account picker card. Usernames and display names are
 * user-visible by design (A-FR-04); no secret rides this channel.
 */
export const accountPickerRequestEventSchema = lazySchema(() =>
  z.strictObject({
    requestId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(64),
    siteDomain: z.string().min(1).max(253),
    candidates: z
      .array(
        z.strictObject({
          id: z.number().int().positive(),
          user: z.string().min(1).max(256),
          name: z.string().max(256),
        })
      )
      .min(1)
      .max(20),
    createdAt: z.number().int().positive(),
  })
);

export const accountPickerSubmitSchema = lazySchema(() =>
  z.strictObject({
    requestId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    /** null = "use another account" → the credential card flow. */
    accountId: z.number().int().positive().nullable(),
    cancelled: z.boolean(),
  })
);

export type AccountPickerSubmitInput = z.infer<
  ReturnType<typeof accountPickerSubmitSchema>
>;

/**
 * B03/S-FR-04: extra-domain confirmation card. The request lists ONLY the
 * domains the session actually visited (main-process ledger); the submit
 * carries the user's chosen subset — no token rides the renderer channel.
 */
export const siteConfirmRequestEventSchema = lazySchema(() =>
  z.strictObject({
    requestId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(64),
    siteId: z.number().int().positive(),
    registrableDomain: z.string().min(1).max(253),
    proposedDomains: z.array(z.string().min(1).max(253)).min(1).max(16),
    createdAt: z.number().int().positive(),
  })
);

export const siteConfirmSubmitSchema = lazySchema(() =>
  z.strictObject({
    requestId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    siteId: z.number().int().positive(),
    domains: z.array(z.string().min(1).max(253)).max(16),
    cancelled: z.boolean(),
  })
);

export type SiteConfirmSubmitInput = z.infer<
  ReturnType<typeof siteConfirmSubmitSchema>
>;
