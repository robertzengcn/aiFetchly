/**
 * Streaming text capture (T16 / design §9.3).
 *
 * `captureTextStream` exists for sources whose length is unknown up front
 * (shell stdout/stderr, a tail-followed log). The claims under test are the
 * ones the design makes about exactness and honest completeness:
 *
 *  - append → finalize produces a manifest whose sha256 + capturedBytes match
 *    EXACTLY the bytes that were appended (incremental hash, no re-read);
 *  - the staging file is promoted atomically (no `.staging` remnant);
 *  - hitting `artifactMaxBytes` seals the capture as `partial` with
 *    `failureCode: ARTIFACT_LIMIT_REACHED` and drops further chunks;
 *  - writes are serialized — `finalize` awaits in-flight writes, so the
 *    promoted artifact is never missing a pending chunk;
 *  - `abort()` discards the staging file without promoting;
 *  - re-finalize is a typed rejection, not a silent no-op.
 *
 * `artifactMaxBytes` is lowered to 2 KiB via a config mock so the cap path is
 * exercisable without allocating 64 MiB; every other config field stays real.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

vi.mock("@/config/toolResultConfig", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/config/toolResultConfig")>();
  return {
    ...actual,
    TOOL_RESULT_CONFIG: { ...actual.TOOL_RESULT_CONFIG, artifactMaxBytes: 2048 },
  };
});

import {
  ToolResultStorageService,
  ToolResultStorageError,
} from "@/service/toolResult/ToolResultStorageService";
import { artifactDirectory } from "@/service/toolResult/ToolResultPaths";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";

const CAP = TOOL_RESULT_CONFIG.artifactMaxBytes; // 2048 with the mock above

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
  root = path.join(
    os.tmpdir(),
    `aifetchly-capturestream-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(root, { recursive: true });
  service = new ToolResultStorageService({ root });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Open one capture with the standard identity; returns the handle + its id. */
async function openCapture(): Promise<{
  outputId: string;
  capture: Awaited<ReturnType<ToolResultStorageService["captureTextStream"]>>;
}> {
  const outputId = newOutputId();
  const capture = await service.captureTextStream({
    outputId,
    ...IDENTITY,
    sourceCompleteness: "complete",
  });
  return { outputId, capture };
}

/** The artifact directory for a capture's identity (to assert no remnant). */
function artifactDir(outputId: string): string {
  return artifactDirectory({
    root,
    profileId: IDENTITY.profileId,
    outputEpoch: IDENTITY.outputEpoch,
    outputId,
  });
}

describe("captureTextStream — append → finalize exactness", () => {
  it("persists appended chunks with a manifest matching the exact bytes", async () => {
    const { outputId, capture } = await openCapture();
    const chunks = [
      Buffer.from("hello ", "utf8"),
      Buffer.from("world", "utf8"),
      Buffer.from("\nsecond line", "utf8"),
    ];
    for (const chunk of chunks) {
      expect(capture.appendChunk(chunk)).toBe(true);
    }

    const expected = Buffer.concat(chunks);
    const stored = await capture.finalize(expected.byteLength);

    expect(stored.outputId).toBe(outputId);
    expect(stored.capturedBytes).toBe(expected.byteLength);
    expect(stored.originalBytes).toBe(expected.byteLength);
    expect(stored.format).toBe("text");
    expect(stored.preservation).toBe("complete");
    expect(stored.failureCode).toBeUndefined();
    // Incremental sha256 must equal a fresh hash of the exact bytes.
    const expectedHash = crypto
      .createHash("sha256")
      .update(expected)
      .digest("hex");
    expect(stored.sha256).toBe(expectedHash);

    // The promoted file reconstructs to the same content.
    const onDisk = await fs.promises.readFile(stored.absolutePath);
    expect(onDisk.equals(expected)).toBe(true);

    // The manifest reflects the same identity + checksum.
    const manifest = await service.readManifest(
      IDENTITY.profileId,
      IDENTITY.outputEpoch,
      outputId
    );
    expect(manifest).not.toBeNull();
    expect(manifest?.sha256).toBe(expectedHash);
    expect(manifest?.capturedBytes).toBe(expected.byteLength);
    expect(manifest?.preservation).toBe("complete");

    // No staging remnant after promotion.
    const dirEntries = await fs.promises.readdir(artifactDir(outputId));
    expect(dirEntries.some((name) => name.endsWith(".staging"))).toBe(false);
  });

  it("yields CJK/multi-byte exactness across chunk boundaries", async () => {
    const { capture } = await openCapture();
    // Split a multi-byte sequence across two chunks: the hash and byte count
    // are per-chunk, so the total must still match the concatenation.
    const text = "你好世界".repeat(50);
    const full = Buffer.from(text, "utf8");
    const mid = Math.floor(full.byteLength / 2);
    expect(capture.appendChunk(full.subarray(0, mid))).toBe(true);
    expect(capture.appendChunk(full.subarray(mid))).toBe(true);

    const stored = await capture.finalize(full.byteLength);
    expect(stored.capturedBytes).toBe(full.byteLength);
    expect(stored.sha256).toBe(
      crypto.createHash("sha256").update(full).digest("hex")
    );
    const onDisk = await fs.promises.readFile(stored.absolutePath);
    expect(onDisk.toString("utf8")).toBe(text);
  });
});

