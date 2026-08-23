/**
 * WS-4 R4.4 — unit tests for the in-flight extraction recovery logic.
 *
 * Acceptance criterion: "A test simulates a worker crash mid-batch; queued/
 * in-flight jobs are recovered (re-queued), not lost." The pure recovery
 * functions take their collaborators as injectable deps, so we simulate a crash
 * by returning non-terminal resultIds from getInFlightResultIds and assert the
 * worker is sent a fresh `extract-contact` batch (re-queued, not lost), and that
 * a circuit-broken worker marks them failed instead.
 */
import { describe, it, expect, vi } from "vitest";
import {
  recoverInFlightExtractions,
  failInFlightExtractions,
  type RecoveryDeps,
  type FailDeps,
} from "@/main-process/communication/contactExtractionRecovery";

describe("recoverInFlightExtractions (WS-4 R4.4)", () => {
  it("is a no-op when nothing is in-flight", async () => {
    const send = vi.fn();
    const getSearchResults = vi.fn();
    const deps: RecoveryDeps = {
      getInFlightResultIds: vi.fn().mockResolvedValue([]),
      getSearchResults,
      send,
    };

    const ids = await recoverInFlightExtractions(deps);

    expect(ids).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(getSearchResults).not.toHaveBeenCalled();
  });

  it("re-queues in-flight jobs by sending an extract-contact batch to the worker", async () => {
    const send = vi.fn();
    const results = [
      { id: 1, url: "https://a.com", title: "A" },
      { id: 3, url: "https://c.com", title: "C" },
    ];
    const deps: RecoveryDeps = {
      // 99 is in-flight but has no backing search-result row
      getInFlightResultIds: vi.fn().mockResolvedValue([1, 3, 99]),
      getSearchResults: vi.fn().mockResolvedValue(results),
      send,
    };

    const ids = await recoverInFlightExtractions(deps);

    // only ids backed by a search-result row are re-dispatched
    expect(ids).toEqual([1, 3]);
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as {
      type: string;
      resultIds: number[];
      results: unknown[];
      priority: number;
      batchId: string;
    };
    expect(msg.type).toBe("extract-contact");
    expect(msg.resultIds).toEqual([1, 3]);
    expect(msg.results).toBe(results);
    expect(msg.priority).toBe(0);
    expect(typeof msg.batchId).toBe("string");
    // getSearchResults was called with exactly the in-flight ids
    expect(deps.getSearchResults).toHaveBeenCalledWith([1, 3, 99]);
  });

  it("does not re-queue when in-flight ids have no backing search results", async () => {
    const send = vi.fn();
    const deps: RecoveryDeps = {
      getInFlightResultIds: vi.fn().mockResolvedValue([7]),
      getSearchResults: vi.fn().mockResolvedValue([]),
      send,
    };

    const ids = await recoverInFlightExtractions(deps);

    expect(ids).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("failInFlightExtractions (WS-4 R4.4)", () => {
  it("is a no-op when nothing is in-flight", async () => {
    const batchUpdateStatus = vi.fn();
    const deps: FailDeps = {
      getInFlightResultIds: vi.fn().mockResolvedValue([]),
      batchUpdateStatus,
    };

    const ids = await failInFlightExtractions(deps, "boom");

    expect(ids).toEqual([]);
    expect(batchUpdateStatus).not.toHaveBeenCalled();
  });

  it("marks all in-flight jobs failed with the reason (circuit-broken worker)", async () => {
    const batchUpdateStatus = vi.fn().mockResolvedValue(undefined);
    const deps: FailDeps = {
      getInFlightResultIds: vi.fn().mockResolvedValue([1, 2, 3]),
      batchUpdateStatus,
    };

    const ids = await failInFlightExtractions(deps, "worker circuit-broken");

    expect(ids).toEqual([1, 2, 3]);
    expect(batchUpdateStatus).toHaveBeenCalledWith(
      [1, 2, 3],
      "failed",
      "worker circuit-broken"
    );
  });
});
