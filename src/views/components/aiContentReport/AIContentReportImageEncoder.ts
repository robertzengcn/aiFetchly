/**
 * Renderer-side image preview encoder for AI-content reports.
 *
 * Re-encodes a generated image into a bounded display preview using the
 * browser Canvas API — no native module (sharp) required, so it stays in the
 * base app bundle.
 *
 * Implements PRD FR-3.5 / FR-3.6 / §14.6:
 *  - max 1,024 pixels on the longest edge
 *  - JPEG / WebP / PNG only
 *  - max 1 MiB decoded per image
 *  - never accepts a local path, custom protocol URL, file:// URL, or signed
 *    remote URL as evidence — only the raw image bytes the renderer selected
 *  - rejects SVG, HTML, non-image MIME, and unsupported data URLs
 *
 * Mirrors the canvas pattern in `views/components/aiChatV2/imageScaleUtil.ts`
 * and reuses the runtime-neutral dimension math in `utils/imageScaling.ts`.
 */
import {
  computeScaledDimensions,
  pickImageOutputMimeType,
} from "@/utils/imageScaling";
import { arrayBufferToBase64 } from "@/views/components/aiChatV2/imageScaleUtil";
import type { AIContentReportImagePreview } from "@/entityTypes/aiContentReportTypes";

export const MAX_PREVIEW_DIMENSION = 1024;
export const MAX_PREVIEW_BYTES = 1024 * 1024; // 1 MiB decoded
const PREVIEW_JPEG_QUALITY = 0.82;

/** MIME types that must never be accepted as report evidence (PRD §14.6). */
const FORBIDDEN_MIME_PREFIXES = ["image/svg", "text/html", "text/xml"];

export interface ReportImageSource {
  /** Base64-encoded image bytes (without the `data:` prefix). */
  dataBase64?: string;
  /** MIME type as known by the caller (e.g. from OpenAIChatImage.mime_type). */
  mimeType?: string;
  /** Raw bytes (alternative to `dataBase64`). */
  bytes?: Uint8Array | ArrayBuffer;
}

/**
 * Promisified `HTMLCanvasElement.toBlob`.
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

/**
 * Decode a source into an `ImageBitmap` via a Blob URL. Returns null when the
 * source is not a valid decodable image (SVG/HTML/non-image/dimensions missing).
 */
async function decodeToBitmap(
  source: ReportImageSource
): Promise<ImageBitmap | null> {
  if (isForbiddenMime(source.mimeType)) {
    return null;
  }
  const blob = toBlob(source);
  if (!blob) {
    return null;
  }
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** Convert the source into a Blob, rejecting empty/non-image sources. */
function toBlob(source: ReportImageSource): Blob | null {
  let bytes: Uint8Array | undefined;
  if (source.bytes) {
    bytes =
      source.bytes instanceof Uint8Array
        ? source.bytes
        : new Uint8Array(source.bytes);
  } else if (source.dataBase64 && source.dataBase64.trim().length > 0) {
    try {
      const binary = atob(source.dataBase64);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        arr[i] = binary.charCodeAt(i);
      }
      bytes = arr;
    } catch {
      return null;
    }
  }
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }
  const mime = normalizeMime(source.mimeType);
  if (!mime || !mime.startsWith("image/")) {
    return null;
  }
  // Copy into a standalone ArrayBuffer so the Blob constructor accepts it as
  // a BlobPart across TS lib versions (Uint8Array<ArrayBufferLike> is not always
  // assignable to BlobPart).
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: mime });
}

function isForbiddenMime(mime?: string): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return FORBIDDEN_MIME_PREFIXES.some((p) => lower.startsWith(p));
}

function normalizeMime(mime?: string): string | undefined {
  if (!mime) return undefined;
  const lower = mime.toLowerCase();
  if (lower === "image/jpg") return "image/jpeg";
  return lower;
}

/**
 * Encode a single source into a bounded preview.
 *
 * Returns `null` when the source cannot be safely converted — the caller
 * then sets `evidenceUnavailable: true` and surfaces the localized
 * "image could not be attached" notice (PRD FR-3.7).
 *
 * Uses progressive JPEG quality reduction to stay under the 1 MiB cap.
 */
export async function encodeReportImagePreview(
  source: ReportImageSource,
  options: { maxDimension?: number; maxBytes?: number } = {}
): Promise<AIContentReportImagePreview | null> {
  const maxDimension = options.maxDimension ?? MAX_PREVIEW_DIMENSION;
  const maxBytes = options.maxBytes ?? MAX_PREVIEW_BYTES;

  const bitmap = await decodeToBitmap(source);
  if (!bitmap) {
    return null;
  }

  try {
    const { width, height } = computeScaledDimensions(
      bitmap.width,
      bitmap.height,
      maxDimension
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const outputMime = pickImageOutputMimeType(source.mimeType ?? "image/jpeg");

    // Progressive quality reduction to stay under the byte cap.
    const qualities =
      outputMime === "image/png" ? [1] : [PREVIEW_JPEG_QUALITY, 0.6, 0.4, 0.25];
    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, outputMime, quality);
      if (!blob) continue;
      if (blob.size > maxBytes) continue;
      const buffer = await blob.arrayBuffer();
      return {
        mimeType: outputMime,
        dataBase64: arrayBufferToBase64(buffer),
        width,
        height,
      };
    }
    // Could not fit under the cap.
    return null;
  } finally {
    bitmap.close?.();
  }
}
