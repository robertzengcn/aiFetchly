import { describe, expect, it } from "vitest";
import {
  buildImageArtifactHandoffMessage,
  countImageContentParts,
  countImageDataUrlChars,
} from "@/service/AIChatImageHandoff";
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import type { ImageModelArtifact } from "@/entityTypes/aiImageAttachmentToolTypes";

function imageUrl(url: string, detail: "auto" | "low" | "high" = "auto") {
  return { type: "image_url" as const, image_url: { url, detail } };
}

function artifact(overrides: Partial<ImageModelArtifact> = {}): ImageModelArtifact {
  return {
    kind: "image",
    fileName: "a.jpg",
    relativePath: "a.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 10,
    width: 100,
    height: 100,
    sha256: "abc",
    detail: "auto",
    dataUrl: "data:image/jpeg;base64,AAAA",
    ...overrides,
  };
}

describe("countImageContentParts", () => {
  it("counts image_url parts across messages", () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "compare these" },
          imageUrl("data:image/jpeg;base64,AAA"),
          imageUrl("data:image/png;base64,BBB"),
        ],
      },
      { role: "assistant", content: "sure" },
      { role: "user", content: [imageUrl("data:image/gif;base64,CCC")] },
    ];
    expect(countImageContentParts(messages)).toBe(3);
  });

  it("ignores string content and non-image parts", () => {
    const messages: OpenAIChatMessage[] = [
      { role: "user", content: "just text" },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: null },
    ];
    expect(countImageContentParts(messages)).toBe(0);
  });

  it("does not count the legacy message.images field", () => {
    const messages = [
      {
        role: "assistant",
        content: "generated an image",
        images: [{ b64: "xxx" }],
      },
    ] as unknown as OpenAIChatMessage[];
    expect(countImageContentParts(messages)).toBe(0);
  });
});

describe("countImageDataUrlChars", () => {
  it("sums the character length of every image_url.url", () => {
    const u1 = "data:image/jpeg;base64,AAAA"; // 24
    const u2 = "data:image/png;base64,BBBBB"; // 25
    const messages: OpenAIChatMessage[] = [
      { role: "user", content: [imageUrl(u1), imageUrl(u2)] },
    ];
    expect(countImageDataUrlChars(messages)).toBe(u1.length + u2.length);
  });

  it("returns 0 when there are no image parts", () => {
    expect(countImageDataUrlChars([{ role: "user", content: "text" }])).toBe(0);
  });
});

describe("buildImageArtifactHandoffMessage", () => {
  it("builds a role:user message with the handoff text + image parts", () => {
    const arts = [
      artifact({ dataUrl: "data:image/jpeg;base64,AAA", detail: "high" }),
      artifact({ dataUrl: "data:image/png;base64,BBB", detail: "auto" }),
    ];
    const msg = buildImageArtifactHandoffMessage({
      artifacts: arts,
      originalUserRequest: "Make the background white.",
      toolCallId: "call_1",
    });

    expect(msg.role).toBe("user");
    expect(Array.isArray(msg.content)).toBe(true);
    const content = msg.content as Array<{ type: string }>;
    // First part is text; remaining are image_url parts.
    expect(content.length).toBe(3);
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("image_url");
    expect(content[2].type).toBe("image_url");
  });

  it("repeats the original user request in the text part", () => {
    const msg = buildImageArtifactHandoffMessage({
      artifacts: [artifact()],
      originalUserRequest: "Find the front-view photo and edit it.",
      toolCallId: "call_1",
    });
    const text = (msg.content as Array<{ type: string; text?: string }>)[0].text;
    expect(text).toContain("[AIFETCHLY_IMAGE_HANDOFF_V1]");
    expect(text).toContain("attached 1 local image(s)");
    expect(text).toContain("Find the front-view photo and edit it.");
  });

  it("maps each artifact to an image_url part with the right url and detail", () => {
    const arts = [
      artifact({ dataUrl: "data:image/jpeg;base64,AAA", detail: "low" }),
      artifact({ dataUrl: "data:image/png;base64,BBB", detail: "high" }),
    ];
    const msg = buildImageArtifactHandoffMessage({
      artifacts: arts,
      originalUserRequest: "compare",
      toolCallId: "call_1",
    });
    const parts = (msg.content as Array<{
      type: string;
      image_url?: { url: string; detail?: string };
    }>).filter((p) => p.type === "image_url");
    expect(parts[0].image_url).toEqual({ url: "data:image/jpeg;base64,AAA", detail: "low" });
    expect(parts[1].image_url).toEqual({ url: "data:image/png;base64,BBB", detail: "high" });
  });

  it("does not embed untrusted filenames into the text part", () => {
    const msg = buildImageArtifactHandoffMessage({
      artifacts: [artifact({ fileName: "secret-filename.png" })],
      originalUserRequest: "edit it",
      toolCallId: "call_1",
    });
    const text = (msg.content as Array<{ type: string; text?: string }>)[0].text;
    expect(text).not.toContain("secret-filename.png");
  });
});
