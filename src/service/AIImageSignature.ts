/**
 * Pure image file-signature ("magic byte") detection.
 *
 * The DETECTED MIME type — not the file extension — drives decoding for the
 * `attach_local_images` tool. This prevents renamed files from bypassing the
 * allowed-type policy (a `.png` whose bytes are actually HTML is rejected as a
 * signature mismatch, not silently accepted).
 *
 * See PRD FR4 and Technical Design §9.5.
 */
import type { SupportedImageMimeType } from "@/entityTypes/aiImageAttachmentToolTypes";

/** ASCII byte helpers (avoid fragile string/encoding comparisons). */
function bytesStartWith(
  buf: Buffer,
  prefix: readonly number[],
  offset = 0
): boolean {
  if (buf.length < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (buf[offset + i] !== prefix[i]) return false;
  }
  return true;
}

// Leading-byte signatures.
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];
const GIF87_SIG = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF89_SIG = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" (bytes 8..11)

/**
 * Detect the image MIME type from the leading bytes of a file.
 *
 * @returns the detected MIME type, or `null` if the bytes do not begin with a
 *   recognised image signature (PNG/JPEG/GIF/WebP).
 */
export function detectImageSignature(
  buffer: Buffer
): { mimeType: SupportedImageMimeType } | null {
  if (!buffer || buffer.length < 3) return null;

  if (bytesStartWith(buffer, PNG_SIG)) {
    return { mimeType: "image/png" };
  }
  if (bytesStartWith(buffer, JPEG_SIG)) {
    return { mimeType: "image/jpeg" };
  }
  if (bytesStartWith(buffer, GIF87_SIG) || bytesStartWith(buffer, GIF89_SIG)) {
    return { mimeType: "image/gif" };
  }
  // WebP: "RIFF" + 4 size bytes + "WEBP"
  if (bytesStartWith(buffer, RIFF_SIG) && bytesStartWith(buffer, WEBP_SIG, 8)) {
    return { mimeType: "image/webp" };
  }
  return null;
}
