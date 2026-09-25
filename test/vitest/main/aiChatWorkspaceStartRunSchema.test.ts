import { describe, expect, it } from "vitest";
import { startChatRunRequestSchema } from "@/schemas/ipc/aiChatWorkspace";

/**
 * The workspace start-run boundary must enforce the PRD §12.4 generated-image
 * reference cap (3 per request) — the same limit the legacy v2 stream edge
 * enforces via normalizeGeneratedImageReferences. A renderer that bypasses
 * the composer tray preflight must not be able to push more references
 * through the workspace IPC path.
 */

function reference(messageId: string, imageIndex: number): {
  messageId: string;
  imageIndex: number;
} {
  return { messageId, imageIndex };
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversationId: "v2-schema-test",
    clientRequestId: "cr-schema-test",
    message: "hello",
    ...overrides,
  };
}

describe("startChatRunRequestSchema generatedImageReferences cap", () => {
  it("accepts up to 3 references", () => {
    const parsed = startChatRunRequestSchema.safeParse(
      request({
        generatedImageReferences: [
          reference("m1", 0),
          reference("m2", 1),
          reference("m3", 2),
        ],
      })
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects more than 3 references (trust-boundary parity with the v2 stream edge)", () => {
    const parsed = startChatRunRequestSchema.safeParse(
      request({
        generatedImageReferences: [
          reference("m1", 0),
          reference("m2", 0),
          reference("m3", 0),
          reference("m4", 0),
        ],
      })
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects malformed reference entries (strict shape)", () => {
    const withExtra = startChatRunRequestSchema.safeParse(
      request({
        generatedImageReferences: [
          { messageId: "m1", imageIndex: 0, url: "https://attacker.example/x" },
        ],
      })
    );
    expect(withExtra.success).toBe(false);

    const badIndex = startChatRunRequestSchema.safeParse(
      request({
        generatedImageReferences: [{ messageId: "m1", imageIndex: -1 }],
      })
    );
    expect(badIndex.success).toBe(false);
  });

  it("allows omitting references entirely", () => {
    const parsed = startChatRunRequestSchema.safeParse(request());
    expect(parsed.success).toBe(true);
  });
});
