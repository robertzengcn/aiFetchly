import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";

function expectedKey(canonicalRootPath: string): string {
  const digest = createHash("sha256")
    .update(canonicalRootPath)
    .digest("hex")
    .slice(0, 32);
  return `ws_${digest}`;
}

describe("WorkspaceKeyService", () => {
  it("canonicalizes the selected path and prefers the git root for keying", async () => {
    const realpath = vi.fn().mockResolvedValue("/real/repo/packages/app");
    const findGitRoot = vi.fn().mockResolvedValue("/real/repo");
    const service = new WorkspaceKeyService({ realpath, findGitRoot });

    const resolved = await service.resolve("/selected/app");

    expect(realpath).toHaveBeenCalledWith("/selected/app");
    expect(findGitRoot).toHaveBeenCalledWith("/real/repo/packages/app");
    expect(resolved).toEqual({
      inputRootPath: "/real/repo/packages/app",
      canonicalRootPath: "/real/repo",
      workspaceKey: expectedKey("/real/repo"),
      displayName: "repo",
      gitRootDetected: true,
    });
  });

  it("falls back to the real selected path when git root detection is unavailable", async () => {
    const service = new WorkspaceKeyService({
      realpath: vi.fn().mockResolvedValue("/real/non-git-workspace"),
      findGitRoot: vi.fn().mockResolvedValue(null),
    });

    const resolved = await service.resolve("/selected/non-git-workspace");

    expect(resolved.canonicalRootPath).toBe("/real/non-git-workspace");
    expect(resolved.workspaceKey).toBe(expectedKey("/real/non-git-workspace"));
    expect(resolved.displayName).toBe("non-git-workspace");
    expect(resolved.gitRootDetected).toBe(false);
  });

  it("hashWorkspacePath is deterministic and uses the documented ws_ prefix", () => {
    const service = new WorkspaceKeyService({
      realpath: vi.fn(),
      findGitRoot: vi.fn(),
    });

    const first = service.hashWorkspacePath("/stable/project");
    const second = service.hashWorkspacePath("/stable/project");
    const other = service.hashWorkspacePath("/stable/other-project");

    expect(first).toBe(second);
    expect(first).toMatch(/^ws_[a-f0-9]{32}$/);
    expect(first).not.toBe(other);
  });
});
