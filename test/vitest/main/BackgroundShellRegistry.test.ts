import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "child_process";
import {
  getDefaultBackgroundShellRegistry,
  BackgroundShellRegistry,
} from "@/service/BackgroundShellRegistry";

describe("BackgroundShellRegistry", () => {
  let registry: BackgroundShellRegistry;

  beforeEach(() => {
    // Use a fresh instance per test to avoid cross-test pollution
    registry = new BackgroundShellRegistry();
  });

  it("detains a child and exposes a status with shell_id", async () => {
    const child = spawn(process.platform === "win32" ? "cmd.exe" : "sh", [
      process.platform === "win32" ? "/c" : "-c",
      "echo hello; sleep 0.1",
    ]);
    const id = registry.detain(child, { command: "echo hello" });

    expect(typeof id).toBe("string");
    expect(registry.poll(id)?.status).toBe("running");

    await new Promise((r) => setTimeout(r, 300));
    const status = registry.poll(id);
    expect(status?.status).toBe("completed");
    expect(status?.stdout).toContain("hello");
    expect(status?.exitCode).toBe(0);
  });

  it("kill terminates a running shell", async () => {
    const child = spawn(process.platform === "win32" ? "cmd.exe" : "sh", [
      process.platform === "win32" ? "/c" : "-c",
      "sleep 10",
    ]);
    const id = registry.detain(child, { command: "sleep 10" });
    const killed = registry.kill(id);
    expect(killed).toBe(true);

    // Give the close handler a moment to fire
    await new Promise((r) => setTimeout(r, 50));
    const status = registry.poll(id);
    // After kill, status should be "killed" (set explicitly by kill())
    expect(status?.status).toBe("killed");
  });

  it("poll returns undefined for unknown shell_id", () => {
    expect(registry.poll("does-not-exist")).toBeUndefined();
  });

  it("kill returns false for unknown shell_id", () => {
    expect(registry.kill("does-not-exist")).toBe(false);
  });

  it("detained id is unique across calls", () => {
    const child1 = spawn("sh", ["-c", "true"]);
    const child2 = spawn("sh", ["-c", "true"]);
    const id1 = registry.detain(child1, { command: "true" });
    const id2 = registry.detain(child2, { command: "true" });
    expect(id1).not.toBe(id2);
  });

  it("caps stdout accumulation at MAX_BACKGROUND_SHELL_OUTPUT_CHARS", async () => {
    // Generate enough output to exceed the cap without making the test slow.
    // Emit 10 chunks of 50KB each = 500KB total, exceeds 200KB cap.
    const child = spawn("sh", [
      "-c",
      "for i in $(seq 1 10); do head -c 50000 /dev/urandom | base64; done",
    ]);
    const id = registry.detain(child, { command: "noise" });

    // Wait for the process to finish and buffers to settle.
    await new Promise((r) => setTimeout(r, 500));

    const state = registry.poll(id);
    expect(state).toBeDefined();
    expect(state!.stdout.length).toBeLessThanOrEqual(200_000);
  });
});

describe("getDefaultBackgroundShellRegistry", () => {
  it("returns the same singleton across calls", () => {
    const a = getDefaultBackgroundShellRegistry();
    const b = getDefaultBackgroundShellRegistry();
    expect(a).toBe(b);
  });
});
