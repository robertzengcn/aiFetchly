import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AtMentionSuggestionService } from "@/service/aiChatAtMentions/AtMentionSuggestionService";
import type { AtMentionWorkspaceLike } from "@/service/aiChatAtMentions/AtMentionSuggestionService";

const CONV_ID = "v2-test-conv";

function makeResolver(rootPath: string | null): AtMentionWorkspaceLike {
  return {
    resolve: async (_conversationId: string) =>
      rootPath
        ? { workspaceId: 1, rootPath }
        : null,
  };
}

describe("AtMentionSuggestionService", () => {
  let tmpDir: string;
  let outsideDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atm-suggest-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "atm-outside-"));

    // Workspace fixtures
    fs.mkdirSync(path.join(tmpDir, "src", "service"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "main.ts"), "export {}");
    fs.writeFileSync(
      path.join(tmpDir, "src", "service", "FileToolService.ts"),
      "export {}"
    );
    fs.writeFileSync(
      path.join(tmpDir, "docs with space.md"),
      "# title"
    );
    // node_modules should be ignored
    fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "node_modules", "pkg", "index.js"),
      "module.exports = 1"
    );

    // Outside file that must never leak
    fs.writeFileSync(path.join(outsideDir, "outside-secret.txt"), "secret");
    // Symlink inside workspace pointing outside
    try {
      fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-outside"), "dir");
    } catch {
      // symlinks may be unavailable on some systems; that case is still safe
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("returns workspaceRequired when conversationId is missing", async () => {
    const service = new AtMentionSuggestionService(makeResolver(tmpDir));
    const resp = await service.suggest({ query: "src" });
    expect(resp.workspaceRequired).toBe(true);
    expect(resp.suggestions).toEqual([]);
  });

  it("returns workspaceRequired when resolver yields no workspace", async () => {
    const service = new AtMentionSuggestionService(makeResolver(null));
    const resp = await service.suggest({
      conversationId: CONV_ID,
      query: "src",
    });
    expect(resp.workspaceRequired).toBe(true);
  });

  it("returns relative suggestions for an approved workspace", async () => {
    const service = new AtMentionSuggestionService(makeResolver(tmpDir));
    const resp = await service.suggest({
      conversationId: CONV_ID,
      query: "main",
    });
    expect(resp.workspaceRequired).toBe(false);
    const paths = resp.suggestions.map((s) => s.relativePath);
    expect(paths).toContain("src/main.ts");
  });

  it("returns directory suggestions with trailing slash insert text", async () => {
    const service = new AtMentionSuggestionService(makeResolver(tmpDir));
    const resp = await service.suggest({
      conversationId: CONV_ID,
      query: "service",
    });
    const dir = resp.suggestions.find((s) => s.kind === "directory");
    expect(dir).toBeDefined();
    expect(dir?.insertText).toBe("@src/service/");
  });

  it("quotes insert text for paths with spaces", async () => {
    const service = new AtMentionSuggestionService(makeResolver(tmpDir));
    const resp = await service.suggest({
      conversationId: CONV_ID,
      query: "space",
    });
    const spaced = resp.suggestions.find((s) =>
      s.relativePath.includes("docs with space.md")
    );
    expect(spaced).toBeDefined();
    expect(spaced?.insertText).toBe('@"docs with space.md"');
  });

  it("does not include ignored directories like node_modules", async () => {
    const service = new AtMentionSuggestionService(makeResolver(tmpDir));
    const resp = await service.suggest({
      conversationId: CONV_ID,
      query: "pkg",
    });
    const paths = resp.suggestions.map((s) => s.relativePath);
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("does not leak files from outside the workspace via symlink", async () => {
    const service = new AtMentionSuggestionService(makeResolver(tmpDir));
    const resp = await service.suggest({
      conversationId: CONV_ID,
      query: "outside-secret",
    });
    const paths = resp.suggestions.map((s) => s.relativePath);
    expect(paths.some((p) => p.includes("outside-secret"))).toBe(false);
  });

  it("caps results to the requested limit", async () => {
    // create many matching files
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(tmpDir, `many-${i}.ts`), "x");
    }
    const service = new AtMentionSuggestionService(makeResolver(tmpDir));
    const resp = await service.suggest({
      conversationId: CONV_ID,
      query: "many",
      limit: 5,
    });
    expect(resp.suggestions.length).toBeLessThanOrEqual(5);
  });
});
