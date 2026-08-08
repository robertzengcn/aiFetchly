import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatGoalModule } from "@/modules/AIChatGoalModule";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { AIChatGoalCriterion } from "@/entityTypes/aiChatGoalTypes";

const tmpDir = path.join(os.tmpdir(), "aifetchly-goal-mod");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

const CRITERIA: AIChatGoalCriterion[] = [
  {
    criterionId: "c1",
    description: "scraper returns at least one result",
    required: true,
    verification: { kind: "command", command: "echo ok", expectedExitCode: 0 },
  },
];

describe("AIChatGoalModule", () => {
  it("creates a draft goal and returns a renderer-safe view", async () => {
    const mod = new AIChatGoalModule();
    await SqliteDb.ensureInitialized();
    const goal = await mod.createDraftGoal({
      conversationId: "v2-conv-1",
      objective: "Build a scraper",
      criteria: CRITERIA,
    });
    expect(goal.status).toBe("draft");
    expect(goal.objective).toBe("Build a scraper");
    expect(goal.criteria).toHaveLength(1);
    expect(goal.conversationId).toBe("v2-conv-1");
  });

  it("rejects an empty objective", async () => {
    const mod = new AIChatGoalModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createDraftGoal({
        conversationId: "v2-conv-2",
        objective: "   ",
        criteria: CRITERIA,
      })
    ).rejects.toThrow(/objective/);
  });

  it("rejects a goal with no acceptance criteria", async () => {
    const mod = new AIChatGoalModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createDraftGoal({
        conversationId: "v2-conv-3",
        objective: "Do something",
        criteria: [],
      })
    ).rejects.toThrow(/criterion/);
  });

  it("rejects a second active goal unless replace is true", async () => {
    const mod = new AIChatGoalModule();
    await SqliteDb.ensureInitialized();
    await mod.createDraftGoal({
      conversationId: "v2-conv-4",
      objective: "first goal",
      criteria: CRITERIA,
    });
    await expect(
      mod.createDraftGoal({
        conversationId: "v2-conv-4",
        objective: "second goal",
        criteria: CRITERIA,
      })
    ).rejects.toThrow(/active goal already exists/);

    const first = await mod.getActiveGoal("v2-conv-4");
    expect(first?.objective).toBe("first goal");

    const replaced = await mod.createDraftGoal({
      conversationId: "v2-conv-4",
      objective: "second goal",
      criteria: CRITERIA,
      replace: true,
    });
    expect(replaced.objective).toBe("second goal");

    const active = await mod.getActiveGoal("v2-conv-4");
    expect(active?.goalId).toBe(replaced.goalId);
    expect(active?.objective).toBe("second goal");

    // Prior goal must be terminal so retries do not stack active drafts.
    const prior = first ? await mod.getGoal(first.goalId) : null;
    expect(prior?.status).toBe("cancelled");
    expect(prior?.terminalReason).toBe("replaced");
  });

  it("enforces legal status transitions", async () => {
    const mod = new AIChatGoalModule();
    await SqliteDb.ensureInitialized();
    const goal = await mod.createDraftGoal({
      conversationId: "v2-conv-5",
      objective: "goal",
      criteria: CRITERIA,
    });
    // draft -> running is illegal
    await expect(
      mod.transitionGoalStatus(goal.goalId, "running")
    ).rejects.toThrow(/Illegal goal status transition/);
    // draft -> active is legal
    const active = await mod.transitionGoalStatus(goal.goalId, "active");
    expect(active.status).toBe("active");
    // active -> running is legal
    const running = await mod.transitionGoalStatus(goal.goalId, "running");
    expect(running.status).toBe("running");
  });

  it("persists runs, evidence, and terminal reasons", async () => {
    const mod = new AIChatGoalModule();
    await SqliteDb.ensureInitialized();
    const goal = await mod.createDraftGoal({
      conversationId: "v2-conv-6",
      objective: "goal",
      criteria: CRITERIA,
    });
    await mod.transitionGoalStatus(goal.goalId, "active");

    const run = await mod.createRun({
      goalId: goal.goalId,
      conversationId: goal.conversationId,
      maxIterations: 5,
      maxRuntimeMs: 60_000,
      repeatedFailureThreshold: 3,
    });
    expect(run.status).toBe("running");
    expect(run.maxIterations).toBe(5);

    // A second active run for the same goal is rejected.
    await expect(
      mod.createRun({
        goalId: goal.goalId,
        conversationId: goal.conversationId,
        maxIterations: 5,
        maxRuntimeMs: 60_000,
        repeatedFailureThreshold: 3,
      })
    ).rejects.toThrow(/already active/);

    await mod.appendEvidence({
      goalId: goal.goalId,
      runId: run.runId,
      iteration: 1,
      criterionId: "c1",
      sourceKind: "command",
      state: "pass",
      excerpt: "ok",
    });

    await mod.endRun(run.runId, "complete", "all_criteria_passed", false);
    const ended = await mod.getRun(run.runId);
    expect(ended?.status).toBe("complete");
    expect(ended?.terminalReason).toBe("all_criteria_passed");
  });
});
