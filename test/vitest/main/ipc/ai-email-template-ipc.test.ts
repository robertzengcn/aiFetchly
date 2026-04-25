import { describe, expect, test } from "vitest";
import { normalizeEmailTemplateStreamChunk } from "@/main-process/communication/ai-email-template-ipc";

describe("normalizeEmailTemplateStreamChunk", () => {
  test("returns normal plain-text chunks unchanged", () => {
    expect(normalizeEmailTemplateStreamChunk("Hello world")).toBe(
      "Hello world"
    );
  });

  test("extracts content from OpenAI delta.content chunk", () => {
    const raw =
      '{"choices":[{"delta":{"content":"Subject: Great Offer"},"finish_reason":null,"index":0}]}';
    expect(normalizeEmailTemplateStreamChunk(raw)).toBe("Subject: Great Offer");
  });

  test("ignores assistant role bookkeeping chunk", () => {
    const raw =
      '{"choices":[{"delta":{"role":"assistant"},"finish_reason":null,"index":0}]}';
    expect(normalizeEmailTemplateStreamChunk(raw)).toBe("");
  });

  test("ignores empty delta chunk", () => {
    const raw = '{"choices":[{"delta":{},"finish_reason":null,"index":0}]}';
    expect(normalizeEmailTemplateStreamChunk(raw)).toBe("");
  });

  test("ignores finish sentinel chunk", () => {
    const raw = '{"choices":[{"delta":{},"finish_reason":"stop","index":0}]}';
    expect(normalizeEmailTemplateStreamChunk(raw)).toBe("");
  });

  test("prevents title pollution in mixed stream sequence", () => {
    const chunks = [
      '{"choices":[{"delta":{"role":"assistant"},"finish_reason":null,"index":0}]}',
      '{"choices":[{"delta":{},"finish_reason":null,"index":0}]}',
      '{"choices":[{"delta":{"content":"Subject: Elevate Your Daily Routine"},"finish_reason":null,"index":0}]}',
      '{"choices":[{"delta":{"content":"\\n\\nBody line 1"},"finish_reason":null,"index":0}]}',
      '{"choices":[{"delta":{},"finish_reason":"stop","index":0}]}',
    ];

    const merged = chunks.map(normalizeEmailTemplateStreamChunk).join("");

    expect(merged).toBe("Subject: Elevate Your Daily Routine\n\nBody line 1");
    expect(merged.startsWith('{"choices"')).toBe(false);
  });
});
