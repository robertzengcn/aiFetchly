import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AIImageAttachmentToolService } from "@/service/AIImageAttachmentToolService";
import type { ImageNormalizerPort } from "@/service/AIImageAttachmentToolService";
import { FilePathGuard } from "@/service/FilePathGuard";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";
import type {
  AttachLocalImagesResult,
  PreparedImageMimeType,
  SupportedImageMimeType,
} from "@/entityTypes/aiImageAttachmentToolTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

// ---------------------------------------------------------------------------
// Signatures for synthetic test files.
// ---------------------------------------------------------------------------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_SIG = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const GIF_SIG = Buffer.from("GIF89a", "ascii");

function withSig(sig: Buffer, extra = 16): Buffer {
  return Buffer.concat([sig, Buffer.alloc(extra, 0x01)]);
}

// ---------------------------------------------------------------------------
// Fake normalizer — returns a small prepared image; dataUrlChars configurable.
// ---------------------------------------------------------------------------
function makeFakeNormalizer(
  dataUrlChars = 200
): ImageNormalizerPort & { calls: () => number } {
  let n = 0;
  const normalize: ImageNormalizerPort["normalize"] = vi.fn(
    async (_buffer: Buffer, mime: SupportedImageMimeType) => {
      n += 1;
      const outMime: PreparedImageMimeType =
        mime === "image/png" ? "image/png" : "image/jpeg";
      const filler = "x".repeat(Math.max(0, dataUrlChars - 30));
      const dataUrl = `data:${outMime};base64,${filler}`;
      return {
        buffer: Buffer.alloc(100, 0xab),
        mimeType: outMime,
        width: 100,
        height: 100,
        sha256: "deadbeef".repeat(8),
        dataUrl,
        dataUrlChars: dataUrl.length,
      };
    }
  );
  return { normalize, calls: () => n };
}

// ---------------------------------------------------------------------------
// Test workspace scaffold
// ---------------------------------------------------------------------------
let workspace: string;

