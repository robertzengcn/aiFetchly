import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import {
  AI_CONTENT_REPORT_CATEGORIES,
  AI_CONTENT_TYPES,
  AI_OUTPUT_SURFACES,
  AI_CONVERSATION_REPORT_SCOPES,
  AI_CONVERSATION_REPORT_SURFACES,
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

// ---------------------------------------------------------------------------
// Conversation reporting (schema version 2) — design §12.
// Kept in the same file so the union can reference both v1 and v2 inner
// strict objects without crossing module boundaries or re-invoking a
// lazy factory while constructing another schema (design §12 note).
// ---------------------------------------------------------------------------

const MAX_V2_ITEM_TEXT = 8_000;
const MAX_V2_IMAGES_PER_ITEM = 3;
const MAX_V2_AGGREGATE_TEXT = 32_000;
const MAX_V2_ITEMS = 20;
const MAX_V2_AI_ITEMS = 10;
const MAX_V2_USER_ITEMS = 10;
const MAX_V2_TOTAL_IMAGES = 3;

const conversationSurfaceSchema = z.enum(AI_CONVERSATION_REPORT_SURFACES);
const conversationScopeSchema = z.enum(AI_CONVERSATION_REPORT_SCOPES);

const v2ItemSchema = z.strictObject({
  itemId: z.string().min(1).max(MAX_SHORT_ID),
  messageId: z.string().min(1).max(MAX_SHORT_ID),
  sequence: z.number().int().nonnegative(),
  role: z.enum(["assistant", "user"]),
  contentType: contentTypeSchema,
  text: z.string().max(MAX_V2_ITEM_TEXT).optional(),
  textTruncated: z.boolean().optional(),
  imagePreviews: z
    .array(imagePreviewSchema)
    .max(MAX_V2_IMAGES_PER_ITEM)
    .optional(),
  evidenceUnavailable: z.boolean().optional(),
  generatedAt: z.string().datetime().optional(),
  model: z.string().max(MAX_SHORT_ID).optional(),
  consentSource: z.literal("related_user_context_toggle").optional(),
});

const v2ContextSchema = z.strictObject({
  conversationId: z.string().min(1).max(MAX_SHORT_ID),
  selectedAIItemCount: z.number().int().nonnegative(),
  includedUserItemCount: z.number().int().nonnegative(),
  aggregateTextTruncated: z.boolean().optional(),
  appVersion: z.string().min(1).max(MAX_APP_VERSION),
  platform: z.enum(["win32", "darwin", "linux"]),
  locale: z.string().min(1).max(MAX_LOCALE),
  installId: z.string().max(MAX_SHORT_ID).optional(),
});

/**
 * Inner strict v2 schema (not lazy-wrapped). Defined once so the union can
 * reference the SAME instance as the standalone v2 export — design §12 warns
 * against invoking one lazy factory inside another.
 *
 * superRefine enforces the 13 root rules in design §12.2.
 */
const createAIConversationReportV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    clientReportId: z.string().min(1).max(MAX_SHORT_ID),
    surface: conversationSurfaceSchema,
    reportScope: conversationScopeSchema,
    category: categorySchema,
    comment: z.string().max(MAX_COMMENT_CHARS).optional(),
    items: z.array(v2ItemSchema).min(1).max(MAX_V2_ITEMS),
    context: v2ContextSchema,
  })
  .superRefine((req, ctx) => {
    const items = req.items;
    const aiItems = items.filter((i) => i.role === "assistant");
    const userItems = items.filter((i) => i.role === "user");

    // 2. Assistant count 1..10
    if (aiItems.length < 1 || aiItems.length > MAX_V2_AI_ITEMS) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: `Assistant item count must be 1..${MAX_V2_AI_ITEMS}`,
      });
    }
    // 3. User count 0..10
    if (userItems.length > MAX_V2_USER_ITEMS) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: `User item count must be 0..${MAX_V2_USER_ITEMS}`,
      });
    }
    // 4. Declared counts equal actual counts
    if (req.context.selectedAIItemCount !== aiItems.length) {
      ctx.addIssue({
        code: "custom",
        path: ["context", "selectedAIItemCount"],
        message: "selectedAIItemCount must equal actual assistant item count",
      });
    }
    if (req.context.includedUserItemCount !== userItems.length) {
      ctx.addIssue({
        code: "custom",
        path: ["context", "includedUserItemCount"],
        message: "includedUserItemCount must equal actual user item count",
      });
    }
    // 5. selected_ai_outputs contains no user items
    if (req.reportScope === "selected_ai_outputs" && userItems.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["reportScope"],
        message: "selected_ai_outputs must not contain user items",
      });
    }
    // 6. with_related_user_context contains >=1 consented user item
    if (
      req.reportScope === "selected_ai_outputs_with_related_user_context" &&
      userItems.length < 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reportScope"],
        message:
          "selected_ai_outputs_with_related_user_context requires at least one consented user item",
      });
    }
    // 7. IDs and messageIds unique per role; assistant & related user cannot share messageId
    const assistantMessageIds = new Set(aiItems.map((i) => i.messageId));
    for (const u of userItems) {
      if (assistantMessageIds.has(u.messageId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message:
            "An assistant and a related user item cannot share a messageId",
        });
        break;
      }
    }
    const seenItemIds = new Set<string>();
    for (const it of items) {
      if (seenItemIds.has(it.itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message: "Duplicate itemId",
        });
        break;
      }
      seenItemIds.add(it.itemId);
    }
    // 8. Sequences are exactly 0..items.length-1 in array order
    for (let i = 0; i < items.length; i++) {
      if (items[i].sequence !== i) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "sequence"],
          message: "Sequences must be contiguous 0..n-1 in array order",
        });
        break;
      }
    }
    // 9. Aggregate text length <= 32000
    const aggregateText = items
      .map((i) => i.text ?? "")
      .reduce((a, b) => a + b.length, 0);
    if (aggregateText > MAX_V2_AGGREGATE_TEXT) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Aggregate text length must be at most 32000 characters",
      });
    }
    // 10. Total image previews <= 3
    const totalImages = items.reduce(
      (n, i) => n + (i.imagePreviews?.length ?? 0),
      0
    );
    if (totalImages > MAX_V2_TOTAL_IMAGES) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "At most 3 image previews across all items",
      });
    }
    // 13. If every assistant item has only evidenceUnavailable, comment must be non-empty
    const allAiOnlyUnavailable =
      aiItems.length > 0 &&
      aiItems.every(
        (i) =>
          i.evidenceUnavailable === true &&
          !(typeof i.text === "string" && i.text.length > 0) &&
          !(Array.isArray(i.imagePreviews) && i.imagePreviews.length > 0)
      );
    if (
      allAiOnlyUnavailable &&
      (typeof req.comment !== "string" || req.comment.trim().length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["comment"],
        message:
          "A non-empty comment is required when every assistant item has only evidenceUnavailable",
      });
    }
    // Per-item evidence rule (§12.1): assistant items need >=1 of text/images/evidenceUnavailable;
    // user items must be text-only with consentSource set exactly.
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.role === "assistant") {
        const hasEvidence =
          (typeof it.text === "string" && it.text.length > 0) ||
          (Array.isArray(it.imagePreviews) && it.imagePreviews.length > 0) ||
          it.evidenceUnavailable === true;
        if (!hasEvidence) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i],
            message:
              "Assistant item needs at least one of text, imagePreviews, or evidenceUnavailable",
          });
        }
      } else {
        if (it.contentType !== "text") {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "contentType"],
            message: "User items must use contentType 'text'",
          });
        }
        if (typeof it.text !== "string" || it.text.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "text"],
            message: "User items must contain non-empty text",
          });
        }
        if (Array.isArray(it.imagePreviews) && it.imagePreviews.length > 0) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "imagePreviews"],
            message: "User items must not contain images",
          });
        }
        if (it.model !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "model"],
            message: "User items must not include a model",
          });
        }
        if (it.evidenceUnavailable !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "evidenceUnavailable"],
            message: "User items must not set evidenceUnavailable",
          });
        }
        if (it.consentSource !== "related_user_context_toggle") {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "consentSource"],
            message:
              "User items must set consentSource to 'related_user_context_toggle'",
          });
        }
      }
    }
  });

export const createAIConversationReportSchema = lazySchema(
  () => createAIConversationReportV2Schema
);

/**
 * Union of the two literal-version strict schemas. Used at the IPC + service
 * dispatch boundary. A normal z.union is required (not discriminatedUnion)
 * because both branches use superRefine → ZodEffects, which Zod 3.25's
 * discriminatedUnion rejects (design §12 note). The literal schemaVersion
 * still rejects cross-version payloads; app code narrows with
 * `request.schemaVersion`.
 */
export const createAnyAIContentReportSchema = lazySchema(() =>
  z.union([createAIContentReportSchema(), createAIConversationReportV2Schema])
);

// Capability IPC REQUEST schema (design §13). Validates the renderer→main
// payload. The RESPONSE is validated separately by the api/ schema (Task 6).
export const getAIContentReportCapabilitiesSchema = lazySchema(() =>
  z.strictObject({ schemaVersion: z.literal(1) })
);
