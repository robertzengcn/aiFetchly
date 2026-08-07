import { describe, it, expect } from "vitest";
import { persistAgentImages } from "@/service/persistAgentImages";
import type { OpenAIChatImage } from "@/api/aiChatApi";

describe("persistAgentImages", () => {
  it("returns paths + descriptors when storage succeeds", async () => {
    const out = await persistAgentImages({
      images: [{ type: "image", b64_json: "x" }],
      conversationId: "c",
      messageId: "m",
      storage: {
        storeImages: async (): Promise<OpenAIChatImage[]> => [
          {
            type: "image",
            delivery: "local_file",
            local_path: "/p/image-1.png",
            url: "aifetchly-generated-image://local/u/c/m/image-1.png",
            mime_type: "image/png",
          },
        ],
      },
    });
    expect(out.outputFilePaths).toEqual(["/p/image-1.png"]);
    expect(out.outputImages?.[0]?.local_path).toBe("/p/image-1.png");
  });

  it("strips b64_json from descriptors even when storage returns bytes (PRD non-goal 8)", async () => {
    // Storage's per-item fallback can return the ORIGINAL image (with b64
    // bytes) when a single write fails. persistAgentImages must guarantee no
    // bytes leave it, so AgentResult never persists base64 to the DB.
    const out = await persistAgentImages({
      images: [{ type: "image", b64_json: "SHOULD-NOT-LEAK" }],
      conversationId: "c",
      messageId: "m",
      storage: {
        storeImages: async (): Promise<OpenAIChatImage[]> => [
          {
            type: "image",
            delivery: "local_file",
            local_path: "/p/image-1.png",
            url: "aifetchly-generated-image://local/u/c/m/image-1.png",
            mime_type: "image/png",
            b64_json: "SHOULD-NOT-LEAK",
          } as OpenAIChatImage,
        ],
      },
    });
    expect(out.outputFilePaths).toEqual(["/p/image-1.png"]);
    expect(out.outputImages?.[0]?.b64_json).toBeUndefined();
    // path + url survive (rendering needs them)
    expect(out.outputImages?.[0]?.local_path).toBe("/p/image-1.png");
  });

  it("returns empty result for no images", async () => {
    const out = await persistAgentImages({
      images: [],
      conversationId: "c",
      messageId: "m",
      storage: { storeImages: async () => [] },
    });
    expect(out).toEqual({});
  });

  it("returns empty result when images is undefined", async () => {
    const out = await persistAgentImages({
      images: undefined,
      conversationId: "c",
      messageId: "m",
      storage: { storeImages: async () => [] },
    });
    expect(out).toEqual({});
  });

  it("swallows storage errors and returns empty (never throws)", async () => {
    const out = await persistAgentImages({
      images: [{ type: "image" }],
      conversationId: "c",
      messageId: "m",
      storage: {
        storeImages: async (): Promise<OpenAIChatImage[]> => {
          throw new Error("disk full");
        },
      },
    });
    expect(out).toEqual({});
  });

  it("returns undefined paths when stored images lack local_path", async () => {
    const out = await persistAgentImages({
      images: [{ type: "image", url: "https://x/y.png" }],
      conversationId: "c",
      messageId: "m",
      storage: {
        storeImages: async (): Promise<OpenAIChatImage[]> => [
          { type: "image", url: "https://x/y.png" },
        ],
      },
    });
    expect(out.outputFilePaths).toBeUndefined();
    expect(out.outputImages).toHaveLength(1);
  });
});
