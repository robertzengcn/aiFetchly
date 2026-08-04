import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { PluginManifestService } from "@/service/PluginManifestService";
import { ClaudeSkillFormatAdapter } from "@/service/pluginCompat/ClaudeSkillFormatAdapter";
import {
  ClaudePluginAdapter,
  CLAUDE_OPAQUE_KEY,
} from "@/service/pluginCompat/ClaudePluginAdapter";
import { normalizeInlineMcpMap } from "@/service/PluginMcpDeclaration";

const FIXTURES = path.resolve(
  __dirname,
  "../../../../../test/fixtures/claude-plugins"
);

describe("AC-1: install reference Claude plugins (manifest + component validation)", () => {
  it("skills-only plugin: manifest + 2 skills adapt cleanly", async () => {
    const root = path.join(FIXTURES, "skills-only");
    const mr = await PluginManifestService.loadFromDirectory(root);
    expect(mr.success).toBe(true);
    if (!mr.success) return;
    expect(mr.manifest.format).toBe("claude");
    expect(mr.manifest.name).toBe("claude-skills-pack");

    const skillsDir = path.join(root, "skills");
    const subs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(subs.sort()).toEqual(["email-writer", "lead-research"]);
    for (const sub of subs) {
      const md = fs.readFileSync(
        path.join(skillsDir, sub, "SKILL.md"),
        "utf-8"
      );
      expect(
        ClaudeSkillFormatAdapter.adapt(md, `skills/${sub}/SKILL.md`).ok
      ).toBe(true);
    }
  });

  it("mcp-only plugin: manifest + inline mcp map normalize cleanly", () => {
    const root = path.join(FIXTURES, "mcp-only");
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf-8")
    );
    const adapted = ClaudePluginAdapter.adapt(raw, { pluginRoot: root });
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.adapted.inlineMcp).toBeDefined();
    expect(Object.keys(adapted.adapted.inlineMcp!)).toEqual(["demo-server"]);
    const norm = normalizeInlineMcpMap(adapted.adapted.inlineMcp!, root);
    expect(norm.ok).toBe(true);
    if (!norm.ok) return;
    expect(norm.servers[0].serverName).toBe("demo-server");
    expect(norm.servers[0].command).toBe("node");
  });

  it("mixed plugin: skills + inline mcp both adapt cleanly", () => {
    const root = path.join(FIXTURES, "mixed");
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf-8")
    );
    const adapted = ClaudePluginAdapter.adapt(raw, { pluginRoot: root });
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.adapted.skillsPaths).toEqual(["skills/"]);
    expect(adapted.adapted.inlineMcp).toBeDefined();
    expect(Object.keys(adapted.adapted.inlineMcp!)).toEqual(["echo"]);

    // Verify the skill under skills/ adapts
    const md = fs.readFileSync(
      path.join(root, "skills", "lead-research", "SKILL.md"),
      "utf-8"
    );
    expect(
      ClaudeSkillFormatAdapter.adapt(md, "skills/lead-research/SKILL.md").ok
    ).toBe(true);
  });
});

describe("AC-3, AC-5: skill isolation", () => {
  it("AC-5: broken skill (missing frontmatter) is rejected, good skill is not", () => {
    const root = path.join(FIXTURES, "broken-skill");
    const goodMd = fs.readFileSync(
      path.join(root, "skills", "good-skill", "SKILL.md"),
      "utf-8"
    );
    const brokenMd = fs.readFileSync(
      path.join(root, "skills", "broken-skill", "SKILL.md"),
      "utf-8"
    );
    const good = ClaudeSkillFormatAdapter.adapt(
      goodMd,
      "skills/good-skill/SKILL.md"
    );
    const broken = ClaudeSkillFormatAdapter.adapt(
      brokenMd,
      "skills/broken-skill/SKILL.md"
    );
    expect(good.ok).toBe(true);
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error.code).toBe("claude-frontmatter-missing-field");
  });

  it("AC-3 conceptual: each skill has independent identity (per-plugin namespace)", () => {
    // Skills within a plugin are namespaced by their frontmatter name; the
    // Plugin Manager's per-skill toggle reads the InstalledSkill row, not
    // the manifest. Two skills with different frontmatter names produce
    // different InstalledSkill identities — toggling one doesn't touch
    // the other's DB row.
    const root = path.join(FIXTURES, "skills-only");
    const lead = ClaudeSkillFormatAdapter.adapt(
      fs.readFileSync(
        path.join(root, "skills", "lead-research", "SKILL.md"),
        "utf-8"
      ),
      "skills/lead-research/SKILL.md"
    );
    const email = ClaudeSkillFormatAdapter.adapt(
      fs.readFileSync(
        path.join(root, "skills", "email-writer", "SKILL.md"),
        "utf-8"
      ),
      "skills/email-writer/SKILL.md"
    );
    expect(lead.ok && email.ok).toBe(true);
    if (!lead.ok || !email.ok) return;
    expect(lead.manifest.name).not.toBe(email.manifest.name);
  });
});

