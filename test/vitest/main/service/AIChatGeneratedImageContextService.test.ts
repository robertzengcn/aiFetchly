import { describe, expect, it } from "vitest";
import {
  parseGeneratedImagesFromMetadata,
  buildGeneratedImagesAnnotation,
  augmentContentWithGeneratedImages,
} from "@/service/AIChatGeneratedImageContextService";

// Legacy metadata shape: rows written before the context-hygiene change
// carry local_path and protocol URLs. Parsing must tolerate them.
const LEGACY_META = JSON.stringify({
  generatedImages: [
    {
      type: "image",
      url: "aifetchly-generated-image://local/user/conv/msg/image-1.png",
      file_name: "image-1.png",
      local_path: "/home/user/data/generated/image-1.png",
    },
  ],
});

function expectNoPathLeak(text: string): void {
  expect(text).not.toContain("local_path");
  expect(text).not.toContain("/home/user/data/generated");
  expect(text).not.toContain("aifetchly-generated-image://");
  // No absolute-path-looking substrings ("/" prefixed tokens).
  expect(text).not.toMatch(/(?:^|\s)\/\S+/);
}

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

  it("parses legacy rows with local_path without crash and drops unknown fields", () => {
    const result = parseGeneratedImagesFromMetadata(LEGACY_META);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]).toEqual({
      url: "aifetchly-generated-image://local/user/conv/msg/image-1.png",
      file_name: "image-1.png",
    });
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
  it("emits compact semantic markers with message id and zero-based index", () => {
    const annotation = buildGeneratedImagesAnnotation(
      [
        {
          url: "aifetchly-generated-image://local/u/c/m/image-1.png",
          file_name: "image-1.png",
        },
        {
          url: "aifetchly-generated-image://local/u/c/m/image-2.png",
        },
      ],
      "assistant-123"
    );
    expect(annotation).toContain("<generated_images>");
    expect(annotation).toContain("</generated_images>");
    expect(annotation).toContain("[1] message=assistant-123 image=0 file=image-1.png");
    expect(annotation).toContain("[2] message=assistant-123 image=1");
    expectNoPathLeak(annotation);
  });

  it("omits the file segment when file_name is absent", () => {
    const annotation = buildGeneratedImagesAnnotation(
      [{ url: "aifetchly-generated-image://local/x.png" }],
      "assistant-123"
    );
    const line = annotation.split("\n").find((l) => l.includes("[1]"));
    expect(line).toBe("  [1] message=assistant-123 image=0");
  });

  it("omits the message segment when no sourceMessageId is provided (backward compatible)", () => {
    const annotation = buildGeneratedImagesAnnotation([
      {
        url: "aifetchly-generated-image://local/x.png",
        file_name: "x.png",
      },
    ]);
    const line = annotation.split("\n").find((l) => l.includes("[1]"));
    expect(line).toBe("  [1] image=0 file=x.png");
  });

  it("caps descriptors at 10 per message, dropping extras beyond the first 10", () => {
    const images = Array.from({ length: 12 }, (_, i) => ({
      url: `aifetchly-generated-image://local/img-${i}.png`,
      file_name: `img-${i}.png`,
    }));
    const annotation = buildGeneratedImagesAnnotation(images, "m-1");
    const descriptorLines = annotation
      .split("\n")
      .filter((l) => /^\s+\[\d+\]/.test(l));
    expect(descriptorLines).toHaveLength(10);
    expect(descriptorLines[0]).toContain("image=0");
    expect(descriptorLines[9]).toContain("[10]");
    expect(descriptorLines[9]).toContain("image=9");
    expect(annotation).not.toContain("image=10");
  });

  it("never leaks paths or protocol URLs", () => {
    const annotation = buildGeneratedImagesAnnotation(
      [
        {
          url: "aifetchly-generated-image://local/u/c/m/image-1.png",
          file_name: "image-1.png",
        },
      ],
      "assistant-123"
    );
    expectNoPathLeak(annotation);
  });
});

describe("augmentContentWithGeneratedImages", () => {
  it("returns original content for non-assistant roles", () => {
    expect(
      augmentContentWithGeneratedImages("hello", "user", LEGACY_META)
    ).toBe("hello");
    expect(
      augmentContentWithGeneratedImages("hello", "system", LEGACY_META)
    ).toBe("hello");
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

  it("appends a semantic-marker block threaded with the row messageId", () => {
    const result = augmentContentWithGeneratedImages(
      "Here's your house!",
      "assistant",
      LEGACY_META,
      "assistant-123"
    );
    expect(result).toContain("Here's your house!");
    expect(result).toContain("<generated_images>");
    expect(result).toContain("[1] message=assistant-123 image=0 file=image-1.png");
    // Legacy metadata contributes no path text to the output.
    expectNoPathLeak(result);
  });

  it("is idempotent — does not double-augment if marker already present", () => {
    const once = augmentContentWithGeneratedImages(
      "text",
      "assistant",
      LEGACY_META,
      "assistant-123"
    );
    const twice = augmentContentWithGeneratedImages(
      once,
      "assistant",
      LEGACY_META,
      "assistant-123"
    );
    expect(twice).toBe(once);
    expect(twice.match(/<generated_images>/g)).toHaveLength(1);
  });

  it("handles empty content gracefully", () => {
    const result = augmentContentWithGeneratedImages(
      "",
      "assistant",
      LEGACY_META,
      "assistant-123"
    );
    expect(result).toContain("<generated_images>");
    expect(result).toContain("[1] message=assistant-123 image=0 file=image-1.png");
    expectNoPathLeak(result);
  });

  it("handles malformed metadata without throwing", () => {
    expect(
      augmentContentWithGeneratedImages("text", "assistant", "not json")
    ).toBe("text");
  });
});
