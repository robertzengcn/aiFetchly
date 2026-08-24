/**
 * Unit tests for PromptSkillLoader, PromptSkillCatalog, the token budget
 * service, and the context assembler (design §10, PRD §13-14).
 */
import { describe, expect, it, afterEach } from "vitest";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadSkillMarkdownFile,
  extractBody,
  canonicalizeSkillRoot,
  SKILL_MD_MAX_BYTES,
} from "@/service/PromptSkillLoader";
import {
  PromptSkillCatalog,
  buildPromptSkillRuntimeId,
  getDefaultPromptSkillCatalog,
} from "@/service/PromptSkillCatalog";
import {
  PromptSkillTokenBudgetService,
  splitMarkdownSections,
  estimateTokens,
} from "@/service/PromptSkillTokenBudgetService";
import { PromptSkillContextAssembler } from "@/service/PromptSkillContextAssembler";
import type { PromptSkillDefinition } from "@/entityTypes/promptSkillTypes";

function makeSkillDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pskill-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function makeDefinition(
  overrides: Partial<PromptSkillDefinition> = {}
): PromptSkillDefinition {
  const root = makeSkillDir({
    "SKILL.md": "---\nname: video-use\ndescription: Edit videos\n---\nBody.",
  });
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    runtimeId: `prompt:user:test-${suffix}`,
    installationId: `test-${suffix}`,
    sourceId: "user",
    scope: "user",
    name: "video-use",
    description: "Edit videos",
    canonicalRoot: root,
    skillMarkdownPath: path.join(root, "SKILL.md"),
    contentHash: sha256(
      "---\nname: video-use\ndescription: Edit videos\n---\nBody."
    ),
    manifest: {
      schemaVersion: 1,
      name: "video-use",
      description: "Edit videos",
      unknownFields: {},
    },
    enabled: true,
    ...overrides,
  };
}

