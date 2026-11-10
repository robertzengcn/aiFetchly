import { describe, expect, it, beforeEach } from "vitest";
import { spawn } from "child_process";
import {
  ownedSpawnAllowed,
  registerOwnedProcess,
} from "@/main-process/lifecycle/ownedSpawn";
import { getOwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";
import { bindSpawnGateToLifecycle } from "@/main-process/lifecycle/spawnGate";
import { ApplicationLifecycleService } from "@/main-process/lifecycle/ApplicationLifecycleService";

/**
 * ownedSpawn adoption-helper tests (design §6): the structural handle
 * accepts real ChildProcess AND UtilityProcess-shaped objects, registration
 * is best-effort (never throws into the feature), and the spawn gate
 * refuses once quitting begins (AC-05).
 */

function fakeUtilityProcess(pid: number | undefined): {
  pid: number | undefined;
  kill: () => boolean;
  once: () => unknown;
} {
  return {
    pid,
    kill: () => true,
    once: () => undefined,
  };
}

describe("ownedSpawn", () => {
  beforeEach(() => {
    bindSpawnGateToLifecycle(new ApplicationLifecycleService());
  });

  it("registers a UtilityProcess-shaped handle", () => {
    const record = registerOwnedProcess("unit-utility", fakeUtilityProcess(4242));
    expect(record).not.toBeNull();
    expect(record?.ownerId).toBe("unit-utility");
    expect(getOwnedProcessRegistry().get(record!.id)?.pid).toBe(4242);
  });

  it("registers a real ChildProcess and observes its exit", async () => {
    const child = spawn("sh", ["-c", "exit 0"], { stdio: "ignore" });
    const record = registerOwnedProcess("unit-real", child);
    expect(record).not.toBeNull();
    const exited = getOwnedProcessRegistry().observeExit(record!.id, 5_000);
    await expect(exited).resolves.toBe(true);
  });

  it("never throws on a broken handle", () => {
    const broken = fakeUtilityProcess(1);
    broken.kill = () => {
      throw new Error("kill broken");
    };
    expect(() => registerOwnedProcess("unit-broken", broken)).not.toThrow();
  });

  it("the gate refuses spawns once quitting begins (AC-05)", () => {
    expect(ownedSpawnAllowed("any-family")).toBe(true);
    const svc = new ApplicationLifecycleService();
    bindSpawnGateToLifecycle(svc);
    svc.requestExit("tray");
    expect(ownedSpawnAllowed("any-family")).toBe(false);
  });
});
