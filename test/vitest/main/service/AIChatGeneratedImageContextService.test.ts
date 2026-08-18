import { describe, expect, it } from "vitest";
import {
  parseGeneratedImagesFromMetadata,
  buildGeneratedImagesAnnotation,
  augmentContentWithGeneratedImages,
} from "@/service/AIChatGeneratedImageContextService";

describe("parseGeneratedImagesFromMetadata", () => {
  it("returns null for undefined/empty/null metadata", () => {
    expect(parseGeneratedImagesFromMetadata(undefined)).toBeNull();
    expect(parseGeneratedImagesFromMetadata(null)).toBeNull();
    expect(parseGeneratedImagesFromMetadata("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseGeneratedImagesFromMetadata("not json")).toBeNull();
    expect(parseGeneratedImagesFromMetadata("{broken")).toBeNull();
  });

  it("returns null when generatedImages is absent", () => {
    expect(
      parseGeneratedImagesFromMetadata(
        JSON.stringify({ source: "chat-v2", openaiResponseId: "x" })
      )
    ).toBeNull();
  });

  it("returns null when generatedImages is an empty array", () => {
    expect(
      parseGeneratedImagesFromMetadata(
        JSON.stringify({ generatedImages: [] })
      )
    ).toBeNull();
  });

  it("parses valid generatedImages with url, file_name, local_path", () => {
    const meta = JSON.stringify({
      generatedImages: [
        {
          type: "image",
          url: "aifetchly-generated-image://local/user/conv/msg/image-1.png",
          file_name: "image-1.png",
          local_path: "/home/user/data/image-1.png",
        },
      ],
    });
    const result = parseGeneratedImagesFromMetadata(meta);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].url).toBe(
      "aifetchly-generated-image://local/user/conv/msg/image-1.png"
    );
    expect(result![0].file_name).toBe("image-1.png");
    expect(result![0].local_path).toBe("/home/user/data/image-1.png");
  });

  it("skips entries without a url", () => {
    const meta = JSON.stringify({
      generatedImages: [
        { type: "image", file_name: "no-url.png" },
        { type: "image", url: "aifetchly-generated-image://local/x.png" },
      ],
    });
    const result = parseGeneratedImagesFromMetadata(meta);
    expect(result).toHaveLength(1);
    expect(result![0].url).toBe("aifetchly-generated-image://local/x.png");
  });
});

describe("buildGeneratedImagesAnnotation", () => {
  it("builds a compact annotation block with index, url, file, local", () => {
    const annotation = buildGeneratedImagesAnnotation([
      {
        url: "aifetchly-generated-image://local/user/conv/msg/image-1.png",
        file_name: "image-1.png",
        local_path: "/home/user/data/image-1.png",
      },
    ]);
    expect(annotation).toContain("<generated_images>");
    expect(annotation).toContain("</generated_images>");
    expect(annotation).toContain(
      "aifetchly-generated-image://local/user/conv/msg/image-1.png"
    );
    expect(annotation).toContain("file: image-1.png");
    expect(annotation).toContain("local: /home/user/data/image-1.png");
    expect(annotation).toContain("[1]");
  });

  it("works without file_name and local_path", () => {
    const annotation = buildGeneratedImagesAnnotation([
      { url: "aifetchly-generated-image://local/x.png" },
    ]);
    expect(annotation).toContain("<generated_images>");
    expect(annotation).toContain(
      "aifetchly-generated-image://local/x.png"
    );
    expect(annotation).not.toContain("file:");
    expect(annotation).not.toContain("local:");
  });
});

describe("augmentContentWithGeneratedImages", () => {
  it("returns original content for non-assistant roles", () => {
    const meta = JSON.stringify({
      generatedImages: [
        { url: "aifetchly-generated-image://local/x.png" },
      ],
    });
    expect(augmentContentWithGeneratedImages("hello", "user", meta)).toBe(
      "hello"
    );
    expect(augmentContentWithGeneratedImages("hello", "system", meta)).toBe(
      "hello"
    );
  });

  it("returns original content when metadata has no generatedImages", () => {
    expect(
      augmentContentWithGeneratedImages("hello", "assistant", undefined)
    ).toBe("hello");
    expect(
      augmentContentWithGeneratedImages(
        "hello",
        "assistant",
        JSON.stringify({ source: "chat-v2" })
      )
    ).toBe("hello");
  });

  it("appends generated_images block to assistant content", () => {
    const meta = JSON.stringify({
      generatedImages: [
        {
          url: "aifetchly-generated-image://local/user/conv/msg/image-1.png",
          file_name: "image-1.png",
          local_path: "/home/user/data/image-1.png",
        },
      ],
    });
    const result = augmentContentWithGeneratedImages(
      "Here's your house!",
      "assistant",
      meta
    );
    expect(result).toContain("Here's your house!");
    expect(result).toContain("<generated_images>");
    expect(result).toContain(
      "aifetchly-generated-image://local/user/conv/msg/image-1.png"
    );
  });

  it("is idempotent — does not double-augment if marker already present", () => {
    const meta = JSON.stringify({
      generatedImages: [
        { url: "aifetchly-generated-image://local/x.png" },
      ],
    });
    const once = augmentContentWithGeneratedImages(
      "text",
      "assistant",
      meta
    );
    const twice = augmentContentWithGeneratedImages(
      once,
      "assistant",
      meta
    );
    expect(twice).toBe(once);
    expect(twice.match(/<generated_images>/g)).toHaveLength(1);
  });

  it("handles empty content gracefully", () => {
    const meta = JSON.stringify({
      generatedImages: [
        { url: "aifetchly-generated-image://local/x.png" },
      ],
    });
    const result = augmentContentWithGeneratedImages(
      "",
      "assistant",
      meta
    );
    expect(result).toContain("<generated_images>");
    expect(result).toContain(
      "aifetchly-generated-image://local/x.png"
    );
  });

  it("handles malformed metadata without throwing", () => {
    expect(
      augmentContentWithGeneratedImages("text", "assistant", "not json")
    ).toBe("text");
  });
});
