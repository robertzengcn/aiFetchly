/**
 * Tests for SkillApprovedCommandRunner (TODO 5 / FR-16): approved-template
 * execution, secret injection (names-only audit), high-risk refusal,
 * missing-credential fail-closed, unknown/mismatched ids.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  SkillApprovedCommandRunner,
} from "@/service/SkillApprovedCommandRunner";
import type { SkillInstallPlan } from "@/entityTypes/skillInstallationTypes";

let tmpRoot: string;
const FAKE_STORE = new Map<string, string>();

/** Credential service stub: retrieve backed by an in-memory map. */
const credentialStub = {
  retrieve: (installationId: string, envVar: string) =>
    FAKE_STORE.get(`${installationId}:${envVar}`) ?? null,
} as unknown as ConstructorParameters<typeof SkillApprovedCommandRunner>[0];

function makePlan(
  commands: SkillInstallPlan["commands"]
): SkillInstallPlan {
  return {
    planVersion: 1,
    planRevision: "rev",
    sessionId: "sess",
    source: {
      sourceId: "src",
      canonicalUri: "https://example.com/repo",
      resolvedRevision: "abc",
      acquiredRoot: tmpRoot,
      contentHash: "h".repeat(64),
      acquisitionMethod: "git",
    },
    discoveredSkills: [],
    selectedSkillIds: [],
    activation: {
      mode: "managed-copy",
      targetDirectory: "t",
      skillsToActivate: [],
    },
    dependencies: [],
    credentials: [],
    commands,
    permissions: [],
    warnings: [],
    verification: [],
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmdrunner-"));
  FAKE_STORE.clear();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("SkillApprovedCommandRunner", () => {
  const runner = new SkillApprovedCommandRunner(credentialStub);

  it("executes an approved benign template and captures output", async () => {
    fs.writeFileSync(path.join(tmpRoot, "out.txt"), "");
    const plan = makePlan([
      {
        id: "cmd:echo1",
        executable: process.platform === "win32" ? "cmd.exe" : "echo",
        args: process.platform === "win32" ? ["/c", "echo hello-cmd"] : ["hello-cmd"],
        workingDirectory: tmpRoot,
        environmentNames: [],
        riskLevel: "low",
        rationale: "test",
      },
    ]);
    const result = await runner.run(plan, "cmd:echo1", tmpRoot, null);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdoutPreview).toContain("hello-cmd");
    expect(result.injectedEnvNames).toEqual([]);
  }, 30_000);

  it("injects declared credentials into the child env; audit names only", async () => {
    FAKE_STORE.set("inst-1:MY_TOOL_TOKEN", "sk-secret-value-do-not-log");
    const plan = makePlan([
      {
        id: "cmd:env",
        executable: process.platform === "win32" ? "cmd.exe" : "printenv",
        args:
          process.platform === "win32"
            ? ["/c", "echo %MY_TOOL_TOKEN%"]
            : ["MY_TOOL_TOKEN"],
        workingDirectory: tmpRoot,
        environmentNames: ["MY_TOOL_TOKEN"],
        riskLevel: "low",
        rationale: "test",
      },
    ]);
    const result = await runner.run(plan, "cmd:env", tmpRoot, "inst-1");
    expect(result.ok).toBe(true);
    // The VALUE reached the child process...
    if (process.platform !== "win32") {
      expect(result.stdoutPreview).toContain("sk-secret-value-do-not-log");
    }
    // ...but the result's auditable fields carry the NAME only.
    expect(result.injectedEnvNames).toEqual(["MY_TOOL_TOKEN"]);
    const auditable = JSON.stringify({
      injected: result.injectedEnvNames,
      message: result.message,
    });
    expect(auditable).not.toContain("sk-secret-value-do-not-log");
  }, 30_000);

  it("fails CLOSED when a declared credential is not stored", async () => {
    const plan = makePlan([
      {
        id: "cmd:needs-secret",
        executable: "echo",
        args: ["x"],
        workingDirectory: tmpRoot,
        environmentNames: ["MY_TOOL_TOKEN"],
        riskLevel: "low",
        rationale: "test",
      },
    ]);
    const result = await runner.run(plan, "cmd:needs-secret", tmpRoot, "inst-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("COMMAND_FAILED");
    expect(result.message).toContain("MY_TOOL_TOKEN");
    expect(result.message).toContain("secure input");
  }, 30_000);

  it("refuses high-risk templates even though the plan lists them", async () => {
    const plan = makePlan([
      {
        id: "cmd:sudo",
        executable: "sudo",
        args: ["apt", "install", "x"],
        workingDirectory: tmpRoot,
        environmentNames: [],
        riskLevel: "high",
        rationale: "repo asked",
      },
    ]);
    const result = await runner.run(plan, "cmd:sudo", tmpRoot, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("COMMAND_HIGH_RISK");
    expect(result.message).toContain("manually");
  }, 30_000);

  it("rejects command ids not in the approved plan", async () => {
    const plan = makePlan([]);
    const result = await runner.run(plan, "cmd:ghost", tmpRoot, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("COMMAND_NOT_FOUND");
  }, 30_000);

  it("reports non-zero exits without treating them as success", async () => {
    const plan = makePlan([
      {
        id: "cmd:fail",
        executable: process.platform === "win32" ? "cmd.exe" : "false",
        args: process.platform === "win32" ? ["/c", "exit 3"] : [],
        workingDirectory: tmpRoot,
        environmentNames: [],
        riskLevel: "low",
        rationale: "test",
      },
    ]);
    const result = await runner.run(plan, "cmd:fail", tmpRoot, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("COMMAND_FAILED");
    expect(result.exitCode).not.toBe(0);
  }, 30_000);
});
