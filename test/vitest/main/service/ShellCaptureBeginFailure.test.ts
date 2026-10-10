/**
 * I9 regression: `ShellCapture.begin()` must mark the claimed output row as
 * failed when the stream open fails AFTER a successful claim.
 *
 * `begin()` calls `module.claimOutput` (which transitions a row to the
 * `writing` state and mints an outputId + leaseFence + reservationId) and then
 * `storage.captureTextStream`. If `captureTextStream` throws, the original
 * catch set `beginFailed` and released the reservation but did NOT call
 * `markOutputFailed` — unlike `finalize()` and `abort()`, which both mark
 * failed. Because `finalize()` short-circuits on `beginFailed` and returns null
 * before reaching its own mark-failed path, the claimed row orphaned in the
 * `writing` state until the recovery sweep eventually tombstoned it. A
 * `writing`-state row is not yet committed so it is not readable, but it
 * consumes quota and confuses the sweep's "is this orphaned?" check until the
 * next cycle.
 *
 * The fix: in `begin()`'s catch, when `this.outputId` was set (the claim
 * succeeded), call `markOutputFailed(outputId, "OUTPUT_WRITE_FAILED")` before
 * releasing the reservation — the same code `finalize`'s catch uses.
 *
 * Run: npx vitest --config vite.main.config.mjs run test/vitest/main/service/ShellCaptureBeginFailure.test.ts
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const currentEpoch = vi.fn().mockResolvedValue("epoch-1");
const claimOutput = vi.fn();
const markOutputFailed = vi.fn().mockResolvedValue(true);
const settleReservation = vi.fn().mockResolvedValue(undefined);
const captureTextStream = vi.fn();

vi.mock("@/modules/ToolResultModule", () => ({
  ToolResultModule: class {
    currentEpoch = currentEpoch;
    claimOutput = claimOutput;
    markOutputFailed = markOutputFailed;
    settleReservation = settleReservation;
  },
}));
vi.mock("@/service/toolResult/ToolResultStorageService", () => ({
  ToolResultStorageService: class {
    captureTextStream = captureTextStream;
  },
  TextStreamCapture: class {
    appendChunk(): boolean {
      return true;
    }
    finalize(): Promise<never> {
      return Promise.reject(new Error("not used"));
    }
    abort(): Promise<void> {
      return Promise.resolve();
    }
    getBytesWritten(): number {
      return 0;
    }
    isFull(): boolean {
      return false;
    }
    flush(): Promise<void> {
      return Promise.resolve();
    }
  },
}));
vi.mock("@/service/toolResult/toolResultRoot", () => ({
  getToolResultStorageRoot: () => "/tmp/aifetchly-i9-test",
}));
vi.mock("@/config/featureFlags", () => ({
  isToolOutputCaptureEnabled: () => true,
}));

import { ShellCapture } from "@/service/ShellCaptureService";

describe("ShellCapture begin() stream-open failure (I9)", () => {
  beforeEach(() => {
    currentEpoch.mockResolvedValue("epoch-1");
    currentEpoch.mockClear();
    claimOutput.mockReset();
    markOutputFailed.mockResolvedValue(true);
    markOutputFailed.mockClear();
    settleReservation.mockResolvedValue(undefined);
    settleReservation.mockClear();
    captureTextStream.mockReset();
  });

  it("marks the claimed output failed when captureTextStream throws after a successful claim", async () => {
    // Claim succeeds → row is in `writing` state with an outputId.
    claimOutput.mockResolvedValue({
      kind: "claimed",
      outputId: "out-i9-claimed",
      leaseFence: "fence-i9",
      reservationId: "res-i9",
      revision: 1,
    });
    // Stream open fails (disk error / staging-file error / etc).
    captureTextStream.mockRejectedValue(new Error("staging file open failed"));

    const capture = ShellCapture.create({
      conversationId: "conv-i9",
      toolCallId: "call-i9",
      toolName: "shell",
      executionId: "exec-i9",
    });
    capture.startBegin();

    // awaitBegin resolves to false (beginFailed). The claim landed but the
    // stream never opened, so finalize must return null — the inline preview is
    // the caller's only output, never an unbounded body.
    const ok = await capture.awaitBegin();
    expect(ok).toBe(false);

    // The claimed row must be marked failed so it does not orphan in the
    // `writing` state. Same failure code as finalize's catch.
    expect(markOutputFailed).toHaveBeenCalledWith(
      "out-i9-claimed",
      "OUTPUT_WRITE_FAILED"
    );
    // The reservation is still released (the original behavior is preserved).
    expect(settleReservation).toHaveBeenCalledWith("res-i9", 0);
  });

  it("does not call markOutputFailed when the claim itself is rejected (no outputId was minted)", async () => {
    // Claim rejected (quota/epoch) — no row was transitioned to `writing`, so
    // there is nothing to mark failed. begin() degrades to inline.
    claimOutput.mockResolvedValue({
      kind: "rejected",
      code: "OUTPUT_QUOTA_EXCEEDED",
      reason: "over quota",
    });
    captureTextStream.mockResolvedValue({});

    const capture = ShellCapture.create({
      conversationId: "conv-i9",
      toolCallId: "call-i9",
      toolName: "shell",
      executionId: "exec-i9",
    });
    capture.startBegin();

    const ok = await capture.awaitBegin();
    expect(ok).toBe(false);
    // No outputId was minted → markOutputFailed must NOT be called.
    expect(markOutputFailed).not.toHaveBeenCalled();
    // captureTextStream is never reached when the claim is rejected.
    expect(captureTextStream).not.toHaveBeenCalled();
  });

  it("finalize returns null and does not re-attempt markOutputFailed when begin already failed", async () => {
    // The begin catch already marked the row failed. finalize short-circuits on
    // beginFailed and must not call markOutputFailed again (no double-mark).
    claimOutput.mockResolvedValue({
      kind: "claimed",
      outputId: "out-i9-finalize",
      leaseFence: "fence-i9",
      reservationId: "res-i9",
      revision: 1,
    });
    captureTextStream.mockRejectedValue(new Error("staging file open failed"));

    const capture = ShellCapture.create({
      conversationId: "conv-i9",
      toolCallId: "call-i9",
      toolName: "shell",
      executionId: "exec-i9",
    });
    capture.startBegin();
    await capture.awaitBegin();

    markOutputFailed.mockClear();
    const ref = await capture.finalize();

    expect(ref).toBeNull();
    // finalize's own mark-failed path is skipped because beginFailed is set.
    expect(markOutputFailed).not.toHaveBeenCalled();
  });

  it("abort after a begin() stream-open failure does not double-mark (idempotent best-effort)", async () => {
    claimOutput.mockResolvedValue({
      kind: "claimed",
      outputId: "out-i9-abort",
      leaseFence: "fence-i9",
      reservationId: "res-i9",
      revision: 1,
    });
    captureTextStream.mockRejectedValue(new Error("staging file open failed"));

    const capture = ShellCapture.create({
      conversationId: "conv-i9",
      toolCallId: "call-i9",
      toolName: "shell",
      executionId: "exec-i9",
    });
    capture.startBegin();
    await capture.awaitBegin();

    // begin's catch marked failed once. abort is a best-effort cleanup that also
    // attempts markOutputFailed (its stream is null, so it only marks). The
    // state machine rejects the transition (writing → failed already applied),
    // so abort's call returns false — but it MUST NOT throw.
    markOutputFailed.mockClear();
    markOutputFailed.mockResolvedValue(false);
    await expect(capture.abort()).resolves.toBeUndefined();
    // abort still attempts the mark (best-effort) but the caller sees no error.
    expect(markOutputFailed).toHaveBeenCalledWith(
      "out-i9-abort",
      "OUTPUT_WRITE_FAILED"
    );
  });
});
