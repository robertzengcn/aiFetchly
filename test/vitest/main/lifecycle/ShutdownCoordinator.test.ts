import { describe, expect, it } from "vitest";
import {
  ShutdownCoordinator,
  sanitizeVerificationFailure,
  type ForceStopHook,
  type ShutdownParticipant,
  type ShutdownReport,
} from "@/main-process/lifecycle/ShutdownCoordinator";
import type { LifecycleCleanupContext } from "@/main-process/lifecycle/ApplicationLifecycleService";
import type { ApplicationShutdownPhase } from "@/entityTypes/applicationLifecycleTypes";

/**
 * Shutdown coordinator tests (design §5, §13): deadline accounting, hung /
 * rejecting participants, phase ordering, settled aggregation, report
 * privacy. PRD coverage: AC-04, AC-05, AC-06, AC-15.
 */

const CONTEXT: LifecycleCleanupContext = {
  attemptId: "attempt-1",
  reason: "tray",
  intent: "quit",
};

interface Recording {
  calls: string[];
  participants: ShutdownParticipant[];
}

/** Participants that append every lifecycle call to a shared log. */
function makeRecordingParticipants(
  ids: string[],
  behavior: Partial<
    Record<
      string,
      {
        stopMs?: number;
        rejectStop?: boolean;
        rejectFinalize?: boolean;
        freezeClockJump?: () => void;
      }
    >
  > = {}
): Recording {
  const calls: string[] = [];
  const participants = ids.map((id): ShutdownParticipant => {
    const spec = behavior[id] ?? {};
    return {
      id,
      freeze: () => {
        calls.push(`freeze:${id}`);
        spec.freezeClockJump?.();
      },
      stop: async () => {
        calls.push(`stop:${id}`);
        if (spec.stopMs) {
          await new Promise((r) => setTimeout(r, spec.stopMs));
        }
        if (spec.rejectStop) throw new Error(`${id} stop failed`);
      },
      finalize: async () => {
        calls.push(`finalize:${id}`);
        if (spec.rejectFinalize) throw new Error(`${id} finalize failed`);
      },
    };
  });
  return { calls, participants };
}

function makeCoordinator(
  recording: Recording,
  extra: {
    forceStop?: ForceStopHook;
    onPhases?: ApplicationShutdownPhase[];
    reports?: ShutdownReport[];
    budget?: {
      totalBudgetMs?: number;
      gracefulElapsedCapMs?: number;
      forceElapsedCapMs?: number;
    };
    now?: () => number;
  } = {}
): ShutdownCoordinator {
  return new ShutdownCoordinator({
    participants: () => recording.participants,
    forceStop: extra.forceStop,
    onPhase: (phase) => extra.onPhases?.push(phase),
    onReport: (report) => extra.reports?.push(report),
    ...extra.budget,
    ...(extra.now ? { now: extra.now } : {}),
  });
}

describe("ShutdownCoordinator — clean run", () => {
  it("runs freeze -> stop -> force -> finalize in order and reports clean", async () => {
    const recording = makeRecordingParticipants(["a", "b"]);
    const forceCalls: string[] = [];
    const onPhases: ApplicationShutdownPhase[] = [];
    const reports: ShutdownReport[] = [];
    const coordinator = makeCoordinator(recording, {
      forceStop: async () => {
        forceCalls.push("force");
        return { forcedCount: 0, verificationFailures: [] };
      },
      onPhases,
      reports,
    });

    const { clean, report } = await coordinator.run(CONTEXT);

    expect(clean).toBe(true);
    expect(forceCalls).toEqual(["force"]);
    expect(onPhases).toEqual([
      "freeze",
      "graceful-stop",
      "force-stop",
      "finalize",
    ]);
    // Every participant's freeze precedes any stop; every stop precedes
    // finalize (within-stage concurrency is allowed, across-stage is not).
    expect(recording.calls).toContain("freeze:a");
    expect(recording.calls).toContain("freeze:b");
    const firstStop = recording.calls.findIndex((c) => c.startsWith("stop:"));
    const lastFreeze = recording.calls.lastIndexOf("freeze:b");
    expect(firstStop).toBeGreaterThan(lastFreeze);
    const firstFinalize = recording.calls.findIndex((c) =>
      c.startsWith("finalize:")
    );
    const lastStop = Math.max(
      recording.calls.lastIndexOf("stop:a"),
      recording.calls.lastIndexOf("stop:b")
    );
    expect(firstFinalize).toBeGreaterThan(lastStop);

    expect(report.clean).toBe(true);
    expect(report.deadlineExpired).toBe(false);
    expect(report.forcedTerminationCount).toBe(0);
    expect(report.participantOutcomes).toHaveLength(4); // 2 stages × 2 ids
    expect(report.participantOutcomes.every((o) => o.status === "ok")).toBe(
      true
    );
    expect(reports).toHaveLength(1);
  });

  it("works with zero participants (early-startup empty set)", async () => {
    const coordinator = new ShutdownCoordinator({ participants: () => [] });
    const { clean, report } = await coordinator.run(CONTEXT);
    expect(clean).toBe(true);
    expect(report.participantOutcomes).toEqual([]);
  });
});

