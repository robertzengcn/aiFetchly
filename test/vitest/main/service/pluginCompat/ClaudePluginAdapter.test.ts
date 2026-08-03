import { describe, it, expect } from "vitest";
import { ClaudePluginAdapter } from "@/service/pluginCompat/ClaudePluginAdapter";

const ROOT = "/tmp/plugin-root";

describe("ClaudePluginAdapter", () => {
  it("adapts a minimal Claude manifest with only skills array", () => {
    const raw = {
      name: "lead-pack",
      version: "1.0.0",
      description: "Lead research tools",
      skills: ["skills/lead-research/"],
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.manifest.name).toBe("lead-pack");
    expect(r.adapted.manifest.format).toBe("claude");
    expect(r.adapted.skillsPaths).toEqual(["skills/lead-research/"]);
    expect(r.adapted.mcpServersPaths).toEqual([]);
  });

  it("treats skills:true as auto-detect of skills/ directory", () => {
    const raw = { name: "p", version: "1.0.0", description: "d", skills: true };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.skillsPaths).toEqual(["skills/"]);
  });

  it("treats missing skills field as auto-detect (skills/)", () => {
    const raw = { name: "p", version: "1.0.0", description: "d" };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.skillsPaths).toEqual(["skills/"]);
  });

  it("normalizes object-map skills form to skill file paths", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      skills: {
        "lead-research": { description: "desc" },
        "email-writer": {},
      },
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.skillsPaths).toEqual([
      "skills/lead-research/SKILL.md",
      "skills/email-writer/SKILL.md",
    ]);
  });

  it("dedupes skill paths", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      skills: ["skills/a/", "skills/a/"],
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.skillsPaths).toEqual(["skills/a/"]);
  });

  it("rejects path-traversal in skill paths", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      skills: ["../escape/"],
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("path-outside-plugin");
  });

  it("captures inline mcp map and leaves mcpServersPaths empty", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      mcp: {
        linkedin: { command: "node", args: ["server.js"] },
      },
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.inlineMcp).toEqual({
      linkedin: { command: "node", args: ["server.js"] },
    });
    expect(r.adapted.mcpServersPaths).toEqual([]);
  });

  it("records hooks path opaquely for Phase 3", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      hooks: "hooks/hooks.json",
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.hooksPath).toBe("hooks/hooks.json");
  });

  it("carries commands/outputStyles as opaque and agents as a first-class field", () => {
    const raw = {
      name: "p",
      version: "1.0.0",
      description: "d",
      commands: { foo: { source: "commands/foo.md" } },
      agents: ["agents/bar.md"],
      outputStyles: ["styles/x.json"],
    };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.opaque.commands).toEqual({
      foo: { source: "commands/foo.md" },
    });
    // `agents` was promoted to a first-class manifest field; it is normalized
    // there (not carried in the opaque bag like commands/outputStyles).
    expect(r.adapted.manifest.agents).toEqual(["agents/bar.md"]);
    expect(r.adapted.opaque.outputStyles).toEqual(["styles/x.json"]);
  });

  it("defaults version to 0.0.0 when missing", () => {
    const raw = { name: "p", description: "d" };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapted.manifest.version).toBe("0.0.0");
  });

  it("fails on invalid name", () => {
    const raw = { name: "P!", version: "1.0.0", description: "d" };
    const r = ClaudePluginAdapter.adapt(raw, { pluginRoot: ROOT });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("manifest-schema-invalid");
  });

  it("fails on non-object input", () => {
    const r = ClaudePluginAdapter.adapt("not an object", { pluginRoot: ROOT });
    expect(r.ok).toBe(false);
  });
});
