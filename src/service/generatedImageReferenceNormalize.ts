import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";

/** Stable machine code emitted when a reference list overflows the cap. */
export const GENERATED_IMAGE_REFERENCE_LIMIT_CODE =
  "generated_image_reference_limit";

/** Stable machine code emitted when any reference entry is malformed. */
export const GENERATED_IMAGE_REFERENCE_INVALID_CODE =
  "generated_image_reference_invalid";

interface OkResult {
  readonly ok: true;
  readonly references: ChatV2GeneratedImageReference[];
}

interface NotOkResult {
  readonly ok: false;
  /** Renderer-safe human-readable failure description. */
  readonly reason: string;
  /** Stable machine code for localized rendering, when classified. */
  readonly errorCode?: string;
}

export type NormalizedGeneratedImageReferencesResult = OkResult | NotOkResult;

const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_IMAGE_INDEX = 49;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate opaque generated-image references received from the renderer.
 *
 * Input must be `undefined` (→ ok, empty list) or an array of objects with a
 * trimmed `messageId` string of 1..200 characters and an integer `imageIndex`
 * in 0..49. Duplicate `${messageId}:${imageIndex}` entries are collapsed
 * first-wins; overflow beyond `maxItems` is rejected; ANY malformed entry
 * fails the whole batch (never silently dropped). Only `messageId` and
 * `imageIndex` are copied — fields such as `url`, `localPath`,
 * `conversationId`, or `userEmail` are never accepted into the result.
 */
export function normalizeGeneratedImageReferences(
  input: unknown,
  maxItems: number
): NormalizedGeneratedImageReferencesResult {
  if (input === undefined) {
    return { ok: true, references: [] };
  }
  if (!Array.isArray(input)) {
    return {
      ok: false,
      reason: "generatedImageReferences must be an array",
      errorCode: GENERATED_IMAGE_REFERENCE_INVALID_CODE,
    };
  }

  const seen = new Set<string>();
  const references: ChatV2GeneratedImageReference[] = [];

  for (const item of input) {
    if (!isRecord(item)) {
      return {
        ok: false,
        reason: "generatedImageReferences entries must be objects",
        errorCode: GENERATED_IMAGE_REFERENCE_INVALID_CODE,
      };
    }
    const rawMessageId = item.messageId;
    if (typeof rawMessageId !== "string") {
      return {
        ok: false,
        reason:
          "generatedImageReferences entries require a string messageId",
        errorCode: GENERATED_IMAGE_REFERENCE_INVALID_CODE,
      };
    }
    const messageId = rawMessageId.trim();
    if (messageId.length === 0 || messageId.length > MAX_MESSAGE_ID_LENGTH) {
      return {
        ok: false,
        reason:
          "generatedImageReferences messageId must be 1-200 characters",
        errorCode: GENERATED_IMAGE_REFERENCE_INVALID_CODE,
      };
    }
    const imageIndex = item.imageIndex;
    if (
      typeof imageIndex !== "number" ||
      !Number.isInteger(imageIndex) ||
      imageIndex < 0 ||
      imageIndex > MAX_IMAGE_INDEX
    ) {
      return {
        ok: false,
        reason:
          "generatedImageReferences imageIndex must be an integer between 0 and 49",
        errorCode: GENERATED_IMAGE_REFERENCE_INVALID_CODE,
      };
    }
    const key = `${messageId}:${imageIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ messageId, imageIndex });
  }

  if (references.length > maxItems) {
    return {
      ok: false,
      reason: `Too many generated image references: at most ${maxItems} per request.`,
      errorCode:
        maxItems === 3
          ? GENERATED_IMAGE_REFERENCE_LIMIT_CODE
          : GENERATED_IMAGE_REFERENCE_INVALID_CODE,
    };
  }

  return { ok: true, references };
}
