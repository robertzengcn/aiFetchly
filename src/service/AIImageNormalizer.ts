/**
 * Main-process image normalizer for the `attach_local_images` tool.
 *
 * Decodes a validated local image, caps its long edge (never upscales), and
 * re-encodes it within a per-image byte target using bounded attempts. PNG
 * input stays PNG (to preserve transparency); JPEG/WebP/GIF input becomes
 * JPEG. The exact final data-URL character length is measured (base64 inflation
 * makes raw-byte estimates unreliable).
 *
 * Decode/resize/encode go through an injected {@link ImageCodec} so the
 * algorithm is unit-testable with a fake codec and uses Electron
 * `nativeImage` in production (see `ElectronNativeImageCodec`).
 *
 * See PRD FR5 and Technical Design §10.
 */
import * as crypto from "crypto";
import type {
  PreparedImageMimeType,
  SupportedImageMimeType,
  AttachLocalImagesErrorCode,
} from "@/entityTypes/aiImageAttachmentToolTypes";
import {
  MAX_INPUT_DIMENSION,
  MAX_INPUT_PIXELS,
} from "@/config/chatImageLimits";
import { computeScaledDimensions } from "@/utils/imageScaling";
import { sniffImageDimensions } from "@/service/AIImageDimensions";

// ---------------------------------------------------------------------------
// Codec interface (injectable; production impl wraps Electron nativeImage)
// ---------------------------------------------------------------------------

/** A decoded, mutable image the normalizer can resize and re-encode. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
  resize(width: number, height: number): DecodedImage;
  toPng(): Buffer;
  toJpeg(quality: number): Buffer;
}

/** Decodes raw image bytes into a {@link DecodedImage}. Throws if undecodable. */
export interface ImageCodec {
  decode(buffer: Buffer): DecodedImage;
}

// ---------------------------------------------------------------------------
// Result + error types
// ---------------------------------------------------------------------------

/** A single fully prepared image ready to become a model artifact. */
export interface NormalizedImage {
  readonly buffer: Buffer;
  readonly mimeType: PreparedImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly dataUrl: string;
  readonly dataUrlChars: number;
}

/** Normalization options — usually sourced from CHAT_IMAGE_LIMITS. */
export interface NormalizeOptions {
  readonly targetBytes: number;
  readonly maxLongEdge: number;
  readonly initialJpegQuality: number;
  readonly minJpegQuality: number;
  readonly minLongEdge: number;
  readonly maxEncodingAttempts: number;
  readonly signal?: AbortSignal;
}

/** Typed normalizer failure; the tool service maps `code` onto the result. */
export class ImageNormalizationError extends Error {
  constructor(
    readonly code: Extract<
      AttachLocalImagesErrorCode,
      | "image_dimensions_too_large"
      | "image_payload_too_large"
      | "image_processing_failed"
      | "cancelled"
    >,
    message: string
  ) {
    super(message);
    this.name = "ImageNormalizationError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ImageNormalizationError("cancelled", "Normalization cancelled.");
  }
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

export class AIImageNormalizer {
  constructor(private readonly codec: ImageCodec) {}

