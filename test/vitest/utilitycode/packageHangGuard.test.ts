import { createRequire } from "node:module";
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Regression guard for the opaque `exit code 143` CI packaging failure.
 *
 * Symptom: `yarn package:ci` died with "Error: Process completed with exit
 * code 143." right after "Finalizing package", with ZERO `[package-guard]`
 * log lines — no reason, no diagnostics.
 *
 * Root cause: scripts/run-packaging-with-hang-guard.js had NO
 * process.on("SIGTERM") handler. When GitHub cancels the job (runner OOM ->
 * lost heartbeat -> cancel, OR the 30-min step timeout), it SIGTERMs the
 * step's process tree. The guard (the step entry process) had no handler, so
 * Node's default SIGTERM behavior killed it immediately (exit 143) BEFORE it
 * could log a reason or dump disk/mem/process diagnostics — exactly the
 * opaque failure the guard exists to prevent. The guard's 15-min hard timer
 * only beats a *clean stall*; it cannot win when the runner itself is killed.
 *
 * Fix: the guard now installs SIGTERM/SIGINT handlers that dump diagnostics
 * and force-finish with a precise reason. These tests pin that contract via
 * the exported `installSignalHandlers` seam. We spy on `process.on` to
 * capture the registered listener and invoke it directly — sending a real
 * signal to the test process is unreliable (vitest installs its own signal
 * handlers and the worker may terminate before assertions run).
 */
const require = createRequire(import.meta.url);
const {
  installSignalHandlers,
}: {
  installSignalHandlers: (handlers: {
    finish: (exitCode: number, reason: string) => void;
    dumpDiagnostics: (reason: string) => void;
  }) => () => void;
} = require("../../../scripts/run-packaging-with-hang-guard.js");

type SignalListener = (...args: unknown[]) => void;

/** Capture listeners registered via process.on so we can invoke them directly. */
function captureSignalListeners(): {
  listeners: (signal: "SIGTERM" | "SIGINT") => SignalListener | undefined;
  restore: () => void;
} {
  const registered = new Map<string, SignalListener>();
  const onSpy = vi
    .spyOn(process, "on")
    .mockImplementation((event: string | symbol, listener: SignalListener) => {
      if (
        typeof event === "string" &&
        (event === "SIGTERM" || event === "SIGINT")
      ) {
        registered.set(event, listener);
      }
      return process;
    });
  const removeSpy = vi
    .spyOn(process, "removeListener")
    .mockImplementation((event: string | symbol) => {
      if (typeof event === "string") registered.delete(event);
      return process;
    });
  return {
    listeners: (sig) => registered.get(sig),
    restore: () => {
      onSpy.mockRestore();
      removeSpy.mockRestore();
    },
  };
}

describe("run-packaging-with-hang-guard — signal handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("on SIGTERM, dumps diagnostics then finishes with a precise reason (not silent 143)", () => {
    const finish = vi.fn();
    const dumpDiagnostics = vi.fn();
    const cap = captureSignalListeners();
    try {
      const teardown = installSignalHandlers({ finish, dumpDiagnostics });
      const listener = cap.listeners("SIGTERM");
      expect(listener).toBeDefined();
      listener?.();

      expect(dumpDiagnostics).toHaveBeenCalledTimes(1);
      expect(dumpDiagnostics.mock.calls[0][0]).toMatch(/SIGTERM/i);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(finish.mock.calls[0][0]).toBe(1);
      expect(finish.mock.calls[0][1]).toMatch(/SIGTERM/i);

      teardown();
    } finally {
      cap.restore();
    }
  });

  it("on SIGINT (Ctrl-C), also finishes gracefully with diagnostics", () => {
    const finish = vi.fn();
    const dumpDiagnostics = vi.fn();
    const cap = captureSignalListeners();
    try {
      const teardown = installSignalHandlers({ finish, dumpDiagnostics });
      const listener = cap.listeners("SIGINT");
      expect(listener).toBeDefined();
      listener?.();

      expect(dumpDiagnostics).toHaveBeenCalledTimes(1);
      expect(dumpDiagnostics.mock.calls[0][0]).toMatch(/SIGINT/i);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(finish.mock.calls[0][1]).toMatch(/SIGINT/i);

      teardown();
    } finally {
      cap.restore();
    }
  });

  it("teardown removes the SIGTERM/SIGINT listeners", () => {
    const finish = vi.fn();
    const dumpDiagnostics = vi.fn();
    const cap = captureSignalListeners();
    try {
      const teardown = installSignalHandlers({ finish, dumpDiagnostics });
      expect(cap.listeners("SIGTERM")).toBeDefined();
      expect(cap.listeners("SIGINT")).toBeDefined();
      teardown();
      // removeListener spy should have been called for both signals.
      expect(cap.listeners("SIGTERM")).toBeUndefined();
      expect(cap.listeners("SIGINT")).toBeUndefined();
    } finally {
      cap.restore();
    }
  });
});
