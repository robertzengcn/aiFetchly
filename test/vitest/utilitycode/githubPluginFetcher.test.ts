import { describe, it, expect, vi } from "vitest";
import {
  classifyGitHubUrl,
  GitHubPluginFetcher,
  isGitHubArchiveInstallEnabled,
} from "@/service/pluginSources/GitHubPluginFetcher";
void isGitHubArchiveInstallEnabled;

describe("classifyGitHubUrl", () => {
  it("classifies a plain repo URL as 'repo'", () => {
    expect(classifyGitHubUrl("https://github.com/owner/repo")).toEqual({
      type: "repo",
      owner: "owner",
      repo: "repo",
    });
  });

  it("strips a trailing .git from repo URLs", () => {
    expect(classifyGitHubUrl("https://github.com/owner/repo.git")).toEqual({
      type: "repo",
      owner: "owner",
      repo: "repo",
    });
  });

  it("classifies a release asset URL as 'asset'", () => {
    expect(
      classifyGitHubUrl(
        "https://github.com/o/r/releases/download/v1/x.zip"
      )
    ).toEqual({
      type: "asset",
      owner: "o",
      repo: "r",
      tag: "v1",
      asset: "x.zip",
    });
  });

  it("classifies a releases/latest URL as 'latest'", () => {
    expect(classifyGitHubUrl("https://github.com/o/r/releases/latest")).toEqual({
      type: "latest",
      owner: "o",
      repo: "r",
    });
  });

  it("returns unknown for arbitrary URL", () => {
    expect(classifyGitHubUrl("https://example.com/x")).toEqual({
      type: "unknown",
    });
  });

  it("returns unknown for malformed input", () => {
    expect(classifyGitHubUrl("not a url")).toEqual({ type: "unknown" });
  });
});

describe("GitHubPluginFetcher — git-free repository acquisition (GF Phase B)", () => {
  it("classifies tree/commit browser URLs as convenience (rejected with guidance)", () => {
    expect(classifyGitHubUrl("https://github.com/o/r/tree/feature/x")).toMatchObject({
      type: "convenience",
      kind: "tree",
    });
    expect(classifyGitHubUrl("https://github.com/o/r/commit/abc123")).toMatchObject({
      type: "convenience",
      kind: "commit",
    });
    // Plain repo URLs (incl. .git) stay repo.
    expect(classifyGitHubUrl("https://github.com/o/r").type).toBe("repo");
    expect(classifyGitHubUrl("https://github.com/o/r.git").type).toBe("repo");
  });

  it("repository acquisition NEVER invokes the Git fetcher and returns trusted provenance", async () => {
    const gitAcquire = vi.fn();
    const zipAcquire = vi.fn(async () => ({
      success: true as const,
      source: {
        localRoot: "/tmp/extracted",
        cleanup: async () => undefined,
      },
    }));
    const resolveRevision = vi.fn(async () => ({
      ok: true as const,
      revision: { requestedRef: "main", commitSha: "d".repeat(40) },
    }));
    const downloadArchive = vi.fn(async () => ({
      ok: true as const,
      zipPath: "/tmp/x.zip",
      bytes: 42,
    }));
    const fetcher = new GitHubPluginFetcher({
      archiveClient: { resolveRevision, downloadArchive } as never,
      zip: { acquire: zipAcquire } as never,
      git: { acquire: gitAcquire } as never,
    });
    const result = await fetcher.acquire({
      kind: "github",
      uri: "https://github.com/owner/repo.git",
      ref: "main",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(gitAcquire).not.toHaveBeenCalled();
    expect(resolveRevision).toHaveBeenCalledTimes(1);
    // The archive was requested for the RESOLVED sha (immutable download).
    const downloadCall = downloadArchive.mock.calls[0] as unknown as [
      unknown,
      { requestedRef: string; commitSha: string },
    ];
    expect(downloadCall[1]).toEqual({
      requestedRef: "main",
      commitSha: "d".repeat(40),
    });
    // Trusted provenance: canonical URI (no .git), ref, sha, acquisition.
    expect(result.source.provenance).toEqual({
      sourceUri: "https://github.com/owner/repo",
      sourceRef: "main",
      sourceMeta: {
        acquisition: "github-archive",
        resolvedCommitSha: "d".repeat(40),
        repositoryHost: "github.com",
      },
    });
  });

  it("resolution failures surface the typed archive error", async () => {
    const fetcher = new GitHubPluginFetcher({
      archiveClient: {
        resolveRevision: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: "github-rate-limited" as const,
            message: "limited",
            recoverable: true,
          },
        })),
        downloadArchive: vi.fn(async () => ({ ok: true as const, zipPath: "x", bytes: 1 })),
      } as never,
      zip: { acquire: vi.fn() } as never,
      git: { acquire: vi.fn() } as never,
    });
    const result = await fetcher.acquire({
      kind: "github",
      uri: "https://github.com/owner/repo",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0]?.code).toBe("github-rate-limited");
  });

  it("convenience URLs are rejected with repository-URL + Ref guidance", async () => {
    const fetcher = new GitHubPluginFetcher({
      archiveClient: { resolveRevision: vi.fn(), downloadArchive: vi.fn() } as never,
      zip: { acquire: vi.fn() } as never,
      git: { acquire: vi.fn() } as never,
    });
    const result = await fetcher.acquire({
      kind: "github",
      uri: "https://github.com/owner/repo/tree/main",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0]?.message).toContain("Ref field");
  });
});
