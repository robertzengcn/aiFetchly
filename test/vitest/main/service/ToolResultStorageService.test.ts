import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  ToolResultStorageService,
  ToolResultStorageError,
} from "@/service/toolResult/ToolResultStorageService";
import {
  MemorySerializerSink,
  ToolResultSerializationError,
  serializeValue,
} from "@/service/toolResult/ToolResultSerializer";
import {
  assertReadableRegularFile,
  resolveStorageKey,
  storageKeyFor,
} from "@/service/toolResult/ToolResultPaths";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";

/**
 * Serialization fidelity and storage-lifecycle tests.
 *
 * The claims under test are the ones the design makes about EXACTNESS: for a
 * supported complete fixture, the captured bytes must reconstruct to the same
 * content and the same checksum, including CJK, emoji, and long unbroken
 * lines (NFR-06, AC-02, AC-06).
 */

let root: string;
let service: ToolResultStorageService;

function newOutputId(): string {
  return `out_${crypto.randomBytes(16).toString("hex")}`;
}

const IDENTITY = {
  profileId: "prof-1",
  outputEpoch: "epoch-1",
};

beforeEach(() => {
  root = path.join(os.tmpdir(), `aifetchly-toolstorage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(root, { recursive: true });
  service = new ToolResultStorageService({ root });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Serialize into memory with a generous cap (test helper). */
async function toText(value: unknown, maxBytes = 8 * 1024 * 1024): Promise<string> {
  const sink = new MemorySerializerSink(maxBytes);
  const outcome = await serializeValue(value, sink, { format: "json" });
  expect(outcome.truncated).toBe(false);
  return sink.toBuffer().toString("utf8");
}

describe("serializeValue — fidelity", () => {
  it("round-trips nested structures exactly", async () => {
    const value = {
      businesses: [
        { name: "Acme", tags: ["a", "b"], nested: { score: 1.5, ok: true } },
        { name: "Ünïcödé Ltd", tags: [], nested: { score: -0.25, ok: false } },
      ],
      total: 2,
      page: { cursor: null, hasMore: false },
    };
    const text = await toText(value);
    expect(JSON.parse(text)).toEqual(value);
  });

  it("preserves CJK and emoji byte-for-byte (AC-06)", async () => {
    const value = { text: "你好世界 🎉 こんにちは 안녕하세요" };
    const text = await toText(value);
    expect(JSON.parse(text).text).toBe("你好世界 🎉 こんにちは 안녕하세요");
  });

  it("keeps long unbroken lines intact rather than truncating mid-line", async () => {
    const long = "x".repeat(200_000);
    const text = await toText({ long });
    expect(JSON.parse(text).long).toBe(long);
  });

  it("omits undefined object properties, matching JSON semantics", async () => {
    const text = await toText({ keep: 1, drop: undefined });
    expect(JSON.parse(text)).toEqual({ keep: 1 });
    expect(text).not.toContain("drop");
  });

  it("serializes an undefined array element as null to keep array shape", async () => {
    const text = await toText([1, undefined, 3]);
    expect(JSON.parse(text)).toEqual([1, null, 3]);
  });

  it("computes a checksum over exactly the emitted bytes", async () => {
    const sink = new MemorySerializerSink(1024 * 1024);
    const value = { a: 1, b: "two", c: [3, 4] };
    const outcome = await serializeValue(value, sink, { format: "json" });
    const emitted = sink.toBuffer();
    expect(outcome.sha256).toBe(crypto.createHash("sha256").update(emitted).digest("hex"));
    expect(outcome.bytesWritten).toBe(emitted.byteLength);
  });

  it("reports a record count for a top-level array", async () => {
    const sink = new MemorySerializerSink(1024 * 1024);
    const outcome = await serializeValue([1, 2, 3, 4], sink, { format: "json" });
    expect(outcome.recordCount).toBe(4);
  });
});

describe("serializeValue — typed rejections", () => {
  it("rejects a circular reference", async () => {
    const value: Record<string, unknown> = { name: "loop" };
    value.self = value;
    await expect(toText(value)).rejects.toBeInstanceOf(ToolResultSerializationError);
  });

  it("rejects BigInt instead of coercing it", async () => {
    // BigInt() rather than a 1n literal: the project targets below ES2020.
    await expect(toText({ big: BigInt(1) })).rejects.toThrow(/bigint/i);
  });

  it("rejects a function value", async () => {
    await expect(toText({ fn: () => 1 })).rejects.toThrow(/function/i);
  });

  it("rejects an unsupported prototype rather than invoking toJSON", async () => {
    class Custom {
      toJSON(): string {
        return "SHOULD-NOT-BE-CALLED";
      }
    }
    await expect(toText({ custom: new Custom() })).rejects.toThrow(
      /unsupported object prototype/i
    );
  });

  it("rejects an accessor property rather than invoking the getter", async () => {
    let invoked = false;
    const value = {
      get boom(): string {
        invoked = true;
        return "nope";
      },
    };
    await expect(toText(value)).rejects.toThrow(/accessor/i);
    expect(invoked).toBe(false);
  });

  it("rejects nesting past the configured depth", async () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 200; i += 1) deep = { deep };
    await expect(toText(deep)).rejects.toThrow(/nesting deeper/i);
  });

  it("rejects a non-finite number rather than emitting invalid JSON", async () => {
    await expect(toText({ n: Number.POSITIVE_INFINITY })).rejects.toThrow(
      /non-finite/i
    );
  });
});

describe("serializeValue — cap behaviour", () => {
  it("stops at the sink cap and reports truncation", async () => {
    const sink = new MemorySerializerSink(64);
    const outcome = await serializeValue({ big: "y".repeat(10_000) }, sink, {
      format: "json",
    });
    expect(outcome.truncated).toBe(true);
    expect(outcome.bytesWritten).toBeLessThanOrEqual(64);
  });
});

describe("ToolResultStorageService — artifacts", () => {
  it("captures a small JSON result and can read it back exactly", async () => {
    const outputId = newOutputId();
    const value = { total: 2400, items: [{ id: 1, name: "Acme" }] };
    const stored = await service.captureJson({
      outputId,
      ...IDENTITY,
      value,
      sourceCompleteness: "complete",
    });

    expect(stored.preservation).toBe("complete");
    expect(stored.format).toBe("json");
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.recordCount).toBeUndefined();

    const window = await service.readWindow({
      storageKey: stored.storageKey,
      startByte: 0,
      maxBytes: 64 * 1024,
    });
    expect(JSON.parse(window.buffer.toString("utf8"))).toEqual(value);
    expect(window.totalBytes).toBe(stored.capturedBytes);
  });

  it("verifies the stored checksum matches the emitted bytes (NFR-06)", async () => {
    const outputId = newOutputId();
    const stored = await service.captureJson({
      outputId,
      ...IDENTITY,
      value: { cjk: "你好 🎉", n: 42 },
      sourceCompleteness: "complete",
    });
    const actual = await service.checksumOf(stored.storageKey);
    expect(actual).toBe(stored.sha256);
  });

  it("records a record count for an array result", async () => {
    const outputId = newOutputId();
    const stored = await service.captureJson({
      outputId,
      ...IDENTITY,
      value: [{ i: 1 }, { i: 2 }, { i: 3 }],
      sourceCompleteness: "complete",
    });
    expect(stored.recordCount).toBe(3);
  });

  it("spools a large result to disk without holding it in memory", async () => {
    const outputId = newOutputId();
    // Comfortably above the 16 KiB inline allowance.
    const value = { rows: Array.from({ length: 4000 }, (_, i) => ({ i, name: `row-${i}` })) };
    const stored = await service.captureJson({
      outputId,
      ...IDENTITY,
      value,
      sourceCompleteness: "complete",
    });
    expect(stored.capturedBytes).toBeGreaterThan(TOOL_RESULT_CONFIG.inlineMaxBytes);
    expect(stored.preservation).toBe("complete");

    const window = await service.readWindow({
      storageKey: stored.storageKey,
      startByte: 0,
      maxBytes: 1024 * 1024,
    });
    const parsed = JSON.parse(window.buffer.toString("utf8"));
    expect(parsed.rows).toHaveLength(4000);
    expect(parsed.rows[3999].name).toBe("row-3999");
  });

  it("captures text and marks an over-cap stream as partial (AC-15)", async () => {
    const outputId = newOutputId();
    const huge = "l".repeat(TOOL_RESULT_CONFIG.artifactMaxBytes + 1024);
    const stored = await service.captureText({
      outputId,
      ...IDENTITY,
      text: huge,
      sourceCompleteness: "complete",
    });
    expect(stored.preservation).toBe("partial");
    expect(stored.failureCode).toBe("ARTIFACT_LIMIT_REACHED");
    // The producer said "complete" and the capture preserved everything it
    // received; the two facts stay independent.
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("surfaces a typed code for an unserializable value", async () => {
    const outputId = newOutputId();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(
      service.captureJson({
        outputId,
        ...IDENTITY,
        value: cyclic,
        sourceCompleteness: "complete",
      })
    ).rejects.toBeInstanceOf(ToolResultStorageError);
  });

  it("writes a bounded manifest with integrity metadata", async () => {
    const outputId = newOutputId();
    const stored = await service.captureJson({
      outputId,
      ...IDENTITY,
      value: { a: 1 },
      sourceCompleteness: "complete",
    });
    const manifest = await service.readManifest(IDENTITY.profileId, IDENTITY.outputEpoch, outputId);
    expect(manifest).not.toBeNull();
    expect(manifest?.outputId).toBe(outputId);
    expect(manifest?.sha256).toBe(stored.sha256);
    expect(manifest?.preservation).toBe("complete");
  });

  it("leaves no staging file behind after a successful commit", async () => {
    const outputId = newOutputId();
    const stored = await service.captureJson({
      outputId,
      ...IDENTITY,
      value: { a: 1 },
      sourceCompleteness: "complete",
    });
    expect(fs.existsSync(`${stored.absolutePath}.staging`)).toBe(false);
    expect(fs.existsSync(stored.absolutePath)).toBe(true);
  });

  it("deletes an artifact idempotently", async () => {
    const outputId = newOutputId();
    const stored = await service.captureJson({
      outputId,
      ...IDENTITY,
      value: { a: 1 },
      sourceCompleteness: "complete",
    });
    await service.deleteArtifact(IDENTITY.profileId, IDENTITY.outputEpoch, outputId);
    await service.deleteArtifact(IDENTITY.profileId, IDENTITY.outputEpoch, outputId);
    expect(fs.existsSync(stored.absolutePath)).toBe(false);
  });

  it("reads a bounded window without loading the whole payload", async () => {
    const outputId = newOutputId();
    const stored = await service.captureJson({
      outputId,
      ...IDENTITY,
      value: { rows: Array.from({ length: 1500 }, (_, i) => ({ i })) },
      sourceCompleteness: "complete",
    });
    const page = await service.readWindow({
      storageKey: stored.storageKey,
      startByte: 0,
      maxBytes: 256,
    });
    expect(page.buffer.byteLength).toBe(256);
    expect(page.totalBytes).toBe(stored.capturedBytes);
  });
});

describe("ToolResultPaths — path safety", () => {
  it("never embeds producer or user names in the path", () => {
    const outputId = newOutputId();
    const key = storageKeyFor({
      profileId: "Profile With Spaces",
      outputEpoch: "epoch",
      outputId,
      format: "json",
    });
    // A hostile/awkward profile name must not leak into the path, and the
    // layout is fully determined by internally generated segments.
    expect(key).not.toContain(" ");
    expect(key).not.toContain("Profile");
    expect(key.endsWith("payload.json")).toBe(true);
  });

  it("refuses a storage key that escapes the managed root", () => {
    expect(() =>
      resolveStorageKey(service.getRoot(), "../../../etc/passwd")
    ).toThrow(/escapes/i);
  });

  it("refuses an absolute storage key outside the managed root", () => {
    expect(() => resolveStorageKey(service.getRoot(), "/etc/passwd")).toThrow(
      /escapes/i
    );
  });

  it("refuses a symlink that points outside the managed root", async () => {
    // The target must be OUTSIDE the managed root for this to be an escape.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-outside-"));
    const outside = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(outside, "secret");
    try {
      const linkDir = path.join(root, "linkdir");
      fs.mkdirSync(linkDir, { recursive: true });
      fs.symlinkSync(outside, path.join(linkDir, "payload.json"));
      await expect(
        assertReadableRegularFile(root, path.join("linkdir", "payload.json"))
      ).rejects.toThrow(/escapes/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses a missing artifact", async () => {
    await expect(
      assertReadableRegularFile(root, path.join("nope", "payload.json"))
    ).rejects.toThrow(/missing/i);
  });
});
