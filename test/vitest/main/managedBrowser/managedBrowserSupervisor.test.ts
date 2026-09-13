import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedBrowserSupervisor } from "@/service/ManagedBrowserSupervisor";
import type { ManagedBrowserProcessIdentity } from "@/entityTypes/managedBrowserTypes";
import type { ManagedBrowserWorkerClient } from "@/service/ManagedBrowserWorkerClient";

/** Structural fake client — only the surface the supervisor touches. */
function fakeClient(overrides: Partial<{
  lastHeartbeatTime: number;
  processIdentity: ManagedBrowserProcessIdentity | null;
}> = {}): { client: ManagedBrowserWorkerClient; cleanup: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  const cleanup = vi.fn(async () => "cleaned");
  const stop = vi.fn(async () => "stopped");
  const client = {
    lastHeartbeatTime: overrides.lastHeartbeatTime ?? 0,
    processIdentity: overrides.processIdentity ?? null,
    cleanup,
    stop,
  } as unknown as ManagedBrowserWorkerClient;
  return { client, cleanup, stop };
}

const identity = (over: Partial<ManagedBrowserProcessIdentity> = {}): ManagedBrowserProcessIdentity => ({
  sessionId: "mb_super0001",
  sessionNonce: "nonce-123456",
  workerPid: 100,
  browserPid: 200,
  executableSha256: "a".repeat(64),
  executableVersion: "136.0.0.0",
  launchedAtEpochMs: 1_000,
  ...over,
});

describe("ManagedBrowserSupervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("handleTerminal releases the lease and notifies exactly once", () => {
    const supervisor = new ManagedBrowserSupervisor();
    const { client } = fakeClient();
    const releaseLease = vi.fn();
    const onTerminal = vi.fn();
    supervisor.register({
      sessionId: "mb_super0001",
      accountId: 42,
      client,
      releaseLease,
      onTerminal,
    });
    supervisor.handleTerminal("mb_super0001", "user_stop");
    supervisor.handleTerminal("mb_super0001", "again");
    expect(releaseLease).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith("mb_super0001", "user_stop");
    expect(supervisor.listSessions()).toHaveLength(0);
  });

  it("marks a heartbeat-silent worker unresponsive after the threshold", () => {
    let clock = 1_000_000;
    const supervisor = new ManagedBrowserSupervisor(() => clock);
    const { client, cleanup } = fakeClient({ lastHeartbeatTime: clock });
    const releaseLease = vi.fn();
    supervisor.register({
      sessionId: "mb_super0001",
      accountId: 42,
      client,
      releaseLease,
      onTerminal: () => {},
    });
    // No heartbeat for > 15s: advance the clock past the threshold.
    clock += 16_000;
    vi.advanceTimersByTime(5_000); // fire one watchdog tick
    expect(cleanup).toHaveBeenCalledWith("worker_unresponsive");
    expect(releaseLease).toHaveBeenCalledTimes(1);
  });

  it("keeps a freshly-started session within the startup grace window", () => {
    let clock = 1_000_000;
    const supervisor = new ManagedBrowserSupervisor(() => clock);
    const { client, cleanup } = fakeClient({ lastHeartbeatTime: 0 });
    supervisor.register({
      sessionId: "mb_super0001",
      accountId: 42,
      client,
      releaseLease: () => {},
      onTerminal: () => {},
    });
    clock += 10_000; // inside workerReady + launch grace
    vi.advanceTimersByTime(5_000);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("verifyProcessIdentity rejects PID-only matches (FR-RUNTIME-013)", () => {
    const expected = identity();
    expect(
      ManagedBrowserSupervisor.verifyProcessIdentity(identity(), expected)
    ).toBe(true);
    expect(
      ManagedBrowserSupervisor.verifyProcessIdentity(
        identity({ sessionNonce: "nonce-other11" }),
        expected
      )
    ).toBe(false);
    expect(
      ManagedBrowserSupervisor.verifyProcessIdentity(
        identity({ executableVersion: "137.0.0.0" }),
        expected
      )
    ).toBe(false);
    expect(ManagedBrowserSupervisor.verifyProcessIdentity(null, expected)).toBe(
      false
    );
  });

  it("shutdownAll stops every live session within the deadline", async () => {
    const supervisor = new ManagedBrowserSupervisor();
    const terminals: Array<[string, string]> = [];
    for (const id of ["mb_super0001", "mb_super0002"]) {
      const { client } = fakeClient();
      supervisor.register({
        sessionId: id,
        accountId: 1,
        client,
        releaseLease: () => {},
        onTerminal: (sessionId, cause) => terminals.push([sessionId, cause]),
      });
    }
    await supervisor.shutdownAll(1_000);
    expect(terminals).toHaveLength(2);
    for (const [, cause] of terminals) {
      expect(cause).toBe("shutdown");
    }
  });
});

// ---------------------------------------------------------------------------
// GAP-06: unexpected-exit orphan cleanup + launch-time identity window
// ---------------------------------------------------------------------------

describe("GAP-06 crash containment", () => {
  // Typed via the MockInstance the spy returns (vi.spyOn overloads make
  // ReturnType<typeof vi.spyOn> unusable with generic args).
  let killSpy: { mockRestore(): void };

  beforeEach(() => {
    killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as typeof process.kill);
  });
  afterEach(() => {
    killSpy.mockRestore();
  });

  it("handleTerminal kills the recorded Chrome tree on an unexpected exit", () => {
    const supervisor = new ManagedBrowserSupervisor();
    const { client } = fakeClient({ processIdentity: identity({ browserPid: 4242 }) });
    supervisor.register({
      sessionId: "mb_super0001",
      accountId: 42,
      client,
      releaseLease: () => undefined,
      onTerminal: () => undefined,
    });
    supervisor.handleTerminal("mb_super0001", "exit:1");
    expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");
    expect(supervisor.listSessions()).toHaveLength(0);
  });

  it("graceful stops never attempt orphan cleanup (Chrome closed in-worker)", () => {
    const supervisor = new ManagedBrowserSupervisor();
    const { client } = fakeClient({ processIdentity: identity({ browserPid: 4242 }) });
    supervisor.register({
      sessionId: "mb_super0001",
      accountId: 42,
      client,
      releaseLease: () => undefined,
      onTerminal: () => undefined,
    });
    supervisor.handleTerminal("mb_super0001", "user_stop");
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("chrome_disconnected exits also attempt cleanup", () => {
    const supervisor = new ManagedBrowserSupervisor();
    const { client } = fakeClient({ processIdentity: identity({ browserPid: 5555 }) });
    supervisor.register({
      sessionId: "mb_super0001",
      accountId: 42,
      client,
      releaseLease: () => undefined,
      onTerminal: () => undefined,
    });
    supervisor.handleTerminal("mb_super0001", "chrome_disconnected");
    expect(killSpy).toHaveBeenCalledWith(5555, "SIGTERM");
  });

  it("verifyProcessIdentity enforces the launch-time window", () => {
    const base = identity();
    expect(
      ManagedBrowserSupervisor.verifyProcessIdentity(
        identity({ launchedAtEpochMs: base.launchedAtEpochMs + 2_000 }),
        base
      )
    ).toBe(true);
    expect(
      ManagedBrowserSupervisor.verifyProcessIdentity(
        identity({ launchedAtEpochMs: base.launchedAtEpochMs + 60_000 }),
        base
      )
    ).toBe(false);
  });
});
