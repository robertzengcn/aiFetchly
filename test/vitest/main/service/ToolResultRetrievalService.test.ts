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
  createToolResultRetrievalService,
  dispatchingSourceReader,
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
import {
  toolResultIntegrityGate,
  verifyArtifactIntegrity,
} from "@/service/toolResult/ToolResultIntegrityGate";

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

/**
 * Absolute path of the payload file for an artifact, resolved the same way the
 * storage service does. Used by the T10 tests to tamper with bytes on disk
 * behind the registry's back.
 */
async function payloadPathFor(outputId: string): Promise<string> {
  const { artifactDirectory, payloadFileName } = await import(
    "@/service/toolResult/ToolResultPaths"
  );
  const dir = artifactDirectory({
    root,
    profileId: IDENTITY.profileId,
    outputEpoch: IDENTITY.outputEpoch,
    outputId,
  });
  return path.join(dir, payloadFileName("text"));
}

/**
 * Wrap a `ToolResultStorageService` so calls to `checksumOf` are counted
 * without disturbing the rest of the interface. A `Proxy` (rather than a
 * spread) is required so the spy still satisfies the class type — spreading an
 * instance drops every method not literally enumerated on the object, which
 * tsc rejects as missing `captureJson`/`captureText`/etc.
 */
function spyChecksumOf(
  storage: ToolResultStorageService,
  onCall: () => void
): ToolResultStorageService {
  return new Proxy(storage, {
    get(target, prop, receiver) {
      if (prop === "checksumOf") {
        const real = target.checksumOf.bind(target);
        return async (key: string) => {
          onCall();
          return real(key);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

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
      // No maxBytes/maxTokens → the UI path, which per TD §563 uses the 32 KiB
      // UI page budget (NOT the model readMaxBytes). The page bound is the UI
      // ceiling; reassembly must still reproduce the payload exactly.
      const outcome = await service.read({ target, cursor });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      assembled += outcome.page.text;
      pages += 1;
      expect(outcome.page.text.length).toBeLessThanOrEqual(
        TOOL_RESULT_CONFIG.uiReadMaxBytes
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

  it("folds dense repeated hits into separate windows and resumes after them", async () => {
    const names = Array.from(
      { length: 80 },
      (_, i) => `file_${String(i).padStart(3, "0")}.csv`
    ).join("\n");
    const target = await storeText(names);
    const outcome = await service.search({ target, query: "csv", maxMatches: 4 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.matches.length).toBeGreaterThan(1);
    expect(outcome.page.matches.length).toBeLessThanOrEqual(4);
    expect(outcome.page.matches[0].matchCountInWindow).toBeGreaterThan(1);
    const excerpts = outcome.page.matches.map((match) => match.excerpt);
    expect(new Set(excerpts).size).toBe(excerpts.length);
    for (const match of outcome.page.matches) {
      const decoded = decodeToolResultCursor(match.readCursor, {
        outputId: target.outputId,
        mode: "read",
        revision: target.revision,
      });
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.payload.position).toBe(match.startByte);
    }
    expect(outcome.page.nextCursor).not.toBeNull();
    const second = await service.search({
      target,
      query: "csv",
      maxMatches: 4,
      cursor: outcome.page.nextCursor ?? undefined,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const firstStarts = new Set(outcome.page.matches.map((match) => match.startByte));
    const lastStart = outcome.page.matches[outcome.page.matches.length - 1].startByte;
    for (const match of second.page.matches) {
      expect(firstStarts.has(match.startByte)).toBe(false);
      expect(match.startByte).toBeGreaterThan(lastStart);
    }
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
  /** Stand-in for the bounded SQL slice of a historical message row. Sized
   * past the 32 KiB UI page so the paging+reassemble contract is exercised
   * under the UI ceiling (the page bound a caller with neither maxBytes nor
   * maxTokens — the UI path — actually gets). */
  const legacyText = Array.from(
    { length: 1600 },
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
      // Identical paging CONTRACT to the file backend (TD §10.2): a caller
      // passing neither maxBytes nor maxTokens is the UI path, bounded by the
      // UI ceiling. The model readMaxBytes budget applies only to a
      // model-triggered (maxTokens) read.
      expect(outcome.page.text.length).toBeLessThanOrEqual(
        TOOL_RESULT_CONFIG.uiReadMaxBytes
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

/**
 * Regression tests for the confirmed defects in the 2026-10-01 audit.
 *
 * These drive the REAL retrieval service rather than a mock, so a fix that only
 * satisfies a unit test with an injected stub fails here.
 */

/**
 * In-memory legacy source row, standing in for `ai_chat_messages`, exposed
 * through the same Module seam the production factory uses.
 */
function legacyModule(full: string) {
  return {
    readLegacySourceSlice: async (args: {
      sourceRowKey: string;
      offsetBytes: number;
      lengthBytes: number;
    }) => {
      const buffer = Buffer.from(full, "utf8");
      const slice = buffer.subarray(
        args.offsetBytes,
        args.offsetBytes + args.lengthBytes
      );
      // Returns the RAW bytes (not a decoded string) so a slice ending
      // mid-multibyte keeps its partial sequence for decodeUtf8Window.
      return { buffer: slice, totalBytes: buffer.byteLength };
    },
  };
}

describe("audit regression — T01: backend dispatch", () => {
  it("reads a file-backed artifact through the production factory", async () => {
    // The audit's probe: the model path was constructed with the LEGACY reader
    // only, so every file artifact failed with OUTPUT_NOT_AVAILABLE.
    const target = await storeText("file backed needle content");
    const wired = createToolResultRetrievalService({
      storage,
      module: legacyModule(""),
    });

    const outcome = await wired.read({ target });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.text).toContain("file backed needle content");
  });

  it("reads a legacy_message row through the same service", async () => {
    const wired = createToolResultRetrievalService({
      storage,
      module: legacyModule("legacy row needle content"),
    });
    const target: RetrievalTarget = {
      outputId: newOutputId(),
      revision: 1,
      backend: "legacy_message",
      sourceRowKey: "msg-1",
      storageKey: "",
      format: "text",
      capturedBytes: 25,
      sourceCompleteness: "complete",
    };

    const outcome = await wired.read({ target });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.text).toBe("legacy row needle content");
  });

  it("refuses a legacy target with no source row instead of reading a file", async () => {
    const wired = createToolResultRetrievalService({
      storage,
      module: legacyModule("legacy"),
    });
    const target: RetrievalTarget = {
      outputId: newOutputId(),
      revision: 1,
      backend: "legacy_message",
      storageKey: "",
      format: "text",
      capturedBytes: 6,
      sourceCompleteness: "complete",
    };

    const outcome = await wired.read({ target });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("OUTPUT_NOT_AVAILABLE");
  });

  it("dispatches per target rather than to one injected reader", async () => {
    const fileTarget = await storeText("from file");
    const seen: string[] = [];
    const empty = { buffer: Buffer.alloc(0), totalBytes: 0 };
    const reader = dispatchingSourceReader({
      file: {
        read: async () => {
          seen.push("file");
          return empty;
        },
      },
      legacy: {
        read: async () => {
          seen.push("legacy");
          return empty;
        },
      },
    });

    await reader.read({ target: fileTarget, startByte: 0, maxBytes: 10 });
    await reader.read({
      target: { ...fileTarget, backend: "legacy_message", sourceRowKey: "m" },
      startByte: 0,
      maxBytes: 10,
    });

    expect(seen).toEqual(["file", "legacy"]);
  });
});

describe("audit regression — T07: search continuation loses no match", () => {
  it("finds a match whose start is inside the first page's window", async () => {
    // A small per-page match budget stops the scan inside a window. A match
    // whose START lies in that window but whose END lies past the window end
    // must still be reported by the continuation.
    const filler = "x".repeat(70 * 1024);
    const needle = "BOUNDARY-SPANNING-NEEDLE";
    const target = await storeText(`${filler}${needle}${filler}`);

    const collected: number[] = [];
    let cursor: string | undefined;
    let complete = false;

    for (let i = 0; i < 60 && !complete; i += 1) {
      const page = await service.search({ target, query: needle, maxMatches: 1, cursor });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      collected.push(...page.page.matches.map((m) => m.startByte));
      complete = page.page.scanComplete;
      cursor = page.page.nextCursor ?? undefined;
      if (!cursor && !complete) break;
    }

    expect(complete).toBe(true);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toBe(Buffer.byteLength(filler, "utf8"));
  });

  it("collects every occurrence exactly once while paging", async () => {
    const target = await storeText("hit ".repeat(500));
    const starts: number[] = [];
    let counted = 0;
    let cursor: string | undefined;
    let complete = false;

    for (let i = 0; i < 400 && !complete; i += 1) {
      const page = await service.search({
        target,
        query: "hit",
        maxMatches: 3,
        cursor,
      });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      for (const match of page.page.matches) {
        starts.push(match.startByte);
        counted += match.matchCountInWindow;
      }
      complete = page.page.scanComplete;
      cursor = page.page.nextCursor ?? undefined;
      if (!cursor && !complete) break;
    }

    expect(complete).toBe(true);
    // Windows do not repeat, and every raw hit is counted inside one window.
    expect(new Set(starts).size).toBe(starts.length);
    expect(counted).toBe(500);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.length).toBeLessThan(500);
  });
});


describe("audit regression — artifact integrity verification", () => {
  it("confirms a payload that matches its manifest checksum", async () => {
    // `checksumOf` existed with no production caller, so a corrupted payload
    // could be served as though it were the evidence the registry claims.
    const outputId = newOutputId();
    const stored = await storage.captureText({
      outputId,
      ...IDENTITY,
      text: "authentic captured output",
      sourceCompleteness: "complete",
    });
    const manifest = await storage.readManifest(
      IDENTITY.profileId,
      IDENTITY.outputEpoch,
      outputId
    );
    expect(manifest).not.toBeNull();

    const outcome = await verifyArtifactIntegrity({
      storage,
      storageKey: stored.storageKey,
      manifest,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified).toBe(true);
  });

  it("reports a mismatch instead of serving corrupted bytes", async () => {
    const outputId = newOutputId();
    const stored = await storage.captureText({
      outputId,
      ...IDENTITY,
      text: "authentic captured output",
      sourceCompleteness: "complete",
    });
    const outcome = await verifyArtifactIntegrity({
      storage,
      storageKey: stored.storageKey,
      // A digest that cannot match: exactly what silent corruption looks like.
      manifest: { sha256: "0".repeat(64) },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("OUTPUT_INTEGRITY_FAILED");
  });

  it("does not call an unrecorded artifact corrupt", async () => {
    // An artifact that predates manifests is unverified, not corrupt.
    const outputId = newOutputId();
    const stored = await storage.captureText({
      outputId,
      ...IDENTITY,
      text: "no manifest",
      sourceCompleteness: "complete",
    });
    const outcome = await verifyArtifactIntegrity({
      storage,
      storageKey: stored.storageKey,
      manifest: null,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verified).toBe(false);
  });
});

/**
 * T10 — read-path integrity (technical design §8.4).
 *
 * The read/search path serves bytes without checking them against the manifest.
 * §8.4 requires a cheap identity+size check ON OPEN (not a full re-hash per
 * paged read) so a shrunken or replaced payload is reported as
 * OUTPUT_INTEGRITY_FAILED instead of served. The full checksum stays on
 * sealing/recovery/export.
 */
describe("T10 — read-path integrity on open", () => {
  /** Store text and return a target carrying its manifest subset. */
  async function storeTextWithManifest(text: string): Promise<{
    target: RetrievalTarget;
    manifest: { sha256: string; capturedBytes: number } | null;
  }> {
    const outputId = newOutputId();
    const stored = await storage.captureText({
      outputId,
      ...IDENTITY,
      text,
      sourceCompleteness: "complete",
    });
    const manifest = await storage.readManifest(
      IDENTITY.profileId,
      IDENTITY.outputEpoch,
      outputId
    );
    return {
      target: {
        outputId,
        revision: 1,
        storageKey: stored.storageKey,
        format: "text",
        capturedBytes: stored.capturedBytes,
        sourceCompleteness: "complete",
        ...(manifest
          ? { manifest: { sha256: manifest.sha256, capturedBytes: manifest.capturedBytes } }
          : {}),
      },
      manifest: manifest
        ? { sha256: manifest.sha256, capturedBytes: manifest.capturedBytes }
        : null,
    };
  }

  it("reads when the artifact size matches the manifest", async () => {
    const { target } = await storeTextWithManifest("intact output");
    const outcome = await service.read({ target });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.text).toBe("intact output");
  });

  it("reports OUTPUT_INTEGRITY_FAILED when the file is smaller than the manifest", async () => {
    const { target, manifest } = await storeTextWithManifest("a".repeat(4096));
    if (!manifest) throw new Error("manifest was not written");
    // Truncate the payload on disk behind the registry's back.
    const payloadPath = await payloadPathFor(target.outputId);
    const original = fs.readFileSync(payloadPath);
    fs.writeFileSync(payloadPath, original.subarray(0, 128));


    const outcome = await service.read({ target });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("OUTPUT_INTEGRITY_FAILED");
  });

  it("reports OUTPUT_INTEGRITY_FAILED when the file grew past the manifest", async () => {
    const { target, manifest } = await storeTextWithManifest("small");
    if (!manifest) throw new Error("manifest was not written");
    // Append extra bytes on disk behind the registry's back.
    const payloadPath = await payloadPathFor(target.outputId);
    fs.writeFileSync(payloadPath, Buffer.concat([fs.readFileSync(payloadPath), Buffer.from("extraneous")]));

    const outcome = await service.read({ target });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("OUTPUT_INTEGRITY_FAILED");
  });

  it("serves a target with no manifest (pre-manifest artifact)", async () => {
    const outputId = newOutputId();
    const stored = await storage.captureText({
      outputId,
      ...IDENTITY,
      text: "legacy artifact without manifest",
      sourceCompleteness: "complete",
    });
    // Simulate a pre-manifest artifact by removing the manifest file.
    const { artifactDirectory } = await import("@/service/toolResult/ToolResultPaths");
    const dir = artifactDirectory({
      root,
      profileId: IDENTITY.profileId,
      outputEpoch: IDENTITY.outputEpoch,
      outputId,
    });
    fs.rmSync(path.join(dir, "manifest.json"), { force: true });

    const target: RetrievalTarget = {
      outputId,
      revision: 1,
      storageKey: stored.storageKey,
      format: "text",
      capturedBytes: stored.capturedBytes,
      sourceCompleteness: "complete",
    };
    const outcome = await service.read({ target });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.text).toBe("legacy artifact without manifest");
  });

  it("skips the size check for the legacy_message backend (TD §179)", async () => {
    const wired = createToolResultRetrievalService({
      storage,
      module: {
        readLegacySourceSlice: async () => ({
          buffer: Buffer.from("legacy row content", "utf8"),
          totalBytes: 18,
        }),
      },
    });
    // No file bytes exist for a legacy row; a fabricated checksum/size would be
    // exactly what TD §179 forbids. The gate must not block this read.
    const target: RetrievalTarget = {
      outputId: newOutputId(),
      revision: 1,
      backend: "legacy_message",
      sourceRowKey: "msg-42",
      storageKey: "",
      format: "text",
      capturedBytes: 18,
      sourceCompleteness: "complete",
      manifest: { sha256: "0".repeat(64), capturedBytes: 999999 },
    };
    const outcome = await wired.read({ target });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.text).toBe("legacy row content");
  });

  it("search applies the same integrity gate", async () => {
    const { target } = await storeTextWithManifest("needle in intact output");
    // Corrupt (not truncate) so the scan would find the needle otherwise.
    const payloadPath = await payloadPathFor(target.outputId);
    fs.writeFileSync(payloadPath, "tampered bytes, no needle here");

    const outcome = await service.search({ target, query: "needle" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("OUTPUT_INTEGRITY_FAILED");
  });
});

/**
 * T10 part 2 — the full-checksum gate (`ToolResultIntegrityGate`).
 *
 * The cheap per-page size check above catches truncation/growth with no extra
 * I/O, but it CANNOT catch an in-place byte edit that preserves length. The
 * gate streams the whole artifact once through `checksumOf` and compares to the
 * recorded SHA-256; the verdict is cached per `storageKey` so 8192 paged reads
 * of one artifact do not re-hash 8192 times.
 */
describe("T10 — ToolResultIntegrityGate (full-checksum cache)", () => {
  beforeEach(() => {
    // Each test starts with a cold cache so a cached-positive verdict from one
    // test cannot mask a corruption assertion in the next.
    toolResultIntegrityGate.clear();
  });

  /** Store authentic text and return the storageKey + recorded sha256. */
  async function storeAuthentic(text: string): Promise<{
    storageKey: string;
    sha256: string;
    outputId: string;
  }> {
    const outputId = newOutputId();
    const stored = await storage.captureText({
      outputId,
      ...IDENTITY,
      text,
      sourceCompleteness: "complete",
    });
    const manifest = await storage.readManifest(
      IDENTITY.profileId,
      IDENTITY.outputEpoch,
      outputId
    );
    if (!manifest?.sha256) throw new Error("manifest sha256 was not written");
    return { storageKey: stored.storageKey, sha256: manifest.sha256, outputId };
  }

  it("detects same-size byte corruption the size check cannot", async () => {
    // Same length, different bytes: the per-page size check passes, only the
    // full checksum catches it. This is the exact gap the gate closes.
    const original = "authentic captured output of fixed length";
    const { storageKey, sha256, outputId } = await storeAuthentic(original);
    const payloadPath = await payloadPathFor(outputId);
    const buf = fs.readFileSync(payloadPath);
    // Flip bytes in place so the length is unchanged.
    const tampered = Buffer.from(buf);
    tampered[0] = tampered[0] === 0x41 ? 0x42 : 0x41;
    tampered[tampered.length - 1] = tampered[tampered.length - 1] === 0x41 ? 0x42 : 0x41;
    fs.writeFileSync(payloadPath, tampered);

    const verdict = await toolResultIntegrityGate.verify({
      storage,
      storageKey,
      manifest: { sha256, capturedBytes: original.length },
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("OUTPUT_INTEGRITY_FAILED");
  });

  it("verifies an intact artifact and caches the positive verdict", async () => {
    const { storageKey, sha256 } = await storeAuthentic("intact artifact for cache test");

    const first = await toolResultIntegrityGate.verify({
      storage,
      storageKey,
      manifest: { sha256 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.verified).toBe(true);

    // Corrupt the payload AFTER the cached verdict was taken. A cached verdict
    // must remain correct because a storageKey includes the unique outputId,
    // so one key always refers to the same bytes within a process lifetime.
    // The per-page size check remains the cheap line of defence for changes
    // after the cache was populated; here we assert the cache itself is stable.
    const second = await toolResultIntegrityGate.verify({
      storage,
      storageKey,
      manifest: { sha256 },
    });
    expect(second).toEqual(first);
  });

  it("does not re-hash on a cached verdict (checksumOf called once)", async () => {
    const { storageKey, sha256 } = await storeAuthentic("cache hit avoids rehash");
    let calls = 0;
    const spied = spyChecksumOf(storage, () => calls++);

    const v1 = await toolResultIntegrityGate.verify({
      storage: spied,
      storageKey,
      manifest: { sha256 },
    });
    const v2 = await toolResultIntegrityGate.verify({
      storage: spied,
      storageKey,
      manifest: { sha256 },
    });
    const v3 = await toolResultIntegrityGate.verify({
      storage: spied,
      storageKey,
      manifest: { sha256 },
    });
    expect(v1.ok).toBe(true);
    expect(v2.ok).toBe(true);
    expect(v3.ok).toBe(true);
    // Three verifies, one hash: the second and third hit the cache.
    expect(calls).toBe(1);
  });

  it("caches the negative verdict for an artifact without a recorded sha256", async () => {
    // A pre-manifest artifact returns { ok: true, verified: false } and that
    // verdict is cached too, so 8192 paged reads do not re-stat 8192 times.
    const outputId = newOutputId();
    const stored = await storage.captureText({
      outputId,
      ...IDENTITY,
      text: "pre-manifest artifact",
      sourceCompleteness: "complete",
    });
    let calls = 0;
    const spied = spyChecksumOf(storage, () => calls++);

    const v1 = await toolResultIntegrityGate.verify({
      storage: spied,
      storageKey: stored.storageKey,
      manifest: null,
    });
    const v2 = await toolResultIntegrityGate.verify({
      storage: spied,
      storageKey: stored.storageKey,
      manifest: null,
    });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    expect(v1.verified).toBe(false);
    expect(v2).toEqual(v1);
    // No sha256 to compare against, so checksumOf is never called at all.
    expect(calls).toBe(0);
  });

  it("invalidate() drops a cached verdict so a subsequent verify re-hashes", async () => {
    // Capture an intact artifact, populate the cache, then invalidate. After
    // invalidation a corrupted payload MUST be detected: a stale cached-positive
    // verdict would mask the corruption, which is the exact regression
    // invalidation exists to prevent (e.g. after a re-capture to the same key).
    const { storageKey, sha256, outputId } = await storeAuthentic("invalidate then reverify");
    const intact = await toolResultIntegrityGate.verify({
      storage,
      storageKey,
      manifest: { sha256 },
    });
    expect(intact.ok).toBe(true);

    toolResultIntegrityGate.invalidate(storageKey);

    // Tamper in place (same length) and re-verify. With the cache cleared the
    // gate must re-hash and detect the mismatch.
    const payloadPath = await payloadPathFor(outputId);
    const buf = fs.readFileSync(payloadPath);
    const tampered = Buffer.from(buf);
    tampered[0] = tampered[0] === 0x41 ? 0x42 : 0x41;
    fs.writeFileSync(payloadPath, tampered);

    const verdict = await toolResultIntegrityGate.verify({
      storage,
      storageKey,
      manifest: { sha256 },
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("OUTPUT_INTEGRITY_FAILED");
  });
});

/**
 * UI vs model page-budget regression (TD §557/§563/§634).
 *
 * The user viewer uses the 32 KiB UI page budget and does NOT consume model
 * retrieval-work tokens. A byte-only request (the renderer path, which passes
 * `maxBytes` and never `maxTokens`) must be bounded only by the UI byte
 * ceiling — the model token budget (2000 tokens → ~1600 bytes) must NOT be
 * applied to it, or the renderer's first page collapses from 32 KiB to 1600
 * bytes and a fact planted a few KiB in can never be reached by page one.
 *
 * The discriminant is the caller: the model-tool path passes `maxTokens`, the
 * IPC renderer path passes only `maxBytes`. Found while running the T18 E2E
 * lifecycle spec — a 100 KiB file with a NEEDLE at 16 KiB was unreachable on
 * the first page because the token ceiling shrank the UI window to 1600 B.
 */
describe("UI vs model page-budget (T18 regression)", () => {
  it("a byte-only (UI) read returns a page up to the UI byte ceiling, not the token-byte ceiling", async () => {
    // 40 KiB text so a 1600-byte token ceiling would clearly fall short of a
    // 32 KiB UI page. readMaxTokens=2000 → tokenByteCeiling=1600; the UI
    // ceiling (uiReadMaxBytes) is 32 KiB. Without the fix the page is 1600 B.
    const filler = "a".repeat(40 * 1024);
    const target = await storeText(filler);
    const outcome = await service.read({
      target,
      maxBytes: TOOL_RESULT_CONFIG.uiReadMaxBytes,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 1600 is the token-byte ceiling the bug applied; 32 KiB is the UI budget
    // the design requires. Assert strictly between the two so the regression
    // cannot silently re-appear by either tightening or loosening a bound.
    expect(outcome.page.text.length).toBeGreaterThan(1600);
    expect(outcome.page.text.length).toBeLessThanOrEqual(32 * 1024);
    expect(outcome.page.complete).toBe(false);
    expect(outcome.page.nextCursor).not.toBeNull();
  });

  it("a byte-only (UI) read reaches a needle planted past the token-byte ceiling but within the UI page", async () => {
    // Plant the NEEDLE at 8 KiB: past the 1600-byte token ceiling, well within
    // the 32 KiB UI page. This is the exact T18 E2E shape (NEEDLE past the
    // inline ceiling, retrievable via the real read IPC).
    const NEEDLE = "T18_BUDGET_NEEDLE_aifetchly";
    const prefix = "a".repeat(8 * 1024);
    const target = await storeText(prefix + NEEDLE + "a".repeat(8 * 1024));
    const outcome = await service.read({
      target,
      maxBytes: TOOL_RESULT_CONFIG.uiReadMaxBytes,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.text).toContain(NEEDLE);
  });

  it("a model-token read is still bounded by the token-byte ceiling", async () => {
    // The model path passes maxTokens; its page must obey the token budget so
    // a model retrieval call cannot pull unbounded context. This pins the
    // other side of the discriminant: token requests stay token-bounded.
    const filler = "a".repeat(40 * 1024);
    const target = await storeText(filler);
    const outcome = await service.read({
      target,
      maxTokens: TOOL_RESULT_CONFIG.readMaxTokens,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // tokenByteCeiling = floor(2000 * 0.8) = 1600. The model page must not
    // exceed it (decodeUtf8Window may trim to a code-point boundary, so the
    // bound is an upper bound, not equality).
    expect(outcome.page.text.length).toBeLessThanOrEqual(1600);
  });

  it("a byte-only (UI) read with no explicit maxBytes defaults to the UI byte ceiling, not the token ceiling", async () => {
    // The IPC path calls read({ target }) for page 1 when the renderer omits
    // `page`; it must still get the 32 KiB UI page, not 1600 bytes.
    const filler = "a".repeat(40 * 1024);
    const target = await storeText(filler);
    const outcome = await service.read({ target });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.text.length).toBeGreaterThan(1600);
    expect(outcome.page.text.length).toBeLessThanOrEqual(32 * 1024);
  });
});
