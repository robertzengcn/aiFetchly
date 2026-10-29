import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  AI_CHAT_GENERATED_IMAGE_HOST,
  AI_CHAT_GENERATED_IMAGE_PROTOCOL,
  buildGeneratedImageProtocolUrl,
  getGeneratedImageUserRoot,
  parseGeneratedImageProtocolIdentity,
  sanitizeGeneratedImagePathPart,
} from "@/service/AIChatGeneratedImageProtocol";
import { AIChatGeneratedImageStorageService } from "@/service/AIChatGeneratedImageStorageService";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/test/userdata",
  },
}));

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-chat-image-proto-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

function rawProtocolUrl(rawSegments: string[]): string {
  return `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://${AI_CHAT_GENERATED_IMAGE_HOST}/${rawSegments.join("/")}`;
}

describe("sanitizeGeneratedImagePathPart", () => {
  it("replaces path separators with underscores", () => {
    expect(sanitizeGeneratedImagePathPart("a/b\\c")).toBe("a_b_c");
  });

  it("falls back to unknown for empty input", () => {
    expect(sanitizeGeneratedImagePathPart("")).toBe("unknown");
  });

  it("truncates to 160 characters", () => {
    expect(sanitizeGeneratedImagePathPart("k".repeat(250))).toBe(
      "k".repeat(160)
    );
  });

  it("replaces unicode characters with underscores", () => {
    expect(sanitizeGeneratedImagePathPart("café☕.png")).toBe("caf__.png");
  });
});

describe("parseGeneratedImageProtocolIdentity", () => {
  const USER_DATA_PATH = "/tmp/u";

  function buildValidUrl(): string {
    return buildGeneratedImageProtocolUrl({
      userEmail: "U@X.com",
      conversationId: "v2-abc",
      messageId: "assistant-1",
      fileName: "image-1.png",
    });
  }

  it("parses a URL built by buildGeneratedImageProtocolUrl into full identity", () => {
    expect(
      parseGeneratedImageProtocolIdentity(buildValidUrl(), USER_DATA_PATH)
    ).toEqual({
      normalizedUser: "u@x.com",
      conversationPathPart: "v2-abc",
      messagePathPart: "assistant-1",
      fileName: "image-1.png",
      candidatePath: path.resolve(
        getGeneratedImageUserRoot(USER_DATA_PATH, "u@x.com"),
        "v2-abc",
        "assistant-1",
        "image-1.png"
      ),
    });
  });

  it("rejects a wrong scheme", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        "https://local/u%40x.com/v2-abc/assistant-1/image-1.png",
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a wrong host", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        "aifetchly-generated-image://remote/u%40x.com/v2-abc/assistant-1/image-1.png",
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects 3 segments", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "v2-abc", "assistant-1"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects 5 segments", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl([
          "u%40x.com",
          "v2-abc",
          "assistant-1",
          "image-1.png",
          "extra",
        ]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects an empty raw segment", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a trailing slash creating an extra empty segment", () => {
    expect(
      parseGeneratedImageProtocolIdentity(`${buildValidUrl()}/`, USER_DATA_PATH)
    ).toBeNull();
  });

  it("rejects an encoded forward separator (%2F)", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "v2%2Fabc", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects an encoded back separator (%5C)", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "v2%5Cabc", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a NUL byte in a decoded segment", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl([
          "u%40x.com",
          "v2%00abc",
          "assistant-1",
          "image-1.png",
        ]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a raw dot segment", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", ".", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a raw double-dot segment", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "v2-abc", "..", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects percent-encoded dot segments", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "%2E", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "%2E%2E", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a query string", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        `${buildValidUrl()}?x=1`,
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a fragment", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        `${buildValidUrl()}#f`,
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects malformed percent escapes (%ZZ)", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "%ZZ", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a lone percent escape", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["u%40x.com", "v2%", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects segments failing the sanitizer round-trip (space)", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl([
          "u%40x.com",
          "v2%20abc",
          "assistant-1",
          "image-1.png",
        ]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects segments failing the sanitizer round-trip (unicode)", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl([
          "u%40x.com",
          "v2%C3%A9abc",
          "assistant-1",
          "image-1.png",
        ]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects a non-normalized user segment (uppercase)", () => {
    expect(
      parseGeneratedImageProtocolIdentity(
        rawProtocolUrl(["U%40X.com", "v2-abc", "assistant-1", "image-1.png"]),
        USER_DATA_PATH
      )
    ).toBeNull();
  });

  it("rejects input without the protocol prefix at all", () => {
    expect(parseGeneratedImageProtocolIdentity("", USER_DATA_PATH)).toBeNull();
    expect(
      parseGeneratedImageProtocolIdentity("/etc/passwd", USER_DATA_PATH)
    ).toBeNull();
  });
});

describe("AIChatGeneratedImageStorageService shared-sanitizer regression", () => {
  it("still produces identically sanitized directory names and parseable URLs", async () => {
    const root = await makeTempDir();
    const fetchStub = vi.fn() as typeof fetch;
    const service = new AIChatGeneratedImageStorageService(
      fetchStub,
      root,
      "U@X.com"
    );

    const stored = await service.storeImages({
      conversationId: "a/b\\c",
      messageId: "assistant-1",
      images: [
        {
          type: "image",
          b64_json: Buffer.from([137, 80, 78, 71]).toString("base64"),
          mime_type: "image/png",
        },
      ],
    });

    const expectedDir = path.join(
      root,
      "ai-chat-generated-images",
      "u@x.com",
      "a_b_c",
      "assistant-1"
    );
    expect(stored[0].local_path).toBe(path.join(expectedDir, "image-1.png"));
    await expect(fs.stat(stored[0].local_path ?? "")).resolves.toEqual(
      expect.objectContaining({ size: 4 })
    );
    expect(stored[0].url).toBe(
      "aifetchly-generated-image://local/u%40x.com/a_b_c/assistant-1/image-1.png"
    );
    expect(
      parseGeneratedImageProtocolIdentity(stored[0].url ?? "", root)
        ?.candidatePath
    ).toBe(stored[0].local_path);
  });
});
