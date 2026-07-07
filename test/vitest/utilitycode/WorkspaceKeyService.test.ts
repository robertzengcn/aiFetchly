"use strict";
import { describe, expect, it } from "vitest";
import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";

const fakeRealpath = (out: string) => async (): Promise<string> => out;

describe("WorkspaceKeyService", () => {
  it("derives a stable ws_ key from the canonical path", async () => {
    const svc = new WorkspaceKeyService({
      realpath: fakeRealpath("/tmp/repo"),
      findGitRoot: () => "/tmp/repo",
    });
    const r = await svc.resolve("/some/input");
    expect(r.workspaceKey).toMatch(/^ws_[a-f0-9]{32}$/);
    expect(r.canonicalRootPath).toBe("/tmp/repo");
    expect(r.gitRootDetected).toBe(true);
    expect(r.displayName).toBe("repo");
  });

  it("prefers the git root over the real input path", async () => {
    const svc = new WorkspaceKeyService({
      realpath: fakeRealpath("/tmp/repo/sub"),
      findGitRoot: () => "/tmp/repo",
    });
    const r = await svc.resolve("/tmp/repo/sub");
    expect(r.canonicalRootPath).toBe("/tmp/repo");
    expect(r.inputRootPath).toBe("/tmp/repo/sub");
    expect(r.gitRootDetected).toBe(true);
  });

  it("falls back to the real path when git is unavailable", async () => {
    const svc = new WorkspaceKeyService({
      realpath: fakeRealpath("/tmp/plain"),
      findGitRoot: () => null,
    });
    const r = await svc.resolve("/tmp/plain");
    expect(r.canonicalRootPath).toBe("/tmp/plain");
    expect(r.gitRootDetected).toBe(false);
  });

  it("hash is deterministic and distinguishes paths", () => {
    const svc = new WorkspaceKeyService();
    const a = svc.hashWorkspacePath("/a/b");
    const b = svc.hashWorkspacePath("/a/b");
    const c = svc.hashWorkspacePath("/a/c");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^ws_[a-f0-9]{32}$/);
  });

  it("two services resolve the same canonical root to the same key", async () => {
    const s1 = new WorkspaceKeyService({
      realpath: fakeRealpath("/projects/foo"),
      findGitRoot: () => "/projects/foo",
    });
    const s2 = new WorkspaceKeyService({
      realpath: fakeRealpath("/projects/foo"),
      findGitRoot: () => null,
    });
    const r1 = await s1.resolve("/projects/foo");
    const r2 = await s2.resolve("/projects/foo");
    expect(r1.workspaceKey).toBe(r2.workspaceKey);
  });

  it("different canonical roots produce different keys (workspace isolation)", () => {
    const svc = new WorkspaceKeyService();
    const x = svc.hashWorkspacePath("/projects/alpha");
    const y = svc.hashWorkspacePath("/projects/beta");
    expect(x).not.toBe(y);
  });
});
