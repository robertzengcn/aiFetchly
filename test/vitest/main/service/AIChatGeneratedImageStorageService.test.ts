import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { AIChatGeneratedImageStorageService } from "@/service/AIChatGeneratedImageStorageService";
import { resolveGeneratedImageProtocolPath } from "@/service/AIChatGeneratedImageProtocol";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/test/userdata",
  },
}));

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-chat-image-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("AIChatGeneratedImageStorageService", () => {
  it("downloads provider images and rewrites them to local file URLs", async () => {
    const root = await makeTempDir();
    const body = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    ) as typeof fetch;
    const service = new AIChatGeneratedImageStorageService(
      fetchMock,
      root,
      "User+One@Example.COM"
    );

    const stored = await service.storeImages({
      conversationId: "v2-conv",
      messageId: "assistant-1",
      images: [
        {
          type: "image",
          delivery: "provider_url",
          url: "https://example.com/generated.png?expires=soon",
          mime_type: "image/png",
          download_required: true,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/generated.png?expires=soon"
    );
    expect(stored[0]).toEqual(
      expect.objectContaining({
        delivery: "local_file",
        original_url: "https://example.com/generated.png?expires=soon",
        download_required: false,
        mime_type: "image/png",
      })
    );
    expect(stored[0].url).toBe(
      "aifetchly-generated-image://local/user%2Bone%40example.com/v2-conv/assistant-1/image-1.png"
    );
    expect(stored[0].b64_json).toBeUndefined();
    expect(stored[0].local_path).toBe(
      path.join(
        root,
        "ai-chat-generated-images",
        "user+one@example.com",
        "v2-conv",
        "assistant-1",
        "image-1.png"
      )
    );
    expect(resolveGeneratedImageProtocolPath(stored[0].url ?? "", root)).toBe(
      stored[0].local_path
    );
    await expect(fs.stat(stored[0].local_path ?? "")).resolves.toEqual(
      expect.objectContaining({ size: body.length })
    );
  });

  it("does not trust server-provided local_path for remote provider URLs", async () => {
    const root = await makeTempDir();
    const body = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    ) as typeof fetch;
    const service = new AIChatGeneratedImageStorageService(
      fetchMock,
      root,
      "user@example.com"
    );

    const stored = await service.storeImages({
      conversationId: "v2-conv",
      messageId: "assistant-1",
      images: [
        {
          type: "image",
          delivery: "provider_url",
          url: "https://example.com/generated.png",
          local_path: "/tmp/not-owned-by-chat.png",
          mime_type: "image/png",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/generated.png");
    expect(stored[0].delivery).toBe("local_file");
    expect(stored[0].local_path).not.toBe("/tmp/not-owned-by-chat.png");
  });
});
