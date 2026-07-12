/**
 * SKL-01 (Phase 18 / Plan 01 Task 3) — SkillImportService local-skill
 * execution-boundary contract test (T-arbitrary-exec / T-18-01).
 *
 * Characterization test of the EXISTING execution boundary (NO new production
 * code in SkillImportService — 18-RESEARCH Pattern 2/3 confirm the boundary
 * handles local roots with zero changes). This test PROVES the local-skill
 * execute handler routes through SkillWorkerClient (utility process) and NEVER
 * loads the entry code on the main thread.
 *
 * Approach:
 *   1. Mock SkillWorkerClient.getInstance().execute to capture the `code` arg.
 *   2. Register a local JS skill via SkillImportService.registerImportedSkill
 *      with skillDir pointing at a tmp dir (manifest.json + handler.js with
 *      known marker content).
 *   3. Invoke the registered SkillDefinition.execute.
 *   4. Assert SkillWorkerClient.execute was called with the EXACT handler.js
 *      content — proving the entry code is SENT to the utility process, not
 *      loaded on the main thread.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { SkillImportService } from "@/service/SkillImportService";
import { SkillRegistry } from "@/config/skillsRegistry";

// Hoist the mock execute so the factory can reference it (vi.mock is hoisted).
const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@/service/SkillWorkerClient", () => ({
  SkillWorkerClient: {
    getInstance: () => ({ execute: mockExecute }),
  },
}));

const ENTRY_MARKER = "// LOCAL-SKILL-ENTRY-MARKER-DO-NOT-LOAD-ON-MAIN";
const HANDLER_CODE = `${ENTRY_MARKER}\nmodule.exports = async () => ({ ok: true });\n`;

describe("SkillImportService local-skill execution boundary (T-arbitrary-exec / SKL-01)", () => {
  const tracked: string[] = [];
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-local-skill-"));
    expect(typeof SkillImportService.registerImportedSkill).toBe("function");
  });

  afterAll(() => {
    for (const n of tracked) {
      try {
        SkillRegistry.unregisterSkill(n);
      } catch {
        /* gone */
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registerImportedSkill with a local skillDir routes execution through SkillWorkerClient (NOT main-thread load)", async () => {
    const skillName = "local-js-boundary";
    tracked.push(skillName);
    const skillDir = path.join(tmpDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    const manifest = {
      name: skillName,
      version: "1.0.0",
      description: "Boundary contract test skill.",
      runtime: "javascript",
      entry: "handler.js",
      parameters: { type: "object", properties: {} },
    };
    fs.writeFileSync(
      path.join(skillDir, "manifest.json"),
      JSON.stringify(manifest),
      "utf8"
    );
    fs.writeFileSync(path.join(skillDir, "handler.js"), HANDLER_CODE, "utf8");

    // Register the local skill — this is the Phase 18 entry point (the adapter
    // calls this with skillDir = ~/.aifetchly/skills/<name>).
    SkillImportService.registerImportedSkill(manifest as never, skillDir);

    const skill = SkillRegistry.getSkill(skillName);
    expect(skill).not.toBeNull();
    if (!skill) return;

    // Reset the mock and invoke the registered execute handler.
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({
      success: true,
      result: "executed in utility process",
    });
    const ctx: SkillExecutionContext = {
      toolCallId: "tc-boundary",
      conversationId: "conv-boundary",
    };
    await skill.execute({ prompt: "run" }, ctx);

    // The entry CODE was sent to SkillWorkerClient — proving it runs in the
    // utility process, NOT loaded on the main thread.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const callArgs = mockExecute.mock.calls[0];
    expect(callArgs[0]).toContain(ENTRY_MARKER);
    expect(callArgs[0]).toBe(HANDLER_CODE);
    // Args + context flow through too.
    expect(callArgs[1]).toMatchObject({ prompt: "run" });
  });

  it("the registered local skill appears in SkillRegistry.getAllToolFunctions (automatic OpenAI tool exposure)", async () => {
    // SkillImportService.registerImportedSkill was already called in the test above;
    // the skill persists in the registry for this suite. Verify it is exposed as a tool.
    const tools = await SkillRegistry.getAllToolFunctions();
    const localTool = tools.find((t) => t.name === "local-js-boundary");
    expect(localTool).toBeDefined();
    expect(localTool?.type).toBe("function");
  });
});