function writeFile(rel: string, content: Buffer): string {
  const abs = path.join(workspace, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function makeContext(
  overrides: Partial<SkillExecutionContext> = {}
): SkillExecutionContext {
  return {
    conversationId: "conv-1",
    toolCallId: "call-1",
    args: {},
    ...overrides,
  };
}

/** Cast the metadata-only result record to its typed shape for assertions. */
function asResult(res: {
  result: Record<string, unknown>;
}): AttachLocalImagesResult {
  return res.result as unknown as AttachLocalImagesResult;
}

function makeService(
  normalizer: ImageNormalizerPort,
  resolveWorkspace?: (id: string) => Promise<{ rootPath: string } | null>
): AIImageAttachmentToolService {
  return new AIImageAttachmentToolService({
    resolveWorkspace:
      resolveWorkspace ?? (async () => ({ rootPath: workspace })),
    createPathGuard: (roots) => new FilePathGuard(roots),
    normalizer,
    openForRead: async (p) => {
      const fileHandle = await fs.promises.open(p, "r");
      const stats = await fileHandle.stat();
      return {
        stats,
        read: () => fileHandle.readFile(),
        close: () => fileHandle.close(),
      };
    },
    destinationLabel: "Configured AI Server",
  });
}

describe("AIImageAttachmentToolService", () => {
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aif-img-"));
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  // --- argument validation ---
  it("rejects a non-array paths argument", async () => {
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: "a.png" }, makeContext());
    expect(res.success).toBe(false);
    expect(res.result.code).toBe("invalid_arguments");
  });

  it("rejects zero paths", async () => {
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: [] }, makeContext());
    expect(res.result.code).toBe("invalid_arguments");
  });

  it("rejects more than three paths", async () => {
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute(
      { paths: ["a.png", "b.png", "c.png", "d.png"] },
      makeContext()
    );
    expect(res.result.code).toBe("invalid_arguments");
  });

  it("rejects an invalid detail value", async () => {
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute(
      { paths: ["a.png"], detail: "ultra" },
      makeContext()
    );
    expect(res.result.code).toBe("invalid_arguments");
  });

  it("deduplicates identical input paths", async () => {
    writeFile("a.png", withSig(PNG_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["a.png", "a.png"] }, makeContext());
    expect(res.success).toBe(true);
    expect(res.result.attached_count).toBe(1);
    expect(res.modelArtifacts?.length).toBe(1);
  });

  // --- workspace fail-closed ---
  it("fails closed with workspace_required when no approved workspace", async () => {
    const svc = makeService(makeFakeNormalizer(), async () => null);
    writeFile("a.png", withSig(PNG_SIG));
    const res = await svc.execute({ paths: ["a.png"] }, makeContext());
    expect(res.result.code).toBe("workspace_required");
    expect(res.modelArtifacts).toBeUndefined();
  });

  it("fails closed when the workspace resolver throws", async () => {
    const svc = makeService(makeFakeNormalizer(), async () => {
      throw new Error("db down");
    });
    writeFile("a.png", withSig(PNG_SIG));
    const res = await svc.execute({ paths: ["a.png"] }, makeContext());
    expect(res.result.code).toBe("workspace_required");
  });

  // --- combined request capacity ---
  it("enforces the combined per-request image cap", async () => {
    writeFile("a.png", withSig(PNG_SIG));
    writeFile("b.png", withSig(PNG_SIG));
    const svc = makeService(makeFakeNormalizer());
    // Existing request already has 2 images → only 1 slot remains.
    const res = await svc.execute(
      { paths: ["a.png", "b.png"] },
      makeContext({ currentRequestImageCount: 2 })
    );
    expect(res.result.code).toBe("image_limit_reached");
    expect(res.modelArtifacts).toBeUndefined();
  });

  // --- path safety ---
  it("rejects a path outside the workspace", async () => {
    writeFile("a.png", withSig(PNG_SIG));
    const outside = path.join(
      os.tmpdir(),
      "aif-outside-" + Date.now() + ".png"
    );
    fs.writeFileSync(outside, withSig(PNG_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: [outside] }, makeContext());
    expect(res.result.code).toBe("path_outside_workspace");
    fs.rmSync(outside, { force: true });
  });

  it("rejects path traversal (../escape)", async () => {
    writeFile("a.png", withSig(PNG_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["../evil.png"] }, makeContext());
    expect(res.result.code).toBe("path_outside_workspace");
  });

  it("rejects a symlink that escapes the workspace", async () => {
    const outside = path.join(
      os.tmpdir(),
      "aif-out-" + Math.floor(Math.random() * 1e9)
    );
    fs.writeFileSync(outside, withSig(PNG_SIG));
    // Create a symlink inside the workspace pointing outside.
    fs.symlinkSync(outside, path.join(workspace, "escape.png"));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["escape.png"] }, makeContext());
    expect(res.result.code).toBe("path_outside_workspace");
    fs.rmSync(outside, { force: true });
  });

  it("rejects a missing file", async () => {
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["nope.png"] }, makeContext());
    expect(res.result.code).toBe("path_not_found");
  });

  it("rejects a directory", async () => {
    fs.mkdirSync(path.join(workspace, "subdir"));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["subdir"] }, makeContext());
    expect(res.result.code).toBe("path_is_directory");
  });

  it("rejects a file larger than the raw byte limit", async () => {
    writeFile(
      "big.png",
      Buffer.concat([PNG_SIG, Buffer.alloc(CHAT_IMAGE_LIMITS.maxRawFileBytes)])
    );
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["big.png"] }, makeContext());
    expect(res.result.code).toBe("image_file_too_large");
  });

  it("rejects an empty file", async () => {
    writeFile("empty.png", Buffer.alloc(0));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["empty.png"] }, makeContext());
    expect(res.result.code).toBe("unsupported_image_type");
  });

  // --- signature / type validation ---
  it("rejects a non-image file (no signature)", async () => {
    writeFile("notes.txt", Buffer.from("hello world, not an image"));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["notes.txt"] }, makeContext());
    expect(res.result.code).toBe("unsupported_image_type");
  });

  it("rejects a signature/extension mismatch (.png with JPEG bytes)", async () => {
    writeFile("fake.png", withSig(JPEG_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["fake.png"] }, makeContext());
    expect(res.result.code).toBe("image_signature_mismatch");
  });

  // --- success ---
  it("attaches a valid relative PNG and returns metadata + transient artifact", async () => {
    writeFile("product.png", withSig(PNG_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["product.png"] }, makeContext());
    expect(res.success).toBe(true);
    expect(res.result.attached_count).toBe(1);
    expect(asResult(res).attachments[0]).toMatchObject({
      file_name: "product.png",
      relative_path: "product.png",
      mime_type: "image/png",
    });
    const artifact = res.modelArtifacts?.[0];
    expect(artifact?.kind).toBe("image");
    expect(artifact?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("accepts an absolute path inside the workspace", async () => {
    const abs = writeFile("abs/jpeg.jpg", withSig(JPEG_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: [abs] }, makeContext());
    expect(res.success).toBe(true);
    expect(asResult(res).attachments[0].relative_path).toBe("abs/jpeg.jpg");
  });

  it("attaches up to three images of mixed supported types", async () => {
    writeFile("a.png", withSig(PNG_SIG));
    writeFile("b.jpg", withSig(JPEG_SIG));
    writeFile("c.webp", withSig(WEBP_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute(
      { paths: ["a.png", "b.jpg", "c.webp"] },
      makeContext()
    );
    expect(res.success).toBe(true);
    expect(res.result.attached_count).toBe(3);
    expect(res.modelArtifacts?.length).toBe(3);
  });

  it("forwards the detail field to the artifact", async () => {
    writeFile("a.gif", withSig(GIF_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute(
      { paths: ["a.gif"], detail: "high" },
      makeContext()
    );
    expect(res.modelArtifacts?.[0].detail).toBe("high");
    expect(asResult(res).attachments[0].detail).toBe("high");
  });

  // --- atomic failure + isolation ---
  it("fails atomically if any path in the batch is invalid", async () => {
    writeFile("good.png", withSig(PNG_SIG));
    writeFile("bad.txt", Buffer.from("nope"));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute(
      { paths: ["good.png", "bad.txt"] },
      makeContext()
    );
    expect(res.success).toBe(false);
    // No partial artifacts leaked.
    expect(res.modelArtifacts).toBeUndefined();
    expect(asResult(res).file_errors?.length).toBe(1);
  });

  it("never places data:image/ in the persistable result", async () => {
    writeFile("a.png", withSig(PNG_SIG));
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute({ paths: ["a.png"] }, makeContext());
    const serialized = JSON.stringify(res.result);
    expect(serialized).not.toContain("data:image/");
    expect(serialized).not.toContain("modelArtifacts");
  });

  // --- cumulative budget + cancellation ---
  it("enforces the cumulative data-URL char budget", async () => {
    writeFile("a.png", withSig(PNG_SIG));
    // Each artifact claims ~3M chars; two would blow the 6M budget. With one
    // image and the request already near the cap, even a single attach fails.
    const svc = makeService(makeFakeNormalizer(3_000_000));
    const res = await svc.execute(
      { paths: ["a.png"] },
      makeContext({ currentRequestImageDataUrlChars: 5_000_000 })
    );
    expect(res.result.code).toBe("image_payload_too_large");
    expect(res.modelArtifacts).toBeUndefined();
  });

  it("returns cancelled when the abort signal is already set", async () => {
    writeFile("a.png", withSig(PNG_SIG));
    const ac = new AbortController();
    ac.abort();
    const svc = makeService(makeFakeNormalizer());
    const res = await svc.execute(
      { paths: ["a.png"] },
      makeContext({ signal: ac.signal } as Partial<SkillExecutionContext>)
    );
    expect(res.result.code).toBe("cancelled");
  });
});
