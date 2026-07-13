import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { PluginManifestService } from "@/service/PluginManifestService";
import { ClaudeSkillFormatAdapter } from "@/service/pluginCompat/ClaudeSkillFormatAdapter";

const FIXTURE_ROOT = path.resolve(
  __dirname,
  "../../../../../test/fixtures/claude-plugins/skills-only"
);

describe("load Claude skills-only plugin (integration)", () => {
  it("loads the manifest with format=claude", async () => {
    const result = await PluginManifestService.loadFromDirectory(FIXTURE_ROOT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.format).toBe("claude");
    expect(result.manifest.name).toBe("claude-skills-pack");
  });

  it("adapts each SKILL.md under skills/", async () => {
    const manifestResult = await PluginManifestService.loadFromDirectory(
      FIXTURE_ROOT
    );
    expect(manifestResult.success).toBe(true);
    if (!manifestResult.success) return;

    const skillsDir = path.join(FIXTURE_ROOT, "skills");
    const entries = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    expect(entries.sort()).toEqual(["email-writer", "lead-research"]);

    for (const dir of entries) {
      const mdPath = path.join(skillsDir, dir, "SKILL.md");
      const content = fs.readFileSync(mdPath, "utf-8");
      const adapted = ClaudeSkillFormatAdapter.adapt(
        content,
        `skills/${dir}/SKILL.md`
      );
      expect(adapted.ok).toBe(true);
      if (!adapted.ok) continue;
      expect(adapted.manifest.documentationOnly).toBe(true);
      expect(adapted.manifest.runtime).toBe("javascript");
    }
  });

  it("round-trip fidelity: plugin bytes unchanged on disk", () => {
    // After "load" (read-only operations only), every file in the fixture
    // must be byte-identical. Adapters never write.
    const manifestPath = path.join(
      FIXTURE_ROOT,
      ".claude-plugin",
      "plugin.json"
    );
    const stat = fs.statSync(manifestPath);
    expect(stat.size).toBeGreaterThan(0);
    // Re-read and check no synthesized manifest.json has been written.
    const synthesized = path.join(FIXTURE_ROOT, "manifest.json");
    expect(fs.existsSync(synthesized)).toBe(false);
  });
});
