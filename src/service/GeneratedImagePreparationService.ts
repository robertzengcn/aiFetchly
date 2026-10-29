/**
 * GeneratedImagePreparationService — shared normalization step for images
 * destined for an AI model round.
 *
 * Builds `NormalizeOptions` purely from `CHAT_IMAGE_LIMITS` and delegates to an
 * injected {@link ImageNormalizerPort}. Performs NO file IO and NO
 * authorization — callers pin/read bytes themselves; upstream dimension/pixel
 * ceilings (`MAX_INPUT_DIMENSION`/`MAX_INPUT_PIXELS`) are enforced by the
 * caller against decoded signature metadata where available, otherwise they
 * surface as normalization errors mapped by
 * {@link GeneratedImagePreparationService.errorCodeForNormalizationError}.
 */
import type { ImageNormalizerPort } from "@/service/AIImageAttachmentToolService";
import {
  AIImageNormalizer,
  ImageNormalizationError,
  type NormalizeOptions,
  type NormalizedImage,
} from "@/service/AIImageNormalizer";
import { ElectronNativeImageCodec } from "@/service/ElectronNativeImageCodec";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";
import type { SupportedImageMimeType } from "@/entityTypes/aiImageAttachmentToolTypes";
import type { GeneratedImageReferenceErrorCode } from "@/entityTypes/generatedImageReferenceTypes";

/** One fully normalized image ready to be sent to the model. Transient:
 * `dataUrl` must never be persisted or logged. */
export interface PreparedModelImage {
  readonly mimeType: "image/png" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly preparedSizeBytes: number;
  readonly dataUrl: string;
}

export interface GeneratedImagePreparationDeps {
  readonly normalizer: ImageNormalizerPort;
}

/** Error named `AbortError` so callers can branch on cancellation. */
function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export class GeneratedImagePreparationService {
  private readonly normalizer: ImageNormalizerPort;

  constructor(deps?: GeneratedImagePreparationDeps) {
    // ElectronNativeImageCodec lazy-requires `electron` only inside decode(),
    // so this default wiring is safe outside the Electron main process.
    this.normalizer =
      deps?.normalizer ?? new AIImageNormalizer(new ElectronNativeImageCodec());
  }

  /**
   * Normalize already-pinned image bytes into a transient model-ready data URL
   * using the shared chat-image limits. Resolves with the prepared image or
   * rejects with an {@link ImageNormalizationError}.
   */
  async prepare(
    source: Buffer,
    detectedMimeType: SupportedImageMimeType,
    detail: "auto" | "low" | "high",
    signal?: AbortSignal
  ): Promise<PreparedModelImage> {
    const opts: NormalizeOptions = {
      targetBytes: CHAT_IMAGE_LIMITS.targetPreparedImageBytes,
      maxLongEdge: CHAT_IMAGE_LIMITS.maxLongEdge,
      initialJpegQuality: CHAT_IMAGE_LIMITS.initialJpegQuality,
      minJpegQuality: CHAT_IMAGE_LIMITS.minJpegQuality,
      minLongEdge: CHAT_IMAGE_LIMITS.minLongEdge,
      maxEncodingAttempts: CHAT_IMAGE_LIMITS.maxEncodingAttempts,
      signal,
    };
    const normalized: NormalizedImage = await this.normalizer.normalize(
      source,
      detectedMimeType,
      opts
    );
    return {
      mimeType: normalized.mimeType,
      width: normalized.width,
      height: normalized.height,
      preparedSizeBytes: normalized.buffer.length,
      dataUrl: normalized.dataUrl,
    };
  }

  /**
   * Map a normalization failure onto a generated-image reference error code.
   * Cancellation is rethrown as an `AbortError` instead of returning a code.
   */
  static errorCodeForNormalizationError(
    err: unknown
  ): GeneratedImageReferenceErrorCode {
    if (!(err instanceof ImageNormalizationError)) {
      return "generated_image_unsupported_type";
    }
    switch (err.code) {
      case "image_dimensions_too_large":
        return "generated_image_dimension_limit";
      case "image_payload_too_large":
        return "generated_image_too_large";
      case "cancelled":
        throw abortError(err.message);
      case "image_processing_failed":
      default:
        return "generated_image_unsupported_type";
    }
  }
}
