/**
 * Pure image-dimension sniffer — reads width/height from the leading header
 * bytes of PNG/JPEG/WebP/GIF WITHOUT decoding the pixel data.
 *
 * Used by {@link AIImageNormalizer} as a pre-decode guard so a small-on-disk
 * but huge-on-decode image (decompression bomb) can be rejected before
 * nativeImage allocates a multi-hundred-MB bitmap. Returns `null` when the
 * header cannot be parsed; callers must fall back to post-decode guards in
 * that case (the sniff is a pre-filter, not a security boundary on its own).
 */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function readUint16BE(buf: Buffer, off: number): number {
  return ((buf[off] << 8) | buf[off + 1]) >>> 0;
}
function readUint16LE(buf: Buffer, off: number): number {
  return (buf[off] | (buf[off + 1] << 8)) >>> 0;
}
function readUint32BE(buf: Buffer, off: number): number {
  return (
    (buf[off] * 0x1000000 +
      (buf[off + 1] << 16) +
      (buf[off + 2] << 8) +
      buf[off + 3]) >>>
    0
  );
}

function sniffWebP(buf: Buffer): ImageDimensions | null {
  const fourcc = buf.toString("latin1", 12, 16);
  if (fourcc === "VP8 ") {
    // Lossy: frame tag bytes at 20..22, then 14-bit width @ 26, 14-bit height @ 28.
    if (buf.length < 30) return null;
    return {
      width: readUint16LE(buf, 26) & 0x3fff,
      height: readUint16LE(buf, 28) & 0x3fff,
    };
  }
  if (fourcc === "VP8L") {
    // Lossless: 0x2f signature @ 21, then 14-bit width-1, 14-bit height-1.
    if (buf.length < 26) return null;
    const b0 = buf[22];
    const b1 = buf[23];
    const b2 = buf[24];
    const b3 = buf[25];
    const widthMinus1 = (b0 | ((b1 & 0x3f) << 8)) >>> 0;
    const heightMinus1 =
      (((b1 >> 6) & 0x03) | (b2 << 2) | ((b3 & 0x0f) << 10)) >>> 0;
    return { width: widthMinus1 + 1, height: heightMinus1 + 1 };
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit width-1 @ 24, 24-bit height-1 @ 27.
    if (buf.length < 30) return null;
    const widthMinus1 = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) >>> 0;
    const heightMinus1 = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) >>> 0;
    return { width: widthMinus1 + 1, height: heightMinus1 + 1 };
  }
  return null;
}

function sniffJpeg(buf: Buffer): ImageDimensions | null {
  let off = 2;
  // Need to read up to off+8 for an SOF marker (height@off+5, width@off+7).
  while (off + 9 <= buf.length) {
    if (buf[off] !== 0xff) return null;
    const marker = buf[off + 1];
    // Start-of-frame markers carry the dimensions.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      // layout: FF marker | len(2 BE) | precision(1) | height(2 BE) | width(2 BE)
      return {
        height: readUint16BE(buf, off + 5),
        width: readUint16BE(buf, off + 7),
      };
    }
    // Standalone markers (no length field).
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      off += 2;
      continue;
    }
    // All other markers carry a 2-byte big-endian length to skip.
    if (off + 4 > buf.length) return null;
    const len = readUint16BE(buf, off + 2);
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

/**
 * sniff width/height from the header bytes. Returns null for unrecognised or
 * truncated headers.
 */
export function sniffImageDimensions(buf: Buffer): ImageDimensions | null {
  if (!buf || buf.length < 12) return null;

  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    if (buf.length < 24) return null;
    return { width: readUint32BE(buf, 16), height: readUint32BE(buf, 20) };
  }
  // GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: readUint16LE(buf, 6), height: readUint16LE(buf, 8) };
  }
  // WebP (RIFF....WEBP)
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return sniffWebP(buf);
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return sniffJpeg(buf);
  }
  return null;
}
