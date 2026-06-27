/**
 * Unit tests for CancellationToken — a thin wrapper around AbortController
 * that adds timeout scheduling, a typed abort reason, and throwIfAborted.
 */
import { describe, it, expect } from "vitest";
import { CancellationToken, AbortReason } from "@/service/CancellationToken";

describe("CancellationToken", () => {
  it("is not aborted on construction", () => {
    const t = new CancellationToken(1000);
    expect(t.signal.aborted).toBe(false);
    expect(t.reason).toBeNull();
  });

  it("records reason and resolves on abort('timeout')", async () => {
    const t = new CancellationToken(1000);
    const seen: AbortReason[] = [];
    t.signal.addEventListener("abort", () => seen.push(t.reason!));
    t.abort("timeout");
    expect(seen).toEqual(["timeout"]);
  });

  it("startTimer schedules an abort with 'timeout' reason", async () => {
    const t = new CancellationToken(50);
    t.startTimer();
    await new Promise((r) => setTimeout(r, 80));
    expect(t.signal.aborted).toBe(true);
    expect(t.reason).toBe("timeout");
  });

  it("clearTimer cancels the scheduled abort", async () => {
    const t = new CancellationToken(50);
    t.startTimer();
    t.clearTimer();
    await new Promise((r) => setTimeout(r, 80));
    expect(t.signal.aborted).toBe(false);
  });

  it("throwIfAborted throws AbortError with reason in the message", () => {
    const t = new CancellationToken(1000);
    t.abort("cancel");
    expect(() => t.throwIfAborted()).toThrowError(/cancel/);
  });
});