describe("captureTextStream — cap behaviour", () => {
  it("seals as partial with ARTIFACT_LIMIT_REACHED at the artifact cap", async () => {
    const { capture } = await openCapture();
    // Write exactly cap bytes: the cap is reached but not exceeded, so the
    // capture is not yet "full" — the next chunk trips it.
    const exact = Buffer.alloc(CAP, 0x61);
    expect(capture.appendChunk(exact)).toBe(true);
    expect(capture.isFull()).toBe(false);
    expect(capture.getBytesWritten()).toBe(CAP);

    // Surplus is dropped and seals the capture as full.
    expect(capture.appendChunk(Buffer.from("surplus", "utf8"))).toBe(false);
    expect(capture.isFull()).toBe(true);
    expect(capture.getBytesWritten()).toBe(CAP);

    const stored = await capture.finalize(CAP + 7);
    expect(stored.capturedBytes).toBe(CAP);
    expect(stored.originalBytes).toBe(CAP + 7);
    expect(stored.preservation).toBe("partial");
    expect(stored.failureCode).toBe("ARTIFACT_LIMIT_REACHED");
  });

  it("truncates a single over-cap chunk to the cap and marks full", async () => {
    const { capture } = await openCapture();
    expect(capture.appendChunk(Buffer.alloc(CAP + 1000, 0x62))).toBe(true);
    expect(capture.isFull()).toBe(true);
    expect(capture.getBytesWritten()).toBe(CAP);
  });
});

describe("captureTextStream — serialization invariants", () => {
  it("finalize awaits in-flight writes so the artifact is never missing a chunk", async () => {
    const { capture } = await openCapture();
    // Fire many appends without awaiting anything; the writes are queued on
    // the handle's promise chain. finalize must await the chain before the
    // rename, so every chunk lands on disk.
    const count = 200;
    let accepted = 0;
    for (let i = 0; i < count; i += 1) {
      if (capture.appendChunk(Buffer.from(`line-${i}\n`, "utf8"))) accepted += 1;
    }
    const stored = await capture.finalize();

    const expected = Buffer.concat(
      Array.from(
        { length: accepted },
        (_, i) => Buffer.from(`line-${i}\n`, "utf8")
      )
    );
    expect(stored.capturedBytes).toBe(expected.byteLength);
    const onDisk = await fs.promises.readFile(stored.absolutePath);
    expect(onDisk.equals(expected)).toBe(true);
  });

  it("abort discards the staging file without promoting", async () => {
    const { outputId, capture } = await openCapture();
    capture.appendChunk(Buffer.from("will be discarded", "utf8"));
    await capture.abort();

    // Idempotent: a second abort is a no-op.
    await capture.abort();
    // Post-abort appends are refused.
    expect(capture.appendChunk(Buffer.from("after abort", "utf8"))).toBe(false);

    // No artifact promoted, no staging remnant: the directory is empty (or the
    // payload/staging/manifest files are all absent).
    const dir = artifactDir(outputId);
    const entries = await fs.promises.readdir(dir).catch(() => [] as string[]);
    expect(entries.some((name) => name.endsWith(".staging"))).toBe(false);
    expect(entries.some((name) => name.startsWith("payload."))).toBe(false);
    expect(entries.some((name) => name === "manifest.json")).toBe(false);
  });

  it("rejects a second finalize with a typed error", async () => {
    const { capture } = await openCapture();
    capture.appendChunk(Buffer.from("once", "utf8"));
    const stored = await capture.finalize();
    expect(stored.capturedBytes).toBe(4);
    await expect(capture.finalize()).rejects.toBeInstanceOf(
      ToolResultStorageError
    );
  });

  it("refuses appends after finalize", async () => {
    const { capture } = await openCapture();
    capture.appendChunk(Buffer.from("first", "utf8"));
    await capture.finalize();
    expect(capture.appendChunk(Buffer.from("late", "utf8"))).toBe(false);
  });
});
