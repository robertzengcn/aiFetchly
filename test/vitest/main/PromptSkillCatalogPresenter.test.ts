/**
 * Tests for PromptSkillCatalogPresenter (design §10.3, NFR-09):
 * metadata-only catalog rendering, description bounding, deterministic
 * shortening under budget, and no instruction bodies ever leaking.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildPromptSkillCatalogBlock,
} from "@/service/PromptSkillCatalogPresenter";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import type { PromptSkillDefinition } from "@/entityTypes/promptSkillTypes";

function makeSkill(
  name: string,
  description: string,
  overrides: Partial<PromptSkillDefinition> = {}
): PromptSkillDefinition {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "presenter-"));
  const content = `---\nname: ${name}\ndescription: ${description}\n---\nSECRET-BODY-${name}`;
  fs.writeFileSync(path.join(root, "SKILL.md"), content);
  return {
    runtimeId: `prompt:user:${name}`,
    installationId: name,
    sourceId: "user",
    scope: "user",
    name,
    description,
    canonicalRoot: root,
    skillMarkdownPath: path.join(root, "SKILL.md"),
    contentHash: crypto.createHash("sha256").update(content).digest("hex"),
    manifest: {
      schemaVersion: 1,
      name,
      description,
      unknownFields: {},
    },
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  getDefaultPromptSkillCatalog().replaceSource("user", []);
});

afterEach(() => {
  getDefaultPromptSkillCatalog().replaceSource("user", []);
});

describe("buildPromptSkillCatalogBlock", () => {
  it("lists installed skills with names, bounded descriptions, and scope labels", () => {
    getDefaultPromptSkillCatalog().replaceSource("user", [
      makeSkill("video-use", "Edit and produce videos with helpers"),
      makeSkill("release-check", "Validate the workspace before release"),
    ]);
    const block = buildPromptSkillCatalogBlock({});
    expect(block).toContain("use_skill");
    expect(block).toContain("video-use");
    expect(block).toContain("release-check");
    expect(block).toContain("user skill");
  });

  it("NEVER contains instruction bodies (metadata-only)", () => {
    getDefaultPromptSkillCatalog().replaceSource("user", [
      makeSkill("video-use", "Edit videos"),
    ]);
    const block = buildPromptSkillCatalogBlock({});
    expect(block).not.toContain("SECRET-BODY");
  });

  it("returns empty for an empty catalog", () => {
    expect(buildPromptSkillCatalogBlock({})).toBe("");
  });

  it("bounds long descriptions", () => {
    getDefaultPromptSkillCatalog().replaceSource("user", [
      makeSkill(
        "long-skill",
        "x".repeat(500)
      ),
    ]);
    const block = buildPromptSkillCatalogBlock({});
    const line = block.split("\n").find((l) => l.includes("long-skill"));
    expect(line).toBeDefined();
    expect((line as string).length).toBeLessThan(250);
  });

  it("deterministically shortens descriptions before dropping entries under the budget", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      makeSkill(
        `skill-${i}`,
        `Description number ${i} with plenty of explanatory text to spend budget`
      )
    );
    getDefaultPromptSkillCatalog().replaceSource("user", many);
    const block = buildPromptSkillCatalogBlock({});
    // Some entries survive; the omitted tail is reported, never silently cut.
    expect(block).toContain("skill-0");
    expect(block).toMatch(/omitted for context budget|skill-5/);
  });

  it("marks disable-model-invocation skills as explicit-only", () => {
    const base = makeSkill("manual-only", "Only users invoke this");
    getDefaultPromptSkillCatalog().replaceSource("user", [
      {
        ...base,
        manifest: { ...base.manifest, disableModelInvocation: true },
      },
    ]);
    const block = buildPromptSkillCatalogBlock({});
    expect(block).toContain("model selection disabled");
  });
});
