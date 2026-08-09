import { describe, expect, test, vi } from "vitest";
import {
  DisposableVoiceRuntimeProbe,
  interpretProbeMessage,
  resolveRuntimeProbeWorkerPath,
  type ProbeUtilityProcess,
} from "@/service/localAiRuntime/DisposableVoiceRuntimeProbe";
import type { HealthProbeOutcome } from "@/service/localAiRuntime/LocalAiRuntimeHealthService";
import type { ResolvedLocalAiRuntime } from "@/entityTypes/localAiRuntimeTypes";

/** Controllable stand-in for an Electron UtilityProcess. */
interface FakeProbeProcess {
  proc: ProbeUtilityProcess;
  postedMessages: string[];
  killed: boolean;
  emitMessage(raw: unknown): void;
  emitExit(code: number | null): void;
  emitError(err: unknown): void;
}

function makeFakeProbeProcess(): FakeProbeProcess {
  const msgHandlers: Array<(m: unknown) => void> = [];
  const exitHandlers: Array<(c: number | null) => void> = [];
  const errorHandlers: Array<(e: unknown) => void> = [];
  const postedMessages: string[] = [];
  let killed = false;

  const proc: ProbeUtilityProcess = {
    // Overloaded `on` satisfied via a single cast handler (matches the
    // SherpaVoiceWorkerClient test fake pattern).
    on: ((event: string, handler: (arg: unknown) => void) => {
      if (event === "message") msgHandlers.push(handler);
      else if (event === "exit") exitHandlers.push(handler as never);
      else if (event === "error") errorHandlers.push(handler as never);
    }) as ProbeUtilityProcess["on"],
    postMessage: (message: string) => {
      postedMessages.push(message);
      return undefined;
    },
    kill: () => {
      killed = true;
      return undefined;
    },
  };

  return {
    proc,
    get postedMessages() {
      return postedMessages;
    },
    get killed() {
      return killed;
    },
    emitMessage: (raw) => {
      for (const h of msgHandlers) h(raw);
    },
    emitExit: (code) => {
      for (const h of exitHandlers) h(code);
    },
    emitError: (err) => {
      for (const h of errorHandlers) h(err);
    },
  };
}