describe("PromptSkillLoader", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parses frontmatter name/description and strips the body", () => {
    dir = makeSkillDir({
      "SKILL.md":
        "---\nname: video-use\ndescription: Edit videos with helpers\n---\n\n# Usage\n\nDo things.",
    });
    const result = loadSkillMarkdownFile(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.manifest.name).toBe("video-use");
    expect(result.file.manifest.description).toBe("Edit videos with helpers");
    expect(result.file.body).toContain("# Usage");
    expect(result.file.body).not.toContain("name: video-use");
    expect(result.file.contentHash).toHaveLength(64);
  });

  it("accepts a bare markdown body with directory-name fallback", () => {
    dir = makeSkillDir({
      "SKILL.md": "# Release Checklist\n\nVerify the build.",
    });
    const result = loadSkillMarkdownFile(
      path.join(dir, "..", path.basename(dir))
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Directory name is normalized as the fallback name.
    expect(result.file.manifest.name).toMatch(/^[a-z0-9-]+$/);
    expect(result.file.manifest.description).toContain("Release Checklist");
  });

  it("preserves unknown frontmatter fields without executing them", () => {
    dir = makeSkillDir({
      "SKILL.md":
        "---\nname: s\ndescription: d\nsome-future-field: value\nhooks:\n  - a\n  - b\n---\nbody",
    });
    const result = loadSkillMarkdownFile(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.manifest.unknownFields["some-future-field"]).toBe(
      "value"
    );
    expect(result.file.manifest.unknownFields["hooks"]).toEqual(["a", "b"]);
  });

  it("reads through a symlinked skill root (realpath)", () => {
    const real = makeSkillDir({
      "SKILL.md": "---\nname: linked\ndescription: d\n---\nbody",
    });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pskill-link-"));
    const linkPath = path.join(dir, "linked-skill");
    fs.symlinkSync(real, linkPath);
    try {
      const result = loadSkillMarkdownFile(linkPath);
      expect(result.ok).toBe(true);
      expect(canonicalizeSkillRoot(linkPath)).toBe(fs.realpathSync(real));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  it("rejects oversized SKILL.md before reading", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pskill-"));
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "x".repeat(SKILL_MD_MAX_BYTES + 1)
    );
    const result = loadSkillMarkdownFile(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SKILL_MD_TOO_LARGE");
  });

  it("rejects missing SKILL.md", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pskill-"));
    const result = loadSkillMarkdownFile(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SKILL_MD_MISSING");
  });
});

describe("PromptSkillCatalog", () => {
  it("registers and resolves by runtime id and name", () => {
    const catalog = new PromptSkillCatalog();
    const def = makeDefinition();
    const { registered } = catalog.replaceSource("user", [def]);
    expect(registered).toHaveLength(1);

    const byId = catalog.resolve(def.runtimeId, {});
    expect(byId.definition?.name).toBe("video-use");

    const byName = catalog.resolve("video-use", {});
    expect(byName.definition?.runtimeId).toBe(def.runtimeId);
  });

  it("workspace scope outranks user scope on name collisions", () => {
    const catalog = new PromptSkillCatalog();
    const userDef = makeDefinition({
      name: "dup",
      scope: "user",
      sourceId: "u",
    });
    const wsDef = makeDefinition({
      name: "dup",
      scope: "workspace",
      sourceId: "w",
      runtimeId: buildPromptSkillRuntimeId("workspace", "ws-install", 42),
    });
    catalog.replaceSource("u", [userDef]);
    const { diagnostics } = catalog.replaceSource("w", [wsDef]);
    expect(
      diagnostics.some((d) => d.code === "prompt-skill-name-collision")
    ).toBe(true);
    const resolved = catalog.resolve("dup", { workspaceId: 42 });
    expect(resolved.definition?.scope).toBe("workspace");
  });

  it("workspace skills do not leak into other workspaces", () => {
    const catalog = new PromptSkillCatalog();
    const wsDef = makeDefinition({
      name: "secret-ws",
      scope: "workspace",
      sourceId: "w",
      runtimeId: buildPromptSkillRuntimeId("workspace", "ws-install", 42),
    });
    catalog.replaceSource("w", [wsDef]);
    expect(
      catalog.resolve("secret-ws", { workspaceId: 7 }).definition
    ).toBeNull();
    expect(
      catalog.resolve("secret-ws", { workspaceId: 42 }).definition
    ).not.toBeNull();
  });

  it("deduplicates by canonical SKILL.md real path", () => {
    const catalog = new PromptSkillCatalog();
    const base = makeDefinition();
    const twin = makeDefinition({
      runtimeId: "prompt:user:other-install",
      installationId: "other-install",
      sourceId: "u2",
      name: "twin-skill",
      skillMarkdownPath: base.skillMarkdownPath,
      canonicalRoot: base.canonicalRoot,
    });
    catalog.replaceSource("u", [base]);
    const { registered } = catalog.replaceSource("u2", [twin]);
    expect(registered).toHaveLength(0); // deduped away
    expect(catalog.size()).toBe(1);
  });

  it("replaceSource atomically swaps one source without touching others", () => {
    const catalog = new PromptSkillCatalog();
    const a1 = makeDefinition({ name: "a-one", sourceId: "sa" });
    const b1 = makeDefinition({ name: "b-one", sourceId: "sb" });
    catalog.replaceSource("sa", [a1]);
    catalog.replaceSource("sb", [b1]);

    const a2 = makeDefinition({
      name: "a-two",
      sourceId: "sa",
      runtimeId: "prompt:user:a-two",
    });
    catalog.replaceSource("sa", [a2]);
    expect(catalog.resolve("a-one", {}).definition).toBeNull();
    expect(catalog.resolve("b-one", {}).definition).not.toBeNull();
    expect(catalog.resolve("a-two", {}).definition).not.toBeNull();
  });

  it("list() never includes instruction bodies", () => {
    const catalog = new PromptSkillCatalog();
    catalog.replaceSource("user", [makeDefinition()]);
    const listed = catalog.list({});
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("Body.");
    expect(listed[0]).toHaveProperty("runtimeId");
    expect(listed[0]).toHaveProperty("description");
  });

  it("respects the catalog cap", () => {
    const catalog = new PromptSkillCatalog();
    const many = Array.from({ length: 105 }, (_, i) =>
      makeDefinition({
        name: `skill-${i}`,
        runtimeId: `prompt:user:skill-${i}`,
        sourceId: "bulk",
      })
    );
    const { registered, diagnostics } = catalog.replaceSource("bulk", many);
    expect(registered.length).toBe(100);
    expect(
      diagnostics.some((d) => d.code === "prompt-skill-limit-exceeded")
    ).toBe(true);
  });

  it("global catalog singleton exists", () => {
    expect(getDefaultPromptSkillCatalog()).toBe(getDefaultPromptSkillCatalog());
  });
});

describe("PromptSkillTokenBudgetService", () => {
  const service = new PromptSkillTokenBudgetService();

  it("keeps the full body when it fits", () => {
    const decision = service.decide({
      normalizedBody: "# S\n\nsmall body",
      availableTokens: 10_000,
      perSkillMaxTokens: 5_000,
    });
    expect(decision.mode).toBe("full");
    expect(decision.resourceReadRequired).toBe(false);
  });

  it("splits sections on headings without breaking fenced blocks", () => {
    const md = [
      "# Title",
      "",
      "intro text",
      "",
      "## Workflow",
      "",
      "```bash",
      "# not a heading inside a fence",
      "echo run-step",
      "```",
      "",
      "## Extra Details",
      "",
      "long tail content",
    ].join("\n");
    const sections = splitMarkdownSections(md);
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain("Workflow");
    expect(headings).toContain("Extra Details");
    const workflow = sections.find((s) => s.heading === "Workflow");
    expect(workflow?.content).toContain("# not a heading inside a fence");
    expect(workflow?.content).toContain("echo run-step");
  });

  it("selects essential sections and omits the rest whole", () => {
    const filler = "x".repeat(200);
    const md = [
      "preamble contract text",
      "",
      "## Safety",
      "",
      `safety content ${filler}`,
      "",
      "## Changelog Trivia",
      "",
      `huge noise ${filler.repeat(40)}`,
      "",
      "## Workflow",
      "",
      `workflow steps ${filler}`,
    ].join("\n");
    const decision = service.decide({
      normalizedBody: md,
      availableTokens: 400,
      perSkillMaxTokens: 400,
    });
    expect(decision.mode).toBe("section-selected");
    expect(decision.selectedSections).toContain("Safety");
    expect(decision.selectedSections).toContain("Workflow");
    expect(decision.omittedSections).toContain("Changelog Trivia");
    expect(decision.resourceReadRequired).toBe(true);

    const rendered = service.renderSelected(md, decision);
    expect(rendered).toContain("safety content");
    expect(rendered).not.toContain("huge noise");
    expect(rendered).toContain("skill_resource_read");
  });

  it("falls back to metadata-only when even essentials cannot fit", () => {
    const md = `## Safety\n\n${"y".repeat(4_000)}`;
    const decision = service.decide({
      normalizedBody: md,
      availableTokens: 10,
      perSkillMaxTokens: 10,
    });
    expect(decision.mode).toBe("metadata-only");
  });

  it("estimates tokens ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("PromptSkillContextAssembler", () => {
  const assembler = new PromptSkillContextAssembler();

  it("assembles a bounded, marked instruction block with stable header", () => {
    const def = makeDefinition();
    const result = assembler.assemble({
      definition: def,
      conversationWorkspaceRoot: "/ws/root",
      availableTokens: 10_000,
      perSkillMaxTokens: 5_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.normalizedInstructions).toContain(
      "<invoked_prompt_skill"
    );
    expect(result.context.normalizedInstructions).toContain(
      `Base directory for this skill: ${def.canonicalRoot}`
    );
    expect(result.context.normalizedInstructions).toContain(
      "Writable workspace: /ws/root"
    );
    expect(result.context.normalizedInstructions).toContain(
      "repository-authored and untrusted"
    );
    expect(result.context.normalizedInstructions).toContain("Body.");
    expect(result.context.budgetMode).toBe("full");
  });

  it("substitutes both skill-dir variables", () => {
    const content =
      "---\nname: video-use\ndescription: Edit videos\n---\n" +
      "run ${AIFETCHLY_SKILL_DIR}/helpers/cut.sh and ${CLAUDE_SKILL_DIR}/helpers/merge.sh";
    const root = makeSkillDir({ "SKILL.md": content });
    const def = makeDefinition({
      canonicalRoot: root,
      skillMarkdownPath: path.join(root, "SKILL.md"),
      contentHash: sha256(content),
    });
    const result = assembler.assemble({
      definition: def,
      conversationWorkspaceRoot: "/ws",
      availableTokens: 10_000,
      perSkillMaxTokens: 5_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.normalizedInstructions).toContain(
      `${root}/helpers/cut.sh`
    );
    expect(result.context.normalizedInstructions).toContain(
      `${root}/helpers/merge.sh`
    );
    expect(result.context.normalizedInstructions).not.toContain(
      "AIFETCHLY_SKILL_DIR"
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects when the on-disk hash no longer matches (linked skill changed)", () => {
    const root = makeSkillDir({
      "SKILL.md": "---\nname: video-use\ndescription: Edit videos\n---\nBody.",
    });
    const def = makeDefinition({
      canonicalRoot: root,
      skillMarkdownPath: path.join(root, "SKILL.md"),
      contentHash: sha256("different content"),
    });
    const result = assembler.assemble({
      definition: def,
      conversationWorkspaceRoot: "/ws",
      availableTokens: 10_000,
      perSkillMaxTokens: 5_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SKILL_CONTEXT_HASH_MISMATCH");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects disabled skills before any injection", () => {
    const def = makeDefinition({ enabled: false });
    const result = assembler.assemble({
      definition: def,
      conversationWorkspaceRoot: "/ws",
      availableTokens: 10_000,
      perSkillMaxTokens: 5_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SKILL_DISABLED");
  });
});

describe("extractBody", () => {
  it("returns the full text when no frontmatter exists", () => {
    expect(extractBody("plain text")).toBe("plain text");
  });
});
