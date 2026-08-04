import { describe, expect, it } from "vitest";
import {
  AIImageNormalizer,
  ImageNormalizationError,
  type DecodedImage,
  type ImageCodec,
  type NormalizeOptions,
} from "@/service/AIImageNormalizer";
import type { SupportedImageMimeType } from "@/entityTypes/aiImageAttachmentToolTypes";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";

// ---------------------------------------------------------------------------
// Fake codec — models byte size from pixel area (and JPEG quality) so the
// bounded encoding loops are exercised deterministically.
// ---------------------------------------------------------------------------

interface FakeSpec {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha?: boolean;
  /** Output bytes per pixel of area at JPEG quality 100. */
  readonly factor?: number;
  /** When true, JPEG size ignores quality (area-only) — forces dimension shrink. */
  readonly qualityIndependent?: boolean;
  /** Throw inside decode() to model an undecodable file. */
  readonly decodeThrows?: boolean;
  /** Hook called from resize(); used to abort mid-loop. */
  readonly onResize?: () => void;
}

interface Recorder {
  resizes: Array<{ width: number; height: number }>;
  jpegQualities: number[];
}

class FakeDecoded implements DecodedImage {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly hasAlpha: boolean,
    private readonly factor: number,
    private readonly qualityIndependent: boolean,
    private readonly recorder: Recorder,
    private readonly onResize?: () => void
  ) {}

  resize(width: number, height: number): DecodedImage {
    this.recorder.resizes.push({ width, height });
    this.onResize?.();
    return new FakeDecoded(
      width,
      height,
      this.hasAlpha,
      this.factor,
      this.qualityIndependent,
      this.recorder,
      this.onResize
    );
  }

  toJpeg(quality: number): Buffer {
    this.recorder.jpegQualities.push(quality);
    const qScale = this.qualityIndependent ? 1 : quality / 100;
    const size = Math.max(
      1,
      Math.floor(this.width * this.height * this.factor * qScale)
    );
    return Buffer.alloc(size, 0xff);
  }

  toPng(): Buffer {
    const size = Math.max(
      1,
      Math.floor(this.width * this.height * this.factor)
    );
    return Buffer.alloc(size, 0x00);
  }
}

class FakeCodec implements ImageCodec {
  readonly recorder: Recorder = { resizes: [], jpegQualities: [] };
  constructor(private readonly spec: FakeSpec) {}

  decode(): DecodedImage {
    if (this.spec.decodeThrows) throw new Error("decode failed");
    return new FakeDecoded(
      this.spec.width,
      this.spec.height,
      this.spec.hasAlpha ?? false,
      this.spec.factor ?? 1,
      this.spec.qualityIndependent ?? false,
      this.recorder,
      this.spec.onResize
    );
  }
}

function defaultOpts(
  overrides: Partial<NormalizeOptions> = {}
): NormalizeOptions {
  return {
    targetBytes: CHAT_IMAGE_LIMITS.targetPreparedImageBytes,
    maxLongEdge: CHAT_IMAGE_LIMITS.maxLongEdge,
    initialJpegQuality: CHAT_IMAGE_LIMITS.initialJpegQuality,
    minJpegQuality: CHAT_IMAGE_LIMITS.minJpegQuality,
    minLongEdge: CHAT_IMAGE_LIMITS.minLongEdge,
    maxEncodingAttempts: CHAT_IMAGE_LIMITS.maxEncodingAttempts,
    ...overrides,
  };
}

