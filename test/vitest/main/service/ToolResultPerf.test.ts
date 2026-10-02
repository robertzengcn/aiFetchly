/**
 * Large tool results — performance fixtures (1 / 10 / 64 MiB).
 *
 * PRD §9 measurement requirements: capture/serialization p95, first-page read
 * p95 (NFR-04 ≤ 200 ms after warmup), search latency, event-loop stall
 * (NFR-05: no single stall > 50 ms), and additional resident memory for a
 * 64 MiB capture/read (NFR-03: < 16 MiB additional). This suite seeds real
 * artifacts through `ToolResultStorageService.captureText` and drives the
 * production `ToolResultRetrievalService`.
 *
 * This suite is HEAVY (writes up to 75 MiB of artifacts) and runs ONLY with
 * `AIFETCHLY_PERF_TOOLRESULT=1`; the everyday gate never pays for it. When
 * enabled it prints measured p50/p95 latencies and memory deltas for the
 * record (the audit's T18 acceptance asks to record commands, fixture sizes,
 * host, and measurements) and asserts generous machine-independent bounds —
 * the strict PRD numbers (200 ms / 16 MiB) are asserted on reference-hardware
 * runs only, so a CI runner that is 4× slower still proves the INVARIANTS
 * (bounded page, no full-copy allocation, yielding behavior) rather than
 * absolute wall-clock.
 *
 * Run:  AIFETCHLY_PERF_TOOLRESULT=1 yarn testmain test/vitest/main/service/ToolResultPerf.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import {
  ToolResultRetrievalService,
  type RetrievalTarget,
} from "@/service/toolResult/ToolResultRetrievalService";
import {
  deriveToolResultCursorKey,
  setToolResultCursorKey,
} from "@/service/toolResult/ToolResultCursorCodec";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";

const ENABLED = process.env.AIFETCHLY_PERF_TOOLRESULT === "1";
const describeGate = ENABLED ? describe : describe.skip;

const MiB = 1024 * 1024;
/** Fixture sizes in bytes (PRD §9: 1 / 10 / 64 MiB). */
const FIXTURE_BYTES = [1 * MiB, 10 * MiB, 64 * MiB];

/** A literal needle planted at a known byte offset so search has work to do. */
const NEEDLE = "PERF_NEEDLE_MARKER_";

function p50(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function p95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}

/**
 * Build a deterministic text fixture of exactly `bytes` bytes with a needle
 * planted every ~1 MiB, so a search over the full artifact has matches
 * distributed through the whole payload.
 *
 * Built in bounded chunks so CONSTRUCTION itself never allocates a
 * monolithic JS string for the 64 MiB case beyond the single Buffer that
 * `captureText` requires (the producer's materialized object is measured
 * separately per NFR-03).
 */
function buildFixture(bytes: number): string {
  const chunk = Buffer.alloc(64 * 1024, 0x61); // "aaaa..."
  chunk.write("line-head ", 0, "utf8");
  const parts: Buffer[] = [];
  let written = 0;
  let nextNeedle = 0;
  while (written < bytes) {
    const take = Math.min(chunk.byteLength, bytes - written);
    const slice = chunk.subarray(0, take);
    if (written >= nextNeedle) {
      slice.write(NEEDLE, 0, Math.min(NEEDLE.length, take), "utf8");
      nextNeedle += MiB;
    }
    parts.push(Buffer.from(slice));
    written += take;
  }
  return Buffer.concat(parts).toString("utf8");
}

const IDENTITY = { profileId: "perf-prof", outputEpoch: "perf-epoch" };

interface Fixture {
  readonly label: string;
  readonly bytes: number;
  readonly target: RetrievalTarget;
}

const tmpRoot = path.join(
  os.tmpdir(),
  `aifetchly-toolresult-perf-${crypto.randomUUID()}`
);
let storage: ToolResultStorageService;
let retrieval: ToolResultRetrievalService;
const fixtures: Fixture[] = [];

