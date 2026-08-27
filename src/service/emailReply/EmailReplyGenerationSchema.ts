import { z } from "zod/v4";
import type { EmailMessageClassification } from "@/entityTypes/emailReceiveTypes";

/**
 * Strict structured generation contract (FR-011, technical design §12.2).
 * Local validation is authoritative because OpenAI-compatible providers may
 * ignore response-format hints. Missing, malformed, non-finite, and
 * out-of-range fields FAIL validation instead of being silently coerced, and
 * subject/body length limits are enforced here in application code.
 */

export const GENERATED_REPLY_SCHEMA_VERSION = "gen-schema-v1";

const CLASSIFICATIONS = [
  "interested",
  "not_interested",
  "unsubscribe",
  "bounce",
  "auto_reply",
  "support_request",
  "needs_human_review",
  "unknown",
] as const satisfies readonly EmailMessageClassification[];

export const generatedEmailReplySchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "subject_empty")
    .max(120, "subject_too_long"),
  bodyText: z
    .string()
    .trim()
    .min(1, "body_empty")
    .max(20_000, "body_too_long"),
  intentSuggestion: z.enum(CLASSIFICATIONS),
  confidence: z
    .number()
    .finite("confidence_not_finite")
    .min(0, "confidence_out_of_range")
    .max(1, "confidence_out_of_range"),
  requiresHumanReview: z.boolean().optional(),
  unresolvedQuestions: z.array(z.string().max(500)).max(10).optional(),
  reviewReasons: z.array(z.string().max(500)).max(20).optional(),
});

export type GeneratedEmailReply = z.infer<typeof generatedEmailReplySchema>;

export type StrictParseResult =
  | { readonly ok: true; readonly value: GeneratedEmailReply }
  | { readonly ok: false; readonly codes: readonly string[] };

/** Extract a JSON object from raw LLM output (tolerates fences / stray text). */
export function extractJson(raw: string): string | null {
  const fenced = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return fenced.slice(start, end + 1);
}

/**
 * Strictly validate raw LLM output against {@link generatedEmailReplySchema}.
 * Returns machine-readable failure CODES (never raw prose) so the bounded
 * regeneration prompt can tell the model exactly what to fix.
 */
export function parseStrictGeneratedReply(raw: string): StrictParseResult {
  const json = extractJson(raw);
  if (!json) {
    return { ok: false, codes: ["no_json_object"] };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return { ok: false, codes: ["malformed_json"] };
  }
  const parsed = generatedEmailReplySchema.safeParse(obj);
  if (!parsed.success) {
    const codes = parsed.error.issues
      .map((i) => `${i.path.join(".") || "root"}:${i.message}`)
      .slice(0, 10);
    return { ok: false, codes };
  }
  return { ok: true, value: parsed.data };
}

/** Short correction prompt carrying ONLY validation codes (§12.3). */
export function buildCorrectionPrompt(codes: readonly string[]): string {
  return [
    "Your previous reply failed validation.",
    "Fix exactly these issues and return ONLY a corrected JSON object with the same shape:",
    ...codes.map((c) => `- ${c}`),
  ].join("\n");
}
