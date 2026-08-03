import { describe, expect, it } from "vitest";
import { detectImageSignature } from "@/service/AIImageSignature";

describe("detectImageSignature", () => {
  it("detects PNG from its 8-byte signature", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    expect(detectImageSignature(png)).toEqual({ mimeType: "image/png" });
  });

  it("detects JPEG from its 3-byte signature", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageSignature(jpeg)).toEqual({ mimeType: "image/jpeg" });
  });

  it("detects GIF87a", () => {
    const gif = Buffer.from("GIF87a", "ascii");
    expect(detectImageSignature(gif)).toEqual({ mimeType: "image/gif" });
  });

  it("detects GIF89a", () => {
    const gif = Buffer.from("GIF89a", "ascii");
    expect(detectImageSignature(gif)).toEqual({ mimeType: "image/gif" });
  });

  it("detects WebP (RIFF....WEBP)", () => {
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x00, // size (ignored)
      0x57, 0x45, 0x42, 0x50, // "WEBP"
      0x56, 0x50, 0x38, // VP8...
    ]);
    expect(detectImageSignature(webp)).toEqual({ mimeType: "image/webp" });
  });

  it("rejects SVG text content", () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(detectImageSignature(svg)).toBeNull();
  });

  it("rejects TIFF", () => {
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    expect(detectImageSignature(tiff)).toBeNull();
  });

  it("rejects HTML / arbitrary bytes", () => {
    expect(detectImageSignature(Buffer.from("<html>"))).toBeNull();
    expect(detectImageSignature(Buffer.from("hello world"))).toBeNull();
  });

  it("rejects empty and too-short buffers", () => {
    expect(detectImageSignature(Buffer.alloc(0))).toBeNull();
    expect(detectImageSignature(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it("detects by BYTES, not extension — a JPEG renamed to .png is still JPEG", () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    // Caller may claim image/png by extension; signature truth wins.
    expect(detectImageSignature(jpegBytes)).toEqual({ mimeType: "image/jpeg" });
  });

  it("does not match WebP when only RIFF is present (e.g. WAV)", () => {
    const wav = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // "WAVE" — not WEBP
    ]);
    expect(detectImageSignature(wav)).toBeNull();
  });
});