describe("ShutdownCoordinator — failure isolation (AC-04, AC-06)", () => {
  it("a rejecting stop does not skip its siblings", async () => {
    const recording = makeRecordingParticipants(["bad", "good"], {
      bad: { rejectStop: true },
    });
    const coordinator = makeCoordinator(recording);
    const { clean, report } = await coordinator.run(CONTEXT);

    expect(recording.calls).toContain("stop:good");
    expect(recording.calls).toContain("finalize:good");
    expect(recording.calls).toContain("finalize:bad");
    expect(clean).toBe(false);

    const badStop = report.participantOutcomes.find(
      (o) => o.id === "bad" && o.stage === "stop"
    );
    expect(badStop?.status).toBe("error");
    // T15: only the error NAME + stable code — never the message text.
    expect(badStop?.errorMessage).toBe("Error[Er5]");
    const goodStop = report.participantOutcomes.find(
      (o) => o.id === "good" && o.stage === "stop"
    );
    expect(goodStop?.status).toBe("ok");
  });

  it("a rejecting finalize is recorded but does not fail the whole run loop", async () => {
    const recording = makeRecordingParticipants(["a", "b"], {
      b: { rejectFinalize: true },
    });
    const coordinator = makeCoordinator(recording);
    const { report } = await coordinator.run(CONTEXT);
    const bFinalize = report.participantOutcomes.find(
      (o) => o.id === "b" && o.stage === "finalize"
    );
    expect(bFinalize?.status).toBe("error");
  });

  it("a hung participant times out and the run still finishes (AC-06)", async () => {
    const recording = makeRecordingParticipants(["hung", "fast"], {
      hung: { stopMs: 5_000 }, // far beyond the small test budget
    });
    const coordinator = makeCoordinator(recording, {
      budget: {
        totalBudgetMs: 300,
        gracefulElapsedCapMs: 60,
        forceElapsedCapMs: 150,
      },
    });
    const { clean, report } = await coordinator.run(CONTEXT);

    expect(clean).toBe(false);
    expect(report.deadlineExpired).toBe(true);
    const hungStop = report.participantOutcomes.find(
      (o) => o.id === "hung" && o.stage === "stop"
    );
    expect(hungStop?.status).toBe("timeout");
    const fastStop = report.participantOutcomes.find(
      (o) => o.id === "fast" && o.stage === "stop"
    );
    expect(fastStop?.status).toBe("ok");
  });

  it("a throwing participant provider resolves UNCLEAN (T14)", async () => {
    const coordinator = new ShutdownCoordinator({
      participants: (): ShutdownParticipant[] => {
        throw new Error("provider boom");
      },
    });
    const { clean } = await coordinator.run(CONTEXT);
    // T14 (2026-09-21 audit): a failed provider is an incomplete shutdown —
    // the empty participant list must never masquerade as a clean outcome.
    expect(clean).toBe(false);
  });
});

describe("ShutdownCoordinator — force-stop stage (AC-05, AC-14, AC-15)", () => {
  it("records forced count and marks verification failures unclean", async () => {
    const recording = makeRecordingParticipants(["a"]);
    const coordinator = makeCoordinator(recording, {
      forceStop: async () => ({
        forcedCount: 3,
        verificationFailures: ["pid-42 still alive"],
      }),
    });
    const { clean, report } = await coordinator.run(CONTEXT);

    expect(clean).toBe(false);
    expect(report.forcedTerminationCount).toBe(3);
    expect(report.verificationFailures).toEqual(["pid-42 still alive"]);
  });

  it("a throwing force-stop hook is recorded as a verification failure", async () => {
    const recording = makeRecordingParticipants(["a"]);
    const coordinator = makeCoordinator(recording, {
      forceStop: async () => {
        throw new Error("taskkill exploded");
      },
    });
    const { clean, report } = await coordinator.run(CONTEXT);
    expect(clean).toBe(false);
    expect(report.verificationFailures).toEqual(["force-stop hook failed"]);
  });

  it("force-stop runs only after graceful stop finished/timed out", async () => {
    const recording = makeRecordingParticipants(["a"]);
    const order: string[] = [];
    const coordinator = makeCoordinator(recording, {
      forceStop: async () => {
        order.push("force");
        return { forcedCount: 0, verificationFailures: [] };
      },
    });
    // Patch participant stop to record relative to force.
    const participant = recording.participants[0];
    recording.participants[0] = {
      ...participant,
      stop: async (ctx) => {
        order.push("stop");
        await participant.stop(ctx);
      },
    };
    await coordinator.run(CONTEXT);
    expect(order).toEqual(["stop", "force"]);
  });
});

