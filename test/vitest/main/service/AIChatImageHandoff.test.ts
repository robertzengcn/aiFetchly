import { describe, expect, it } from "vitest";
import {
  buildImageArtifactHandoffMessage,
  countImageContentParts,
  countImageDataUrlChars,
  isImageHandoffMessage,
  stripConsumedImageHandoffs,
  stripConsumedUserImages,
} from "@/service/AIChatImageHandoff";
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import type { ImageModelArtifact } from "@/entityTypes/aiImageAttachmentToolTypes";

function imageUrl(url: string, detail: "auto" | "low" | "high" = "auto") {
  return { type: "image_url" as const, image_url: { url, detail } };
}

function artifact(
  overrides: Partial<ImageModelArtifact> = {}
): ImageModelArtifact {
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
    const text = (msg.content as Array<{ type: string; text?: string }>)[0]
      .text;
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
    const parts = (
      msg.content as Array<{
        type: string;
        image_url?: { url: string; detail?: string };
      }>
    ).filter((p) => p.type === "image_url");
    expect(parts[0].image_url).toEqual({
      url: "data:image/jpeg;base64,AAA",
      detail: "low",
    });
    expect(parts[1].image_url).toEqual({
      url: "data:image/png;base64,BBB",
      detail: "high",
    });
  });

  it("does not embed untrusted filenames into the text part", () => {
    const msg = buildImageArtifactHandoffMessage({
      artifacts: [artifact({ fileName: "secret-filename.png" })],
      originalUserRequest: "edit it",
      toolCallId: "call_1",
    });
    const text = (msg.content as Array<{ type: string; text?: string }>)[0]
      .text;
    expect(text).not.toContain("secret-filename.png");
  });
});

describe("stripConsumedImageHandoffs", () => {
  it("keeps handoff images until an assistant message follows them", () => {
    const handoff = buildImageArtifactHandoffMessage({
      artifacts: [
        artifact({ dataUrl: "data:image/jpeg;base64,AAA" }),
        artifact({ dataUrl: "data:image/jpeg;base64,BBB" }),
        artifact({ dataUrl: "data:image/jpeg;base64,CCC" }),
      ],
      originalUserRequest: "make backgrounds white",
      toolCallId: "call_1",
    });
    const messages: OpenAIChatMessage[] = [
      { role: "user", content: "make backgrounds white" },
      handoff,
    ];
    expect(stripConsumedImageHandoffs(messages)).toBe(0);
    expect(countImageContentParts(messages)).toBe(3);
  });

  it("strips handoff image parts after the model round completes", () => {
    const handoff = buildImageArtifactHandoffMessage({
      artifacts: [
        artifact({ dataUrl: "data:image/jpeg;base64,AAA" }),
        artifact({ dataUrl: "data:image/jpeg;base64,BBB" }),
        artifact({ dataUrl: "data:image/jpeg;base64,CCC" }),
      ],
      originalUserRequest: "make backgrounds white",
      toolCallId: "call_1",
    });
    const messages: OpenAIChatMessage[] = [
      { role: "user", content: "make backgrounds white" },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: '{"success":true,"attached_count":3}',
      },
      handoff,
      {
        role: "assistant",
        content: "Edited the first three. Attaching the next batch.",
        tool_calls: [
          {
            id: "call_2",
            type: "function",
            function: { name: "attach_local_images", arguments: "{}" },
          },
        ],
      },
    ];

    expect(countImageContentParts(messages)).toBe(3);
    expect(stripConsumedImageHandoffs(messages)).toBe(3);
    expect(countImageContentParts(messages)).toBe(0);
    expect(isImageHandoffMessage(messages[2])).toBe(true);
    const text = (
      messages[2].content as Array<{ type: string; text?: string }>
    )[0].text;
    expect(text).toContain("[AIFETCHLY_IMAGE_HANDOFF_V1]");
    expect(JSON.stringify(messages[2].content)).not.toContain("data:image/");
  });

  it("does not strip ordinary user-selected image parts", () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          imageUrl("data:image/jpeg;base64,USERIMG"),
        ],
      },
      { role: "assistant", content: "nice photo" },
    ];
    expect(stripConsumedImageHandoffs(messages)).toBe(0);
    expect(countImageContentParts(messages)).toBe(1);
  });
});

describe("stripConsumedUserImages", () => {
  it("strips user image_url parts after an assistant response", () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "analyze this image" },
          imageUrl("data:image/jpeg;base64,BIGDATA"),
        ],
      },
      { role: "assistant", content: "I see a house." },
      { role: "user", content: "tell me more" },
    ];
    const removed = stripConsumedUserImages(messages);
    expect(removed).toBe(1);
    // Text part is kept, image part is gone.
    const userMsg = messages[0];
    const content = userMsg.content as unknown[];
    expect(content).toHaveLength(1);
    expect((content[0] as { type: string }).type).toBe("text");
    expect(countImageContentParts(messages)).toBe(0);
  });

  it("does NOT strip when no later assistant message exists", () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "analyze this" },
          imageUrl("data:image/jpeg;base64,BIGDATA"),
        ],
      },
    ];
    expect(stripConsumedUserImages(messages)).toBe(0);
    expect(countImageContentParts(messages)).toBe(1);
  });

  it("does NOT strip handoff messages (those are handled by stripConsumedImageHandoffs)", () => {
    const messages: OpenAIChatMessage[] = [
      buildImageArtifactHandoffMessage({
        artifacts: [artifact()],
        originalUserRequest: "edit this",
        toolCallId: "call-1",
      }),
      { role: "assistant", content: "done" },
    ];
    expect(stripConsumedUserImages(messages)).toBe(0);
  });

  it("does NOT strip string-content user messages", () => {
    const messages: OpenAIChatMessage[] = [
      { role: "user", content: "just text" },
      { role: "assistant", content: "reply" },
    ];
    expect(stripConsumedUserImages(messages)).toBe(0);
  });

  it("creates a placeholder when user message has no text parts", () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: "user",
        content: [imageUrl("data:image/png;base64,ONLYIMAGE")],
      },
      { role: "assistant", content: "response" },
    ];
    const removed = stripConsumedUserImages(messages);
    expect(removed).toBe(1);
    const content = messages[0].content as unknown[];
    expect(content).toHaveLength(1);
    expect((content[0] as { type: string }).type).toBe("text");
    expect((content[0] as { text: string }).text).toContain("image(s)");
  });

  it("strips multiple images from a single user message", () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "compare these" },
          imageUrl("data:image/jpeg;base64,IMG1"),
          imageUrl("data:image/png;base64,IMG2"),
        ],
      },
      { role: "assistant", content: "they are different" },
    ];
    expect(stripConsumedUserImages(messages)).toBe(2);
    expect(countImageContentParts(messages)).toBe(0);
  });
});
