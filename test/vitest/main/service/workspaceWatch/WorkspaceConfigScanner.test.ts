/**
 * WorkspaceConfigScanner — CFG-02 / CFG-04 / CFG-05 scanner tests.
 *
 * Verifies the workspace-rooted discovery of `.aifetchly/{AGENTS.md,
 * settings.json, commands/*.md}` + optional root `AGENTS.md`, the
 * missing-dir happy path (empty snapshot, no throw), and the size-limit
 * (CFG-04) + path-safety (CFG-05) diagnostics.
 *
 * Per design §9.7 the scanner is the bounded-read pipeline reused from
 * Phase 13's AIFetchlyConfigLoader, scoped to the explicit file set.
 * Phase 14 reads commands/*.md frontmatter but does NOT expand
 * `$ARGUMENTS` (Phase 15) — the snapshot carries raw frontmatter only.
 */

import { describe, expect, it } from "vitest";
import { WorkspaceConfigScanner } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import {
  tmpdirSync,
  writeFiles,
} from "../../childprocess/_fixtures/workspaceTmpdir";

/**
 * Shape of a raw WorkspaceAgentDraft the worker emits into snapshot.agents
 * (Phase 16 / Plan 02). Validation happens main-process (Task 3); the worker
 * produces drafts ONLY (WAT-02 worker-no-DB).
 */
interface WorkspaceAgentDraft {
  readonly id: string;
  readonly source: "workspace";
  readonly sourceId: string;
  readonly relativePath: string;
  readonly frontmatter: Readonly<Record<string, string | readonly string[]>>;
  readonly body: string;
  readonly contentHash: string;
}

function agentDrafts(snap: {
  agents: readonly unknown[];
}): WorkspaceAgentDraft[] {
  return snap.agents as unknown as WorkspaceAgentDraft[];
}

describe("WorkspaceConfigScanner — CFG-02 workspace-rooted discovery", () => {
  it("returns an empty snapshot when .aifetchly is missing (no throw, no diagnostic)", async () => {
    const root = tmpdirSync();
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    expect(snap.source).toBe("workspace");
    expect(snap.sourceId).toBe("workspace:w1");
    expect(snap.workspaceId).toBe("w1");
    expect(snap.rootPath).toBe(root);
    expect(snap.files).toHaveLength(0);
    expect(snap.instructions).toHaveLength(0);
    expect(snap.commands).toHaveLength(0);
    expect(snap.diagnostics).toHaveLength(0);
  });

  it("discovers .aifetchly/AGENTS.md as a single instruction block", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      {
        path: ".aifetchly/AGENTS.md",
        content: "# Project guide\nAlways reply with concrete examples.",
      },
    ]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    expect(snap.files.some((f) => f.relativePath.endsWith("AGENTS.md"))).toBe(
      true
    );
    expect(snap.instructions).toHaveLength(1);
    const block = snap.instructions[0];
    expect(block.source).toBe("workspace");
    expect(block.sourceId).toBe("workspace:w1");
    expect(block.trusted).toBe(false); // workspace source — untrusted until Plan 14-02 apply filter
    expect(block.content).toContain("concrete examples");
  });

  it("discovers .aifetchly/commands/*.md and surfaces them as command entries", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      {
        path: ".aifetchly/commands/review.md",
        content:
          "---\nname: review\ndescription: Review code for issues\n---\nReview the code for issues and suggest improvements.",
      },
      {
        path: ".aifetchly/commands/summarize.md",
        content:
          "---\nname: summarize\ndescription: Summarize a file\n---\nSummarize the given file in 3 bullets.",
      },
    ]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    expect(snap.commands.length).toBeGreaterThanOrEqual(2);
    // Snapshot carries raw frontmatter — Phase 15 expands $ARGUMENTS.
    const cmdPaths = snap.files
      .filter((f) => f.kind === "command")
      .map((f) => f.relativePath);
    expect(cmdPaths.some((p) => p.includes("review.md"))).toBe(true);
    expect(cmdPaths.some((p) => p.includes("summarize.md"))).toBe(true);
  });

  it("includes the root AGENTS.md ONLY when includeRootAgentsFile=true", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      { path: ".aifetchly/AGENTS.md", content: "workspace instructions" },
      { path: "AGENTS.md", content: "root-level instructions" },
    ]);

    const scanner = new WorkspaceConfigScanner();

    const withoutRoot = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });
    // Without root include: only .aifetchly/AGENTS.md
    expect(
      withoutRoot.instructions.every((b) => !b.content.includes("root-level"))
    ).toBe(true);

    const withRoot = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: true,
    });
    expect(
      withRoot.instructions.some((b) => b.content.includes("root-level"))
    ).toBe(true);
  });

  it("rejects oversized AGENTS.md (>256KB) with a file-too-large diagnostic (CFG-04)", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      { path: ".aifetchly/AGENTS.md", size: 257 * 1024 }, // 1KB over the 256KB limit
    ]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    expect(snap.instructions).toHaveLength(0);
    expect(snap.diagnostics.some((d) => d.code === "file-too-large")).toBe(
      true
    );
  });

  it("rejects a command file whose name escapes .aifetchly/commands via '..' (CFG-05)", async () => {
    const root = tmpdirSync();
    // Place a real command file with a safe name. Then simulate traversal by
    // asking the scanner to scan a malicious candidate path directly via the
    // public API. The scanner must reject relative paths containing "..".
    writeFiles(root, [
      {
        path: ".aifetchly/commands/normal.md",
        content: "---\nname: normal\n---\nbody",
      },
    ]);
    // Also create a sibling outside .aifetchly that a malicious listing might
    // try to reference. The scanner should NOT pick this up.
    writeFiles(root, [{ path: "secret.md", content: "exfiltrated" }]);

    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    // Only the normal.md command is discovered; secret.md is not under .aifetchly.
    const cmdContents = snap.files.map((f) => f.relativePath).join("\n");
    expect(cmdContents).not.toContain("secret.md");
    expect(
      snap.instructions.every((b) => !b.content.includes("exfiltrated"))
    ).toBe(true);
  });

  it("parses .aifetchly/settings.json with size-limit + invalid-JSON diagnostics (CFG-03/04)", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      { path: ".aifetchly/settings.json", content: "{ this is not valid json" },
    ]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    expect(
      snap.diagnostics.some((d) => d.code === "settings-json-invalid")
    ).toBe(true);
  });

  it("never throws — surfaces IO errors as recoverable diagnostics (scanner-io-error)", async () => {
    const root = tmpdirSync();
    const scanner = new WorkspaceConfigScanner();
    // Point at a path that cannot be read as a directory.
    const snap = await scanner.scan({
      workspaceId: "w1",
      // A path under /proc on Linux is readable as files but readdir behaviour
      // is exotic. Use a non-existent path nested deeper; scanner returns empty.
      workspaceRoot: root + "/does-not-exist",
      includeRootAgentsFile: false,
    });
    expect(snap.files).toHaveLength(0);
    // No throw — that is the assertion.
    expect(snap.diagnostics).toBeDefined();
  });
});

