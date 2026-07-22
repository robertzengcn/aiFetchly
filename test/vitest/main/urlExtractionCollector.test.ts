/**
 * Unit tests for UrlExtractionCollector.
 *
 * The collector encapsulates the "gather per-URL extraction results and settle
 * the promise" logic that used to live inline in contactExtraction-ipc.ts. The
 * critical behavior under test: when the deadline fires with a PARTIAL set of
 * results, the collector RESOLVES with what it has (timedOut: true) instead of
 * rejecting and discarding the data — the root cause of the opaque
 * "Contact extraction timed out after 5 minutes" tool error on async (>=8 URL)
 * batches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UrlExtractionCollector } from "@/main-process/communication/urlExtractionCollector";

describe("UrlExtractionCollector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with timedOut:false when all expected results arrive before the deadline", async () => {
    const collector = new UrlExtractionCollector({
      total: 2,
      timeoutMs: 300_000,
    });
    collector.addResult({ url: "https://a.com", success: true });

    // Not settled yet — still waiting on the second URL.
    const sentinel = Symbol("pending");
    const quick = await Promise.race([
      collector.promise.then(() => "resolved"),
      Promise.resolve(sentinel),
    ]);
    expect(quick).toBe(sentinel);

    collector.addResult({
      url: "https://b.com",
      success: false,
      error: "boom",
    });
    await expect(collector.promise).resolves.toEqual({
      results: [
        { url: "https://a.com", success: true },
        { url: "https://b.com", success: false, error: "boom" },
      ],
      expectedTotal: 2,
      timedOut: false,
    });
  });

  it("RESOLVES with partial results + timedOut:true when the deadline fires with some results", async () => {
    const collector = new UrlExtractionCollector({
      total: 3,
      timeoutMs: 300_000,
    });
    collector.addResult({ url: "https://a.com", success: true });
    collector.addResult({ url: "https://b.com", success: true });
    // Only 2 of 3 URLs have reported. Simulate the 5-minute deadline.
    vi.advanceTimersByTime(300_000);

    await expect(collector.promise).resolves.toEqual({
      results: [
        { url: "https://a.com", success: true },
        { url: "https://b.com", success: true },
      ],
      expectedTotal: 3,
      timedOut: true,
    });
  });

  it("rejects with a clear message only when the deadline fires with ZERO results", async () => {
    const collector = new UrlExtractionCollector({
      total: 2,
      timeoutMs: 300_000,
    });
    vi.advanceTimersByTime(300_000);
    await expect(collector.promise).rejects.toThrow(
      /timed out after 5 minutes/
    );
  });

  it("does not settle twice — late results after completion are ignored", async () => {
    const onResult = vi.fn();
    const collector = new UrlExtractionCollector({
      total: 2,
      timeoutMs: 300_000,
      onResult,
    });
    collector.addResult({ url: "https://a.com", success: true });
    collector.addResult({ url: "https://b.com", success: true });
    const first = await collector.promise;
    expect(first.timedOut).toBe(false);

    // A result arriving after settlement must be a no-op.
    const settled = collector.addResult({
      url: "https://c.com",
      success: true,
    });
    expect(settled).toBe(false);
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("rejectWithError rejects the promise (used when the worker is unavailable)", async () => {
    const collector = new UrlExtractionCollector({
      total: 2,
      timeoutMs: 300_000,
    });
    collector.rejectWithError(new Error("worker unavailable"));
    await expect(collector.promise).rejects.toThrow("worker unavailable");
  });

  it("invokes onResult after each add with accumulated results + counts", async () => {
    const onResult = vi.fn();
    const collector = new UrlExtractionCollector({
      total: 3,
      timeoutMs: 300_000,
      onResult,
    });
    collector.addResult({ url: "https://a.com", success: true });
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "https://a.com" }),
      [expect.objectContaining({ url: "https://a.com" })],
      1,
      3
    );
    collector.addResult({ url: "https://b.com", success: true });
    expect(onResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "https://b.com" }),
      [
        expect.objectContaining({ url: "https://a.com" }),
        expect.objectContaining({ url: "https://b.com" }),
      ],
      2,
      3
    );
  });

  it("clears its deadline timer on dispose so it never fires later", async () => {
    const collector = new UrlExtractionCollector({
      total: 2,
      timeoutMs: 300_000,
    });
    collector.dispose();
    vi.advanceTimersByTime(600_000);
    // Promise stays pending (neither resolved nor rejected) — no settlement.
    const sentinel = Symbol("pending");
    const quick = await Promise.race([
      collector.promise.then(
        () => "settled",
        () => "settled"
      ),
      Promise.resolve(sentinel),
    ]);
    expect(quick).toBe(sentinel);
  });
});
