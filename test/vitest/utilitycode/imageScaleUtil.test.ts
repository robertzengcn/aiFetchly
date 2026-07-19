/**
 * Tests for imageScaleUtil — pure helpers used by the AI Chat V2 image
 * upload path. The canvas-bound `downscaleImageAttachment` is renderer-only
 * and exercised manually; these tests cover the deterministic math/mime
 * helpers that decide how (and whether) an image is downscaled.
 */
import { describe, it, expect } from "vitest";
import {
  computeScaledDimensions,
  pickImageOutputMimeType,
  IMAGE_MAX_LONG_EDGE,
} from "@/views/components/aiChatV2/imageScaleUtil";

describe("imageScaleUtil", () => {
  describe("computeScaledDimensions", () => {
    it("downscales a landscape image so the long edge hits the cap", () => {
      const r = computeScaledDimensions(3000, 2000, 1568);
      expect(r.width).toBe(1568);
      expect(r.height).toBe(Math.round((2000 * 1568) / 3000));
      expect(r.width).toBeGreaterThanOrEqual(r.height);
    });

    it("downscales a portrait image so the long edge hits the cap", () => {
      const r = computeScaledDimensions(2000, 4000, 1568);
      expect(r.height).toBe(1568);
      expect(r.width).toBe(Math.round((2000 * 1568) / 4000));
      expect(r.height).toBeGreaterThan(r.width);
    });

    it("does not upscale when both edges are already within the cap", () => {
      const r = computeScaledDimensions(800, 600, 1568);
      expect(r.width).toBe(800);
      expect(r.height).toBe(600);
    });

    it("returns the input unchanged when the long edge equals the cap", () => {
      const r = computeScaledDimensions(1568, 1000, 1568);
      expect(r.width).toBe(1568);
      expect(r.height).toBe(1000);
    });

    it("never returns a zero dimension", () => {
      // A degenerate 1x100000 image still downscale to at least 1px wide.
      const r = computeScaledDimensions(1, 100000, 1568);
      expect(r.width).toBeGreaterThanOrEqual(1);
      expect(r.height).toBe(1568);
    });

    it("respects the exported default cap when called through it", () => {
      expect(IMAGE_MAX_LONG_EDGE).toBe(1568);
    });
  });

  describe("pickImageOutputMimeType", () => {
    it("keeps PNG to preserve transparency", () => {
      expect(pickImageOutputMimeType("image/png")).toBe("image/png");
    });

    it("re-encodes JPEG as JPEG", () => {
      expect(pickImageOutputMimeType("image/jpeg")).toBe("image/jpeg");
    });

    it("converts WEBP to JPEG", () => {
      expect(pickImageOutputMimeType("image/webp")).toBe("image/jpeg");
    });

    it("converts GIF to JPEG", () => {
      expect(pickImageOutputMimeType("image/gif")).toBe("image/jpeg");
    });

    it("falls back to JPEG for unknown mime types", () => {
      expect(pickImageOutputMimeType("application/octet-stream")).toBe(
        "image/jpeg"
      );
    });
  });
});
