import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AtMentionResolutionService } from "@/service/aiChatAtMentions/AtMentionResolutionService";
import type { AtMentionWorkspaceLike } from "@/service/aiChatAtMentions/AtMentionSuggestionService";

const CONV_ID = "v2-resolve-conv";

function makeResolver(rootPath: string | null): AtMentionWorkspaceLike {
  return {
    resolve: async (_id: string) =>
      rootPath ? { workspaceId: 1, rootPath } : null,
  };
}

describe("AtMentionResolutionService.resolveMessage", () => {
  let tmpDir: string;
  let outsideDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atm-resolve-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "atm-outside-"));

    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "main.ts"),
      "line1\nline2\nline3\nline4\nline5"
    );
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "readme.md"), "# hi");
    // Binary file (null bytes -> isBinaryFile true)
    fs.writeFileSync(path.join(tmpDir, "blob.bin"), Buffer.alloc(2000, 0x00));
    // Outside file + symlink inside pointing outside. The content marker is
    // unique so it can never appear in the echoed mention path text.
    fs.writeFileSync(
      path.join(outsideDir, "secret.txt"),
      "LEAKED_OUTSIDE_CONTENT_MARKER_12345"
    );
    try {
      fs.symlinkSync(outsideDir, path.join(tmpDir, "escape-link"), "dir");
    } catch {
      // symlinks unsupported on some systems
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("returns the message unchanged when there are no mentions", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(CONV_ID, "just a message");
    expect(result.modelMessage).toBe("just a message");
    expect(result.metadata).toEqual([]);
    expect(result.hasResolvedMentions).toBe(false);
  });

  it("marks all mentions workspace_required and does not read files without a workspace", async () => {
    const service = new AtMentionResolutionService(makeResolver(null));
    const result = await service.resolveMessage(CONV_ID, "see @src/main.ts");
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0]?.status).toBe("workspace_required");
    expect(result.modelMessage).toContain("requires an approved workspace");
    // No context block content is injected.
    expect(result.modelMessage).not.toContain("file_read");
    expect(result.hasResolvedMentions).toBe(false);
  });

  it("resolves a plain file mention as a reference without injecting content", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(CONV_ID, "see @src/main.ts");
    expect(result.metadata[0]?.status).toBe("resolved");
    expect(result.metadata[0]?.kind).toBe("file");
    expect(result.hasResolvedMentions).toBe(true);
    // Reference-only -> model is told to use file_read.
    expect(result.modelMessage).toContain('file_read with path="src/main.ts"');
    expect(result.modelMessage).not.toContain("Content:");
  });

  it("injects bounded numbered content for an explicit line range", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(
      CONV_ID,
      "explain @src/main.ts#L2-4"
    );
    expect(result.metadata[0]?.status).toBe("resolved");
    expect(result.metadata[0]?.lineStart).toBe(2);
    expect(result.metadata[0]?.lineEnd).toBe(4);
    expect(result.modelMessage).toContain("2: line2");
    expect(result.modelMessage).toContain("3: line3");
    expect(result.modelMessage).toContain("4: line4");
    expect(result.modelMessage).not.toContain("1: line1");
  });

  it("resolves a directory mention with a shallow listing", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(CONV_ID, "summarize @docs/");
    expect(result.metadata[0]?.status).toBe("resolved");
    expect(result.metadata[0]?.kind).toBe("directory");
    expect(result.modelMessage).toContain("readme.md");
    expect(result.modelMessage).toContain('glob_files with cwd="docs"');
  });

  it("reports missing for a file that does not exist", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(CONV_ID, "see @src/missing.ts");
    expect(result.metadata[0]?.status).toBe("missing");
    expect(result.modelMessage).toContain("was not found in this workspace");
  });

  it("rejects a traversal path that escapes the workspace", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(CONV_ID, "see @../outside.ts");
    expect(result.metadata[0]?.status).toBe("rejected");
    expect(result.metadata[0]?.errorCode).toBe("OUTSIDE_ROOTS");
    expect(result.modelMessage).toContain("outside the approved workspace");
  });

  it("rejects a symlink that escapes the workspace", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(
      CONV_ID,
      "see @escape-link/secret.txt"
    );
    const meta = result.metadata[0];
    expect(meta?.status === "rejected" || meta?.status === "missing").toBe(
      true
    );
    // Either way, the outside file content is never injected.
    expect(result.modelMessage).not.toContain(
      "LEAKED_OUTSIDE_CONTENT_MARKER_12345"
    );
  });

  it("classifies a binary file as binary and injects no content", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(CONV_ID, "read @blob.bin#L1-5");
    expect(result.metadata[0]?.status).toBe("binary");
    expect(result.modelMessage).toContain("binary file");
    expect(result.modelMessage).not.toContain("Content:");
  });

  it("flags an invalid line range without touching the filesystem", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(
      CONV_ID,
      "see @src/main.ts#L4-2"
    );
    expect(result.metadata[0]?.status).toBe("invalid_line_range");
    expect(result.hasResolvedMentions).toBe(false);
  });

  it("lets a valid mention proceed even when another mention is invalid", async () => {
    const service = new AtMentionResolutionService(makeResolver(tmpDir));
    const result = await service.resolveMessage(
      CONV_ID,
      "see @src/main.ts and @src/missing.ts"
    );
    const statuses = result.metadata.map((m) => m.status);
    expect(statuses).toContain("resolved");
    expect(statuses).toContain("missing");
    expect(result.hasResolvedMentions).toBe(true);
  });
});
