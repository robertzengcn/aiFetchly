/**
 * Tests for the prompt-skill expansion of the global ~/.aifetchly loader and
 * the snapshot → PromptSkillCatalog registration bridge
 * (natural-language-skill-installation design §10.1/§10.9, PRD §13.1/§25.3).
 *
 * The loader previously required real directories containing manifest.json
 * and skipped symbolic links and SKILL.md-only directories — the exact
 * portability gap this feature fixes.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AIFetchlyConfigLoader } from "@/service/aifetchlyConfig/AIFetchlyConfigLoader";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";

let root: string;

function writeSkillDir(name: string, files: Record<string, string>): string {
  const dir = path.join(root, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, fileName), content);
  }
  return dir;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-pscan-"));
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  getDefaultPromptSkillCatalog().replaceSource("user", []);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  getDefaultPromptSkillCatalog().replaceSource("user", []);
});

describe("AIFetchlyConfigLoader prompt-skill scanning", () => {
  it("discovers a SKILL.md directory as a prompt skill (not executable)", async () => {
    writeSkillDir("video-use", {
      "SKILL.md":
        "---\nname: video-use\ndescription: Edit videos\n---\n\n# Usage\n\nSteps.",
    });
    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
    expect(snapshot.promptSkills).toHaveLength(1);
    const draft = snapshot.promptSkills?.[0] as {
      name: string;
      canonicalRoot: string;
      manifest: { description: string };
    };
    expect(draft.name).toBe("video-use");
    expect(draft.manifest.description).toBe("Edit videos");
    expect(fs.realpathSync(draft.canonicalRoot)).toBe(
      fs.realpathSync(path.join(root, "skills", "video-use"))
    );
    // Manifest skills stay separate.
    expect(snapshot.skills).toHaveLength(0);
  });

  it("follows a symbolic link to an external skill directory", async () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "ext-skill-"));
    fs.writeFileSync(
      path.join(external, "SKILL.md"),
      "---\nname: linked-skill\ndescription: Dev link\n---\nbody"
    );
    fs.symlinkSync(external, path.join(root, "skills", "linked-skill"), "dir");
    try {
      const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
      expect(snapshot.promptSkills).toHaveLength(1);
      const draft = snapshot.promptSkills?.[0] as { name: string };
      expect(draft.name).toBe("linked-skill");
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it("manifest.json directories stay on the executable path (precedence)", async () => {
    writeSkillDir("exec-skill", {
      "manifest.json": JSON.stringify({
        name: "exec-skill",
        version: "1.0.0",
        description: "executable skill",
        runtime: "javascript",
        entry: "index.js",
        parameters: { type: "object", properties: {} },
      }),
      "index.js": "module.exports = async () => ({});",
      "SKILL.md": "---\nname: exec-skill\ndescription: x\n---\nbody",
    });
    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
    // Native manifest wins — the directory is NOT registered as a prompt skill.
    expect(snapshot.promptSkills).toHaveLength(0);
    // Manifest path still sees it (existing behavior preserved).
    expect(snapshot.skills).toHaveLength(1);
  });

  it("a broken symlink produces a diagnostic, not a crash", async () => {
    fs.symlinkSync(
      path.join(os.tmpdir(), "definitely-missing-target-xyz"),
      path.join(root, "skills", "broken"),
      "dir"
    );
    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
    expect(snapshot.promptSkills).toHaveLength(0);
    expect(
      snapshot.diagnostics.some((d) => d.code === "link-target-missing")
    ).toBe(true);
  });

  it("oversized SKILL.md produces a skill-md-invalid diagnostic", async () => {
    writeSkillDir("big", {
      "SKILL.md": "x".repeat(256 * 1024 + 1),
    });
    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
    expect(snapshot.promptSkills).toHaveLength(0);
    expect(
      snapshot.diagnostics.some((d) => d.code === "skill-md-invalid")
    ).toBe(true);
  });
});

describe("snapshot → PromptSkillCatalog registration", () => {
  it("applySnapshot registers prompt skills under stable prompt:user runtime ids", async () => {
    writeSkillDir("video-use", {
      "SKILL.md": "---\nname: video-use\ndescription: Edit videos\n---\nbody",
    });
    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    const { AIFetchlyRuntimeRegistrySync } = await import(
      "@/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync"
    );
    const { CommandRegistry } = await import(
      "@/service/slashCommands/CommandRegistry"
    );
    const { AIFetchlyContextStore } = await import(
      "@/service/aifetchlyConfig/AIFetchlyContextStore"
    );
    const sync = new AIFetchlyRuntimeRegistrySync(
      new CommandRegistry(),
      new AIFetchlyContextStore()
    );
    const result = sync.applySnapshot(snapshot);

    const catalog = getDefaultPromptSkillCatalog();
    expect(catalog.size()).toBe(1);
    const listed = catalog.list({});
    expect(listed[0].runtimeId).toMatch(/^prompt:user:[0-9a-f]{12}$/);
    expect(listed[0].name).toBe("video-use");
    // Metadata-only discovery: no instruction bodies leak into catalog views.
    expect(JSON.stringify(listed)).not.toContain("body");
    void result;
  });

  it("a rescan after removal unregisters the prompt skill", async () => {
    writeSkillDir("temp-skill", {
      "SKILL.md": "---\nname: temp-skill\ndescription: t\n---\nb",
    });
    const loader = new AIFetchlyConfigLoader(root);
    const { AIFetchlyRuntimeRegistrySync } = await import(
      "@/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync"
    );
    const { CommandRegistry } = await import(
      "@/service/slashCommands/CommandRegistry"
    );
    const { AIFetchlyContextStore } = await import(
      "@/service/aifetchlyConfig/AIFetchlyContextStore"
    );
    const sync = new AIFetchlyRuntimeRegistrySync(
      new CommandRegistry(),
      new AIFetchlyContextStore()
    );
    sync.applySnapshot(await loader.scanGlobalRoot());
    expect(getDefaultPromptSkillCatalog().size()).toBe(1);

    fs.rmSync(path.join(root, "skills", "temp-skill"), {
      recursive: true,
      force: true,
    });
    sync.applySnapshot(await loader.scanGlobalRoot());
    expect(getDefaultPromptSkillCatalog().size()).toBe(0);
  });
});
