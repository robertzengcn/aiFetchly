/**
 * Routing tests for TODO 3 / FR-07: plugin and executable packages found by
 * the typed installer are handed to the EXISTING installation services
 * (PluginImportService / SkillImportService.importFromDirectory) instead of
 * the prompt-skill activation path.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { SkillInstallationModule } from "@/modules/SkillInstallationModule";

const tmpDir = path.join(os.tmpdir(), "aifetchly-skill-install-routing");

// The installer acquires via the plugin source fetchers — local-folder path
// uses fs directly; no workspace needed for these module-level tests.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

// Mock the destination services so the assertions isolate ROUTING decisions.
const pluginInstallMock = vi.hoisted(() => vi.fn());
const executableImportMock = vi.hoisted(() => vi.fn());
vi.mock("@/service/PluginImportService", () => ({
  PluginImportService: {
    installFromLocalRoot: pluginInstallMock,
  },
}));
vi.mock("@/service/SkillImportService", () => ({
  SkillImportService: {
    importFromDirectory: executableImportMock,
  },
}));

function makeFixture(files: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "routing-fixture-"));
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(repo, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return repo;
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
  process.env.AIFETCHLY_SKILL_STAGING_ROOT = path.join(tmpDir, "staging");
  process.env.AIFETCHLY_SKILL_INSTALL_ENABLED = "true";
  pluginInstallMock.mockReset();
  executableImportMock.mockReset();
});

afterEach(() => {
  delete process.env.AIFETCHLY_SKILL_STAGING_ROOT;
  delete process.env.AIFETCHLY_SKILL_INSTALL_ENABLED;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("plugin/executable routing (TODO 3 / FR-07)", () => {
  it("a plugin package routes to PluginInstallService, not prompt activation", async () => {
    pluginInstallMock.mockResolvedValue({ success: true, plugin: null });
    const fixture = makeFixture({
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "routed-plugin",
        version: "1.0.0",
      }),
      "SKILL.md":
        "---\nname: routed-plugin\ndescription: plugin fixture\n---\nbody",
    });

    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-plugin",
      source: fixture,
    });
    expect(prepared.state).toBe("awaiting_approval");
    const approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
    });

    expect(pluginInstallMock).toHaveBeenCalledTimes(1);
    expect(pluginInstallMock).toHaveBeenCalledWith(
      expect.stringContaining("sessions"),
      { overwrite: true }
    );
    expect(approved.state).toBe("ready");
    expect(approved.nextAction).toBe("ready");
  }, 120_000);

  it("plugin service failure fails the session with the service's message", async () => {
    pluginInstallMock.mockResolvedValue({
      success: false,
      errors: [{ code: "manifest-schema-invalid", message: "bad manifest" }],
    });
    const fixture = makeFixture({
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "broken-plugin",
        version: "1.0.0",
      }),
      "SKILL.md":
        "---\nname: broken-plugin\ndescription: x\n---\nbody",
    });

    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-plugin-fail",
      source: fixture,
    });
    const approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
    });
    expect(approved.state).toBe("failed");
    expect(approved.errorCode).toBe("ACTIVATION_VERIFICATION_FAILED");
    expect(approved.safeSummary).toContain("bad manifest");
  }, 120_000);

  it("an executable package routes to SkillImportService.importFromDirectory", async () => {
    executableImportMock.mockResolvedValue({
      success: true,
      name: "routed-exec",
    });
    const fixture = makeFixture({
      "manifest.json": JSON.stringify({
        name: "routed-exec",
        version: "1.0.0",
        description: "executable fixture",
        runtime: "javascript",
        entry: "index.js",
        parameters: { type: "object", properties: {} },
      }),
      "index.js": "module.exports = async () => ({});",
    });

    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-exec",
      source: fixture,
    });
    expect(prepared.state).toBe("awaiting_approval");
    const approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
    });

    expect(executableImportMock).toHaveBeenCalledTimes(1);
    expect(executableImportMock).toHaveBeenCalledWith(
      expect.stringContaining("sessions")
    );
    expect(approved.state).toBe("ready");
  }, 120_000);

  it("executable import failure surfaces the service error", async () => {
    executableImportMock.mockResolvedValue({
      success: false,
      error: "Entry file 'index.js' not found in skill directory",
    });
    const fixture = makeFixture({
      "manifest.json": JSON.stringify({
        name: "broken-exec",
        version: "1.0.0",
        description: "x",
        runtime: "javascript",
        entry: "index.js",
        parameters: { type: "object", properties: {} },
      }),
    });

    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-exec-fail",
      source: fixture,
    });
    const approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
    });
    expect(approved.state).toBe("failed");
    expect(approved.safeSummary).toContain("Entry file");
  }, 120_000);

  it("a PROMPT skill still uses the native activation path (no service calls)", async () => {
    const fixture = makeFixture({
      "SKILL.md":
        "---\nname: plain-prompt\ndescription: prompt fixture\n---\nbody",
    });

    const module = new SkillInstallationModule();
    const prepared = await module.prepare({
      conversationId: "conv-prompt",
      source: fixture,
    });
    const approved = await module.approve({
      sessionId: prepared.sessionId,
      planRevision: prepared.planRevision as string,
      approve: true,
      approvalToken: (await module.getApprovalToken(prepared.sessionId)) ?? "",
    });
    expect(["ready", "installing_dependencies"]).toContain(approved.state);
    expect(pluginInstallMock).not.toHaveBeenCalled();
    expect(executableImportMock).not.toHaveBeenCalled();
  }, 120_000);
});
