import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import {
  ToolResultRetrievalService,
  decodeUtf8Window,
  legacySourceReader,
  type RetrievalTarget,
} from "@/service/toolResult/ToolResultRetrievalService";
import {
  decodeToolResultCursor,
  deriveToolResultCursorKey,
  digestSearchQuery,
  encodeToolResultCursor,
  setToolResultCursorKey,
} from "@/service/toolResult/ToolResultCursorCodec";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";

/**
 * Bounded read/search and cursor-integrity tests.
 *
 * The behaviours pinned here are the ones a naive implementation gets wrong:
 * finding a fact at EOF, paging a single-line minified document, not losing a
 * match that straddles a buffer boundary, and refusing a tampered cursor
 * without reading any content.
 */

let root: string;
let storage: ToolResultStorageService;
let service: ToolResultRetrievalService;

beforeEach(() => {
  root = path.join(os.tmpdir(), `aifetchly-retrieval-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(root, { recursive: true });
  storage = new ToolResultStorageService({ root });
  service = new ToolResultRetrievalService(storage);
  setToolResultCursorKey(deriveToolResultCursorKey("test-key-for-retrieval"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function newOutputId(): string {
  return `out_${crypto.randomBytes(16).toString("hex")}`;
}

const IDENTITY = { profileId: "prof-1", outputEpoch: "epoch-1" };

/** Store a value and return a retrieval target for it. */
async function storeValue(
  value: unknown,
  sourceCompleteness: "complete" | "partial" | "unknown" = "complete"
): Promise<RetrievalTarget> {
  const outputId = newOutputId();
  const stored = await storage.captureJson({
    outputId,
    ...IDENTITY,
    value,
    sourceCompleteness,
  });
  return {
    outputId,
    revision: 1,
    storageKey: stored.storageKey,
    format: "json",
    capturedBytes: stored.capturedBytes,
    sourceCompleteness,
  };
}

/** Store raw text and return a retrieval target for it. */
async function storeText(
  text: string,
  sourceCompleteness: "complete" | "partial" | "unknown" = "complete"
): Promise<RetrievalTarget> {
  const outputId = newOutputId();
  const stored = await storage.captureText({
    outputId,
    ...IDENTITY,
    text,
    sourceCompleteness,
  });
  return {
    outputId,
    revision: 1,
    storageKey: stored.storageKey,
    format: "text",
    capturedBytes: stored.capturedBytes,
    sourceCompleteness,
  };
}

describe("ToolResultRetrievalService — bounded read", () => {
  it("reads a small output in one complete page", async () => {
    const target = await storeText("hello world");
    const outcome = await service.read({ target });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.text).toBe("hello world");
    expect(outcome.page.complete).toBe(true);
    expect(outcome.page.nextCursor).toBeNull();
  });

  it("pages a large output and reassembles it exactly (AC-05, AC-06)", async () => {
    const text = Array.from({ length: 5000 }, (_, i) => `line ${i} 你好 🎉`).join("\n");
    const target = await storeText(text);

    let cursor: string | undefined;
    let assembled = "";
    let pages = 0;
    for (;;) {
      const outcome = await service.read({ target, cursor });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      assembled += outcome.page.text;
      pages += 1;
      expect(outcome.page.text.length).toBeLessThanOrEqual(
        TOOL_RESULT_CONFIG.readMaxBytes
      );
      if (outcome.page.complete || !outcome.page.nextCursor) break;
      cursor = outcome.page.nextCursor;
      expect(pages).toBeLessThan(500); // guard against a non-advancing cursor
    }
    expect(assembled).toBe(text);
    expect(pages).toBeGreaterThan(1);
  });

  it("pages a single-line minified JSON document without a line-based dead end (AC-05)", async () => {
    // One enormous line: a line-oriented reader would stall here forever.
    const value = { rows: Array.from({ length: 1200 }, (_, i) => ({ i, v: "x".repeat(40) })) };
    const target = await storeValue(value);
    const result = await storage.checksumOf(target.storageKey);
    expect(result).toMatch(/^[0-9a-f]{64}$/);

    let cursor: string | undefined;
    let bytes = "";
    for (let i = 0; i < 5000; i += 1) {
      const outcome = await service.read({ target, cursor });
      if (!outcome.ok) throw new Error("read failed");
      bytes += outcome.page.text;
      if (outcome.page.complete) break;
      cursor = outcome.page.nextCursor ?? undefined;
    }
    // Concatenating every page reproduces the stored payload exactly.
    const stored = await storage.readWindow({
      storageKey: target.storageKey,
      startByte: 0,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });
    expect(bytes).toBe(stored.buffer.toString("utf8"));
  });

  it("does not split a multi-byte character across a page boundary (AC-06)", async () => {
    // CJK is 3 bytes, so an arbitrary byte cut would split one.
    const text = "漢".repeat(20000);
    const target = await storeText(text);
    let cursor: string | undefined;
    let assembled = "";
    for (let i = 0; i < 500; i += 1) {
      const outcome = await service.read({ target, cursor });
      if (!outcome.ok) throw new Error("read failed");
      // No replacement character may appear in any page.
      expect(outcome.page.text).not.toContain("\ufffd");
      assembled += outcome.page.text;
      if (outcome.page.complete) break;
      cursor = outcome.page.nextCursor ?? undefined;
    }
    expect(assembled).toBe(text);
  });

  it("refuses a text read of binary output instead of inlining base64", async () => {
    const target: RetrievalTarget = {
      outputId: newOutputId(),
      revision: 1,
      storageKey: "some/key.bin",
      format: "binary",
      capturedBytes: 10,
      sourceCompleteness: "complete",
    };
    const outcome = await service.read({ target });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("OUTPUT_FORMAT_UNSUPPORTED");
  });

  it("reports a missing artifact as unavailable rather than empty success", async () => {
    const target: RetrievalTarget = {
      outputId: newOutputId(),
      revision: 1,
      storageKey: path.join("gone", "payload.txt"),
      format: "text",
      capturedBytes: 10,
      sourceCompleteness: "complete",
    };
    const outcome = await service.read({ target });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("OUTPUT_NOT_AVAILABLE");
  });
});

describe("ToolResultRetrievalService — literal search", () => {
  it("finds a fact beyond the preview (AC-04)", async () => {
    // Small enough to build quickly under a fully parallel suite run, but
    // still far beyond any inline preview so the fact is only reachable
    // through retrieval.
    const value = {
      rows: Array.from({ length: 800 }, (_, i) => ({ i, note: `record ${i}` })),
    };
    const target = await storeValue(value);
    const outcome = await service.search({ target, query: "record 799" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.matches.length).toBeGreaterThan(0);
    expect(outcome.page.matches[0].excerpt).toContain("record 799");
  });

  it("returns a read cursor anchored at each match", async () => {
    const target = await storeValue({ a: 1, b: "needle", c: 3 });
    const outcome = await service.search({ target, query: "needle" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const match = outcome.page.matches[0];
    const readOutcome = await service.read({
      target,
      cursor: match.readCursor,
    });
    expect(readOutcome.ok).toBe(true);
    if (readOutcome.ok) expect(readOutcome.page.text).toContain("needle");
  });

  it("finds a match that straddles an internal buffer boundary (AC-06)", async () => {
    // Place the needle so it spans the 64 KiB read boundary.
    const filler = "a".repeat(65536 - 3);
    const target = await storeText(`${filler}NEEDLE${"b".repeat(200)}`);
    const outcome = await service.search({ target, query: "NEEDLE" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.matches).toHaveLength(1);
    expect(outcome.page.matches[0].excerpt).toContain("NEEDLE");
  });

  it("does not report the same match twice across a continuation", async () => {
    const target = await storeText("needle ".repeat(500));
    const first = await service.search({ target, query: "needle", maxMatches: 3 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.page.matches).toHaveLength(3);
    expect(first.page.scanComplete).toBe(false);
    expect(first.page.nextCursor).not.toBeNull();

    const second = await service.search({
      target,
      query: "needle",
      maxMatches: 3,
      cursor: first.page.nextCursor ?? undefined,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const firstEnds = first.page.matches.map((m) => m.endByte);
    for (const match of second.page.matches) {
      expect(firstEnds).not.toContain(match.endByte);
    }
  });

  it("reports scan_complete for a fully scanned small output", async () => {
    const target = await storeText("alpha beta gamma");
    const outcome = await service.search({ target, query: "beta" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.scanComplete).toBe(true);
    expect(outcome.page.nextCursor).toBeNull();
  });

  it("scan_complete never claims the producer's output was complete (AC-15)", async () => {
    // The producer truncated upstream; our capture is complete as RECEIVED.
    const target = await storeText("partial content needle", "partial");
    const outcome = await service.search({ target, query: "needle" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.scanComplete).toBe(true);
    // ...but the source is honestly reported as partial, so absence from the
    // original output cannot be concluded.
    expect(outcome.page.sourceCompleteness).toBe("partial");
  });

  it("returns a usable continuation when the match budget is reached", async () => {
    const target = await storeText("hit ".repeat(2000));
    const outcome = await service.search({ target, query: "hit", maxMatches: 2 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.matches).toHaveLength(2);
    expect(outcome.page.nextCursor).not.toBeNull();
  });

  it("treats the query as literal text, never as a pattern", async () => {
    const target = await storeText("value: a.b and axb");
    const outcome = await service.search({ target, query: "a.b" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // A regex would match "axb" too; a literal search must not.
    expect(outcome.page.matches).toHaveLength(1);
  });

  it("rejects an over-long query before scanning", async () => {
    const target = await storeText("x");
    const outcome = await service.search({
      target,
      query: "y".repeat(TOOL_RESULT_CONFIG.searchQueryMaxChars + 1),
    });
    expect(outcome.ok).toBe(false);
  });
});

describe("ToolResultCursorCodec — integrity", () => {
  it("round-trips a read cursor", () => {
    const encoded = encodeToolResultCursor({
      outputId: "out_abc",
      revision: 1,
      mode: "read",
      position: 4096,
    });
    const decoded = decodeToolResultCursor(encoded, {
      outputId: "out_abc",
      mode: "read",
      revision: 1,
    });
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload.position).toBe(4096);
  });

  it("rejects a tampered cursor (AC-11)", () => {
    const encoded = encodeToolResultCursor({
      outputId: "out_abc",
      revision: 1,
      mode: "read",
      position: 4096,
    });
    const [body, signature] = encoded.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        outputId: "out_abc",
        revision: 1,
        mode: "read",
        position: 999_999_999,
        policyVersion: "tool-result-policy-v1",
      })
    ).toString("base64url");
    const decoded = decodeToolResultCursor(`${forged}.${signature}`, {
      outputId: "out_abc",
      mode: "read",
      revision: 1,
    });
    expect(decoded.ok).toBe(false);
    expect(body).not.toBe(forged);
  });

  it("rejects a cursor whose signature was stripped", () => {
    const encoded = encodeToolResultCursor({
      outputId: "out_abc",
      revision: 1,
      mode: "read",
      position: 10,
    });
    expect(
      decodeToolResultCursor(encoded.split(".")[0], {
        outputId: "out_abc",
        mode: "read",
      }).ok
    ).toBe(false);
  });

  it("refuses to use a search cursor as a read cursor", () => {
    const encoded = encodeToolResultCursor({
      outputId: "out_abc",
      revision: 1,
      mode: "search",
      position: 10,
      queryDigest: digestSearchQuery("q"),
    });
    const decoded = decodeToolResultCursor(encoded, {
      outputId: "out_abc",
      mode: "read",
    });
    expect(decoded.ok).toBe(false);
  });

  it("refuses a cursor bound to a different output", () => {
    const encoded = encodeToolResultCursor({
      outputId: "out_aaa",
      revision: 1,
      mode: "read",
      position: 10,
    });
    expect(
      decodeToolResultCursor(encoded, { outputId: "out_bbb", mode: "read" }).ok
    ).toBe(false);
  });

  it("refuses a search cursor resumed with a different query", () => {
    const encoded = encodeToolResultCursor({
      outputId: "out_abc",
      revision: 1,
      mode: "search",
      position: 10,
      queryDigest: digestSearchQuery("first"),
    });
    expect(
      decodeToolResultCursor(encoded, {
        outputId: "out_abc",
        mode: "search",
        queryDigest: digestSearchQuery("second"),
      }).ok
    ).toBe(false);
  });

  it("refuses a stale-revision cursor (OUTPUT_CHANGED path)", () => {
    const encoded = encodeToolResultCursor({
      outputId: "out_abc",
      revision: 1,
      mode: "read",
      position: 10,
    });
    expect(
      decodeToolResultCursor(encoded, {
        outputId: "out_abc",
        mode: "read",
        revision: 2,
      }).ok
    ).toBe(false);
  });

  it("rejects garbage input without throwing", () => {
    for (const bad of ["", "x", "....", "a.b", null, undefined, 42, {}]) {
      expect(
        decodeToolResultCursor(bad, { outputId: "out_abc", mode: "read" }).ok
      ).toBe(false);
    }
  });

  it("invalidates cursors when the key rotates, while output ids stay usable", () => {
    const encoded = encodeToolResultCursor({
      outputId: "out_abc",
      revision: 1,
      mode: "read",
      position: 10,
    });
    setToolResultCursorKey(deriveToolResultCursorKey("a-different-key"));
    expect(
      decodeToolResultCursor(encoded, { outputId: "out_abc", mode: "read" }).ok
    ).toBe(false);
    // The caller can still restart from the beginning with the output id.
    setToolResultCursorKey(deriveToolResultCursorKey("test-key-for-retrieval"));
  });
});

describe("legacy_message backend (P1-4)", () => {
  /** Stand-in for the bounded SQL slice of a historical message row. */
  const legacyText = Array.from(
    { length: 800 },
    (_, i) => `legacy row ${i} with some padding text`
  ).join("\n");

  function makeLegacyService(): ToolResultRetrievalService {
    const source = legacySourceReader({
      readSlice: async ({ offsetBytes, lengthBytes }) => ({
        text: Buffer.from(legacyText, "utf8")
          .subarray(offsetBytes, offsetBytes + lengthBytes)
          .toString("utf8"),
        totalBytes: Buffer.byteLength(legacyText, "utf8"),
      }),
    });
    return new ToolResultRetrievalService(storage, source);
  }

  const legacyTarget: RetrievalTarget = {
    outputId: "out_0123456789abcdef0123456789abcdef",
    revision: 1,
    backend: "legacy_message",
    sourceRowKey: "tool-result-legacy-1",
    storageKey: "",
    format: "text",
    capturedBytes: Buffer.byteLength(legacyText, "utf8"),
    sourceCompleteness: "complete",
  };

  it("reads pages from a legacy source row under the same budget", async () => {
    const legacy = makeLegacyService();
    let cursor: string | undefined;
    let assembled = "";
    let pages = 0;
    for (;;) {
      const outcome = await legacy.read({ target: legacyTarget, cursor });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // Identical page ceiling to the file backend (TD §10.2).
      expect(outcome.page.text.length).toBeLessThanOrEqual(
        TOOL_RESULT_CONFIG.readMaxBytes
      );
      assembled += outcome.page.text;
      pages += 1;
      if (outcome.page.complete || !outcome.page.nextCursor) break;
      cursor = outcome.page.nextCursor;
      expect(pages).toBeLessThan(200);
    }
    expect(pages).toBeGreaterThan(1);
    expect(assembled).toBe(legacyText);
  });

  it("searches a legacy source row and reports scan completeness", async () => {
    const legacy = makeLegacyService();
    const outcome = await legacy.search({
      target: legacyTarget,
      query: "legacy row 799",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.matches.length).toBeGreaterThan(0);
    expect(outcome.page.matches[0].excerpt).toContain("legacy row 799");
    // A small row is scanned in full, so absence would be conclusive here.
    expect(outcome.page.scanComplete).toBe(true);
  });

  it("rejects a stale cursor rather than serving different bytes (OUTPUT_CHANGED)", async () => {
    const legacy = makeLegacyService();
    const first = await legacy.read({ target: legacyTarget });
    expect(first.ok).toBe(true);
    if (!first.ok || !first.page.nextCursor) return;

    // The same cursor against a DIFFERENT artifact must not be accepted.
    const other = await legacy.read({
      target: { ...legacyTarget, outputId: "out_ffffffffffffffffffffffffffffffff" },
      cursor: first.page.nextCursor,
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.code).toBe("INVALID_OUTPUT_CURSOR");
  });
});

describe("decodeUtf8Window — text-boundary safety", () => {
  it("trims a partial multi-byte sequence at the window end", () => {
    const full = Buffer.from("漢", "utf8"); // 3 bytes
    const cut = full.subarray(0, 2);
    const text = decodeUtf8Window(cut, 0);
    // A raw toString() would produce U+FFFD here.
    expect(text).not.toContain("\ufffd");
  });

  it("drops a leading continuation byte", () => {
    const full = Buffer.from("漢", "utf8");
    const shifted = full.subarray(1);
    const text = decodeUtf8Window(shifted, 1);
    expect(text).not.toContain("\ufffd");
  });

  it("passes through aligned text unchanged", () => {
    const text = "hello 你好 🎉 world";
    expect(decodeUtf8Window(Buffer.from(text, "utf8"), 0)).toBe(text);
  });
});
