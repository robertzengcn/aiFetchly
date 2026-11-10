import { describe, expect, it, beforeEach } from "vitest";
import {
  SPAWN_BLOCKED_ERROR_CODE,
  SpawnGateError,
  assertSpawnAllowed,
  bindSpawnGateToLifecycle,
  isSpawnAllowed,
} from "@/main-process/lifecycle/spawnGate";
import { ApplicationLifecycleService } from "@/main-process/lifecycle/ApplicationLifecycleService";

/**
 * Spawn-gate tests (PRD AC-05): at shutdown entry, queued starts, retries,
 * and worker restarts are blocked. The gate flips synchronously with the
 * lifecycle state machine (design §4).
 */

describe("spawnGate", () => {
  beforeEach(() => {
    bindSpawnGateToLifecycle(new ApplicationLifecycleService());
  });

  it("allows spawns while the app is not quitting", () => {
    expect(isSpawnAllowed("contact-extraction")).toBe(true);
    expect(() => assertSpawnAllowed("shell-tool")).not.toThrow();
  });

  it("blocks spawns synchronously once quitting begins", async () => {
    const svc = new ApplicationLifecycleService();
    bindSpawnGateToLifecycle(svc);
    let releaseCleanup!: (clean: boolean) => void;
    svc.setCleanupRunner(
      () =>
        new Promise((resolve) => {
          releaseCleanup = (clean: boolean) => resolve({ clean });
        })
    );
    svc.requestExit("tray");
    // Same-tick observation — no await before this check.
    expect(isSpawnAllowed("contact-extraction")).toBe(false);
    expect(() => assertSpawnAllowed("shell-tool")).toThrow(SpawnGateError);
    try {
      assertSpawnAllowed("mcp-client");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnGateError);
      expect((err as SpawnGateError).code).toBe(SPAWN_BLOCKED_ERROR_CODE);
      expect((err as SpawnGateError).message).toContain("mcp-client");
    }
    releaseCleanup(true);
  });

  it("blocks during ready-to-exit as well", async () => {
    const svc = new ApplicationLifecycleService();
    bindSpawnGateToLifecycle(svc);
    const p = svc.requestExit("tray");
    svc.authorizeFinalExit(); // no runner installed -> cleanup resolved sync
    await p;
    expect(svc.getState()).toBe("ready-to-exit");
    expect(isSpawnAllowed("anything")).toBe(false);
  });
});
