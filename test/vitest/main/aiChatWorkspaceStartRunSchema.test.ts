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

/**
 * Capability-parity PRD FR-SUB-004/FR-IMG-004/FR-HIS-002 (transport): the
 * workspace start-run boundary must accept the SAME submission context the
 * Chat V2 pending-queue edge already carries — pasted-content bodies, the
 * trusted confirmed generated-image batch channel, opaque history-selection
 * references, and the retry-stable submission identity.
 */
describe("startChatRunRequestSchema submission-context parity fields", () => {
  it("accepts pastedContents map entries", () => {
    const parsed = startChatRunRequestSchema.safeParse(
      request({ pastedContents: { "1": "pasted body text" } })
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts a confirmed generated-image batch (trusted channel)", () => {
    const parsed = startChatRunRequestSchema.safeParse(
      request({
        confirmedGeneratedImageBatch: {
          references: [
            reference("m1", 0),
            reference("m2", 1),
            reference("m3", 0),
            reference("m4", 0),
          ],
        },
      })
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty confirmed batch (at least one reference)", () => {
    const parsed = startChatRunRequestSchema.safeParse(
      request({ confirmedGeneratedImageBatch: { references: [] } })
    );
    expect(parsed.success).toBe(false);
  });

  it("accepts opaque historySelectionIds and a retry-stable submissionId", () => {
    const parsed = startChatRunRequestSchema.safeParse(
      request({
        historySelectionIds: ["src-1", "src-2"],
        submissionId: "11111111-2222-3333-4444-555555555555",
      })
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects malformed historySelectionIds entries", () => {
    const parsed = startChatRunRequestSchema.safeParse(
      request({ historySelectionIds: [""] })
    );
    expect(parsed.success).toBe(false);
  });

  it("still rejects unknown keys (strict shape)", () => {
    const parsed = startChatRunRequestSchema.safeParse(
      request({ pastedBodies: { p1: "renamed attacker key" } })
    );
    expect(parsed.success).toBe(false);
  });
});
