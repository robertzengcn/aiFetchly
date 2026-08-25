/**
 * Tests for the legacy documentation-skill adapter (design §10.11, FR-25):
 * documentation-only imports join the prompt-skill catalog at import time,
 * and the legacy tool's no-attachment path delegates to the SAME invocation
 * service as use_skill — short ack + hidden context, no long guidance JSON.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SkillImportService } from "@/service/SkillImportService";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import { PromptSkillInvocationModule } from "@/modules/PromptSkillInvocationModule";
import { SqliteDb } from "@/config/SqliteDb";

// Legacy delegation resolves the conversation workspace through the shared
// context service; a missing workspace degrades gracefully.
vi.mock("@/modules/WorkspaceModule", () => {
  const getActiveWorkspace = vi.fn().mockResolvedValue(null);
  return {
    WorkspaceModule: vi.fn().mockImplementation(() => ({
      getActiveWorkspace,
    })),
  };
});

const tmpDir = path.join(os.tmpdir(), "aifetchly-legacy-doc-delegation");

const SKILL_MD =
  "---\nname: legacy-doc\nversion: 1.0.0\ndescription: Legacy documentation skill\n---\n\n# Usage\n\nGuidance body for the legacy skill.";

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
  getDefaultPromptSkillCatalog().replaceSource("legacy-import:legacy-doc", []);
});

afterEach(() => {
  getDefaultPromptSkillCatalog().replaceSource("legacy-import:legacy-doc", []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

import AdmZip from "adm-zip";

function makeDocSkillZip(destZip: string): void {
  const zip = new AdmZip();
  // A legacy documentation-only import: manifest without an executable entry
  // plus a SKILL.md.
  zip.addFile(
    "manifest.json",
    Buffer.from(
      JSON.stringify({
        name: "legacy-doc",
        version: "1.0.0",
        description: "Legacy documentation skill",
        runtime: "javascript",
        entry: "__skill_md_wrapper__.js",
        parameters: { type: "object", properties: {} },
        documentationOnly: true,
      })
    )
  );
  zip.addFile("SKILL.md", Buffer.from(SKILL_MD));
  zip.addFile(
    "__skill_md_wrapper__.js",
    Buffer.from(
      "module.exports = async () => ({ success: true, result: {} }); " +
        "// documentation-only in this app"
    )
  );
  zip.writeZip(destZip);
}

describe("legacy documentation-skill delegation", () => {
  it("import registers the doc skill in the prompt catalog", async () => {
    const zipPath = path.join(tmpDir, "legacy-doc.zip");
    makeDocSkillZip(zipPath);
    const result = await SkillImportService.importFromZip(zipPath);
    expect(result.success).toBe(true);

    // The catalog registration is fire-and-forget; flush the microtask
    // queue before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const resolved = getDefaultPromptSkillCatalog().resolve("legacy-doc", {});
    expect(resolved.definition).not.toBeNull();
    expect(resolved.definition?.runtimeId).toBe(
      "prompt:user:legacy-legacy-doc"
    );
  }, 60_000);

  it("the legacy tool returns a short ack + hidden context, not guidance JSON", async () => {
    // Register directly (import path covered above).
    const { loadSkillMarkdownFile } = await import(
      "@/service/PromptSkillLoader"
    );
    const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-dir-"));
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), SKILL_MD);
    const loaded = loadSkillMarkdownFile(skillDir);
    expect(loaded.ok).toBe(true);
    getDefaultPromptSkillCatalog().replaceSource("legacy-import:legacy-doc", [
      {
        runtimeId: "prompt:user:legacy-legacy-doc",
        installationId: "legacy-legacy-doc",
        sourceId: "legacy-import:legacy-doc",
        scope: "user",
        name: "legacy-doc",
        description: "Legacy documentation skill",
        canonicalRoot: skillDir,
        skillMarkdownPath: path.join(skillDir, "SKILL.md"),
        contentHash: (loaded.ok && loaded.file.contentHash) || "",
        manifest: (loaded.ok && loaded.file.manifest) || {
          schemaVersion: 1 as const,
          name: "legacy-doc",
          description: "Legacy documentation skill",
          unknownFields: {},
        },
        enabled: true,
      },
    ]);

    // Invoke through the same service the legacy adapter calls.
    const { getDefaultPromptSkillInvocationService } = await import(
      "@/service/PromptSkillInvocationService"
    );
    const outcome = await getDefaultPromptSkillInvocationService().invoke(
      { skill: "legacy-doc" },
      {
        conversationId: "conv-legacy",
        conversationWorkspaceRoot: "",
        invocationSource: "legacy-adapter",
      }
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe("loaded");
    expect(outcome.attachment?.normalizedInstructions).toContain(
      "<invoked_prompt_skill"
    );
    expect(outcome.attachment?.normalizedInstructions).toContain(
      "Guidance body for the legacy skill."
    );

    // The invocation is durably recorded (same contract as use_skill).
    const module = new PromptSkillInvocationModule();
    expect(await module.listActive("conv-legacy")).toHaveLength(1);

    fs.rmSync(skillDir, { recursive: true, force: true });
  }, 60_000);
});
