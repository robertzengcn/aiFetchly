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
        structuredContent: { schemaVersion: 1, success: true, status: "completed" },
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
            text: JSON.stringify({
            schemaVersion: 1,
            success: false,
            error: { code: "X" },
          }),
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

  it("rejects schemaVersion 999 with a stable safe failure (B02)", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        structuredContent: { schemaVersion: 999, success: true },
      })
    );
    expect(outcome.success).toBe(false);
    expect(outcome.isDomainEnvelope).toBe(false);
    expect((outcome.payload as { error: string }).error).toContain("999");
    expect((outcome.payload as { invalidResult: boolean }).invalidResult).toBe(
      true
    );
  });

  it("rejects a success-claiming envelope with no schemaVersion (B02)", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        structuredContent: { success: true, status: "completed" },
      })
    );
    expect(outcome.success).toBe(false);
    expect((outcome.payload as { error: string }).error).toContain(
      "missing schemaVersion"
    );
  });

  it("rejects a JSON-text fallback envelope with an unsupported version (B02)", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        content: [
          { type: "text", text: JSON.stringify({ schemaVersion: 2, success: true }) },
        ],
      })
    );
    expect(outcome.success).toBe(false);
    expect((outcome.payload as { error: string }).error).toContain("2");
  });

  it("rejects contradictory structured/text success flags (B02)", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        structuredContent: { schemaVersion: 1, success: true },
        content: [
          {
            type: "text",
            text: JSON.stringify({ schemaVersion: 1, success: false }),
          },
        ],
      })
    );
    expect(outcome.success).toBe(false);
    expect((outcome.payload as { error: string }).error).toContain(
      "contradictory"
    );
  });

  it("accepts a matching text copy alongside the structured envelope", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        structuredContent: { schemaVersion: 1, success: false, preview: [] },
        content: [
          {
            type: "text",
            text: JSON.stringify({ schemaVersion: 1, success: false, preview: [] }),
          },
        ],
      })
    );
    expect(outcome.success).toBe(false);
    expect(outcome.isDomainEnvelope).toBe(true);
  });

  it("prefers structuredContent over the text copy even when the text is not JSON (B02)", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        structuredContent: { schemaVersion: 1, success: true },
        content: [{ type: "text", text: "prose summary, not JSON" }],
      })
    );
    expect(outcome.success).toBe(true);
    expect(outcome.isDomainEnvelope).toBe(true);
  });

  it("keeps the original structured error object reachable for recovery (B02)", () => {
    const structuredError = {
      id: "err_input",
      code: "INVALID_RECOVERY_REQUEST",
      category: "invalid_input",
      stage: "validation",
      message: "Invalid scrape arguments: recovery.abc",
      recoverable: false,
      retryAfterMs: null,
      allowedStrategies: [],
    };
    const outcome = normalizeMcpToolOutcome(
      content({
        isError: true,
        structuredContent: {
          schemaVersion: 1,
          success: false,
          status: "failed",
          error: structuredError,
          preview: [],
          pluginSecret: "s3cr3t",
        },
      })
    );
    expect(outcome.success).toBe(false);
    const payload = outcome.payload as {
      error: Record<string, unknown> | string;
      message?: string;
      diagnostics?: Record<string, unknown>;
    };
    // The loop reads the error OBJECT (code/strategies), not a flat string.
    expect(typeof payload.error).toBe("object");
    const errObj = payload.error as Record<string, unknown>;
    expect(errObj.code).toBe("INVALID_RECOVERY_REQUEST");
    expect(Array.isArray(errObj.allowedStrategies)).toBe(true);
    expect(payload.message).toContain("Invalid scrape arguments");
    // The contradictory success flag is still dropped; sensitive keys are
    // redacted inside the bounded diagnostics.
    const diag = payload.diagnostics as Record<string, unknown>;
    expect((diag as { success?: unknown }).success).toBeUndefined();
    expect(Object.values(diag)).toContain("[redacted]");
  });

  it("bounds oversized structured error diagnostics (B02)", () => {
    const outcome = normalizeMcpToolOutcome(
      content({
        isError: true,
        structuredContent: {
          big: "y".repeat(200_000),
          list: Array.from({ length: 500 }, (_, i) => `item-${i}`),
        },
      })
    );
    expect(outcome.success).toBe(false);
    const payload = outcome.payload as {
      error: string;
      diagnostics?: Record<string, unknown>;
    };
    const diagBytes = Buffer.byteLength(JSON.stringify(payload.diagnostics), "utf8");
    expect(diagBytes).toBeLessThanOrEqual(8_192);
    const bigField = (payload.diagnostics as Record<string, unknown>).big as string | undefined;
    if (bigField) {
      expect(bigField.length).toBeLessThanOrEqual(257);
      expect(bigField.endsWith("…")).toBe(true);
    }
    expect(((payload.diagnostics as Record<string, unknown>).list as unknown[]).length).toBeLessThanOrEqual(16);
    // The capped message still carries a recognizable error.
    expect(payload.error.length).toBeLessThanOrEqual(8_192);
  });

  it("flags diagnosticsTruncated when oversized diagnostics were clipped (B02/G04)", () => {
    // > MAX_DIAGNOSTIC_KEYS (24) fields → the truncated marker is nested in
    // the clipped diagnostics and the excess keys are gone.
    const manyKeys = normalizeMcpToolOutcome(
      content({
        isError: true,
        structuredContent: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`key-${i}`, `value-${i}`])
        ),
      })
    );
    expect(manyKeys.success).toBe(false);
    const manyDiag = (manyKeys.payload as { diagnostics: Record<string, unknown> })
      .diagnostics;
    expect(manyDiag.diagnosticsTruncated).toBe(true);
    expect(Object.keys(manyDiag).length).toBeLessThanOrEqual(25);

    // Whole diagnostics object > 8 KiB even AFTER field clipping → replaced
    // entirely by the marker (oversized content leaks nothing).
    const nestedBlob: Record<string, unknown> = { leaf: "x".repeat(300) };
    let nestedCursor: Record<string, unknown> = nestedBlob;
    for (let i = 0; i < 38; i++) {
      const next: Record<string, unknown> = { leaf: "y".repeat(300), child: nestedCursor };
      nestedCursor = next;
    }
    const oversize = normalizeMcpToolOutcome(
      content({ isError: true, structuredContent: nestedCursor })
    );
    expect(oversize.success).toBe(false);
    expect(
      (oversize.payload as { diagnostics: Record<string, unknown> }).diagnostics
    ).toEqual({ diagnosticsTruncated: true });

    // Small payloads keep no marker (no lie).
    const small = normalizeMcpToolOutcome(
      content({ isError: true, structuredContent: { one: "two" } })
    );
    expect((small.payload as Record<string, unknown>).diagnosticsTruncated).toBeUndefined();
    expect(
      (small.payload as { diagnostics: Record<string, unknown> }).diagnostics
        .diagnosticsTruncated
    ).toBeUndefined();
  });
});
