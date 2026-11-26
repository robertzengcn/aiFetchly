/**
 * browser_sign_in tool schema (PRD A-FR-01).
 *
 * Credential-free BY CONSTRUCTION: no password, field reference, selector,
 * or URL parameter exists. The LLM may pass an account_id (from
 * list_social_accounts) and a username_hint that pre-fills the card.
 */
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

export const browserSignInToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string().min(1).max(64),
    intent: z.enum(["login", "register"]).default("login"),
    account_id: z.number().int().positive().optional(),
    username_hint: z.string().min(1).max(256).optional(),
  })
);