describe("AIImageNormalizer", () => {
  it("never upscales an image already within the long-edge cap", async () => {
    // 100x100 is far below 1568; output must stay 100x100.
    const codec = new FakeCodec({ width: 100, height: 100, factor: 0.0001 });
    const out = await new AIImageNormalizer(codec).normalize(
      Buffer.from([0xff, 0xd8, 0xff]),
      "image/jpeg",
      defaultOpts()
    );
    expect(out.width).toBe(100);
    expect(out.height).toBe(100);
  });

  it("caps the long edge at the configured maximum", async () => {
    // 3000x2000 (long edge 3000) must be downscaled to long edge 1568.
    const codec = new FakeCodec({ width: 3000, height: 2000, factor: 0.00001 });
    const out = await new AIImageNormalizer(codec).normalize(
      Buffer.from([0xff, 0xd8, 0xff]),
      "image/jpeg",
      defaultOpts()
    );
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(
      CHAT_IMAGE_LIMITS.maxLongEdge
    );
    expect(out.mimeType).toBe("image/jpeg");
  });

  it("reduces JPEG quality in bounded steps before shrinking dimensions", async () => {
    // 1000x1000 stays at 1000x1000 (under cap). factor chosen so q=82 exceeds
    // target but q=74 fits → success without changing dimensions.
    // size = area*factor*q/100. Want area*factor*0.82 > 800k and *0.74 < 800k.
    // So area*factor ∈ (975609, 1081081). Pick area*factor = 1_000_000.
    const area = 1000 * 1000;
    const X = 1_000_000;
    const codec = new FakeCodec({
      width: 1000,
      height: 1000,
      factor: X / area,
    });
    const out = await new AIImageNormalizer(codec).normalize(
      Buffer.from([0xff, 0xd8, 0xff]),
      "image/jpeg",
      defaultOpts({ targetBytes: 800_000 })
    );
    // Dimensions unchanged (quality reduction alone solved it).
    expect(out.width).toBe(1000);
    expect(out.height).toBe(1000);
    // Quality was stepped down: 82 used first, then 74.
    expect(codec.recorder.jpegQualities[0]).toBe(82);
    expect(codec.recorder.jpegQualities.length).toBeGreaterThan(1);
    expect(codec.recorder.jpegQualities[1]).toBe(74);
  });

  it("shrinks dimensions after the JPEG quality floor is reached", async () => {
    // qualityIndependent ⇒ lowering quality never reduces size, so the loop
    // must shrink dimensions to meet the target. Image 2000x2000 → long edge
    // caps at 1568 (area 2.46M). Target 2.0M is below 2.46M (oversize at full
    // dims) but above 1332²=1.77M (the first shrink), so one dimension shrink
    // succeeds. minLongEdge is respected (1332 >= 768).
    const codec = new FakeCodec({
      width: 2000,
      height: 2000,
      factor: 1,
      qualityIndependent: true,
    });
    const out = await new AIImageNormalizer(codec).normalize(
      Buffer.from([0xff, 0xd8, 0xff]),
      "image/jpeg",
      defaultOpts({ targetBytes: 2_000_000 })
    );
    // Dimensions shrunk below the 1568 cap (and below the 2000 source edge).
    expect(Math.max(out.width, out.height)).toBeLessThan(1568);
    // And respect the minimum long edge.
    expect(Math.max(out.width, out.height)).toBeGreaterThanOrEqual(
      CHAT_IMAGE_LIMITS.minLongEdge
    );
  });

  it("fails after the maximum number of encoding attempts when it cannot fit", async () => {
    // targetBytes=1 with a small factor keeps every attempt oversize (size in
    // the thousands) while staying well above minLongEdge across 6 attempts,
    // so the loop exhausts its attempt budget and rejects.
    const codec = new FakeCodec({ width: 2000, height: 2000, factor: 0.001 });
    await expect(
      new AIImageNormalizer(codec).normalize(
        Buffer.from([0xff, 0xd8, 0xff]),
        "image/jpeg",
        defaultOpts({ targetBytes: 1 })
      )
    ).rejects.toMatchObject({ code: "image_payload_too_large" });
  });

  it("preserves PNG output (alpha) for PNG input", async () => {
    const codec = new FakeCodec({
      width: 500,
      height: 500,
      hasAlpha: true,
      factor: 0.0001,
    });
    const out = await new AIImageNormalizer(codec).normalize(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      "image/png",
      defaultOpts()
    );
    expect(out.mimeType).toBe("image/png");
  });

  it("rejects oversized dimensions", async () => {
    const codec = new FakeCodec({
      width: 20_000,
      height: 1000,
      factor: 0.0001,
    });
    await expect(
      new AIImageNormalizer(codec).normalize(
        Buffer.from([0xff, 0xd8, 0xff]),
        "image/jpeg",
        defaultOpts()
      )
    ).rejects.toMatchObject({ code: "image_dimensions_too_large" });
  });

  it("rejects excessive pixel count", async () => {
    // 16000x16000 = 256M pixels > 64M cap, each dim under 16384.
    const codec = new FakeCodec({
      width: 16_000,
      height: 16_000,
      factor: 0.0001,
    });
    await expect(
      new AIImageNormalizer(codec).normalize(
        Buffer.from([0xff, 0xd8, 0xff]),
        "image/jpeg",
        defaultOpts()
      )
    ).rejects.toMatchObject({ code: "image_dimensions_too_large" });
  });

  it("rejects an empty / zero-dimension decode", async () => {
    const codec = new FakeCodec({ width: 0, height: 0, factor: 0.0001 });
    await expect(
      new AIImageNormalizer(codec).normalize(
        Buffer.from([0xff, 0xd8, 0xff]),
        "image/jpeg",
        defaultOpts()
      )
    ).rejects.toMatchObject({ code: "image_processing_failed" });
  });

  it("maps a codec decode failure to image_processing_failed", async () => {
    const codec = new FakeCodec({
      width: 100,
      height: 100,
      decodeThrows: true,
    });
    await expect(
      new AIImageNormalizer(codec).normalize(
        Buffer.from([0xff, 0xd8, 0xff]),
        "image/jpeg",
        defaultOpts()
      )
    ).rejects.toMatchObject({ code: "image_processing_failed" });
  });

  it("calculates the exact data-URL character length", async () => {
    const codec = new FakeCodec({ width: 100, height: 100, factor: 0.0001 });
    const out = await new AIImageNormalizer(codec).normalize(
      Buffer.from([0xff, 0xd8, 0xff]),
      "image/jpeg",
      defaultOpts()
    );
    const b64 = out.buffer.toString("base64");
    expect(out.dataUrl).toBe(`data:image/jpeg;base64,${b64}`);
    expect(out.dataUrlChars).toBe(
      `data:image/jpeg;base64,`.length + b64.length
    );
    // Round-trip: the base64 portion decodes back to the prepared bytes.
    expect(Buffer.from(b64, "base64")).toEqual(out.buffer);
  });

  it("computes a sha256 of the prepared bytes", async () => {
    const codec = new FakeCodec({ width: 100, height: 100, factor: 0.0001 });
    const out = await new AIImageNormalizer(codec).normalize(
      Buffer.from([0xff, 0xd8, 0xff]),
      "image/jpeg",
      defaultOpts()
    );
    const crypto = await import("crypto");
    const expected = crypto
      .createHash("sha256")
      .update(out.buffer)
      .digest("hex");
    expect(out.sha256).toBe(expected);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is cancellable before decoding", async () => {
    const ac = new AbortController();
    ac.abort();
    const codec = new FakeCodec({ width: 100, height: 100, factor: 0.0001 });
    await expect(
      new AIImageNormalizer(codec).normalize(
        Buffer.from([0xff, 0xd8, 0xff]),
        "image/jpeg",
        defaultOpts({ signal: ac.signal })
      )
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("is cancellable between encoding attempts", async () => {
    const ac = new AbortController();
    let calls = 0;
    const codec = new FakeCodec({
      width: 1600,
      height: 1600,
      factor: 0.001, // tiny buffers, but targetBytes=1 keeps every attempt oversize
      onResize: () => {
        calls += 1;
        // Abort after the first resize so the next attempt's guard fires.
        if (calls === 1) ac.abort();
      },
    });
    await expect(
      new AIImageNormalizer(codec).normalize(
        Buffer.from([0xff, 0xd8, 0xff]),
        "image/jpeg",
        defaultOpts({ signal: ac.signal, targetBytes: 1 })
      )
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("rejects an oversized image via pre-decode header sniff (decompression-bomb guard)", async () => {
    // A PNG whose declared dimensions exceed the ceiling — small on disk but
    // would decode huge. The sniffer must reject before the codec allocates.
    const big = Buffer.alloc(24, 0);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(big, 0);
    big.writeUInt32BE(20_000, 16); // width
    big.writeUInt32BE(20_000, 20); // height
    // Codec whose decode would blow up if reached — proves the sniff ran first.
    const canaryCodec: ImageCodec = {
      decode: () => {
        throw new Error("decode should not be called for an oversized header");
      },
    };
    await expect(
      new AIImageNormalizer(canaryCodec).normalize(
        big,
        "image/png",
        defaultOpts()
      )
    ).rejects.toMatchObject({ code: "image_dimensions_too_large" });
  });

  it("exposes ImageNormalizationError as a typed error", () => {
    const err = new ImageNormalizationError("cancelled", "msg");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("cancelled");
    expect(err.name).toBe("ImageNormalizationError");
  });

  it("treats WebP and GIF input as JPEG output", async () => {
    for (const mime of [
      "image/webp",
      "image/gif",
    ] as SupportedImageMimeType[]) {
      const codec = new FakeCodec({ width: 100, height: 100, factor: 0.0001 });
      const out = await new AIImageNormalizer(codec).normalize(
        Buffer.from([0xff, 0xd8, 0xff]),
        mime,
        defaultOpts()
      );
      expect(out.mimeType).toBe("image/jpeg");
    }
  });
});
