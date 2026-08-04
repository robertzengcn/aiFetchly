import { describe, expect, it } from "vitest";
import { sniffImageDimensions } from "@/service/AIImageDimensions";

function png(width: number, height: number): Buffer {
  // 8-byte signature + 8 bytes filler + width(4 BE) + height(4 BE)
  const b = Buffer.alloc(24, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function gif(width: number, height: number): Buffer {
  const b = Buffer.alloc(13, 0);
  Buffer.from("GIF89a", "ascii").copy(b, 0);
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function webpVp8(width: number, height: number): Buffer {
  // RIFF<size>WEBPVP8 <chunk size><3-byte frame tag><width 14 LE><height 14 LE>
  const b = Buffer.alloc(32, 0);
  Buffer.from("RIFF", "ascii").copy(b, 0);
  Buffer.from("WEBP", "ascii").copy(b, 8);
  Buffer.from("VP8 ", "ascii").copy(b, 12);
  // frame tag bytes 20..22 (0x9d 0x01 0x2a)
  b[20] = 0x9d;
  b[21] = 0x01;
  b[22] = 0x2a;
  b.writeUInt16LE(width & 0x3fff, 26);
  b.writeUInt16LE(height & 0x3fff, 28);
  return b;
}

function webpVp8x(width: number, height: number): Buffer {
  // RIFF<size>WEBPVP8X<flags><24-bit width-1 LE @24><24-bit height-1 LE @27>
  const b = Buffer.alloc(32, 0);
  Buffer.from("RIFF", "ascii").copy(b, 0);
  Buffer.from("WEBP", "ascii").copy(b, 8);
  Buffer.from("VP8X", "ascii").copy(b, 12);
  b[20] = 0x00; // flags
  const w1 = width - 1;
  const h1 = height - 1;
  b[24] = w1 & 0xff;
  b[25] = (w1 >> 8) & 0xff;
  b[26] = (w1 >> 16) & 0xff;
  b[27] = h1 & 0xff;
  b[28] = (h1 >> 8) & 0xff;
  b[29] = (h1 >> 16) & 0xff;
  return b;
}

function jpeg(width: number, height: number): Buffer {
  // FFD8 (SOI) + APP0 marker (FFE0, len 0x0010, 14 bytes body) + SOF0 (FFC0).
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0xff, 0xd8])); // SOI
  parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10])); // APP0 marker + length 16
  parts.push(Buffer.alloc(14, 0)); // APP0 body (filler)
  parts.push(Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08])); // SOF0 + len 17 + precision 8
  const dims = Buffer.alloc(4, 0);
  dims.writeUInt16BE(height, 0);
  dims.writeUInt16BE(width, 2);
  parts.push(dims);
  return Buffer.concat(parts);
}

describe("sniffImageDimensions", () => {
  it("reads PNG width/height from the IHDR header", () => {
    expect(sniffImageDimensions(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(sniffImageDimensions(png(1568, 2048))).toEqual({
      width: 1568,
      height: 2048,
    });
  });

  it("reads GIF logical screen dimensions", () => {
    expect(sniffImageDimensions(gif(320, 200))).toEqual({ width: 320, height: 200 });
  });

  it("reads WebP lossy (VP8) dimensions", () => {
    expect(sniffImageDimensions(webpVp8(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("reads WebP extended (VP8X) dimensions", () => {
    expect(sniffImageDimensions(webpVp8x(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("reads JPEG SOF0 dimensions, skipping the APP0 segment", () => {
    expect(sniffImageDimensions(jpeg(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("returns null for an unrecognised / non-image header", () => {
    expect(sniffImageDimensions(Buffer.from("hello world this is text"))).toBeNull();
    expect(sniffImageDimensions(Buffer.from([0x42, 0x4d]))).toBeNull(); // BMP
  });

  it("returns null for a too-short buffer", () => {
    expect(sniffImageDimensions(Buffer.alloc(4))).toBeNull();
    expect(sniffImageDimensions(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for a truncated PNG (signature but no IHDR body)", () => {
    const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sniffImageDimensions(b)).toBeNull();
  });

  it("reads a JPEG that places SOF0 after multiple markers", () => {
    // SOI + APP0 + a COM segment, then SOF0.
    const parts: Buffer[] = [];
    parts.push(Buffer.from([0xff, 0xd8]));
    parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x06])); // APP0 len 6
    parts.push(Buffer.alloc(4, 0));
    parts.push(Buffer.from([0xff, 0xfe, 0x00, 0x05])); // COM len 5
    parts.push(Buffer.alloc(3, 0));
    parts.push(Buffer.from([0xff, 0xc1, 0x00, 0x11, 0x08])); // SOF1
    const dims = Buffer.alloc(4, 0);
    dims.writeUInt16BE(500, 0);
    dims.writeUInt16BE(750, 2);
    parts.push(dims);
    expect(sniffImageDimensions(Buffer.concat(parts))).toEqual({
      width: 750,
      height: 500,
    });
  });
});
