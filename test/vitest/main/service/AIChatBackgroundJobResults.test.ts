// test/vitest/main/service/AIChatBackgroundJobResults.test.ts
//
// B07: truthful deadline/cancel results for background tool jobs.
import { describe, it, expect } from "vitest";
import {
  buildDeadlineExceededResult,
  buildTurnCancelledResult,
} from "@/service/AIChatBackgroundJobResults";

describe("background job result builders (B07)", () => {
  it("deadline result claims a definite stop ONLY when cleanup was confirmed", () => {
    const confirmed = buildDeadlineExceededResult(
      { id: "call-1", name: "scrape" },
      "job-a",
      true,
      1_000
    );
    expect(confirmed.success).toBe(false);
    expect(String(confirmed.result.error)).toContain("has been stopped");
    expect(confirmed.result.code).toBe("JOB_DEADLINE_EXCEEDED");
    expect(confirmed.result.cleaned_up).toBe(true);
    expect(confirmed.result.cleanup_pending).toBe(false);
  });

  it("deadline result reports cleanup_pending when shutdown was unconfirmed", () => {
    const unconfirmed = buildDeadlineExceededResult(
      { id: "call-2", name: "scrape" },
      "job-b",
      false,
      2_000
    );
    expect(String(unconfirmed.result.error)).toContain("could not be confirmed");
    expect(unconfirmed.result.cleaned_up).toBe(false);
    expect(unconfirmed.result.cleanup_pending).toBe(true);
  });

  it("user-stop result carries the cancellation plus cleanup truth", () => {
    const stopped = buildTurnCancelledResult(
      { id: "call-3", name: "scrape" },
      "job-c",
      false,
      3_000
    );
    expect(String(stopped.result.error)).toBe("Turn cancelled");
    expect(stopped.result.code).toBe("TURN_CANCELLED");
    expect(stopped.result.cleaned_up).toBe(false);
    expect(stopped.result.cleanup_pending).toBe(true);
    expect(stopped.execution_time_ms).toBeGreaterThan(0);
  });
});
