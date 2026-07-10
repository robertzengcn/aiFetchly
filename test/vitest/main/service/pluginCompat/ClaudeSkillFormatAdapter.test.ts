import { describe, it, expect } from "vitest";
import { ClaudeSkillFormatAdapter } from "@/service/pluginCompat/ClaudeSkillFormatAdapter";

describe("ClaudeSkillFormatAdapter", () => {
  it("adapts a well-formed SKILL.md with name and description", () => {
    const md = `---
name: lead-research
description: Use when the user asks about lead research.
---
# Lead Research
Instructions here.`;
    const result = ClaudeSkillFormatAdapter.adapt(
      md,
      "skills/lead-research/SKILL.md"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.name).toBe("lead-research");
    expect(result.manifest.description).toContain(
      "Use when the user asks about lead research."
    );
    expect(result.manifest.runtime).toBe("javascript");
    expect(result.manifest.documentationOnly).toBe(true);
    expect(result.body).toContain("# Lead Research");
  });

  it("derives the name from the parent directory when name is omitted", () => {
    const md = `---
description: some description
---
body`;
    // `name` is optional: when omitted it is derived from the SKILL.md parent
    // directory (only `description` is required). See ClaudeSkillFormatAdapter.
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/foo/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.name).toBe("foo");
  });

  it("fails when description is missing", () => {
    const md = `---
name: foo
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/foo/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("claude-frontmatter-missing-field");
    expect(result.error.message).toContain("description");
  });

  it("fails when frontmatter is empty", () => {
    const result = ClaudeSkillFormatAdapter.adapt(
      "no frontmatter here",
      "skills/foo/SKILL.md"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("claude-frontmatter-missing-field");
  });

  it("sanitizes a name that does not match the kebab regex", () => {
    const md = `---
name: Lead Research!
description: desc
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(
      md,
      "skills/lead-research/SKILL.md"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.name).toMatch(/^[a-z][a-z0-9_-]*$/);
  });

  it("uses default version 0.0.0 when version absent", () => {
    const md = `---
name: foo
description: desc
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(md, "skills/foo/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.version).toBe("0.0.0");
  });

  it("preserves supportedFileTypes when declared in frontmatter", () => {
    const md = `---
name: pdf-tool
description: desc
supported_file_types: [".pdf"]
---
body`;
    const result = ClaudeSkillFormatAdapter.adapt(
      md,
      "skills/pdf-tool/SKILL.md"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.supportedFileTypes).toEqual([".pdf"]);
  });
});
