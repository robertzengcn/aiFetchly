import { describe, expect, it } from "vitest";
import {
  AIChatGoalLoopService,
  buildGoalContinuationPrompt,
  type GoalLoopPersistence,
  type MakerTurnExecutor,
  type MakerTurnResult,
} from "@/service/aiChatGoal/AIChatGoalLoopService";
import type {
  AIChatGoalCriterion,
  AIChatGoalRunView,
  AIChatGoalStatus,
  AIChatGoalView,
} from "@/entityTypes/aiChatGoalTypes";
import type { GoalCommandRunner } from "@/service/aiChatGoal/GoalEvidenceCollector";

function cmd(criterionId: string, command = "yarn test"): AIChatGoalCriterion {
  return {
    criterionId,
    description: `${criterionId} passes`,
    required: true,
    verification: { kind: "command", command, expectedExitCode: 0 },
  };
}

function view(
  criteria: AIChatGoalCriterion[],
  status: AIChatGoalStatus = "active"
): AIChatGoalView {
  return {
    goalId: "g-1",
    conversationId: "conv-1",
    objective: "build scraper",
    criteria,
    status,
    iterationCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function fakePersistence(initial: AIChatGoalView) {
  let current = initial;
  const runs: AIChatGoalRunView[] = [];
  const evidence: unknown[] = [];
  const persistence: GoalLoopPersistence & {
    snapshot: () => AIChatGoalView;
    runs: AIChatGoalRunView[];
    evidence: unknown[];
  } = {
    runs,
    evidence,
    snapshot: () => current,
    async getGoal(id) {
      return id === current.goalId ? current : null;
    },
    async createRun(input) {
      const run: AIChatGoalRunView = {
        runId: `r-${runs.length + 1}`,
        goalId: input.goalId,
        conversationId: input.conversationId,
        status: "running",
        iterationCount: 0,
        maxIterations: input.maxIterations,
        cancelled: false,
        startedAt: "2026-01-01T00:00:00.000Z",
      };
      runs.push(run);
      return run;
    },
    async transitionGoalStatus(_id, to, patch) {
      current = {
        ...current,
        status: to,
        iterationCount: patch?.iterationCount ?? current.iterationCount,
        terminalReason: patch?.terminalReason ?? current.terminalReason,
        latestVerdict:
          (patch?.latestVerdict as AIChatGoalView["latestVerdict"]) ??
          current.latestVerdict,
      };
      return current;
    },
    async endRun(runId, status, terminalReason, cancelled) {
      const r = runs.find((x) => x.runId === runId);
      if (r) {
        const mutable = r as {
          status: AIChatGoalStatus;
          terminalReason?: string;
          cancelled: boolean;
        };
        mutable.status = status;
        mutable.terminalReason = terminalReason;
        mutable.cancelled = !!cancelled;
      }
    },
    async appendEvidence(input) {
      evidence.push(input);
    },
  };
  return persistence;
}

function fakeMaker(
  plan: MakerTurnResult,
  onExecute?: (iteration: number) => void
): MakerTurnExecutor & { calls: number } {
  const exec = {
    calls: 0,
    async execute(input: {
      conversationId: string;
      goal: AIChatGoalView;
      iteration: number;
      signal: AbortSignal;
    }): Promise<MakerTurnResult> {
      exec.calls++;
      onExecute?.(input.iteration);
      return plan;
    },
  };
  return exec as MakerTurnExecutor & { calls: number };
}

function runner(exitByCriterion: Record<string, number>): GoalCommandRunner {
  return {
    run: async (command) => ({
      exitCode: command in exitByCriterion ? exitByCriterion[command] : 0,
      stdout: "",
      stderr: "",
    }),
  };
}

function makeService(
  persistence: GoalLoopPersistence,
  maker: MakerTurnExecutor,
  opts: {
    commandRunner?: GoalCommandRunner;
    commandRunnerPresent?: boolean;
  } = {}
) {
  return new AIChatGoalLoopService({
    persistence,
    makerExecutor: maker,
    revisionProvider: { current: async () => "rev-1" },
    workspaceProvider: { rootFor: async () => "" },
    commandRunner:
      opts.commandRunnerPresent === false
        ? undefined
        : opts.commandRunner ?? runner({ "yarn test": 0 }),
  });
}

const CONV = "conv-1";

describe("AIChatGoalLoopService", () => {
  it("completes when all required criteria pass on the first iteration", async () => {
    const p = fakePersistence(view([cmd("c1"), cmd("c2")]));
    const maker = fakeMaker({ terminalState: "completed" });
    const service = makeService(p, maker, {
      commandRunner: runner({ "yarn test": 0 }),
    });
    const result = await service.start({
      goalId: "g-1",
      conversationId: CONV,
      maxIterations: 5,
      repeatedFailureThreshold: 3,
    });
    expect(result.terminalStatus).toBe("complete");
    expect(result.iterations).toBe(1);
    expect(p.snapshot().status).toBe("complete");
    expect(maker.calls).toBe(1);
    expect(p.evidence.length).toBe(2); // one per criterion
  });

  it("stops with needs_user_input when the maker pauses for plan approval", async () => {
    const p = fakePersistence(view([cmd("c1")]));
    const maker = fakeMaker({ terminalState: "paused_plan" });
    const service = makeService(p, maker);
    const result = await service.start({
      goalId: "g-1",
      conversationId: CONV,
      maxIterations: 5,
    });
    expect(result.terminalStatus).toBe("needs_user_input");
    expect(p.snapshot().status).toBe("needs_user_input");
  });

  it("stops with needs_user_input for permission and question pauses too", async () => {
    for (const state of ["paused_permission", "paused_question"] as const) {
      const p = fakePersistence(view([cmd("c1")]));
      const maker = fakeMaker({ terminalState: state });
      const service = makeService(p, maker);
      const result = await service.start({
        goalId: "g-1",
        conversationId: CONV,
        maxIterations: 3,
      });
      expect(result.terminalStatus).toBe("needs_user_input");
    }
  });

  it("fails when the maker turn fails", async () => {
    const p = fakePersistence(view([cmd("c1")]));
    const maker = fakeMaker({ terminalState: "failed" });
    const service = makeService(p, maker);
    const result = await service.start({
      goalId: "g-1",
      conversationId: CONV,
      maxIterations: 5,
    });
    expect(result.terminalStatus).toBe("failed");
    expect(p.snapshot().status).toBe("failed");
  });

  it("blocks after the repeated-failure threshold is reached", async () => {
    const p = fakePersistence(view([cmd("c1")]));
    const maker = fakeMaker({ terminalState: "completed" });
    // command exits 1 every time -> fail every iteration
    const service = makeService(p, maker, {
      commandRunner: runner({ "yarn test": 1 }),
    });
    const result = await service.start({
      goalId: "g-1",
      conversationId: CONV,
      maxIterations: 5,
      repeatedFailureThreshold: 3,
    });
    expect(result.terminalStatus).toBe("blocked");
    expect(result.iterations).toBe(3);
    expect(p.snapshot().status).toBe("blocked");
  });

  it("returns to active (max_iterations_reached) when criteria never satisfy", async () => {
    // No command runner -> command criterion is pending -> never satisfied, no failure growth.
    const p = fakePersistence(view([cmd("c1")]));
    const maker = fakeMaker({ terminalState: "completed" });
    const service = makeService(p, maker, { commandRunnerPresent: false });
    const result = await service.start({
      goalId: "g-1",
      conversationId: CONV,
      maxIterations: 3,
    });
    expect(result.terminalStatus).toBe("active");
    expect(result.terminalReason).toBe("max_iterations_reached");
    expect(result.iterations).toBe(3);
  });

  it("cancels when stop() is requested mid-loop", async () => {
    const p = fakePersistence(view([cmd("c1")]));
    const serviceRef: { current?: AIChatGoalLoopService } = {};
    // On the first maker call, request cancellation; iteration 2 aborts at the top.
    const maker = fakeMaker({ terminalState: "completed" }, () => {
      serviceRef.current?.stop(CONV);
    });
    const service = makeService(p, maker, { commandRunnerPresent: false });
    serviceRef.current = service;
    const result = await service.start({
      goalId: "g-1",
      conversationId: CONV,
      maxIterations: 5,
    });
    expect(result.terminalStatus).toBe("cancelled");
    expect(p.snapshot().status).toBe("cancelled");
  });

  it("rejects a second concurrent run for the same conversation", async () => {
    const p = fakePersistence(view([cmd("c1")]));
    const serviceRef: { current?: AIChatGoalLoopService } = {};
    const maker = fakeMaker({ terminalState: "completed" }, () => {
      // While the first run is active, attempt a second start.
      serviceRef.current
        ?.start({ goalId: "g-1", conversationId: CONV, maxIterations: 2 })
        .catch(() => undefined);
    });
    const service = makeService(p, maker, { commandRunnerPresent: false });
    serviceRef.current = service;
    expect(service.hasActiveRun(CONV)).toBe(false);
    // The second start is rejected inside the loop; the first completes normally.
    await expect(
      service.start({ goalId: "g-1", conversationId: CONV, maxIterations: 5 })
    ).resolves.toBeTruthy();
  });

  it("rejects start when the goal is not active", async () => {
    const p = fakePersistence(view([cmd("c1")], "draft"));
    const maker = fakeMaker({ terminalState: "completed" });
    const service = makeService(p, maker);
    await expect(
      service.start({ goalId: "g-1", conversationId: CONV, maxIterations: 3 })
    ).rejects.toThrow(/active/);
  });

  it("buildGoalContinuationPrompt lists required criteria", () => {
    const prompt = buildGoalContinuationPrompt(view([cmd("c1"), cmd("c2")]));
    expect(prompt).toContain("build scraper");
    expect(prompt).toContain("c1 passes");
    expect(prompt).toContain("not claim the goal is complete");
  });
});
