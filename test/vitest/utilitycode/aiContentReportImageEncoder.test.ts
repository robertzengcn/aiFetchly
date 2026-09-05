import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// The image encoder uses browser Canvas APIs (createImageBitmap,
// document.createElement('canvas'), canvas.toBlob). These tests mock those
// APIs so the bounds/rejection logic is pinned without a real browser env.

// Minimal ImageBitmap stub.
interface FakeBitmap {
  width: number;
  height: number;
  close?: () => void;
}

const createImageBitmapMock = vi.fn();
const toBlobMock = vi.fn();

// Stub the global browser APIs the encoder depends on.
function stubCanvasGlobals(): void {
  (
    globalThis as unknown as { createImageBitmap: typeof createImageBitmapMock }
  ).createImageBitmap = createImageBitmapMock;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: vi.fn().mockImplementation(() => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          drawImage: vi.fn(),
        }),
        toBlob: toBlobMock,
      };
      return canvas;
    }),
  };
}

import {
  encodeReportImagePreview,
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_DIMENSION,
} from "@/views/components/aiContentReport/AIContentReportImageEncoder";

describe("encodeReportImagePreview", () => {
  beforeEach(() => {
    createImageBitmapMock.mockReset();
    toBlobMock.mockReset();
    stubCanvasGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an SVG MIME type", async () => {
    const result = await encodeReportImagePreview({
      dataBase64: "dGVzdA==",
      mimeType: "image/svg+xml",
    });
    expect(result).toBeNull();
  });

  it("rejects a text/html MIME type", async () => {
    const result = await encodeReportImagePreview({
      dataBase64: "dGVzdA==",
      mimeType: "text/html",
    });
    expect(result).toBeNull();
  });

  it("rejects a non-image MIME type", async () => {
    const result = await encodeReportImagePreview({
      dataBase64: "dGVzdA==",
      mimeType: "application/pdf",
    });
    expect(result).toBeNull();
  });

  it("rejects empty base64", async () => {
    const result = await encodeReportImagePreview({
      dataBase64: "",
      mimeType: "image/png",
    });
    expect(result).toBeNull();
  });

  it("rejects when there is no source data at all", async () => {
    const result = await encodeReportImagePreview({ mimeType: "image/png" });
    expect(result).toBeNull();
  });

  it("returns a preview for a valid small JPEG under the byte cap", async () => {
    const bitmap: FakeBitmap = { width: 100, height: 100, close: vi.fn() };
    createImageBitmapMock.mockResolvedValue(bitmap);
    // A 10-byte blob — well under 1 MiB.
    const blobBytes = new Uint8Array(10);
    toBlobMock.mockImplementation((cb: (b: Blob | null) => void) =>
      cb(new Blob([blobBytes], { type: "image/jpeg" }))
    );
    const result = await encodeReportImagePreview({
      dataBase64: "dGVzdA==",
      mimeType: "image/jpeg",
    });
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/jpeg");
    expect(result?.width).toBe(100);
    expect(result?.height).toBe(100);
    expect(typeof result?.dataBase64).toBe("string");
  });

  it("returns null when createImageBitmap fails to decode", async () => {
    createImageBitmapMock.mockRejectedValue(new Error("decode failed"));
    const result = await encodeReportImagePreview({
      dataBase64: "dGVzdA==",
      mimeType: "image/png",
    });
    expect(result).toBeNull();
  });

  it("caps the longest edge at MAX_PREVIEW_DIMENSION", async () => {
    // 4000x2000 image — long edge 4000 > 1024.
    const bitmap: FakeBitmap = { width: 4000, height: 2000, close: vi.fn() };
    createImageBitmapMock.mockResolvedValue(bitmap);
    toBlobMock.mockImplementation((cb: (b: Blob | null) => void) => {
      // The canvas dimensions should have been scaled down.
      cb(new Blob([new Uint8Array(8)], { type: "image/jpeg" }));
    });
    await encodeReportImagePreview({
      dataBase64: "dGVzdA==",
      mimeType: "image/jpeg",
    });
    // The canvas created via document.createElement had its width/height set;
    // computeScaledDimensions caps the long edge at 1024 preserving aspect.
    // 4000x2000 -> 1024x512.
    const doc = (
      globalThis as unknown as {
        document: { createElement: ReturnType<typeof vi.fn> };
      }
    ).document;
    const canvas = doc.createElement.mock.results[0].value as {
      width: number;
      height: number;
    };
    expect(canvas.width).toBeLessThanOrEqual(MAX_PREVIEW_DIMENSION);
    expect(canvas.height).toBeLessThanOrEqual(MAX_PREVIEW_DIMENSION);
  });

  it("returns null when every quality level exceeds the byte cap", async () => {
    const bitmap: FakeBitmap = { width: 100, height: 100, close: vi.fn() };
    createImageBitmapMock.mockResolvedValue(bitmap);
    // Always returns a blob larger than 1 MiB.
    const big = new Uint8Array(MAX_PREVIEW_BYTES + 1);
    toBlobMock.mockImplementation((cb: (b: Blob | null) => void) =>
      cb(new Blob([big], { type: "image/jpeg" }))
    );
    const result = await encodeReportImagePreview({
      dataBase64: "dGVzdA==",
      mimeType: "image/jpeg",
    });
    expect(result).toBeNull();
  });

  it("preserves PNG output for transparency", async () => {
    const bitmap: FakeBitmap = { width: 50, height: 50, close: vi.fn() };
    createImageBitmapMock.mockResolvedValue(bitmap);
    toBlobMock.mockImplementation(
      (cb: (b: Blob | null) => void, mime: string) =>
        cb(new Blob([new Uint8Array(4)], { type: mime }))
    );
    const result = await encodeReportImagePreview({
      dataBase64: "dGVzdA==",
      mimeType: "image/png",
    });
    expect(result?.mimeType).toBe("image/png");
  });
});
