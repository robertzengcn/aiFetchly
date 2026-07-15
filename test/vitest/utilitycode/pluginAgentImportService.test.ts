import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PluginAgentImportService } from "@/service/PluginAgentImportService";
import type { PluginManifest } from "@/entityTypes/pluginTypes";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-import-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
}

const md = (name: string, desc = "d") =>
  `---\nname: ${name}\ndescription: ${desc}\n---\nbody for ${name}`;

describe("PluginAgentImportService", () => {
  it("imports a native array declaration", () => {
    write(path.join(tmp, "agents", "reviewer.md"), md("reviewer"));
    const manifest = {
      name: "lead-pack",
      version: "1.0.0",
      description: "x",
      agents: ["agents/reviewer.md"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({
      pluginRoot: tmp,
      manifest,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0].definition.id).toBe("lead-pack:reviewer");
  });

  it("auto-detects Claude agents/ when agents === true", () => {
    write(path.join(tmp, "agents", "a.md"), md("a"));
    write(path.join(tmp, "agents", "b.md"), md("b"));
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
      agents: true,
      format: "claude",
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({
      pluginRoot: tmp,
      manifest,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.agents.map((a) => a.definition.id).sort();
    expect(ids).toEqual(["p:a", "p:b"]);
  });

  it("produces nested namespace IDs for subdirectories", () => {
    write(path.join(tmp, "agents", "review", "security.md"), md("strict"));
    const manifest = {
      name: "lead-pack",
      version: "1.0.0",
      description: "x",
      agents: ["agents/"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({
      pluginRoot: tmp,
      manifest,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.agents[0].definition.id).toBe("lead-pack:review:strict");
  });

  it("rejects path traversal", () => {
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
      agents: ["../escape.md"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({
      pluginRoot: tmp,
      manifest,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "agent-path-invalid")).toBe(true);
  });

  it("fails on duplicate IDs within a plugin", () => {
    write(path.join(tmp, "agents", "a.md"), md("dup"));
    write(path.join(tmp, "agents", "b.md"), md("dup"));
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
      agents: ["agents/"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({
      pluginRoot: tmp,
      manifest,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "agent-name-conflict")).toBe(true);
  });

  it("returns ok with zero agents when nothing is declared and no agents/ exists", () => {
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({
      pluginRoot: tmp,
      manifest,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.agents).toHaveLength(0);
  });

  it("rejects a symlinked agent file that escapes the plugin root", () => {
    // File outside the plugin root (but inside the shared tmp parent).
    const outside = path.join(tmp, "outside-secret.md");
    fs.writeFileSync(outside, "secret content");
    const root = fs.mkdtempSync(path.join(tmp, "plug-"));
    fs.mkdirSync(path.join(root, "agents"));
    fs.symlinkSync(outside, path.join(root, "agents", "leak.md"));
    const manifest = {
      name: "p",
      version: "1.0.0",
      description: "x",
      agents: ["agents/leak.md"],
    } as unknown as PluginManifest;
    const r = PluginAgentImportService.parsePluginAgents({
      pluginRoot: root,
      manifest,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "agent-path-invalid")).toBe(true);
  });
});
