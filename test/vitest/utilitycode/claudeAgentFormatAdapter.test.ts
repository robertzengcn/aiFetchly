import { describe, it, expect } from "vitest";
import { ClaudeAgentFormatAdapter } from "@/service/pluginCompat/ClaudeAgentFormatAdapter";

const VALID_MD = `---
name: reviewer
description: Reviews campaign drafts.
tools: [knowledge_library_search]
model: gpt-5-mini
mode: verifier
maxTurns: 8
color: blue
---

You are a campaign review specialist.`;

describe("ClaudeAgentFormatAdapter", () => {
  it("parses required fields and maps frontmatter", () => {
    const r = ClaudeAgentFormatAdapter.adapt(VALID_MD, {
      pluginName: "lead-pack",
      sourcePath: "agents/reviewer.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.definition;
    expect(d.id).toBe("lead-pack:reviewer");
    expect(d.name).toBe("reviewer");
    expect(d.description).toBe("Reviews campaign drafts.");
    expect(d.systemPrompt).toContain("campaign review specialist");
    expect(d.allowedTools).toEqual(["knowledge_library_search"]);
    expect(d.defaultModel).toBe("gpt-5-mini");
    expect(d.mode).toBe("verifier");
    expect(d.maxContinueCalls).toBe(8);
    expect(d.source).toBe("plugin");
    expect(d.health).toBe("healthy");
    expect(d.status).toBe("active");
    expect((r.manifest as { color: string }).color).toBe("blue");
  });

  it("unions tools and skills into allowedTools", () => {
    const md = `---
name: a
description: d
tools: [t1]
skills: [s1, s2]
---

body`;
    const r = ClaudeAgentFormatAdapter.adapt(md, {
      pluginName: "p",
      sourcePath: "agents/a.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition.allowedTools.sort()).toEqual(["s1", "s2", "t1"]);
  });

  it("maps safe Claude tool aliases and ignores Claude model shorthand", () => {
    const md = `---
name: cavecrew-investigator
description: Read-only locator.
tools: [Read, Grep, Glob, Bash]
model: haiku
---

Locate definitions.`;
    const r = ClaudeAgentFormatAdapter.adapt(md, {
      pluginName: "caveman",
      sourcePath: "agents/cavecrew-investigator.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition.id).toBe("caveman:cavecrew-investigator");
    expect(r.definition.allowedTools).toEqual([
      "file_read",
      "grep_files",
      "glob_files",
    ]);
    expect(r.definition.defaultModel).toBeUndefined();
    expect(r.manifest.claudeModelAlias).toBe("haiku");
    expect(r.warnings.map((w) => w.message).join("\n")).toContain(
      'Claude model alias "haiku"'
    );
    expect(r.warnings.map((w) => w.message).join("\n")).toContain(
      'Claude agent tool "Bash"'
    );
  });

  it("rejects missing name", () => {
    const r = ClaudeAgentFormatAdapter.adapt("---\ndescription: d\n---\nbody", {
      pluginName: "p",
      sourcePath: "agents/x.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("agent-frontmatter-missing-field");
  });

  it("rejects missing description", () => {
    const r = ClaudeAgentFormatAdapter.adapt("---\nname: n\n---\nbody", {
      pluginName: "p",
      sourcePath: "agents/x.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty body", () => {
    const r = ClaudeAgentFormatAdapter.adapt(
      "---\nname: n\ndescription: d\n---\n",
      {
        pluginName: "p",
        sourcePath: "agents/x.md",
        namespaceSegments: [],
      }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("agent-frontmatter-missing-field");
  });

  it("warns on forbidden fields but still succeeds", () => {
    const md = `---
name: n
description: d
hooks: ./hooks.sh
permissionMode: bypassPermissions
mcpServers: [evil]
---

body`;
    const r = ClaudeAgentFormatAdapter.adapt(md, {
      pluginName: "p",
      sourcePath: "agents/x.md",
      namespaceSegments: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.code === "agent-unsupported-field")).toBe(
      true
    );
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("uses namespaceSegments for nested IDs", () => {
    const md = `---
name: strict
description: d
---

body`;
    const r = ClaudeAgentFormatAdapter.adapt(md, {
      pluginName: "lead-pack",
      sourcePath: "agents/review/security.md",
      namespaceSegments: ["review"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition.id).toBe("lead-pack:review:strict");
  });
});
