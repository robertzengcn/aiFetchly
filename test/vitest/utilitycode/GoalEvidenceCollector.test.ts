import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  GoalEvidenceCollector,
  type GoalCommandRunner,
} from "@/service/aiChatGoal/GoalEvidenceCollector";
import type { AIChatGoalCriterion } from "@/entityTypes/aiChatGoalTypes";

const collector = new GoalEvidenceCollector();

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-evidence-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const fileCriterion = (filePath: string): AIChatGoalCriterion => ({
  criterionId: "c-file",
  description: "output file exists",
  required: true,
  verification: { kind: "file", filePath, expectedFileState: "exists" },
});

const cmdCriterion = (
  command: string,
  expectedExitCode = 0,
  expectedOutputPattern?: string
): AIChatGoalCriterion => ({
  criterionId: "c-cmd",
  description: "command passes",
  required: true,
  verification: { kind: "command", command, expectedExitCode, expectedOutputPattern },
});

function fakeRunner(
  exitCode: number,
  stdout = "",
  stderr = ""
): GoalCommandRunner {
  return {
    run: async () => ({ exitCode, stdout, stderr }),
  };
}

describe("GoalEvidenceCollector", () => {
  it("passes a file criterion when the file exists under the workspace", async () => {
    fs.writeFileSync(path.join(tmpDir, "out.txt"), "x");
    const e = await collector.collect(fileCriterion("out.txt"), {
      workspaceRoot: tmpDir,
      currentRevision: "rev-1",
    });
    expect(e.state).toBe("pass");
    expect(e.sourceRevision).toBe("rev-1");
  });

  it("fails when the file is missing", async () => {
    const e = await collector.collect(fileCriterion("missing.txt"), {
      workspaceRoot: tmpDir,
    });
    expect(e.state).toBe("fail");
  });

  it("rejects a traversal file path outside the workspace", async () => {
    const e = await collector.collect(fileCriterion("../escape.txt"), {
      workspaceRoot: tmpDir,
    });
    expect(e.state).toBe("fail");
    expect(e.failureSignature).toBeTruthy();
  });

  it("passes a command criterion when exit code matches", async () => {
    const e = await collector.collect(cmdCriterion("yarn test"), {
      workspaceRoot: tmpDir,
      currentRevision: "rev-1",
      commandRunner: fakeRunner(0, "all good"),
    });
    expect(e.state).toBe("pass");
  });

  it("fails a command criterion on non-zero exit, recording a failure signature", async () => {
    const e = await collector.collect(cmdCriterion("yarn test"), {
      workspaceRoot: tmpDir,
      commandRunner: fakeRunner(1, "", "boom"),
    });
    expect(e.state).toBe("fail");
    expect(e.failureSignature).toContain("exit=1");
  });

  it("fails when an expected output pattern is not present", async () => {
    const e = await collector.collect(
      cmdCriterion("yarn test", 0, "\\d+ passed"),
      {
        workspaceRoot: tmpDir,
        commandRunner: fakeRunner(0, "nothing matched"),
      }
    );
    expect(e.state).toBe("fail");
  });

  it("is pending when a command criterion has no runner", async () => {
    const e = await collector.collect(cmdCriterion("yarn test"), {
      workspaceRoot: tmpDir,
    });
    expect(e.state).toBe("pending");
  });

  it("manual and llm criteria are pending until user/LLM resolves them", async () => {
    const manual: AIChatGoalCriterion = {
      criterionId: "c-manual",
      description: "confirm",
      required: true,
      verification: { kind: "manual" },
    };
    const llm: AIChatGoalCriterion = {
      criterionId: "c-llm",
      description: "qualitative",
      required: true,
      verification: { kind: "llm" },
    };
    expect((await collector.collect(manual, { workspaceRoot: tmpDir })).state).toBe(
      "pending"
    );
    expect((await collector.collect(llm, { workspaceRoot: tmpDir })).state).toBe(
      "pending"
    );
  });
});
