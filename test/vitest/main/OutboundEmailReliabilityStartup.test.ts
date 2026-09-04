import { describe, expect, it, vi, afterEach } from "vitest";
import { OutboundEmailReliabilityStartup } from "@/service/outboundEmail/OutboundEmailReliabilityStartup";

describe("OutboundEmailReliabilityStartup", () => {
  // Ensure any interval armed by a test is cleared afterwards.
  const running: OutboundEmailReliabilityStartup[] = [];
  afterEach(() => {
    for (const s of running) s.stop();
    running.length = 0;
    vi.restoreAllMocks();
  });

  it("arms the interval before the initial sweep runs (a hanging sweep cannot disarm the watchdog)", async () => {
    const startup = new OutboundEmailReliabilityStartup();
    running.push(startup);

    let armedDuringSweep = false;
    const release: { resolve: (() => void) | null } = { resolve: null };
    // The initial sweep hangs until we release it, simulating a locked DB.
    const sweep = vi.spyOn(startup, "runRecoverySweep").mockImplementation(
      () =>
        new Promise((resolve) => {
          // Observe whether the interval is already armed while the sweep
          // is still pending — if not, a hang would leave no watchdog.
          armedDuringSweep = startup["intervalHandle"] !== null;
          release.resolve = () =>
            resolve({ authorizationsExpired: 0, attemptsRecovered: 0 });
        })
    );

    const started = startup.start(60_000);
    // Let the microtask queue run so start() reaches the mock's executor.
    await Promise.resolve();
    await Promise.resolve();

    // The sweep is hanging; the interval must already be armed.
    expect(armedDuringSweep).toBe(true);

    release.resolve?.();
    const result = await started;
    expect(result).toEqual({
      authorizationsExpired: 0,
      attemptsRecovered: 0,
    });
    expect(sweep).toHaveBeenCalledTimes(1);
    startup.stop();
  });

  it("clears a previously armed interval when start() is called again", async () => {
    const startup = new OutboundEmailReliabilityStartup();
    running.push(startup);

    const sweep = vi
      .spyOn(startup, "runRecoverySweep")
      .mockResolvedValue({ authorizationsExpired: 0, attemptsRecovered: 0 });

    await startup.start(60_000);
    const first = startup["intervalHandle"];
    expect(first).not.toBeNull();

    await startup.start(60_000);
    const second = startup["intervalHandle"];
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    // Each start() ran one initial sweep.
    expect(sweep).toHaveBeenCalledTimes(2);

    startup.stop();
    expect(startup["intervalHandle"]).toBeNull();
  });
});
