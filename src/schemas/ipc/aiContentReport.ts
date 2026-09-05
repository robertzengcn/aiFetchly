import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import {
  AI_CONTENT_REPORT_CATEGORIES,
  AI_CONTENT_TYPES,
  AI_OUTPUT_SURFACES,
} from "@/entityTypes/aiContentReportTypes";

/**
 * Zod schema for the AI-content-report create request.
 *
 * Boundary validation for the `AI_CONTENT_REPORT_CREATE` IPC channel. Enforces
 * every bound in PRD §12 (Shared Data Contract) and §FR-3 (Evidence
 * construction). Mirrors the lazySchema + z.strictObject + superRefine
 * pattern used by `src/schemas/ipc/emailReceive.ts` and `dashboard.ts`.
 *
 * Design notes:
 *  - Enums are imported as `as const` tuples from the entity-types module so
 *    the schema and the TS types can never drift apart.
 *  - `z.strictObject` rejects unknown keys — defense against the renderer
 *    accidentally forwarding prompts, reasoning, attachments, or neighboring
 *    messages (PRD FR-3.4, §14.7).
 *  - Image previews are capped at 3 entries and 1 MiB decoded each; the
 *    decoded-byte check uses `Buffer.byteLength(_, "base64")` so it reflects
 *    real payload size, not base64 string length.
 *  - At-least-one-evidence is a cross-field rule, so superRefine is required.
 */

const MAX_COMMENT_CHARS = 2000;
const MAX_TEXT_CHARS = 32000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MiB decoded
const MAX_SHORT_ID = 128;
const MAX_APP_VERSION = 64;
const MAX_LOCALE = 32;

/** Reuse the `as const` tuples as zod enums. */
const categorySchema = z.enum(AI_CONTENT_REPORT_CATEGORIES);
const contentTypeSchema = z.enum(AI_CONTENT_TYPES);
const surfaceSchema = z.enum(AI_OUTPUT_SURFACES);

const imagePreviewSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/webp", "image/png"]),
  dataBase64: z
    .string()
    .min(1)
    .refine(
      (b64) => Buffer.byteLength(b64, "base64") <= MAX_IMAGE_BYTES,
      "Each image preview must be at most 1 MiB decoded"
    ),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().optional(),
});

const outputSchema = z
  .strictObject({
    text: z.string().max(MAX_TEXT_CHARS).optional(),
    textTruncated: z.boolean().optional(),
    imagePreviews: z.array(imagePreviewSchema).max(MAX_IMAGES).optional(),
    evidenceUnavailable: z.boolean().optional(),
  })
  .superRefine((output, ctx) => {
    const hasText = typeof output.text === "string" && output.text.length > 0;
    const hasImages =
      Array.isArray(output.imagePreviews) && output.imagePreviews.length > 0;
    const hasEvidenceUnavailable = output.evidenceUnavailable === true;
    const hasAnyEvidence = hasText || hasImages || hasEvidenceUnavailable;

    if (!hasAnyEvidence) {
      ctx.addIssue({
        code: "custom",
        path: ["output"],
        message:
          "At least one of output.text, output.imagePreviews, or output.evidenceUnavailable must be present",
      });
    }
    // evidenceUnavailable alone is accepted only when comment is non-empty
    // (PRD §12.2). The comment lives on the root object, not output, so this
    // cross-object rule is enforced at the root superRefine below.
  });

const contextSchema = z.strictObject({
  conversationId: z.string().max(MAX_SHORT_ID).optional(),
  messageId: z.string().max(MAX_SHORT_ID).optional(),
  artifactId: z.string().max(MAX_SHORT_ID).optional(),
  model: z.string().max(MAX_SHORT_ID).optional(),
  generatedAt: z.string().datetime().optional(),
  appVersion: z.string().min(1).max(MAX_APP_VERSION),
  platform: z.enum(["win32", "darwin", "linux"]),
  locale: z.string().min(1).max(MAX_LOCALE),
  installId: z.string().max(MAX_SHORT_ID).optional(),
});

export const createAIContentReportSchema = lazySchema(() =>
  z
    .strictObject({
      schemaVersion: z.literal(1),
      clientReportId: z.string().min(1).max(MAX_SHORT_ID),
      surface: surfaceSchema,
      contentType: contentTypeSchema,
      category: categorySchema,
      comment: z.string().max(MAX_COMMENT_CHARS).optional(),
      output: outputSchema,
      context: contextSchema,
    })
    .superRefine((req, ctx) => {
      // evidenceUnavailable alone requires a non-empty comment (PRD §12.2).
      const onlyEvidenceUnavailable =
        req.output.evidenceUnavailable === true &&
        !(typeof req.output.text === "string" && req.output.text.length > 0) &&
        !(
          Array.isArray(req.output.imagePreviews) &&
          req.output.imagePreviews.length > 0
        );
      if (
        onlyEvidenceUnavailable &&
        (typeof req.comment !== "string" || req.comment.trim().length === 0)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["comment"],
          message:
            "A non-empty comment is required when evidenceUnavailable is the only evidence",
        });
      }
    })
);

export type CreateAIContentReportInput = z.infer<
  ReturnType<typeof createAIContentReportSchema>
>;
