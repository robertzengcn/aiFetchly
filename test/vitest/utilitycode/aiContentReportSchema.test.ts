import { describe, expect, it } from "vitest";
import { createAIContentReportSchema } from "@/schemas/ipc/aiContentReport";
import type { CreateAIContentReportRequest } from "@/entityTypes/aiContentReportTypes";

/** Build a minimal valid request; callers override fields to test rejection. */
function makeValid(
  overrides: Partial<CreateAIContentReportRequest> = {}
): CreateAIContentReportRequest {
  return {
    schemaVersion: 1,
    clientReportId: "client-uuid-123",
    surface: "chat_v2",
    contentType: "text",
    category: "other",
    comment: "Microsoft certification test",
    output: { text: "This is the AI-generated output being reported." },
    context: {
      conversationId: "conv-1",
      messageId: "msg-1",
      appVersion: "1.0.0",
      platform: "win32",
      locale: "en-US",
    },
    ...overrides,
  };
}

describe("createAIContentReportSchema", () => {
  const schema = createAIContentReportSchema;

  it("accepts a minimal valid text report", () => {
    const res = schema().safeParse(makeValid());
    expect(res.success).toBe(true);
  });

  it("accepts every valid category", () => {
    const categories = [
      "hate_or_harassment",
      "sexual_content",
      "violence_or_self_harm",
      "child_safety",
      "illegal_or_dangerous",
      "privacy_or_personal_data",
      "misinformation_or_deception",
      "copyright_or_ownership",
      "other",
    ] as const;
    for (const category of categories) {
      const res = schema().safeParse(makeValid({ category }));
      expect(res.success).toBe(true);
    }
  });

  it("accepts every valid content type", () => {
    const types = [
      "text",
      "image",
      "mixed",
      "plan",
      "artifact",
      "email_template",
      "keyword_set",
    ] as const;
    for (const contentType of types) {
      const res = schema().safeParse(makeValid({ contentType }));
      expect(res.success).toBe(true);
    }
  });

  it("accepts every valid surface", () => {
    const surfaces = [
      "chat_v2",
      "legacy_chat",
      "knowledge_chat",
      "ai_artifact",
      "email_template_editor",
      "keyword_generator",
      "automatic_email_reply",
      "other",
    ] as const;
    for (const surface of surfaces) {
      const res = schema().safeParse(makeValid({ surface }));
      expect(res.success).toBe(true);
    }
  });

  it("rejects an unknown category", () => {
    const res = schema().safeParse(
      makeValid({ category: "spam" as unknown as never })
    );
    expect(res.success).toBe(false);
  });

  it("rejects unknown top-level keys (strict object)", () => {
    const res = schema().safeParse({
      ...makeValid(),
      prompt: "leaked prompt",
    });
    expect(res.success).toBe(false);
  });

  it("rejects comment longer than 2000 chars", () => {
    const res = schema().safeParse(makeValid({ comment: "a".repeat(2001) }));
    expect(res.success).toBe(false);
  });

  it("rejects text longer than 32000 chars", () => {
    const res = schema().safeParse({
      ...makeValid(),
      output: { text: "a".repeat(32001) },
    });
    expect(res.success).toBe(false);
  });

  it("rejects more than 3 image previews", () => {
    const previews = Array.from({ length: 4 }, () => ({
      mimeType: "image/jpeg" as const,
      dataBase64: "dGVzdA==", // 4 bytes decoded
      width: 100,
      height: 100,
    }));
    const res = schema().safeParse({
      ...makeValid(),
      contentType: "image",
      output: { imagePreviews: previews },
    });
    expect(res.success).toBe(false);
  });

  it("rejects an image preview over 1 MiB decoded", () => {
    // 2 MiB of zeros base64-encoded
    const big = Buffer.alloc(2 * 1024 * 1024, 0).toString("base64");
    const res = schema().safeParse({
      ...makeValid(),
      contentType: "image",
      output: {
        imagePreviews: [
          { mimeType: "image/jpeg", dataBase64: big, width: 100, height: 100 },
        ],
      },
    });
    expect(res.success).toBe(false);
  });

  it("rejects a non-image MIME type on a preview", () => {
    const res = schema().safeParse({
      ...makeValid(),
      contentType: "image",
      output: {
        imagePreviews: [
          {
            mimeType: "image/svg" as unknown as "image/jpeg",
            dataBase64: "dGVzdA==",
            width: 100,
            height: 100,
          },
        ],
      },
    });
    expect(res.success).toBe(false);
  });

  it("rejects non-positive image dimensions", () => {
    const res = schema().safeParse({
      ...makeValid(),
      contentType: "image",
      output: {
        imagePreviews: [
          {
            mimeType: "image/jpeg",
            dataBase64: "dGVzdA==",
            width: 0,
            height: 100,
          },
        ],
      },
    });
    expect(res.success).toBe(false);
  });

  it("rejects empty evidence (no text, no images, no evidenceUnavailable)", () => {
    const res = schema().safeParse({
      ...makeValid(),
      output: {},
    });
    expect(res.success).toBe(false);
  });

  it("accepts evidenceUnavailable with a non-empty comment", () => {
    const res = schema().safeParse({
      ...makeValid(),
      output: { evidenceUnavailable: true },
      comment: "explaining the issue",
    });
    expect(res.success).toBe(true);
  });

  it("rejects evidenceUnavailable alone without a comment", () => {
    const res = schema().safeParse({
      ...makeValid(),
      output: { evidenceUnavailable: true },
      comment: "",
    });
    expect(res.success).toBe(false);
  });

  it("rejects evidenceUnavailable alone without comment present", () => {
    const res = schema().safeParse({
      ...makeValid(),
      output: { evidenceUnavailable: true },
      comment: undefined,
    });
    expect(res.success).toBe(false);
  });

  it("rejects schemaVersion other than 1", () => {
    const res = schema().safeParse({
      ...makeValid(),
      schemaVersion: 2 as unknown as 1,
    });
    expect(res.success).toBe(false);
  });

  it("rejects an unsupported platform", () => {
    const res = schema().safeParse({
      ...makeValid(),
      context: {
        ...makeValid().context,
        platform: "freebsd" as unknown as "win32",
      },
    });
    expect(res.success).toBe(false);
  });

  it("rejects overly long context identifiers", () => {
    const long = "a".repeat(129);
    const res = schema().safeParse({
      ...makeValid(),
      context: {
        ...makeValid().context,
        conversationId: long,
      },
    });
    expect(res.success).toBe(false);
  });

  it("accepts a missing optional comment", () => {
    const res = schema().safeParse({
      ...makeValid(),
      comment: undefined,
    });
    expect(res.success).toBe(true);
  });
});
