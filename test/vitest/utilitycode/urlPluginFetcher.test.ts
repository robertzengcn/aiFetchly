import { describe, it, expect } from "vitest";
import { classifyUrlKind } from "@/service/pluginSources/UrlPluginFetcher";

describe("classifyUrlKind", () => {
  it("classifies .zip", () => {
    expect(classifyUrlKind("https://x.com/p.zip")).toBe("zip");
  });
  it("classifies .zip with query string", () => {
    expect(classifyUrlKind("https://x.com/p.zip?token=x")).toBe("zip");
  });
  it("classifies .git", () => {
    expect(classifyUrlKind("https://x.com/r.git")).toBe("git");
  });
  it("classifies git@", () => {
    expect(classifyUrlKind("git@github.com:o/r.git")).toBe("git");
  });
  it("classifies ssh://", () => {
    expect(classifyUrlKind("ssh://git@example.com/r.git")).toBe("git");
  });
  it("classifies github.com", () => {
    expect(classifyUrlKind("https://github.com/o/r")).toBe("github");
  });
  it("rejects http", () => {
    expect(classifyUrlKind("http://x.com/p.zip")).toBe("rejected");
  });
  it("returns unknown", () => {
    expect(classifyUrlKind("https://example.com/whatever")).toBe("unknown");
  });
  it("returns unknown for empty", () => {
    expect(classifyUrlKind("")).toBe("unknown");
  });
});

import { vi, describe as d2, it as t2, expect as e2 } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { UrlPluginFetcher } from "@/service/pluginSources/UrlPluginFetcher";
import type { PluginSourceRequest } from "@/service/pluginSources/pluginSourceTypes";
import { PluginHttpDownloadService } from "@/service/pluginSources/PluginHttpDownloadService";
import { makeRequestDouble } from "./pluginHttpDownloadService.testhelpers";

const okZip = vi.fn(async () => ({
  success: true as const,
  source: { localRoot: "/tmp/extracted", cleanup: async () => undefined },
}));

/** FR-21 / §20.4: eligible GitHub URLs — including trailing .git — acquire
 *  via the archive fetcher and NEVER native Git; non-GitHub .git stays Git. */
d2("UrlPluginFetcher.acquire — GitHub delegation (GF-5, FR-21)", () => {
  function makeFetcher() {
    const gitAcquire = vi.fn(async (_req: PluginSourceRequest) => ({
      success: true as const,
      source: { localRoot: "/tmp/git", cleanup: async () => undefined },
    }));
    const githubAcquire = vi.fn(async (_req: PluginSourceRequest) => ({
      success: true as const,
      source: { localRoot: "/tmp/gh", cleanup: async () => undefined },
    }));
    const fetcher = new UrlPluginFetcher({
      zip: { acquire: vi.fn() } as never,
      git: { acquire: gitAcquire } as never,
      github: { acquire: githubAcquire } as never,
    });
    return { fetcher, gitAcquire, githubAcquire };
  }

  t2("an eligible github.com URL delegates to the GitHub fetcher, not Git", async () => {
    const { fetcher, gitAcquire, githubAcquire } = makeFetcher();
    const result = await fetcher.acquire({
      kind: "url",
      uri: "https://github.com/owner/repo",
    });
    e2(result.success).toBe(true);
    e2(githubAcquire).toHaveBeenCalledTimes(1);
    e2(githubAcquire.mock.calls[0]?.[0]).toMatchObject({
      kind: "github",
      uri: "https://github.com/owner/repo",
    });
    e2(gitAcquire).not.toHaveBeenCalled();
  });

  t2("a github.com URL with trailing .git still takes the archive path", async () => {
    const { fetcher, gitAcquire, githubAcquire } = makeFetcher();
    await fetcher.acquire({
      kind: "url",
      uri: "https://github.com/owner/repo.git",
      ref: "v2",
    });
    e2(githubAcquire).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "github",
        uri: "https://github.com/owner/repo.git",
        ref: "v2",
      })
    );
    e2(gitAcquire).not.toHaveBeenCalled();
  });

  t2("a non-GitHub .git URL still uses the Git fetcher", async () => {
    const { fetcher, gitAcquire, githubAcquire } = makeFetcher();
    await fetcher.acquire({ kind: "url", uri: "https://gitlab.com/o/r.git" });
    e2(gitAcquire).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "git", uri: "https://gitlab.com/o/r.git" })
    );
    e2(githubAcquire).not.toHaveBeenCalled();
  });
});

