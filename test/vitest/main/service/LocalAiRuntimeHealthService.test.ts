import { describe, expect, test, vi } from "vitest";
import { LocalAiRuntimeHealthService } from "@/service/localAiRuntime/LocalAiRuntimeHealthService";
import type { ResolvedLocalAiRuntime } from "@/entityTypes/localAiRuntimeTypes";

function resolved(): ResolvedLocalAiRuntime {
  return {
    runtimeId: "voice-sherpa",
    runtimeVersion: "1.0.0",
    runtimeRoot: "/tmp/voice-sherpa/1.0.0",
    manifest: {
      schemaVersion: 1,
      runtimeId: "voice-sherpa",
      runtimeVersion: "1.0.0",
      platform: "darwin",
      arch: "arm64",
      electronVersion: "35.7.5",
      nodeModuleAbi: "135",
      entryModule: "sherpa-onnx-node",
      requiredFiles: ["package.json"],
      dependencies: {},
      build: {
        commit: "abc",
        workflowRunId: "1",
        builtAt: "2026-07-30T00:00:00Z",
      },
    },
  };
}

describe("LocalAiRuntimeHealthService", () => {
  test("maps a passing probe to ok result with the right identity", async () => {
    const probe = vi.fn(async () => ({ ok: true, details: { checked: true } }));
    const svc = new LocalAiRuntimeHealthService({ "voice-sherpa": probe });
    const result = await svc.check({
      runtime: resolved(),
      mode: "runtime_only",
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    expect(result.runtimeId).toBe("voice-sherpa");
    expect(result.runtimeVersion).toBe("1.0.0");
    expect(result.details.checked).toBe(true);
    expect(probe).toHaveBeenCalledWith(
      expect.any(Object),
      "runtime_only",
      expect.any(AbortSignal)
    );
  });

  test("maps a failing probe to a health_check_failed result", async () => {
    const svc = new LocalAiRuntimeHealthService({
      "voice-sherpa": async () => ({ ok: false, errorMessage: "no exports" }),
    });
    const result = await svc.check({
      runtime: resolved(),
      mode: "runtime_only",
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("runtime_health_check_failed");
    expect(result.errorMessage).toBe("no exports");
  });

  test("reports timeout when the probe overruns", async () => {
    const svc = new LocalAiRuntimeHealthService({
      "voice-sherpa": (_r, _m, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () =>
            resolve({ ok: false, errorMessage: "aborted" })
          );
        }),
    });
    const result = await svc.check({
      runtime: resolved(),
      mode: "runtime_only",
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("aborted");
  });

  test("default embedding probe fails when the worker entry is absent", async () => {
    const svc = new LocalAiRuntimeHealthService();
    const result = await svc.check({
      runtime: { ...resolved(), runtimeId: "embedding-xenova" },
      mode: "runtime_only",
      timeoutMs: 1000,
    });
    // resolved() has no entryPoint/entryPath, so the default probe reports missing entry.
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("runtime_health_check_failed");
  });
});