describe("ShutdownCoordinator — deadline math and context", () => {
  it("shares one deadline: stage caps never extend the global budget", async () => {
    // Fake clock jumps past the graceful cap during freeze, so the graceful
    // stage computes a non-positive budget and times out deterministically.
    let clock = 0;
    const recording = makeRecordingParticipants(["a"], {
      a: { freezeClockJump: () => (clock += 7_000) },
    });
    const coordinator = makeCoordinator(recording, {
      now: () => clock,
      budget: {
        totalBudgetMs: 10_000,
        gracefulElapsedCapMs: 6_000,
        forceElapsedCapMs: 9_000,
      },
    });
    const { clean, report } = await coordinator.run(CONTEXT);
    expect(clean).toBe(false);
    const graceful = report.phaseTimings.find(
      (p) => p.phase === "graceful-stop"
    );
    expect(graceful?.timedOut).toBe(true);
  });

  it("remainingMs() reflects the injected clock and never goes negative", async () => {
    let clock = 0;
    const observed: number[] = [];
    const recording = makeRecordingParticipants(["a"]);
    const participant = recording.participants[0];
    recording.participants[0] = {
      ...participant,
      stop: (ctx) => {
        observed.push(ctx.remainingMs());
        clock = 20_000; // past the 10s deadline
        observed.push(ctx.remainingMs());
        return Promise.resolve();
      },
    };
    const coordinator = makeCoordinator(recording, { now: () => clock });
    await coordinator.run(CONTEXT);
    expect(observed[0]).toBeLessThanOrEqual(10_000);
    expect(observed[1]).toBe(0);
  });

  it("aborts the shared signal once the run completes", async () => {
    const recording = makeRecordingParticipants(["a"]);
    let signal: AbortSignal | undefined;
    const participant = recording.participants[0];
    recording.participants[0] = {
      ...participant,
      stop: (ctx) => {
        signal = ctx.signal;
        return Promise.resolve();
      },
    };
    const coordinator = makeCoordinator(recording);
    await coordinator.run(CONTEXT);
    expect(signal?.aborted).toBe(true);
  });
});

describe("ShutdownCoordinator — report privacy (FR-09)", () => {
  it("long messages are dropped entirely (name+code only, T15)", async () => {
    const recording = makeRecordingParticipants(["noisy"]);
    recording.participants[0] = {
      ...recording.participants[0],
      stop: () => Promise.reject(new Error("x".repeat(500))),
    };
    const coordinator = makeCoordinator(recording);
    const { report } = await coordinator.run(CONTEXT);
    const outcome = report.participantOutcomes[0];
    expect(outcome?.errorMessage).toBe("Error[Er5]");
  });

  it("participant errors carry only the name+code, never message text (T15)", async () => {
    const recording = makeRecordingParticipants(["leaky"]);
    recording.participants[0] = {
      ...recording.participants[0],
      stop: () =>
        Promise.reject(
          new Error(
            "ENOENT: no such file /home/robertzeng/secrets/config.json sk-token https://evil/?t=abc"
          )
        ),
    };
    const coordinator = makeCoordinator(recording);
    const { report } = await coordinator.run(CONTEXT);
    const outcome = report.participantOutcomes[0];
    // Name+code only: paths/URLs/credentials cannot appear by construction.
    expect(outcome?.errorMessage).toBe("Error[Er5]");
  });

  it("sanitizeVerificationFailure scrubs paths, URLs, and long tokens (T15)", () => {
    const sanitized = sanitizeVerificationFailure(
      "pgrep failed at /home/robert/secrets see https://evil.example/?t=abc token=abcdefghijklmnopqrstuvwx1234 still-alive-pid-42"
    );
    expect(sanitized).toContain("<path>");
    expect(sanitized).toContain("<url>");
    expect(sanitized).toContain("<token>");
    expect(sanitized).not.toContain("/robert");
    expect(sanitized).toContain("still-alive-pid-42"); // allowlisted shape
  });

  it("report verificationFailures pass through the scrubber (T15)", async () => {
    const recording = makeRecordingParticipants([]);
    const coordinator = makeCoordinator(recording, {
      forceStop: async () => ({
        forcedCount: 1,
        verificationFailures: ["yp-scraper: pids still alive after force-kill: 7"],
      }),
    });
    const { report } = await coordinator.run(CONTEXT);
    expect(report.verificationFailures[0]).toContain("still alive");
    expect(report.verificationFailures[0]).toContain("7");
    expect(report.verificationFailures[0]).toContain("yp-scraper");
  });

  it("carries attempt/reason/intent correlation fields", async () => {
    const coordinator = makeCoordinator(makeRecordingParticipants([]));
    const { report } = await coordinator.run({
      attemptId: "att-42",
      reason: "update-restart",
      intent: "update-restart",
    });
    expect(report.attemptId).toBe("att-42");
    expect(report.reason).toBe("update-restart");
    expect(report.intent).toBe("update-restart");
  });

  it("emits the report through onReport exactly once", async () => {
    const reports: ShutdownReport[] = [];
    const coordinator = new ShutdownCoordinator({
      participants: () => [],
      onReport: (r) => reports.push(r),
    });
    await coordinator.run(CONTEXT);
    expect(reports).toHaveLength(1);
  });
});