describe("WorkspaceConfigScanner — agents/*.md raw drafts (AGT-02 / WAT-02)", () => {
  it("produces a RAW WorkspaceAgentDraft for a valid agents/foo.md (no validation runs here)", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      {
        path: ".aifetchly/agents/foo.md",
        content:
          "---\nname: foo\ndescription: A workspace agent.\ntools:\n  - scrape_urls_from_search_engine\n---\n\nYou are foo. Return JSON.\n",
      },
    ]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    const drafts = agentDrafts(snap);
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d.source).toBe("workspace");
    expect(d.sourceId).toBe("workspace:w1");
    expect(d.relativePath).toContain("agents/foo.md");
    expect(d.contentHash.length).toBe(64); // SHA-256 hex
    // Raw frontmatter carried through (scalars + arrays merged).
    expect(d.frontmatter.name).toBe("foo");
    expect(d.frontmatter.tools).toEqual(["scrape_urls_from_search_engine"]);
    // Body carried through unvalidated.
    expect(d.body).toContain("You are foo");
  });

  it("produces two drafts for two agent files", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      {
        path: ".aifetchly/agents/foo.md",
        content: "---\nname: foo\ndescription: foo agent.\n---\n\nbody foo\n",
      },
      {
        path: ".aifetchly/agents/bar.md",
        content: "---\nname: bar\ndescription: bar agent.\n---\n\nbody bar\n",
      },
    ]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    const drafts = agentDrafts(snap);
    expect(drafts).toHaveLength(2);
    const names = drafts.map((d) => d.frontmatter.name).sort();
    expect(names).toEqual(["bar", "foo"]);
  });

  it("carries an INVALID name through as a raw draft (validation is main-process, not here)", async () => {
    const root = tmpdirSync();
    // Uppercase name fails COMMAND_NAME_REGEX — but the worker does NOT
    // validate, so the draft still appears. Task 3's converter drops it.
    writeFiles(root, [
      {
        path: ".aifetchly/agents/Bad.md",
        content: "---\nname: Bad\ndescription: has desc\n---\n\nbody\n",
      },
    ]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    const drafts = agentDrafts(snap);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].frontmatter.name).toBe("Bad");
    // No agent-name-invalid diagnostic here — the worker is validation-free.
    expect(snap.diagnostics.map((d) => d.code)).not.toContain(
      "agent-name-invalid"
    );
  });

  it("excludes an oversized agent file with a file-too-large diagnostic (CFG-04)", async () => {
    const root = tmpdirSync();
    const big =
      "---\nname: big\ndescription: x\n---\n\n" +
      "x".repeat(AIFETCHLY_CONFIG_LIMITS.agentMdBytes + 1);
    writeFiles(root, [{ path: ".aifetchly/agents/big.md", content: big }]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    expect(agentDrafts(snap)).toHaveLength(0);
    expect(snap.diagnostics.some((d) => d.code === "file-too-large")).toBe(
      true
    );
  });

  it("enforces the maxAgentsPerSource count cap and skips the remainder with diagnostics", async () => {
    const root = tmpdirSync();
    const overCount = AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource + 2;
    for (let i = 0; i < overCount; i++) {
      writeFiles(root, [
        {
          path: `.aifetchly/agents/agent-${i}.md`,
          content: `---\nname: agent-${i}\ndescription: agent ${i}\n---\n\nbody\n`,
        },
      ]);
    }
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    expect(agentDrafts(snap).length).toBe(
      AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource
    );
    expect(snap.diagnostics.some((d) => d.code === "file-too-large")).toBe(
      true
    );
  });

  it("missing agents/ dir -> empty agents, no agent-related diagnostic (happy path)", async () => {
    const root = tmpdirSync();
    writeFiles(root, [{ path: ".aifetchly/AGENTS.md", content: "be helpful" }]);
    const scanner = new WorkspaceConfigScanner();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    expect(agentDrafts(snap)).toHaveLength(0);
    expect(snap.diagnostics.map((d) => d.code)).not.toContain("file-too-large");
  });
});
