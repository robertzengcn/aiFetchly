import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginManifestService } from "@/service/PluginManifestService";

describe("PluginManifestService dual-path discovery", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-manifest-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("prefers .aifetchly-plugin over .claude-plugin when both exist", async () => {
    fs.mkdirSync(path.join(tmp, ".aifetchly-plugin"));
    fs.writeFileSync(
      path.join(tmp, ".aifetchly-plugin", "plugin.json"),
      JSON.stringify({
        name: "native",
        version: "1.0.0",
        description: "native",
        skills: ["skills/foo/"],
      })
    );
    fs.mkdirSync(path.join(tmp, ".claude-plugin"));
    fs.writeFileSync(
      path.join(tmp, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "claude", version: "1.0.0", description: "claude" })
    );

    const result = await PluginManifestService.loadFromDirectory(tmp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.name).toBe("native");
    expect(result.manifest.format).toBeUndefined();
  });

  it("detects claude format when only .claude-plugin exists", async () => {
    fs.mkdirSync(path.join(tmp, ".claude-plugin"));
    fs.writeFileSync(
      path.join(tmp, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "claude-pack",
        version: "1.0.0",
        description: "claude pack",
        skills: ["skills/foo/"],
      })
    );

    const result = await PluginManifestService.loadFromDirectory(tmp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.format).toBe("claude");
  });

  it("falls back to root plugin.json as aifetchly format", async () => {
    fs.writeFileSync(
      path.join(tmp, "plugin.json"),
      JSON.stringify({
        name: "legacy",
        version: "1.0.0",
        description: "legacy",
        skills: ["skills/foo/"],
      })
    );

    const result = await PluginManifestService.loadFromDirectory(tmp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.format).toBeUndefined();
  });

  it("accepts claude manifest with empty description", async () => {
    fs.mkdirSync(path.join(tmp, ".claude-plugin"));
    fs.writeFileSync(
      path.join(tmp, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "minimal", version: "1.0.0" })
    );

    const result = await PluginManifestService.loadFromDirectory(tmp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.manifest.format).toBe("claude");
    expect(result.manifest.description).toBe("");
  });
});
