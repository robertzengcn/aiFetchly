import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { OpenAIChatImage } from "@/api/aiChatApi";
import { AIChatGeneratedImageStorageService } from "@/service/AIChatGeneratedImageStorageService";
import {
  buildGeneratedImageProtocolUrl,
  parseGeneratedImageProtocolIdentity,
  resolveGeneratedImageProtocolPath,
} from "@/service/AIChatGeneratedImageProtocol";

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

describe("AIChatGeneratedImageStorageService.rehomeImages", () => {
  const EMAIL = "user@example.com";

  function makeService(root: string): AIChatGeneratedImageStorageService {
    return new AIChatGeneratedImageStorageService(
      vi.fn() as unknown as typeof fetch,
      root,
      EMAIL
    );
  }

  /** Recursively list all file paths under dir; missing dir yields []. */
  async function collectFiles(dir: string): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if ((await fs.stat(full)).isDirectory()) {
        files.push(...(await collectFiles(full)));
      } else {
        files.push(full);
      }
    }
    return files;
  }

  async function seedAgentImage(
    root: string
  ): Promise<{ bytes: Buffer; oldPath: string; descriptor: OpenAIChatImage }> {
    const bytes = Buffer.from([137, 80, 78, 71]);
    const agentConv = "agent-v2-x";
    const agentMsg = "agent-assistant-y";
    const oldDir = path.join(
      root,
      "ai-chat-generated-images",
      EMAIL,
      agentConv,
      agentMsg
    );
    await fs.mkdir(oldDir, { recursive: true });
    const oldPath = path.join(oldDir, "image-1.png");
    await fs.writeFile(oldPath, bytes);
    const descriptor: OpenAIChatImage = {
      type: "image",
      delivery: "local_file",
      url: buildGeneratedImageProtocolUrl({
        userEmail: EMAIL,
        conversationId: agentConv,
        messageId: agentMsg,
        fileName: "image-1.png",
      }),
      local_path: oldPath,
      file_name: "image-1.png",
      mime_type: "image/png",
    };
    return { bytes, oldPath, descriptor };
  }

  it("copies an agent-owned image into the parent identity and rewrites the descriptor", async () => {
    const root = await makeTempDir();
    const service = makeService(root);
    const { bytes, oldPath, descriptor } = await seedAgentImage(root);

    const [rehomed] = await service.rehomeImages({
      images: [descriptor],
      targetConversationId: "v2-parent",
      targetMessageId: "assistant-parent",
    });

    // New URL parses strictly to the parent segments.
    const identity = parseGeneratedImageProtocolIdentity(rehomed.url ?? "", root);
    if (!identity) {
      throw new Error("expected rehomed URL to parse as a protocol identity");
    }
    expect(identity.conversationPathPart).toBe("v2-parent");
    expect(identity.messagePathPart).toBe("assistant-parent");
    expect(identity.fileName).toBe("image-1.png");

    // Copied file exists under the parent dir with identical bytes.
    expect(rehomed.local_path).toBe(
      path.join(
        root,
        "ai-chat-generated-images",
        EMAIL,
        "v2-parent",
        "assistant-parent",
        "image-1.png"
      )
    );
    await expect(fs.readFile(rehomed.local_path ?? "")).resolves.toEqual(bytes);
    await expect(fs.access(rehomed.local_path ?? "")).resolves.toBeUndefined();

    // Copy, not move: the agent-owned original is retained.
    await expect(fs.readFile(oldPath)).resolves.toEqual(bytes);

    // Descriptor keeps its safe metadata and drops any bytes.
    expect(rehomed).toEqual(
      expect.objectContaining({
        type: "image",
        delivery: "local_file",
        file_name: "image-1.png",
        mime_type: "image/png",
      })
    );
    expect(rehomed.b64_json).toBeUndefined();
  });

  it("is idempotent when called again with the already-rehomed descriptors", async () => {
    const root = await makeTempDir();
    const service = makeService(root);
    const { descriptor } = await seedAgentImage(root);

    const [first] = await service.rehomeImages({
      images: [descriptor],
      targetConversationId: "v2-parent",
      targetMessageId: "assistant-parent",
    });
    const [second] = await service.rehomeImages({
      images: [first],
      targetConversationId: "v2-parent",
      targetMessageId: "assistant-parent",
    });

    expect(second).toEqual(first);
    // No duplicate copies appeared in the parent directory.
    const parentDir = path.join(
      root,
      "ai-chat-generated-images",
      EMAIL,
      "v2-parent",
      "assistant-parent"
    );
    await expect(fs.readdir(parentDir)).resolves.toEqual(["image-1.png"]);
  });

  it("passes through non-protocol descriptors and descriptors whose source file is missing", async () => {
    const root = await makeTempDir();
    const service = makeService(root);

    const remoteDescriptor: OpenAIChatImage = {
      type: "image",
      delivery: "provider_url",
      url: "https://example.com/generated.png",
    };
    const missingSourceDescriptor: OpenAIChatImage = {
      type: "image",
      delivery: "local_file",
      url: buildGeneratedImageProtocolUrl({
        userEmail: EMAIL,
        conversationId: "agent-v2-gone",
        messageId: "agent-assistant-gone",
        fileName: "image-9.png",
      }),
      local_path: path.join(
        root,
        "ai-chat-generated-images",
        EMAIL,
        "agent-v2-gone",
        "agent-assistant-gone",
        "image-9.png"
      ),
      file_name: "image-9.png",
    };

    const result = await service.rehomeImages({
      images: [remoteDescriptor, missingSourceDescriptor],
      targetConversationId: "v2-parent",
      targetMessageId: "assistant-parent",
    });

    expect(result[0]).toEqual(remoteDescriptor);
    expect(result[1]).toEqual(missingSourceDescriptor);
    // Nothing was written for the missing source.
    const parentDir = path.join(
      root,
      "ai-chat-generated-images",
      EMAIL,
      "v2-parent",
      "assistant-parent"
    );
    await expect(fs.readdir(parentDir)).resolves.toEqual([]);
  });

  it("passes through descriptors owned by another local user without touching their files", async () => {
    const root = await makeTempDir();
    const service = makeService(root);
    const foreignUser = "attacker@example.com";
    const foreignBytes = Buffer.from([9, 9, 9, 9]);
    // Seed a real file inside the FOREIGN user's generated-image store.
    const foreignDir = path.join(
      root,
      "ai-chat-generated-images",
      foreignUser,
      "agent-v2-x",
      "agent-assistant-y"
    );
    await fs.mkdir(foreignDir, { recursive: true });
    const foreignPath = path.join(foreignDir, "image-1.png");
    await fs.writeFile(foreignPath, foreignBytes);

    const foreignDescriptor: OpenAIChatImage = {
      type: "image",
      delivery: "local_file",
      url: buildGeneratedImageProtocolUrl({
        userEmail: foreignUser,
        conversationId: "agent-v2-x",
        messageId: "agent-assistant-y",
        fileName: "image-1.png",
      }),
      local_path: foreignPath,
      file_name: "image-1.png",
      mime_type: "image/png",
    };

    const [result] = await service.rehomeImages({
      images: [foreignDescriptor],
      targetConversationId: "v2-parent",
      targetMessageId: "assistant-parent",
    });

    // Returned unchanged...
    expect(result).toEqual(foreignDescriptor);
    // ...the current user's target directory was never created, and the
    // foreign source file was neither copied nor modified.
    await expect(
      fs.access(
        path.join(
          root,
          "ai-chat-generated-images",
          EMAIL,
          "v2-parent",
          "assistant-parent"
        )
      )
    ).rejects.toThrow();
    await expect(fs.readFile(foreignPath)).resolves.toEqual(foreignBytes);
    // No stray copies anywhere in the current user's tree.
    const currentUserRoot = path.join(root, "ai-chat-generated-images", EMAIL);
    const strayFiles = await collectFiles(currentUserRoot);
    expect(strayFiles).toEqual([]);
  });
});

