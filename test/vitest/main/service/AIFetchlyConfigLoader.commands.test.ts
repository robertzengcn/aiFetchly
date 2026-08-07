/**
 * CMD-06 (Phase 15 / Plan 02) — global loader command-scan tests (SC1, SC3, SC4).
 *
 * AIFetchlyConfigLoader now reads ~/.aifetchly/commands/*.md, parses each with
 * the restricted frontmatter parser (CFG-07), validates via
 * buildPromptCommandDefinition, and fills snapshot.commands with the resulting
 * SlashCommandDefinition[] (source 'user', sourceId 'user'). Invalid files
 * produce diagnostics and are skipped.
 *
 * Integration-style: each test builds an ephemeral fake ~/.aifetchly under
 * os.tmpdir() and points the loader at it via the rootPath constructor arg.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import { AIFetchlyConfigLoader } from "@/service/aifetchlyConfig/AIFetchlyConfigLoader";

const VALID_REVIEW =
  "---\nname: review\ndescription: Review current changes\ntype: prompt\nargumentHint: [scope]\n---\n\nReview the workspace changes.\n\nFocus on: $ARGUMENTS\n";

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-cmds-"));
}

function writeCommand(root: string, name: string, content: string): void {
  const dir = path.join(root, "commands");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, "utf8");
}

describe("AIFetchlyConfigLoader command scan (CMD-06 / SC1 / SC4)", () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  it("reads one valid commands/review.md into a single user SlashCommandDefinition", async () => {
    const root = makeRoot();
    roots.push(root);
    writeCommand(root, "review.md", VALID_REVIEW);

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    expect(snapshot.commands).toHaveLength(1);
    const cmd = snapshot.commands[0] as { id: string; name: string; source: string; sourceId: string; type: string; argumentHint?: string };
    expect(cmd).toMatchObject({
      id: "user:command:review",
      name: "review",
      source: "user",
      sourceId: "user",
      type: "prompt",
      argumentHint: "[scope]",
    });
  });

  it("reads two valid command files into two definitions", async () => {
    const root = makeRoot();
    roots.push(root);
    writeCommand(root, "review.md", VALID_REVIEW);
    writeCommand(
      root,
      "ship.md",
      "---\nname: ship\ndescription: Ship it\ntype: prompt\n---\n\nShip the branch.\n"
    );

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();
    expect(snapshot.commands).toHaveLength(2);
    const names = (snapshot.commands as { name: string }[]).map((c) => c.name).sort();
    expect(names).toEqual(["review", "ship"]);
  });

  it("produces a file-too-large diagnostic and skips an oversized command file (CFG-04)", async () => {
    const root = makeRoot();
    roots.push(root);
    const big = "x".repeat(AIFETCHLY_CONFIG_LIMITS.commandMdBytes + 1);
    writeCommand(root, "huge.md", big);

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    expect(snapshot.commands).toHaveLength(0);
    const codes = snapshot.diagnostics.map((d) => d.code);
    expect(codes).toContain("file-too-large");
  });

  it("produces a command-name-invalid diagnostic and skips a CMD-06-invalid file (SC4 global)", async () => {
    const root = makeRoot();
    roots.push(root);
    // Uppercase name fails COMMAND_NAME_REGEX.
    writeCommand(
      root,
      "Bad.md",
      "---\nname: Bad\ndescription: Has desc\ntype: prompt\n---\n\nbody\n"
    );

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    expect(snapshot.commands).toHaveLength(0);
    const codes = snapshot.diagnostics.map((d) => d.code);
    expect(codes).toContain("command-name-invalid");
  });

  it("missing commands/ dir -> empty commands, NO diagnostic (happy path)", async () => {
    const root = makeRoot();
    roots.push(root);
    // Only AGENTS.md, no commands/ dir.
    fs.writeFileSync(path.join(root, "AGENTS.md"), "be helpful", "utf8");

    const snapshot = await new AIFetchlyConfigLoader(root).scanGlobalRoot();

    expect(snapshot.commands).toHaveLength(0);
    expect(snapshot.diagnostics.map((d) => d.code)).not.toContain("file-too-large");
  });
});
