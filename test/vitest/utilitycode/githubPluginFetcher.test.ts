import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  classifyGitHubUrl,
  GitHubPluginFetcher,
  isGitHubArchiveInstallEnabled,
} from "@/service/pluginSources/GitHubPluginFetcher";
import { PluginHttpDownloadService } from "@/service/pluginSources/PluginHttpDownloadService";
import {
  makeRequestDouble,
} from "./pluginHttpDownloadService.testhelpers";
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

describe("GitHubPluginFetcher archive temp-dir cleanup (GF review)", () => {
  it("removes the download temp dir on every failure path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-cleanup-"));
    const made: string[] = [];
    try {
      const fetcher = new GitHubPluginFetcher({
        archiveClient: {
          resolveRevision: vi.fn(async () => ({
            ok: false as const,
            error: {
              code: "github-rate-limited" as const,
              message: "x",
              recoverable: true,
            },
          })),
          downloadArchive: vi.fn(async () => ({
            ok: true as const,
            zipPath: "x",
            bytes: 1,
          })),
        } as never,
        zip: { acquire: vi.fn() } as never,
        git: { acquire: vi.fn() } as never,
        createTempDir: () => {
          const dir = path.join(root, `archive-${made.length}`);
          fs.mkdirSync(dir, { recursive: true });
          made.push(dir);
          return dir;
        },
      });
      const result = await fetcher.acquire({
        kind: "github",
        uri: "https://github.com/owner/repo",
      });
      expect(result.success).toBe(false);
      expect(made).toHaveLength(1);
      // The failure-path finally removed the temp dir.
      expect(fs.existsSync(made[0])).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("GitHubPluginFetcher — release assets on the shared transport (GF Phase D / §25)", () => {
  function makeAssetFetcher(
    plan: Parameters<typeof makeRequestDouble>[0],
    zipAcquire: ReturnType<typeof vi.fn>,
    made?: string[]
  ): GitHubPluginFetcher {
    return new GitHubPluginFetcher({
      archiveClient: {} as never,
      zip: { acquire: zipAcquire } as never,
      git: { acquire: vi.fn() } as never,
      http: new PluginHttpDownloadService(makeRequestDouble(plan)),
      ...(made
        ? {
            createTempDir: () => {
              const dir = path.join(made[0], `asset-${made.length}`);
              fs.mkdirSync(dir, { recursive: true });
              made.push(dir);
              return dir;
            },
          }
        : {}),
    });
  }
  const okZip = vi.fn(async () => ({
    success: true as const,
    source: { localRoot: "/tmp/extracted", cleanup: async () => undefined },
  }));

  it("downloads an asset through the allowlisted release-host chain and returns asset provenance", async () => {
    const requested: string[] = [];
    const fetcher = makeAssetFetcher(
      (url) => {
        requested.push(url.toString());
        if (url.host === "github.com") {
          return {
            redirect: "https://release-assets.githubusercontent.com/o/r/v1/x.zip",
          };
        }
        return {
          statusCode: 200,
          headers: { "content-length": "4" },
          body: Buffer.from("PK\x03\x04"),
        };
      },
      okZip
    );
    const result = await fetcher.acquire({
      kind: "github",
      uri: "https://github.com/o/r/releases/download/v1/x.zip",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Initial hop is the typed asset URL; the redirect landed on the
    // documented release-assets host and was followed.
    expect(requested[0]).toBe(
      "https://github.com/o/r/releases/download/v1/x.zip"
    );
    expect(requested.some((u) => u.startsWith("https://release-assets.githubusercontent.com/"))).toBe(
      true
    );
    expect(result.source.provenance).toEqual({
      sourceUri: "https://github.com/o/r",
      sourceRef: "v1",
      sourceMeta: { acquisition: "github-release-asset" },
    });
  });

  it("latest constructs the documented stable plugin.zip target", async () => {
    const requested: string[] = [];
    const fetcher = makeAssetFetcher(
      (url) => {
        requested.push(url.toString());
        return { statusCode: 200, headers: {}, body: Buffer.from("PK") };
      },
      okZip
    );
    const result = await fetcher.acquire({
      kind: "github",
      uri: "https://github.com/o/r/releases/latest",
    });
    expect(result.success).toBe(true);
    expect(requested[0]).toBe(
      "https://github.com/o/r/releases/latest/download/plugin.zip"
    );
    if (!result.success) return;
    expect(result.source.provenance).toEqual({
      sourceUri: "https://github.com/o/r",
      sourceMeta: { acquisition: "github-release-asset" },
    });
  });

  it("rejects a release-asset redirect to a host outside the allowlist", async () => {
    const fetcher = makeAssetFetcher(
      () => ({ redirect: "https://evil.test/steal.zip" }),
      okZip
    );
    const result = await fetcher.acquire({
      kind: "github",
      uri: "https://github.com/o/r/releases/download/v1/x.zip",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0]?.code).toBe("source-redirect-rejected");
    expect(result.errors[0]?.recoverable).toBe(false);
  });

  it("maps asset 404 to github-repository-unavailable and 429 to github-rate-limited", async () => {
    const notFound = makeAssetFetcher(
      () => ({ statusCode: 404, headers: {}, body: Buffer.alloc(0) }),
      okZip
    );
    const r404 = await notFound.acquire({
      kind: "github",
      uri: "https://github.com/o/r/releases/download/v1/x.zip",
    });
    expect(r404.success).toBe(false);
    if (!r404.success) {
      expect(r404.errors[0]?.code).toBe("github-repository-unavailable");
    }

    const limited = makeAssetFetcher(
      () => ({
        statusCode: 429,
        headers: { "x-ratelimit-remaining": "0" },
        body: Buffer.alloc(0),
      }),
      okZip
    );
    const r429 = await limited.acquire({
      kind: "github",
      uri: "https://github.com/o/r/releases/latest",
    });
    expect(r429.success).toBe(false);
    if (!r429.success) {
      expect(r429.errors[0]?.code).toBe("github-rate-limited");
    }
  });

  it("maps an oversize asset to install-io-failed (non-recoverable)", async () => {
    const fetcher = makeAssetFetcher(
      () => ({
        statusCode: 200,
        headers: { "content-length": String(64 * 1024 * 1024) },
        body: Buffer.alloc(0),
      }),
      okZip
    );
    const result = await fetcher.acquire({
      kind: "github",
      uri: "https://github.com/o/r/releases/download/v1/x.zip",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0]?.code).toBe("install-io-failed");
    expect(result.errors[0]?.recoverable).toBe(false);
  });

  it("removes the asset temp dir on every failure path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-asset-cleanup-"));
    const made: string[] = [root];
    try {
      const fetcher = makeAssetFetcher(
        () => ({ statusCode: 404, headers: {}, body: Buffer.alloc(0) }),
        okZip,
        made
      );
      const result = await fetcher.acquire({
        kind: "github",
        uri: "https://github.com/o/r/releases/download/v1/x.zip",
      });
      expect(result.success).toBe(false);
      // Only the failure-path temp dir(s) were created and all are gone.
      const created = made.slice(1);
      expect(created.length).toBeGreaterThanOrEqual(1);
      for (const dir of created) {
        expect(fs.existsSync(dir)).toBe(false);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("GitHubPluginFetcher — {repo}-{sha}/ zipball wrapper (GF-7, FR-10)", () => {
  it("unwraps the generated wrapper directory so identity comes from plugin.json", async () => {
    const AdmZipMod = await import("adm-zip");
    const AdmZip = AdmZipMod.default;
    const { resolvePluginRoot, PluginManifestService } = await import(
      "@/service/PluginManifestService"
    );
    const { LocalZipPluginFetcher } = await import(
      "@/service/pluginSources/LocalZipPluginFetcher"
    );
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const wrapperDir = `video-use-${sha}`;

    // Build a REAL GitHub-zipball-shaped archive: a single generated
    // wrapper directory holding the repository root (§21.6).
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-wrapper-"));
    try {
      const zipPath = path.join(fixtureDir, "source.zip");
      const zip = new AdmZip();
      zip.addFile(
        `${wrapperDir}/.aifetchly-plugin/plugin.json`,
        Buffer.from(
          JSON.stringify({
            name: "video-use",
            version: "1.0.0",
            description: "wrapper fixture",
            skills: ["skills/demo/manifest.json"],
          }),
          "utf-8"
        )
      );
      zip.addFile(
        `${wrapperDir}/skills/demo/manifest.json`,
        Buffer.from(
          JSON.stringify({
            name: "demo",
            version: "1.0.0",
            description: "demo skill",
            runtime: "javascript",
            entry: "main.js",
            parameters: { type: "object", properties: {} },
            permissions: [],
          }),
          "utf-8"
        )
      );
      zip.addFile(`${wrapperDir}/skills/demo/main.js`, Buffer.from("// demo\n"));
      zip.addFile(
        `${wrapperDir}/README.md`,
        Buffer.from("# video-use\n", "utf-8")
      );
      zip.writeZip(zipPath);

      const fetcher = new GitHubPluginFetcher({
        archiveClient: {
          resolveRevision: vi.fn(async () => ({
            ok: true as const,
            revision: { requestedRef: "main", commitSha: sha },
          })),
          downloadArchive: vi.fn(
            async (
              _repo: unknown,
              _rev: unknown,
              destinationPath: string
            ) => {
              fs.copyFileSync(zipPath, destinationPath);
              return {
                ok: true as const,
                zipPath: destinationPath,
                bytes: fs.statSync(destinationPath).size,
              };
            }
          ),
        } as never,
        zip: new LocalZipPluginFetcher(),
        git: { acquire: vi.fn() } as never,
        createTempDir: () => {
          const dir = fs.mkdtempSync(path.join(fixtureDir, "acquire-"));
          return dir;
        },
      });

      const result = await fetcher.acquire({
        kind: "github",
        uri: "https://github.com/browser-use/video-use",
        ref: "main",
      });
      expect(result.success).toBe(true);
      if (!result.success) return;

      // The extracted root still contains the GitHub wrapper directory…
      expect(fs.existsSync(path.join(result.source.localRoot, wrapperDir))).toBe(
        true
      );
      // …but the effective plugin root unwraps into it, so the plugin
      // identity is the manifest name — never the wrapper folder name.
      const effectiveRoot = resolvePluginRoot(result.source.localRoot);
      expect(effectiveRoot).not.toEqual(result.source.localRoot);
      const manifest = await PluginManifestService.loadFromDirectory(
        effectiveRoot
      );
      if (!manifest.success) {
        throw new Error(
          "manifest load failed: " + JSON.stringify(manifest.errors)
        );
      }
      expect(manifest.success).toBe(true);
      if (manifest.success) {
        expect(manifest.manifest.name).toBe("video-use");
        expect(manifest.manifest.name).not.toBe(wrapperDir);
      }
      await result.source.cleanup();
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
