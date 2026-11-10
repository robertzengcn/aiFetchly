import { describe, expect, it } from "vitest";
import {
  buildUploadedAttachments,
  MAX_UPLOAD_FILE_BYTES,
} from "@/views/components/aiChatV2/aiChatV2Attachment";

function makeFile(
  name: string,
  type: string,
  bytes: Uint8Array
): File {
  return new File([bytes.buffer as ArrayBuffer], name, { type });
}

/**
 * B10: the shared validated attachment builder (used by BOTH Chat V2 and the
 * workspace center) classifies by extension as well as MIME, enforces size
 * limits, and downscales images — so an empty-MIME photo is never silently
 * dropped as a document, and both surfaces produce equivalent payloads.
 */
describe("buildUploadedAttachments parity (B10)", () => {
  it("classifies an empty-MIME photo.png as image (not dropped as document)", async () => {
    const out = await buildUploadedAttachments([
      makeFile("photo.png", "", new Uint8Array([1, 2, 3, 4])),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("image");
    expect(out[0].mimeType).toBe("image/png");
  });

  it("classifies octet-stream JPEG by extension", async () => {
    const out = await buildUploadedAttachments([
      makeFile("shot.jpg", "application/octet-stream", new Uint8Array([5, 6])),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("image");
    expect(out[0].mimeType).toBe("image/jpeg");
  });

  it("accepts supported documents with inferred MIME", async () => {
    const out = await buildUploadedAttachments([
      makeFile("report.pdf", "", new Uint8Array([7, 8, 9])),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("document");
    expect(out[0].mimeType).toBe("application/pdf");
  });

  it("rejects unsupported types instead of silently dropping them", async () => {
    await expect(
      buildUploadedAttachments([
        makeFile("run.exe", "application/octet-stream", new Uint8Array([1])),
      ])
    ).rejects.toThrow(/Unsupported file type/);
  });

  it("rejects oversized files instead of silently truncating them", async () => {
    const big = new Uint8Array(MAX_UPLOAD_FILE_BYTES + 1);
    await expect(
      buildUploadedAttachments([makeFile("big.png", "image/png", big)])
    ).rejects.toThrow(/too large/);
  });
});
