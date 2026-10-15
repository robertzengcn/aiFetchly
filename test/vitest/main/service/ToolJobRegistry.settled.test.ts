// Settlement + deadline-expiry tests (yellow-pages plugin plan, PRD §11.8).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolJobRegistry } from "@/service/ToolJobRegistry";

describe("ToolJobRegistry settlement", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes jobId on the spawn handle", async () => {
    const registry = new ToolJobRegistry();
    let seenId = "";
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      seenId = handle.jobId;
      handle.resolve({ ok: true });
    });
    expect(seenId).toBe(jobId);
  });

  it("fires onSettled exactly once on resolve", async () => {
    const registry = new ToolJobRegistry();
    const settled = vi.fn();
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      handle.onSettled(settled);
      handle.resolve(1);
    });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(await registry.waitForSettled(jobId, 10)).toBe(true);
  });

  it("fires onSettled on cancel", async () => {
    const registry = new ToolJobRegistry();
    const settled = vi.fn();
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      handle.onSettled(settled);
      await new Promise(() => undefined); // never settles on its own
    });
    registry.cancel(jobId);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("late onSettled registration after terminal state fires immediately", async () => {
    const registry = new ToolJobRegistry();
    const late = vi.fn();
    registry.start("t2", {}, { conversationId: "c", toolCallId: "tc2" }, async (handle) => {
      handle.resolve(2);
      // Registering after resolve: the callback must still fire once.
      handle.onSettled(late);
      expect(late).toHaveBeenCalledTimes(1);
    });
  });

  it("waitForSettled times out bounded for a stuck job", async () => {
    const registry = new ToolJobRegistry();
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async () => {
      await new Promise(() => undefined); // never settles
    });
    const outcome = registry.waitForSettled(jobId, 50);
    vi.advanceTimersByTime(80);
    await expect(outcome).resolves.toBe(false);
  });

  it("waitForSettled resolves true when the job settles while waiting", async () => {
    const registry = new ToolJobRegistry();
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, (handle) =>
      new Promise<unknown>(() => {
        setTimeout(() => handle.resolve("done"), 100);
      }) as Promise<unknown>
    );
    const outcome = registry.waitForSettled(jobId, 1_000);
    await vi.advanceTimersByTimeAsync(150);
    await expect(outcome).resolves.toBe(true);
  });

  it("a cancel-then-late-resolve does not double-fire settlement", async () => {
    const registry = new ToolJobRegistry();
    const settled = vi.fn();
    let resolver: ((v: unknown) => void) | undefined;
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      handle.onSettled(settled);
      resolver = handle.resolve;
      await new Promise(() => undefined);
    });
    registry.cancel(jobId);
    expect(settled).toHaveBeenCalledTimes(1);
    resolver?.("late");
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
