/**
 * SKL-01 (Phase 18 / Plan 01 Task 3) — SkillPermissionService local-skill
 * permission-gate contract test (T-exfil-args / D-SkillEnable / T-18-06).
 *
 * Characterization test of the EXISTING permission gate (NO new production
 * code in SkillExecutor/SkillPermissionService). This test PROVES the gate
 * fires at call time for the local path: SkillExecutor.execute calls
 * SkillPermissionService.checkPermission(skillName) BEFORE invoking
 * skill.execute, and a non-pure local skill that has not been granted
 * permission does NOT execute its handler.
 *
 * D-SkillEnable: no per-skill "enable" flag — gating is at call time via the
 * existing SkillPermissionService.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { SkillExecutor } from "@/service/SkillExecutor";
import { SkillPermissionService } from "@/service/SkillPermissionService";
import { SkillImportService } from "@/service/SkillImportService";
import { SkillRegistry } from "@/config/skillsRegistry";

describe("SkillPermissionService local-skill permission gate (T-exfil-args / D-SkillEnable)", () => {
  const tracked: string[] = [];
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-perm-gate-"));
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

  it("SkillExecutor.execute calls SkillPermissionService.checkPermission BEFORE skill.execute on the local path", async () => {
    const skillName = "local-perm-gate-network";
    tracked.push(skillName);
    const skillDir = path.join(tmpDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    const manifest = {
      name: skillName,
      version: "1.0.0",
      description: "Permission-gate test skill (network permission).",
      runtime: "javascript",
      entry: "handler.js",
      parameters: { type: "object", properties: {} },
      // A non-pure permission forces checkPermission to prompt (no stored grant).
      permissions: ["network"],
    };
    fs.writeFileSync(path.join(skillDir, "manifest.json"), JSON.stringify(manifest), "utf8");
    fs.writeFileSync(
      path.join(skillDir, "handler.js"),
      "module.exports = async () => ({ ok: true });\n",
      "utf8"
    );

    SkillImportService.registerImportedSkill(manifest as never, skillDir);
    expect(SkillRegistry.isRegistered(skillName)).toBe(true);

    // Spy on the permission gate. The skill has `network` permission with no
    // stored grant → checkPermission returns { allowed: false, needsPrompt: true }.
    const spy = vi.spyOn(SkillPermissionService, "checkPermission");

    const ctx: SkillExecutionContext = {
      toolCallId: "tc-perm-gate",
      conversationId: "conv-perm-gate",
      // Default: do NOT skip permission — prove the gate fires.
    };
    const result = await SkillExecutor.execute(skillName, {}, ctx);

    // The gate fired with the skill name (D-SkillEnable gate-at-call).
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(skillName);

    // Because no grant is stored, execution stops at the gate (needs prompt)
    // rather than running the skill handler on the main thread.
    expect(result.success).toBe(false);
    expect(result.result).toMatchObject({ error: expect.stringMatching(/permission/i) });

    spy.mockRestore();
  });

  it("SkillExecutor.execute with skipPermissionCheck=true bypasses the gate (caller-asserted trust)", async () => {
    const skillName = "local-perm-skip";
    tracked.push(skillName);
    const skillDir = path.join(tmpDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    const manifest = {
      name: skillName,
      version: "1.0.0",
      description: "Skip-permission test skill.",
      runtime: "javascript",
      entry: "handler.js",
      parameters: { type: "object", properties: {} },
    };
    fs.writeFileSync(path.join(skillDir, "manifest.json"), JSON.stringify(manifest), "utf8");
    fs.writeFileSync(
      path.join(skillDir, "handler.js"),
      "module.exports = async () => ({ ok: true });\n",
      "utf8"
    );

    SkillImportService.registerImportedSkill(manifest as never, skillDir);

    const spy = vi.spyOn(SkillPermissionService, "checkPermission");

    const ctx: SkillExecutionContext = {
      toolCallId: "tc-skip",
      conversationId: "conv-skip",
      skipPermissionCheck: true,
    };
    await SkillExecutor.execute(skillName, {}, ctx);

    // With skipPermissionCheck, the gate is deliberately bypassed (the caller
    // has already asserted trust — e.g. a hook-ref invocation).
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