describe("AIChatGeneratedImageStorageService.rehomeImages symlink containment", () => {
  const EMAIL = "user@example.com";

  function makeService(root: string): AIChatGeneratedImageStorageService {
    return new AIChatGeneratedImageStorageService(
      vi.fn() as unknown as typeof fetch,
      root,
      EMAIL
    );
  }

  it("returns the original descriptor when the source is a symlink escaping the user's store", async () => {
    const root = await makeTempDir();
    const service = makeService(root);

    // Secret outside the generated-image store entirely.
    const secretBytes = Buffer.from("outside-store-secret");
    const secretPath = path.join(root, "secret.png");
    await fs.writeFile(secretPath, secretBytes);

    // A symlink INSIDE the current user's store pointing at the secret.
    const agentConv = "agent-v2-sym";
    const agentMsg = "agent-assistant-sym";
    const linkDir = path.join(
      root,
      "ai-chat-generated-images",
      EMAIL,
      agentConv,
      agentMsg
    );
    await fs.mkdir(linkDir, { recursive: true });
    const linkPath = path.join(linkDir, "image-1.png");
    await fs.symlink(secretPath, linkPath);

    const descriptor: OpenAIChatImage = {
      type: "image",
      delivery: "local_file",
      url: buildGeneratedImageProtocolUrl({
        userEmail: EMAIL,
        conversationId: agentConv,
        messageId: agentMsg,
        fileName: "image-1.png",
      }),
      local_path: linkPath,
      file_name: "image-1.png",
      mime_type: "image/png",
    };

    const [rehomed] = await service.rehomeImages({
      images: [descriptor],
      targetConversationId: "v2-parent",
      targetMessageId: "assistant-parent",
    });

    // The escape is refused: descriptor passes through UNREWRITTEN (still the
    // agent-identity URL) and nothing was copied into the parent directory.
    expect(rehomed.url).toBe(descriptor.url);
    const parentDir = path.join(
      root,
      "ai-chat-generated-images",
      EMAIL,
      "v2-parent",
      "assistant-parent"
    );
    const copied = await collectDirFiles(parentDir);
    expect(copied).toEqual([]);
    // The secret was never read into the store's parent directory.
    expect(rehomed.local_path).toBe(linkPath);
  });

  it("still rehomes a legitimate regular file after the realpath check", async () => {
    const root = await makeTempDir();
    const service = makeService(root);
    const bytes = Buffer.from([137, 80, 78, 71]);
    const agentConv = "agent-v2-ok";
    const agentMsg = "agent-assistant-ok";
    const oldDir = path.join(
      root,
      "ai-chat-generated-images",
      EMAIL,
      agentConv,
      agentMsg
    );
    await fs.mkdir(oldDir, { recursive: true });
    const oldPath = path.join(oldDir, "image-1.png");
    await fs.writeFile(oldPath, bytes);
    const descriptor: OpenAIChatImage = {
      type: "image",
      delivery: "local_file",
      url: buildGeneratedImageProtocolUrl({
        userEmail: EMAIL,
        conversationId: agentConv,
        messageId: agentMsg,
        fileName: "image-1.png",
      }),
      local_path: oldPath,
      file_name: "image-1.png",
      mime_type: "image/png",
    };

    const [rehomed] = await service.rehomeImages({
      images: [descriptor],
      targetConversationId: "v2-parent2",
      targetMessageId: "assistant-parent2",
    });
    expect(rehomed.url).toContain("v2-parent2");
    expect(rehomed.local_path).toContain("assistant-parent2");
    await expect(fs.access(rehomed.local_path as string)).resolves.toBeUndefined();
  });

  async function collectDirFiles(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir);
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry);
        if ((await fs.stat(full)).isDirectory()) {
          files.push(...(await collectDirFiles(full)));
        } else {
          files.push(full);
        }
      }
      return files;
    } catch {
      return [];
    }
  }
});
