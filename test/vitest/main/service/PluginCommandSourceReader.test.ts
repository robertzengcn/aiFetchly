/**
 * PluginCommandSourceReader (PRD §8.2, FR-5, AC-5, AC-6; design §10, §18.5).
 *
 * Exercises native commands/*.md plus every Claude manifest declaration shape
 * (string / array / object-with-source / object-with-inline-content), path
 * safety, oversize rejection, and both dedup levels (same-file silent,
 * same-id-with-diagnostic). Uses real tmpdirs + real frontmatter parsing — no
 * service mocks — so the full validate path is exercised.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginCommandSourceReader } from "@/service/pluginCompat/PluginCommandSourceReader";
import { CLAUDE_OPAQUE_KEY } from "@/service/pluginCompat/ClaudePluginAdapter";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import type { PluginManifest } from "@/entityTypes/pluginTypes";

const PROMPT_REVIEW = `---
name: review
description: Review current changes
type: prompt
argumentHint: [scope]
---
Review the current changes: $ARGUMENTS
`;

const PROMPT_SHIP = `---
name: ship
description: Ship it
type: prompt
---
Ship the changes.
`;

const CLAUDE_ASIDE = `---
description: Answer a quick side question without interrupting context.
---
# Aside Command

Answer the question, then resume the original task.
`;

function tmpPlugin(name = "demo"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `plugin-cmd-${name}-`));
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function nativeManifest(name = "demo"): PluginManifest {
  return {
    name,
    version: "1.0.0",
    description: "demo",
    format: "aifetchly",
  };
}

function claudeManifest(commands: unknown, name = "demo"): PluginManifest {
  return {
    name,
    version: "1.0.0",
    description: "demo",
    format: "claude",
    [CLAUDE_OPAQUE_KEY]: { commands },
  } as unknown as PluginManifest;
}

async function read(
  installPath: string,
  manifest: PluginManifest,
  name = "demo"
) {
  return PluginCommandSourceReader.read({
    pluginName: name,
    installPath,
    manifest,
  });
}

describe("PluginCommandSourceReader — native commands/*.md", () => {
  it("registers prompt commands from the native commands directory", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/review.md", PROMPT_REVIEW);
    writeFile(root, "commands/ship.md", PROMPT_SHIP);
    const { definitions, diagnostics } = await read(root, nativeManifest());
    expect(diagnostics).toEqual([]);
    const ids = definitions.map((d) => d.id).sort();
    expect(ids).toEqual([
      "plugin:demo:command:review",
      "plugin:demo:command:ship",
    ]);
    const review = definitions.find((d) => d.name === "review")!;
    expect(review.source).toBe("plugin");
    expect(review.sourceId).toBe("plugin:demo");
    expect(review.body).toContain("$ARGUMENTS");
    expect(review.argumentHint).toBe("[scope]");
  });

  it("skips an oversized command file with a file-too-large diagnostic", async () => {
    const root = tmpPlugin();
    const big = "a".repeat(AIFETCHLY_CONFIG_LIMITS.commandMdBytes + 1);
    writeFile(root, "commands/review.md", big);
    const { definitions, diagnostics } = await read(root, nativeManifest());
    expect(definitions).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === "file-too-large")).toBe(true);
  });

  it("skips a file whose frontmatter is unparseable", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/review.md", "no frontmatter here at all");
    const { definitions, diagnostics } = await read(root, nativeManifest());
    expect(definitions).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === "frontmatter-unparseable")).toBe(
      true
    );
  });
});

describe("PluginCommandSourceReader — Claude string/array declarations", () => {
  it("registers a command from a Claude string path declaration (AC-5)", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/review.md", PROMPT_REVIEW);
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest("./commands/review.md")
    );
    expect(diagnostics).toEqual([]);
    expect(definitions.map((d) => d.id)).toEqual([
      "plugin:demo:command:review",
    ]);
  });

  it("registers valid siblings when a Claude array entry path is missing", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/review.md", PROMPT_REVIEW);
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest(["./commands/missing.md", "./commands/review.md"])
    );
    expect(definitions.map((d) => d.id)).toEqual([
      "plugin:demo:command:review",
    ]);
    expect(diagnostics.some((d) => d.code === "scanner-io-error")).toBe(true);
  });

  it("reads a directory referenced by a Claude string path", async () => {
    const root = tmpPlugin();
    writeFile(root, "cmds/review.md", PROMPT_REVIEW);
    const { definitions } = await read(root, claudeManifest("./cmds"));
    expect(definitions.map((d) => d.id)).toEqual([
      "plugin:demo:command:review",
    ]);
  });

  it("loads Claude directory commands that omit name and type using filename + prompt fallbacks", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/aside.md", CLAUDE_ASIDE);
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest("./commands/")
    );

    expect(diagnostics).toEqual([]);
    expect(definitions).toHaveLength(1);
    expect(definitions[0].name).toBe("aside");
    expect(definitions[0].type).toBe("prompt");
    expect(definitions[0].description).toBe(
      "Answer a quick side question without interrupting context."
    );
  });

  it("auto-detects root commands/ for Claude manifests whose commands field is true", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/aside.md", CLAUDE_ASIDE);
    const { definitions, diagnostics } = await read(root, claudeManifest(true));

    expect(diagnostics).toEqual([]);
    expect(definitions.map((d) => d.name)).toEqual(["aside"]);
  });
});

describe("PluginCommandSourceReader — Claude object declarations", () => {
  it("registers a command from an object mapping with source + description", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/review.md", PROMPT_REVIEW);
    const { definitions } = await read(
      root,
      claudeManifest({
        review: {
          source: "./commands/review.md",
          description: "Review current changes",
        },
      })
    );
    expect(definitions.map((d) => d.id)).toEqual([
      "plugin:demo:command:review",
    ]);
  });

  it("registers a command from inline content (AC-6)", async () => {
    const root = tmpPlugin();
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest({
        review: {
          description: "Review current changes",
          content:
            "---\nname: review\ndescription: Review current changes\ntype: prompt\n---\nReview $ARGUMENTS\n",
        },
      })
    );
    expect(diagnostics).toEqual([]);
    expect(definitions.map((d) => d.id)).toEqual([
      "plugin:demo:command:review",
    ]);
  });

  it("uses the mapping key as the fallback name when inline content omits it", async () => {
    const root = tmpPlugin();
    const { definitions } = await read(
      root,
      claudeManifest({
        review: {
          description: "Review current changes",
          content: "Review $ARGUMENTS now",
        },
      })
    );
    expect(definitions.map((d) => d.name)).toEqual(["review"]);
    expect(definitions[0].description).toBe("Review current changes");
  });

  it("maps Claude argument-hint to argumentHint", async () => {
    const root = tmpPlugin();
    const { definitions } = await read(
      root,
      claudeManifest({
        review: {
          content:
            "---\nname: review\ndescription: Review current changes\ntype: prompt\nargument-hint: <scope>\n---\nReview $ARGUMENTS\n",
        },
      })
    );
    expect(definitions[0].argumentHint).toBe("<scope>");
  });

  it("reports a diagnostic when an entry declares both source and content (FR-5)", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/review.md", PROMPT_REVIEW);
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest({
        review: {
          source: "./commands/review.md",
          content: "Review $ARGUMENTS",
        },
      })
    );
    expect(definitions).toHaveLength(0);
    expect(
      diagnostics.some((d) => d.code === "claude-frontmatter-invalid")
    ).toBe(true);
  });
});

describe("PluginCommandSourceReader — path safety + dedup", () => {
  it("rejects a path-traversal command declaration (design §11.4)", async () => {
    const root = tmpPlugin();
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest("../../../etc/passwd")
    );
    expect(definitions).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === "path-outside-plugin")).toBe(
      true
    );
  });

  it("silently deduplicates when the native dir and the manifest point at the same file", async () => {
    const root = tmpPlugin();
    writeFile(root, "commands/review.md", PROMPT_REVIEW);
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest("./commands/review.md")
    );
    // Only one review command, no duplicate diagnostic.
    expect(definitions.filter((d) => d.name === "review")).toHaveLength(1);
    expect(diagnostics.some((d) => d.code === "frontmatter-invalid")).toBe(
      false
    );
  });

  it("emits a duplicate-id diagnostic when distinct sources produce the same command id", async () => {
    const root = tmpPlugin();
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest({
        first: {
          content:
            "---\nname: review\ndescription: Duplicate\ntype: prompt\n---\nBody\n",
        },
        second: {
          content:
            "---\nname: review\ndescription: Duplicate\ntype: prompt\n---\nBody\n",
        },
      })
    );
    expect(definitions.filter((d) => d.name === "review")).toHaveLength(1);
    expect(
      diagnostics.some(
        (d) => d.code === "frontmatter-invalid" && /Duplicate/i.test(d.message)
      )
    ).toBe(true);
  });
});

describe("PluginCommandSourceReader — unsupported Claude command types", () => {
  it("skips a Claude local-jsx command with claude-format-unsupported-feature", async () => {
    const root = tmpPlugin();
    const { definitions, diagnostics } = await read(
      root,
      claudeManifest({
        ui: {
          content:
            "---\nname: ui\ndescription: UI\ntype: local-jsx\n---\nrender\n",
        },
      })
    );
    expect(definitions).toHaveLength(0);
    expect(
      diagnostics.some((d) => d.code === "claude-format-unsupported-feature")
    ).toBe(true);
  });
});