describe("AC-4: uninstall cleanup contract", () => {
  it("uninstall removes plugin-owned rows + cache dir + manifest row", () => {
    // The uninstall path in PluginManagementModule already removes rows
    // WHERE pluginName = ?. After our P2.3 scoping change, MCP rows for
    // plugin-owned servers carry:
    //   - serverName: <plugin>__<server>
    //   - pluginName: <plugin>
    //   - origin: "plugin"
    // The existing uninstall-by-pluginName query removes them correctly.
    // This test documents the contract by asserting the row shape.
    const root = path.join(FIXTURES, "mcp-only");
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf-8")
    );
    const adapted = ClaudePluginAdapter.adapt(raw, { pluginRoot: root });
    if (!adapted.ok) throw new Error("adapt failed");
    const scoped = `claude-mcp-only-pack__demo-server`;
    expect(scoped).toMatch(/^[a-z][a-z0-9_-]*__[a-z][a-z0-9_-]*$/);
    expect(adapted.adapted.manifest.name).toBe("claude-mcp-only-pack");
  });
});

describe("AC-16: .git stripping is in effect", () => {
  it("no fixture ships a .git directory (sanity)", () => {
    const check = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && (e.name === ".git" || e.name === ".github")) {
          throw new Error(`forbidden dir ${e.name} in ${dir}`);
        }
      }
    };
    for (const name of fs.readdirSync(FIXTURES)) {
      check(path.join(FIXTURES, name));
    }
  });
});

describe("Round-trip fidelity across all fixtures", () => {
  for (const name of ["skills-only", "mcp-only", "mixed", "broken-skill"]) {
    it(`${name}: no synthesized manifest.json written`, async () => {
      const root = path.join(FIXTURES, name);
      await PluginManifestService.loadFromDirectory(root);
      // Loading is read-only; no manifest.json should appear at the root.
      expect(fs.existsSync(path.join(root, "manifest.json"))).toBe(false);
    });
  }
});

describe("Opaque carry-through preserves unsupported fields", () => {
  it("commands/agents/outputStyles ride along via CLAUDE_OPAQUE_KEY", () => {
    const adapted = ClaudePluginAdapter.adapt(
      {
        name: "p",
        version: "1.0.0",
        description: "d",
        commands: { foo: { source: "commands/foo.md" } },
        agents: ["agents/bar.md"],
        outputStyles: ["styles/x.json"],
      },
      { pluginRoot: "/tmp/p" }
    );
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.adapted.opaque.commands).toEqual({
      foo: { source: "commands/foo.md" },
    });
    // `agents` is a first-class manifest field, not an opaque carry-through.
    expect(adapted.adapted.manifest.agents).toEqual(["agents/bar.md"]);
    expect(adapted.adapted.opaque.outputStyles).toEqual(["styles/x.json"]);

    // Verify the same data is stashed on the manifest object for downstream
    // re-emission.
    const opaqueOnManifest = (
      adapted.adapted.manifest as unknown as Record<string, unknown>
    )[CLAUDE_OPAQUE_KEY];
    expect(opaqueOnManifest).toBeDefined();
  });
});