  /**
   * Normalize one image. Resolves with the prepared image or rejects with an
   * {@link ImageNormalizationError}.
   */
  async normalize(
    buffer: Buffer,
    detectedMime: SupportedImageMimeType,
    opts: NormalizeOptions
  ): Promise<NormalizedImage> {
    throwIfAborted(opts.signal);

    // Pre-decode dimension sniff: reject a small-on-disk-but-huge-on-decode
    // image (decompression bomb) BEFORE the codec allocates a giant bitmap.
    // When the header can be parsed, enforce the same dimension/pixel ceilings
    // we apply post-decode. Unparseable headers fall through to the
    // post-decode guards below.
    const sniffed = sniffImageDimensions(buffer);
    if (sniffed) {
      if (
        sniffed.width > MAX_INPUT_DIMENSION ||
        sniffed.height > MAX_INPUT_DIMENSION ||
        sniffed.width * sniffed.height > MAX_INPUT_PIXELS
      ) {
        throw new ImageNormalizationError(
          "image_dimensions_too_large",
          `Image dimensions ${sniffed.width}x${sniffed.height} exceed the maximum of ${MAX_INPUT_DIMENSION}px / ${MAX_INPUT_PIXELS} pixels.`
        );
      }
    }

    let decoded: DecodedImage;
    try {
      decoded = this.codec.decode(buffer);
    } catch (err) {
      throw new ImageNormalizationError(
        "image_processing_failed",
        `Failed to decode image: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    // Dimension safety guards (§10.2) — protect against excessive decode/resize.
    if (!decoded || decoded.width <= 0 || decoded.height <= 0) {
      throw new ImageNormalizationError(
        "image_processing_failed",
        "Decoded image is empty or has zero dimensions."
      );
    }
    if (
      decoded.width > MAX_INPUT_DIMENSION ||
      decoded.height > MAX_INPUT_DIMENSION
    ) {
      throw new ImageNormalizationError(
        "image_dimensions_too_large",
        `Image dimensions ${decoded.width}x${decoded.height} exceed the maximum of ${MAX_INPUT_DIMENSION}px.`
      );
    }
    if (decoded.width * decoded.height > MAX_INPUT_PIXELS) {
      throw new ImageNormalizationError(
        "image_dimensions_too_large",
        `Image pixel count exceeds the maximum of ${MAX_INPUT_PIXELS}.`
      );
    }

    const preservePng = detectedMime === "image/png";
    const result = preservePng
      ? this.encodePng(decoded, opts)
      : this.encodeJpeg(decoded, opts);

    const sha256 = crypto
      .createHash("sha256")
      .update(result.buffer)
      .digest("hex");
    const dataUrl = `data:${result.mimeType};base64,${result.buffer.toString(
      "base64"
    )}`;
    return {
      buffer: result.buffer,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
      sha256,
      dataUrl,
      dataUrlChars: dataUrl.length,
    };
  }

  /** JPEG encoding loop (§10.4). JPEG/WebP/GIF input → JPEG output. */
  private encodeJpeg(
    decoded: DecodedImage,
    opts: NormalizeOptions
  ): {
    buffer: Buffer;
    mimeType: PreparedImageMimeType;
    width: number;
    height: number;
  } {
    const originalLongEdge = Math.max(decoded.width, decoded.height);
    let longEdge = Math.min(opts.maxLongEdge, originalLongEdge);
    let quality = opts.initialJpegQuality;

    for (let attempt = 0; attempt < opts.maxEncodingAttempts; attempt += 1) {
      throwIfAborted(opts.signal);
      const dims = computeScaledDimensions(
        decoded.width,
        decoded.height,
        longEdge
      );
      const resized = decoded.resize(dims.width, dims.height);
      const encoded = resized.toJpeg(quality);
      if (encoded.length <= opts.targetBytes) {
        return {
          buffer: encoded,
          mimeType: "image/jpeg",
          width: dims.width,
          height: dims.height,
        };
      }
      // Oversized: step the quality down, then the dimensions.
      if (quality > opts.minJpegQuality) {
        quality -= 8;
      } else {
        longEdge = Math.floor(longEdge * 0.85);
        quality = 76; // reset quality after shrinking, per design §10.4
      }
      if (longEdge < opts.minLongEdge) {
        throw new ImageNormalizationError(
          "image_payload_too_large",
          `Could not encode image within ${opts.targetBytes} bytes without falling below the minimum ${opts.minLongEdge}px long edge.`
        );
      }
    }
    throw new ImageNormalizationError(
      "image_payload_too_large",
      `Could not encode image within ${opts.targetBytes} bytes after ${opts.maxEncodingAttempts} attempts.`
    );
  }

  /** PNG encoding loop (§10.5). PNG input → PNG output (alpha preserved). */
  private encodePng(
    decoded: DecodedImage,
    opts: NormalizeOptions
  ): {
    buffer: Buffer;
    mimeType: PreparedImageMimeType;
    width: number;
    height: number;
  } {
    const originalLongEdge = Math.max(decoded.width, decoded.height);
    let longEdge = Math.min(opts.maxLongEdge, originalLongEdge);

    for (let attempt = 0; attempt < opts.maxEncodingAttempts; attempt += 1) {
      throwIfAborted(opts.signal);
      const dims = computeScaledDimensions(
        decoded.width,
        decoded.height,
        longEdge
      );
      const resized = decoded.resize(dims.width, dims.height);
      const encoded = resized.toPng();
      if (encoded.length <= opts.targetBytes) {
        return {
          buffer: encoded,
          mimeType: "image/png",
          width: dims.width,
          height: dims.height,
        };
      }
      longEdge = Math.floor(longEdge * 0.82);
      if (longEdge < opts.minLongEdge) {
        throw new ImageNormalizationError(
          "image_payload_too_large",
          `Could not encode PNG within ${opts.targetBytes} bytes without falling below the minimum ${opts.minLongEdge}px long edge.`
        );
      }
    }
    throw new ImageNormalizationError(
      "image_payload_too_large",
      `Could not encode PNG within ${opts.targetBytes} bytes after ${opts.maxEncodingAttempts} attempts.`
    );
  }
}
