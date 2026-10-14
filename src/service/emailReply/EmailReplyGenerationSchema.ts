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

/**
 * The closed set of intent classifications (FR-025 single source of truth).
 * The prompt builder, the correction prompt, and the strict Zod enum below all
 * derive from this one constant so the model is never told a different enum than
 * the validator enforces. Exported so prompt/correction text and the schema
 * enum can never drift apart.
 */
export const REPLY_CLASSIFICATIONS = [
  "interested",
  "not_interested",
  "unsubscribe",
  "bounce",
  "auto_reply",
  "support_request",
  "needs_human_review",
  "unknown",
] as const satisfies readonly EmailMessageClassification[];

/**
 * The classification enum as a comma-separated English string, derived from the
 * single source of truth ({@link REPLY_CLASSIFICATIONS}). The system prompt and
 * the correction prompt both embed this exact string so the model is told the
 * same enum the validator enforces (FR-025). Never hand-write the list in prompt
 * text — import this so a future classification value reaches the prompt
 * automatically.
 */
export const REPLY_CLASSIFICATIONS_TEXT = REPLY_CLASSIFICATIONS.join(", ");

/**
 * The canonical JSON shape string the prompt asks the model to emit, derived
 * from the strict schema's required field names (FR-025). Embedding this in BOTH
 * the system prompt and the correction prompt keeps the field-name contract
 * (the `intentSuggestion` vs `classification` mismatch that broke every
 * well-formed reply pre-v2) locked to the schema. `subject`/`bodyText`/
 * `intentSuggestion`/`confidence` are the four required non-optional fields.
 */
export const REPLY_JSON_SHAPE_TEXT =
  '{"subject": string, "bodyText": string, "intentSuggestion": string, "confidence": number}';

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
  intentSuggestion: z.enum(REPLY_CLASSIFICATIONS),
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

/**
 * Bounded regeneration prompt (FR-025, §12.3).
 *
 * Carries the validation CODES plus the ORIGINAL inbound-email context so the
 * model can regenerate a fresh reply from scratch. It does NOT echo the
 * invalid raw model output (that would leak malformed content back into the
 * prompt). It names the correct field `intentSuggestion` explicitly, because
 * the v1 prompt asked for `classification` and every well-formed reply failed
 * the strict schema on the field-name mismatch alone. When a length/truncation
 * code is present, a bounded shortening instruction is appended so the model
 * produces a shorter reply instead of hitting the same token cap.
 */
export interface CorrectionPromptInput {
  /** Original user-message content (inbound email + knowledge + instructions). */
  readonly originalUserContent: string;
  /** Validation codes from the first failed {@link parseStrictGeneratedReply}. */
  readonly codes: readonly string[];
}

/** True when a code indicates the prior output was too long / truncated. */
function isLengthCode(code: string): boolean {
  return /truncat|too_long|length/i.test(code);
}

export function buildCorrectionPrompt(input: CorrectionPromptInput): string {
  const { originalUserContent, codes } = input;
  const needsShortening = codes.some(isLengthCode);
  const lines: string[] = [
    "Your previous reply failed strict validation. Do NOT repeat the invalid reply.",
    "Regenerate a FRESH reply as valid JSON only, with this exact shape:",
    `${REPLY_JSON_SHAPE_TEXT}.`,
    "The classification field is named intentSuggestion (NOT classification).",
    `intentSuggestion must be one of: ${REPLY_CLASSIFICATIONS_TEXT}.`,
    "Fix these validation issues:",
    ...codes.map((c) => `- ${c}`),
  ];
  if (needsShortening) {
    lines.push(
      "Your previous output was too long and was truncated. Produce a SHORTER reply this time: bodyText under 300 words, start with the reply directly, no preamble, no markdown fences."
    );
  }
  lines.push(
    "Original inbound email and instructions follow. Regenerate the reply from this context, not from your failed output:",
    originalUserContent
  );
  return lines.join("\n");
}
