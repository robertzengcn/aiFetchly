import { beforeEach, describe, expect, it } from "vitest";
import {
  decodeToolResultCursor,
  deriveToolResultCursorKey,
  encodeToolResultCursor,
  setToolResultCursorKey,
} from "@/service/toolResult/ToolResultCursorCodec";
import {
  fitWrappedRetrievalResult,
  retrievalSerializedFits,
  simulateRetrievalWrap,
} from "@/service/toolResult/retrievalInlineBound";

beforeEach(() => {
  setToolResultCursorKey(deriveToolResultCursorKey("retrieval-inline-bound"));
});

describe("retrieval inline bound", () => {
  it("shrinks a dense search page and resumes at the first omitted hit", () => {
    const outputId = `out_${"ab".repeat(16)}`;
    const matches = Array.from({ length: 30 }, (_, index) => ({
      start_byte: index * 30,
      end_byte: index * 30 + 3,
      excerpt: `name-${index}-` + "x".repeat(180),
      read_cursor: encodeToolResultCursor({
        outputId,
        revision: 1,
        mode: "read",
        position: index * 30,
      }),
      match_count_in_window: 4,
    }));
    const fitted = fitWrappedRetrievalResult({
      success: true,
      output_id: outputId,
      revision: 1,
      query: "csv",
      matches,
      scan_complete: true,
      next_cursor: null,
      source_completeness: "complete",
    });
    expect(fitted).not.toBeNull();
    if (!fitted || typeof fitted !== "object") return;
    expect(retrievalSerializedFits(simulateRetrievalWrap(fitted))).toBe(true);
    const page = fitted as {
      matches: Array<{ start_byte: number }>;
      scan_complete: boolean;
      next_cursor: string;
      revision?: number;
    };
    expect(page.matches.length).toBeGreaterThan(0);
    expect(page.matches.length).toBeLessThan(matches.length);
    expect(page.scan_complete).toBe(false);
    expect(page.revision).toBeUndefined();
    const decoded = decodeToolResultCursor(page.next_cursor, {
      outputId,
      mode: "search",
      revision: 1,
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.payload.position).toBe(page.matches.length * 30);
    }
  });

  it("shortens a read page and points next_cursor at the first omitted byte", () => {
    const outputId = `out_${"cd".repeat(16)}`;
    const fitted = fitWrappedRetrievalResult({
      output_id: outputId,
      revision: 2,
      text: "a".repeat(8000),
      start_byte: 0,
      end_byte: 8000,
      total_bytes: 8000,
      complete: true,
      next_cursor: null,
      source_completeness: "complete",
    });
    expect(fitted).not.toBeNull();
    if (!fitted || typeof fitted !== "object") return;
    expect(retrievalSerializedFits(simulateRetrievalWrap(fitted))).toBe(true);
    const page = fitted as {
      text: string;
      complete: boolean;
      next_cursor: string;
      end_byte: number;
    };
    expect(page.complete).toBe(false);
    expect(page.text.length).toBeLessThan(8000);
    const decoded = decodeToolResultCursor(page.next_cursor, {
      outputId,
      mode: "read",
      revision: 2,
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload.position).toBe(page.end_byte);
  });
});