d2("UrlPluginFetcher.acquire — generic ZIP on the shared transport (GF-4, §25)", () => {
  function makeZipFetcher(
    plan: Parameters<typeof makeRequestDouble>[0],
    made?: string[]
  ): UrlPluginFetcher {
    return new UrlPluginFetcher({
      zip: { acquire: okZip } as never,
      git: { acquire: vi.fn() } as never,
      github: { acquire: vi.fn() } as never,
      http: new PluginHttpDownloadService(makeRequestDouble(plan)),
      ...(made
        ? {
            createTempDir: () => {
              const dir = path.join(made[0], `url-${made.length}`);
              fs.mkdirSync(dir, { recursive: true });
              made.push(dir);
              return dir;
            },
          }
        : {}),
    });
  }

  t2("downloads a .zip over the shared transport, following same-host redirects, with progress", async () => {
    const onProgress = vi.fn();
    const requested: string[] = [];
    const fetcher = makeZipFetcher((url) => {
      requested.push(url.toString());
      if (url.toString() === "https://cdn.example.com/p.zip") {
        return { redirect: "https://cdn.example.com/p.zip?sig=1" };
      }
      return {
        statusCode: 200,
        headers: { "content-length": "4" },
        body: Buffer.from("PK\x03\x04"),
      };
    });
    const result = await fetcher.acquire({
      kind: "url",
      uri: "https://cdn.example.com/p.zip",
      onProgress,
    });
    e2(result.success).toBe(true);
    // The initial hop is the exact requested URL.
    e2(requested[0]).toBe("https://cdn.example.com/p.zip");
    // A same-host (different path) redirect WAS followed.
    e2(requested.length).toBe(2);
    e2(requested[1]).toBe("https://cdn.example.com/p.zip?sig=1");
    // Progress flows through with the stable stage label.
    e2(onProgress).toHaveBeenCalledWith("downloading archive", 100);
  });

  t2("rejects a cross-host redirect (original-exact-host-only policy)", async () => {
    const fetcher = makeZipFetcher(() => ({
      redirect: "https://mirror.test/p.zip",
    }));
    const result = await fetcher.acquire({
      kind: "url",
      uri: "https://cdn.example.com/p.zip",
    });
    e2(result.success).toBe(false);
    if (result.success) return;
    e2(result.errors[0]?.code).toBe("source-redirect-rejected");
    e2(result.errors[0]?.recoverable).toBe(false);
  });

  t2("maps transport failures to stable codes and removes the workdir", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "url-cleanup-"));
    const made: string[] = [root];
    try {
      const cases: Array<
        [{ success: false; reason: string }, string, boolean]
      > = [
        [{ success: false as const, reason: "timeout" }, "source-timeout", true],
        [
          { success: false as const, reason: "too-large" },
          "install-io-failed",
          false,
        ],
        [
          { success: false as const, reason: "aborted" },
          "source-cancelled",
          true,
        ],
      ];
      for (const [failure, expectedCode, expectedRecoverable] of cases) {
        const httpFake = {
          downloadToFile: vi.fn(async () => failure),
        } as never;
        const fetcher = new UrlPluginFetcher({
          zip: { acquire: okZip } as never,
          git: { acquire: vi.fn() } as never,
          github: { acquire: vi.fn() } as never,
          http: httpFake,
          createTempDir: () => {
            const dir = path.join(root, `url-${made.length}`);
            fs.mkdirSync(dir, { recursive: true });
            made.push(dir);
            return dir;
          },
        });
        const result = await fetcher.acquire({
          kind: "url",
          uri: "https://cdn.example.com/p.zip",
        });
        e2(result.success).toBe(false);
        if (!result.success) {
          e2(result.errors[0]?.code).toBe(expectedCode);
          e2(result.errors[0]?.recoverable).toBe(expectedRecoverable);
        }
      }
      // Every failed download cleaned up its temp workdir.
      for (const dir of made.slice(1)) {
        e2(fs.existsSync(dir)).toBe(false);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