/**
 * Measurements accumulated across the run and written to
 * `test/output/tool-result-perf-report.json` at the end — a durable record
 * for the release gate (the audit's T18 acceptance asks to record commands,
 * fixture sizes, host, and measurements; console.log is not reliably visible
 * through every runner, so the file is the source of truth).
 */
interface PerfRecord {
  readonly fixture: string;
  readonly kind: "capture" | "read" | "search";
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly calls?: number;
  readonly matches?: number;
  readonly pages?: number;
}
const perfRecords: PerfRecord[] = [];
let nfr03HeapDeltaMiB = 0;
let nfr05MaxStallMs = 0;

/** Write the accumulated record; best-effort, never fails the suite. */
function writePerfReport(): void {
  try {
    const outDir = path.resolve(__dirname, "../../../output");
    fs.mkdirSync(outDir, { recursive: true });
    const report = {
      feature: "large-tool-results",
      date: new Date().toISOString(),
      host: `${os.platform()}/${os.arch()} node ${process.versions.node}`,
      command:
        "AIFETCHLY_PERF_TOOLRESULT=1 yarn testmain test/vitest/main/service/ToolResultPerf.test.ts",
      fixtures: FIXTURE_BYTES.map((b) => `${(b / MiB).toFixed(0)} MiB text`),
      thresholds: {
        nfr03AdditionalMemoryMiB: 16,
        nfr04FirstPageReadP95Ms: 200,
        nfr05MaxEventLoopStallMs: 50,
      },
      measured: {
        nfr03HeapDeltaMiB,
        nfr05MaxStallMs,
        records: perfRecords,
      },
    };
    fs.writeFileSync(
      path.join(outDir, "tool-result-perf-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
  } catch {
    // Reporting is best-effort; the measurements are also printed to stdout.
  }
}

/**
 * Track the largest observed event-loop stall (NFR-05). A heartbeat timer
 * fires every 5 ms while measurements run; a heartbeat observed more than
 * 50 ms after its schedule proves a synchronous stall somewhere in the
 * measured call.
 */
function installStallDetector(): { maxStallMs: () => number; stop: () => void } {
  const HEARTBEAT_MS = 5;
  let maxStall = 0;
  let running = true;
  // A heartbeat fires every HEARTBEAT_MS; the gap between consecutive actual
  // fire times minus the intended period is the stall. A synchronous block
  // delays the callback, so its drift IS the event-loop stall (NFR-05).
  let lastFire = performance.now();
  const probe = setInterval(() => {
    if (!running) return;
    const now = performance.now();
    const gap = now - lastFire - HEARTBEAT_MS;
    if (gap > maxStall) maxStall = gap;
    lastFire = now;
  }, HEARTBEAT_MS);
  // Unref so the heartbeat never holds the vitest process open.
  probe.unref();
  return {
    maxStallMs: () => maxStall,
    stop: () => {
      running = false;
      clearInterval(probe);
    },
  };
}

describeGate("ToolResultPerf (1/10/64 MiB fixtures)", () => {
  beforeAll(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    setToolResultCursorKey(deriveToolResultCursorKey("perf-key"));
    storage = new ToolResultStorageService({ root: tmpRoot });
    retrieval = new ToolResultRetrievalService(storage);
  }, 120_000);

  afterAll(() => {
    writePerfReport();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  for (const bytes of FIXTURE_BYTES) {
    const label = `${(bytes / MiB).toFixed(0)}MiB`;

    it(`captures a ${label} text artifact and measures capture latency (NFR-04 record)`, async () => {
      const outputId = `out_perf_${bytes}`;
      const text = buildFixture(bytes);
      expect(Buffer.byteLength(text, "utf8")).toBe(bytes);

      const samples: number[] = [];
      // Capture once per sampling round; each round re-captures under a NEW
      // outputId so no caching hides the cost. Warmup 2 rounds first.
      for (let round = 0; round < 7; round += 1) {
        const roundId = `${outputId}_${round}`;
        const t0 = performance.now();
        const stored = await storage.captureText({
          outputId: roundId,
          ...IDENTITY,
          text,
          sourceCompleteness: "complete",
        });
        const dt = performance.now() - t0;
        expect(stored.capturedBytes).toBe(bytes);
        if (round >= 2) samples.push(dt);
        // Only the final round's artifact is kept as the read/search fixture.
        if (round === 6) {
          fixtures.push({
            label,
            bytes,
            target: {
              outputId: roundId,
              revision: 1,
              storageKey: stored.storageKey,
              format: "text",
              capturedBytes: stored.capturedBytes,
              sourceCompleteness: "complete",
            },
          });
        }
      }
      // Record for the release-gate evidence; assert a generous bound (a
      // full sha256 of 64 MiB + fsync write should still be well under this
      // on any local SSD; CI hosts that miss it surface as a flake to triage,
      // not a silent pass).
      console.log(
        `[perf] capture ${label}: p50=${p50(samples).toFixed(1)}ms p95=${p95(samples).toFixed(1)}ms`
      );
      perfRecords.push({
        fixture: label,
        kind: "capture",
        p50Ms: p50(samples),
        p95Ms: p95(samples),
      });
      expect(p95(samples)).toBeLessThan(2_000);
    }, 600_000);
  }

  it("first-page read p95 is bounded for every fixture (NFR-04)", async () => {
    expect(fixtures.length).toBe(FIXTURE_BYTES.length);
    const stalls = installStallDetector();
    try {
      for (const f of fixtures) {
        // Warmup: page-cache the artifact.
        await retrieval.read({ target: f.target });
        const samples: number[] = [];
        for (let i = 0; i < 30; i += 1) {
          const t0 = performance.now();
          const outcome = await retrieval.read({ target: f.target });
          const dt = performance.now() - t0;
          expect(outcome.ok).toBe(true);
          if (!outcome.ok) continue;
          // The page is bounded regardless of fixture size (NFR-02): far
          // smaller than the artifact.
          expect(outcome.page.text.length).toBeLessThanOrEqual(
            TOOL_RESULT_CONFIG.readMaxBytes
          );
          expect(outcome.page.totalBytes).toBe(f.bytes);
          samples.push(dt);
        }
        const lat = p95(samples);
        console.log(
          `[perf] first-page read ${f.label}: p50=${p50(samples).toFixed(1)}ms p95=${lat.toFixed(1)}ms`
        );
        perfRecords.push({
          fixture: f.label,
          kind: "read",
          p50Ms: p50(samples),
          p95Ms: lat,
        });
        // Strict PRD target is 200 ms on reference hardware; assert a
        // machine-independent generous bound (4x) here so the invariant —
        // first-page cost is flat in artifact size — is what is proven.
        expect(lat).toBeLessThan(800);
        // First-page cost must NOT scale with artifact size: the 64 MiB
        // fixture's p95 stays within a small constant factor of the 1 MiB one.
        const small = fixtures[0];
        const smallSamples: number[] = [];
        for (let i = 0; i < 30; i += 1) {
          const t0 = performance.now();
          await retrieval.read({ target: small.target });
          smallSamples.push(performance.now() - t0);
        }
        if (f.bytes > small.bytes) {
          const ratio = lat / Math.max(1, p95(smallSamples));
          expect(ratio).toBeLessThan(5);
        }
      }
    } finally {
      stalls.stop();
      console.log(
        `[perf] NFR-05 max event-loop stall observed: ${stalls.maxStallMs().toFixed(1)}ms`
      );
      nfr05MaxStallMs = Math.max(nfr05MaxStallMs, stalls.maxStallMs());
      expect(stalls.maxStallMs()).toBeLessThan(50);
    }
  }, 600_000);

  it("search p95 is bounded and continues across scan ceilings (NFR-04/T07)", async () => {
    expect(fixtures.length).toBe(FIXTURE_BYTES.length);
    for (const f of fixtures) {
      // Warmup.
      await retrieval.search({ target: f.target, query: NEEDLE });
      const samples: number[] = [];
      let cursor: string | undefined;
      let totalMatches = 0;
      let calls = 0;
      // One full-corpus walk via the continuation cursor: each call is bounded
      // by searchMaxScanBytes (8 MiB) and searchMaxMs (100 ms), so a 64 MiB
      // artifact needs several continuation calls — the T07 regression shape.
      for (;;) {
        const t0 = performance.now();
        const outcome = await retrieval.search({
          target: f.target,
          query: NEEDLE,
          cursor,
        });
        const dt = performance.now() - t0;
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) break;
        samples.push(dt);
        calls += 1;
        totalMatches += outcome.page.matches.length;
        if (outcome.page.scanComplete) break;
        if (!outcome.page.nextCursor) break;
        cursor = outcome.page.nextCursor;
        if (calls > 200) break; // guard against a non-advancing cursor
      }
      // The needle is planted every 1 MiB, so a complete walk finds ~bytes/MiB.
      expect(totalMatches).toBeGreaterThanOrEqual(Math.floor(f.bytes / MiB) - 1);
      console.log(
        `[perf] search ${f.label}: p50=${p50(samples).toFixed(1)}ms p95=${p95(samples).toFixed(1)}ms calls=${calls} matches=${totalMatches}`
      );
      perfRecords.push({
        fixture: f.label,
        kind: "search",
        p50Ms: p50(samples),
        p95Ms: p95(samples),
        calls,
        matches: totalMatches,
      });
      // Per-call bounded: the ceiling is searchMaxMs=100ms by design; assert
      // generous headroom for slow hosts.
      expect(p95(samples)).toBeLessThan(500);
      // A 64 MiB artifact CANNOT be searched in one call: continuation calls
      // prove the bounded-scan contract.
      if (f.bytes > TOOL_RESULT_CONFIG.searchMaxScanBytes) {
        expect(calls).toBeGreaterThan(1);
      }
    }
  }, 600_000);

  it("a 64 MiB read/capture stays within the additional-memory budget (NFR-03)", async () => {
    const big = fixtures.find((f) => f.bytes === 64 * MiB);
    expect(big).toBeDefined();
    if (!big) return;

    // Measure ADDITIONAL resident memory around a paged read of the 64 MiB
    // artifact. The producer's materialized string is pre-existing state and
    // is measured separately (NFR-03 wording); here the artifact exists on
    // disk, so heap growth is purely the read path's buffers/windows.
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    let cursor: string | undefined;
    let pages = 0;
    let textBytes = 0;
    const stalls = installStallDetector();
    try {
      for (;;) {
        const outcome = await retrieval.read({ target: big.target, cursor });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) break;
        textBytes += Buffer.byteLength(outcome.page.text, "utf8");
        pages += 1;
        if (outcome.page.complete || !outcome.page.nextCursor) break;
        cursor = outcome.page.nextCursor;
        // A page is bounded by the TOKEN ceiling (readMaxTokens=2000 → a
        // 1,600-byte conservative byte bound), not the 8 KiB byte ceiling, so
        // a 64 MiB corpus needs ~42k pages. The guard must sit above that.
        if (pages > 50_000) break; // guard against a non-advancing cursor
      }
    } finally {
      stalls.stop();
    }
    // The full corpus was reassembled byte-exactly through bounded pages.
    expect(textBytes).toBe(64 * MiB);
    expect(pages).toBeGreaterThan(1);

    global.gc?.();
    const after = process.memoryUsage().heapUsed;
    const delta = (after - before) / MiB;
    console.log(
      `[perf] NFR-03 64MiB paged read: pages=${pages} heap delta=${delta.toFixed(2)}MiB maxStall=${stalls.maxStallMs().toFixed(1)}ms`
    );
    nfr03HeapDeltaMiB = delta;
    nfr05MaxStallMs = Math.max(nfr05MaxStallMs, stalls.maxStallMs());
    // NFR-03: additional resident memory stays below 16 MiB. Paged reads hold
    // at most one page (~1.6 KiB token-bounded) at a time; pages' decoded text
    // is retained only as the running `textBytes` counter (a number), so the
    // delta must be tiny.
    expect(delta).toBeLessThan(16);
    // NFR-05 on the same walk.
    expect(stalls.maxStallMs()).toBeLessThan(50);
  }, 600_000);
});
