import { describe, it, expect } from "vitest";
import { normalizeMcpToolOutcome } from "@/service/McpResultNormalizer";
import type { MCPToolCallContent } from "@/modules/MCPClient";

function content(partial: Partial<MCPToolCallContent>): MCPToolCallContent {
  return { content: [], isError: false, ...partial };
}

describe("normalizeMcpToolOutcome (design §10.4 precedence)", () => {
  it("preserves a valid domain envelope's success from structuredContent", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        structuredContent: {
          schemaVersion: 1,
          success: false,
          status: "failed",
          error: { code: "RESULT_SELECTOR_NOT_FOUND" },
        },
      })
    );
    expect(outcome.success).toBe(false);
    expect(outcome.isDomainEnvelope).toBe(true);
    expect(outcome.payload.error).toEqual({
      code: "RESULT_SELECTOR_NOT_FOUND",
    });
  });

  it("preserves a success:true envelope", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        structuredContent: { success: true, status: "completed" },
      })
    );
    expect(outcome.success).toBe(true);
    expect(outcome.isDomainEnvelope).toBe(true);
  });

  it("extracts a domain envelope from a JSON text block when structuredContent is absent", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: { code: "X" } }),
          },
        ],
      })
    );
    expect(outcome.success).toBe(false);
    expect(outcome.isDomainEnvelope).toBe(true);
  });

  it("isError wins over a contradictory nested success:true", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        isError: true,
        structuredContent: { success: true, status: "completed" },
      })
    );
    expect(outcome.success).toBe(false);
    // The contradictory flag is dropped from the diagnostics.
    const payload = outcome.payload as { diagnostics?: Record<string, unknown> };
    expect(payload.diagnostics?.success).toBeUndefined();
  });

  it("isError with text content produces a bounded error payload", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        isError: true,
        content: [{ type: "text", text: "x".repeat(20_000) }],
      })
    );
    expect(outcome.success).toBe(false);
    const payload = outcome.payload as { error: string };
    expect(payload.error.length).toBeLessThanOrEqual(8_192);
  });

  it("non-envelope non-error results keep the legacy extraction", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        structuredContent: { ok: true, args: { a: 1 } },
      })
    );
    expect(outcome.success).toBe(true);
    expect(outcome.isDomainEnvelope).toBe(false);
    expect(outcome.payload).toEqual({ ok: true, args: { a: 1 } });
  });

  it("plain text without JSON becomes { result: text }", () => {
    const outcome = normalizeMcpToolOutcome(
      content({ content: [{ type: "text", text: "hello" }] })
    );
    expect(outcome.success).toBe(true);
    expect(outcome.payload).toEqual({ result: "hello" });
  });

  it("an envelope without a boolean success is NOT a domain envelope", () => {
    const outcome = normalizeMcpToolOutcome(
      content({ structuredContent: { status: "completed" } })
    );
    expect(outcome.isDomainEnvelope).toBe(false);
    expect(outcome.success).toBe(true);
  });
});