function resolvedRuntime(): ResolvedLocalAiRuntime {
  return {
    runtimeId: "voice-sherpa",
    runtimeVersion: "1.0.0",
    runtimeRoot: "/staging/voice-sherpa/1.0.0",
    manifest: {
      schemaVersion: 1,
      runtimeId: "voice-sherpa",
      runtimeVersion: "1.0.0",
      platform: "win32",
      arch: "x64",
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

function makeProbe(fake: FakeProbeProcess, timeoutMs = 5000) {
  return new DisposableVoiceRuntimeProbe(
    timeoutMs,
    () => fake.proc,
    "/fake/RuntimeProbeWorker.js"
  );
}

function resultJson(
  ok: boolean,
  exports: Array<{ name: string; present: boolean }>,
  errorMessage?: string
): string {
  return JSON.stringify({
    type: "result",
    requestId: "probe-x",
    ok,
    exports,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  });
}

/** Resolve `p`, or "pending" if it isn't settled within `ms`. */
async function settleState(p: Promise<unknown>, ms: number): Promise<string> {
  return Promise.race([
    p.then(() => "resolved"),
    new Promise<string>((r) => setTimeout(() => r("pending"), ms)),
  ]);
}

describe("DisposableVoiceRuntimeProbe", () => {
  test("is a RuntimeHealthProbe that posts a probe request then awaits exit", async () => {
    const fake = makeFakeProbeProcess();
    const probe = makeProbe(fake);
    const signal = new AbortController().signal;

    const p: Promise<HealthProbeOutcome> = probe.run(
      resolvedRuntime(),
      "runtime_only",
      signal
    ) as Promise<HealthProbeOutcome>;

    // The probe request is posted immediately.
    expect(fake.postedMessages.length).toBe(1);
    const posted = JSON.parse(fake.postedMessages[0]) as {
      type: string;
      runtimeRoot: string;
      entryModule: string;
      requiredExports: string[];
    };
    expect(posted.type).toBe("probe");
    expect(posted.runtimeRoot).toBe("/staging/voice-sherpa/1.0.0");
    expect(posted.entryModule).toBe("sherpa-onnx-node");
    expect(posted.requiredExports).toEqual([
      "OfflineRecognizer",
      "OfflineTts",
      "GenerationConfig",
    ]);

    // A result message alone must NOT resolve the probe.
    fake.emitMessage(
      resultJson(true, [
        { name: "OfflineRecognizer", present: true },
        { name: "OfflineTts", present: true },
        { name: "GenerationConfig", present: true },
      ])
    );
    expect(await settleState(p, 30)).toBe("pending");

    // Exit releases the lock; only now does the probe resolve.
    fake.emitExit(0);
    const outcome = await p;
    expect(outcome.ok).toBe(true);
    expect(outcome.details).toEqual({
      OfflineRecognizer: true,
      OfflineTts: true,
      GenerationConfig: true,
    });
    expect(outcome.errorMessage).toBeUndefined();
  });

  test("propagates missing exports as ok:false", async () => {
    const fake = makeFakeProbeProcess();
    const probe = makeProbe(fake);
    const p = probe.run(
      resolvedRuntime(),
      "runtime_only",
      new AbortController().signal
    );
    fake.emitMessage(
      resultJson(
        false,
        [
          { name: "OfflineRecognizer", present: true },
          { name: "OfflineTts", present: false },
        ],
        "Missing required exports: OfflineTts"
      )
    );
    fake.emitExit(0);
    const outcome = (await p) as HealthProbeOutcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toContain("OfflineTts");
    expect(outcome.details?.OfflineTts).toBe(false);
  });

  test("resolves ok:false when the worker exits without a result", async () => {
    const fake = makeFakeProbeProcess();
    const probe = makeProbe(fake);
    const p = probe.run(
      resolvedRuntime(),
      "runtime_only",
      new AbortController().signal
    );
    fake.emitExit(1);
    const outcome = (await p) as HealthProbeOutcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toContain("exited");
  });

  test("resolves ok:false on a worker error event", async () => {
    const fake = makeFakeProbeProcess();
    const probe = makeProbe(fake);
    const p = probe.run(
      resolvedRuntime(),
      "runtime_only",
      new AbortController().signal
    );
    fake.emitError(new Error("spawn failed"));
    const outcome = (await p) as HealthProbeOutcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toContain("spawn failed");
  });

  test("rejects (ok:false) and kills the worker on timeout", async () => {
    const fake = makeFakeProbeProcess();
    const probe = makeProbe(fake, 40);
    const p = probe.run(
      resolvedRuntime(),
      "runtime_only",
      new AbortController().signal
    );
    const outcome = (await p) as HealthProbeOutcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toContain("timed out");
    expect(fake.killed).toBe(true);
  });

  test("aborts immediately when the signal is already aborted", async () => {
    const fake = makeFakeProbeProcess();
    const probe = makeProbe(fake);
    const ac = new AbortController();
    ac.abort();
    const p = probe.run(resolvedRuntime(), "runtime_only", ac.signal);
    const outcome = (await p) as HealthProbeOutcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toContain("aborted");
    expect(fake.postedMessages.length).toBe(0);
    expect(fake.killed).toBe(true);
  });

  test("aborts mid-flight when the signal fires later", async () => {
    const fake = makeFakeProbeProcess();
    const probe = makeProbe(fake);
    const ac = new AbortController();
    const p = probe.run(resolvedRuntime(), "runtime_only", ac.signal);
    expect(await settleState(p, 20)).toBe("pending");
    ac.abort();
    const outcome = (await p) as HealthProbeOutcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toContain("aborted");
  });

  test("returns ok:false when the manifest has no entryModule", async () => {
    const fake = makeFakeProbeProcess();
    const probe = makeProbe(fake);
    const runtime = resolvedRuntime();
    runtime.manifest = { ...runtime.manifest, entryModule: undefined };
    const outcome = (await probe.run(
      runtime,
      "runtime_only",
      new AbortController().signal
    )) as HealthProbeOutcome;
    expect(outcome.ok).toBe(false);
    expect(outcome.errorMessage).toContain("entryModule");
    // Never forked because the request was invalid.
    expect(fake.postedMessages.length).toBe(0);
  });
});

describe("interpretProbeMessage", () => {
  test("maps a valid result payload to an outcome", () => {
    const outcome = interpretProbeMessage(
      resultJson(true, [{ name: "OfflineTts", present: true }])
    );
    expect(outcome?.ok).toBe(true);
    expect(outcome?.details?.OfflineTts).toBe(true);
  });

  test("returns an ok:false outcome for non-JSON", () => {
    expect(interpretProbeMessage("not-json")?.ok).toBe(false);
  });

  test("returns an ok:false outcome for a malformed result", () => {
    expect(
      interpretProbeMessage({ type: "result", requestId: "r", ok: "yes" })?.ok
    ).toBe(false);
  });
});

describe("resolveRuntimeProbeWorkerPath", () => {
  test("returns the first candidate that exists", () => {
    const exists = vi.fn((candidate: string) =>
      candidate.endsWith("/RuntimeProbeWorker.js")
    );
    const resolved = resolveRuntimeProbeWorkerPath(
      {
        dirname: "/app",
        cwd: "/cwd",
        resourcesPath: "/res",
        existsSync: exists,
      },
      "RuntimeProbeWorker.js"
    );
    expect(resolved.endsWith("RuntimeProbeWorker.js")).toBe(true);
  });

  test("throws when no candidate exists", () => {
    const resolved = (): string =>
      resolveRuntimeProbeWorkerPath(
        {
          dirname: "/app",
          cwd: "/cwd",
          existsSync: () => false,
        },
        "RuntimeProbeWorker.js"
      );
    expect(resolved).toThrow("not found");
  });
});
