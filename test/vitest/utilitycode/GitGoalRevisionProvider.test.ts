import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  GitGoalRevisionProvider,
  type GitRunner,
} from "@/service/aiChatGoal/GitGoalRevisionProvider";
import type {
  AIChatGoalCriterion,
  AIChatGoalView,
} from "@/entityTypes/aiChatGoalTypes";

const goal: AIChatGoalView = {
  goalId: "g-1",
  conversationId: "conv-1",
  objective: "x",
  criteria: [],
  status: "active",
  iterationCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function git(
  head: { ok: boolean; stdout: string },
  status: { ok: boolean; stdout: string }
): GitRunner {
  return {
    exec: async (args) => (args[0] === "rev-parse" ? head : status),
  };
}

describe("GitGoalRevisionProvider", () => {
  it("returns <sha>-clean for a clean working tree", async () => {
    const p = new GitGoalRevisionProvider(
      git({ ok: true, stdout: "abc123\n" }, { ok: true, stdout: "" })
    );
    expect(await p.current(goal, "conv-1", "/ws")).toBe("abc123-clean");
  });

  it("returns <sha>-<dirtyhash> for a dirty working tree", async () => {
    const a = new GitGoalRevisionProvider(
      git(
        { ok: true, stdout: "abc123\n" },
        { ok: true, stdout: " M file.ts\n" }
      )
    );
    const b = new GitGoalRevisionProvider(
      git(
        { ok: true, stdout: "abc123\n" },
        { ok: true, stdout: " M other.ts\n" }
      )
    );
    const ra = await a.current(goal, "conv-1", "/ws");
    const rb = await b.current(goal, "conv-1", "/ws");
    expect(ra).toBeTruthy();
    expect(ra).toMatch(/^abc123-[0-9a-f]{12}$/);
    expect(ra).not.toBe(rb); // different dirty content -> different fingerprint
  });

  it("returns undefined when git HEAD is unavailable", async () => {
    const p = new GitGoalRevisionProvider(
      git({ ok: false, stdout: "" }, { ok: true, stdout: "" })
    );
    expect(await p.current(goal, "conv-1", "/ws")).toBeUndefined();
  });

  it("falls back to <sha>-nogit when status fails", async () => {
    const p = new GitGoalRevisionProvider(
      git({ ok: true, stdout: "abc123\n" }, { ok: false, stdout: "" })
    );
    expect(await p.current(goal, "conv-1", "/ws")).toBe("abc123-nogit");
  });
});

describe("GitGoalRevisionProvider file-content fallback (no git)", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-rev-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const fileCriterion = (filePath: string): AIChatGoalCriterion => ({
    criterionId: "c-file",
    description: "output exists",
    required: true,
    verification: { kind: "file", filePath, expectedFileState: "exists" },
  });
  const noGit: GitRunner = {
    exec: async () => ({ ok: false, stdout: "" }),
  };

  it("returns a files- fingerprint from goal-referenced file content", async () => {
    fs.writeFileSync(path.join(tmpDir, "out.txt"), "v1");
    const g: AIChatGoalView = { ...goal, criteria: [fileCriterion("out.txt")] };
    const p = new GitGoalRevisionProvider(noGit);
    const rev = await p.current(g, "conv-1", tmpDir);
    expect(rev).toMatch(/^files-[0-9a-f]{16}$/);
  });

  it("changes the fingerprint when the referenced file content changes", async () => {
    fs.writeFileSync(path.join(tmpDir, "out.txt"), "v1");
    const g: AIChatGoalView = { ...goal, criteria: [fileCriterion("out.txt")] };
    const p = new GitGoalRevisionProvider(noGit);
    const r1 = await p.current(g, "conv-1", tmpDir);
    fs.writeFileSync(path.join(tmpDir, "out.txt"), "v2-different");
    const r2 = await p.current(g, "conv-1", tmpDir);
    expect(r1).not.toBe(r2);
  });

  it("returns undefined when there are no file criteria and no git", async () => {
    const p = new GitGoalRevisionProvider(noGit);
    expect(await p.current(goal, "conv-1", tmpDir)).toBeUndefined();
  });
});
