/**
 * Tests for GitHubArchiveClient (git-free GitHub plugin installation design
 * §18.2) — ref resolution, immutable-SHA download, and the §9.2 status
 * matrix, all through an injected PluginHttpDownloadService double. No
 * network, no token, no live GitHub.
 */
import { describe, expect, it, vi } from "vitest";
import { GitHubArchiveClient } from "@/service/pluginSources/GitHubArchiveClient";
import { PluginHttpDownloadService } from "@/service/pluginSources/PluginHttpDownloadService";

type BufferOutcome =
  | { success: true; body: Uint8Array; statusCode: number; finalUrl: string; responseHeaders: Record<string, string> }
  | { success: false; reason: string; statusCode?: number; responseHeaders?: Record<string, string> };

interface HttpDouble {
  getBuffer: (req: unknown) => Promise<BufferOutcome>;
  downloadToFile: (req: unknown) => Promise<
    | { success: true; bytesWritten: number }
    | { success: false; reason: string; statusCode?: number }
  >;
}

function makeClient(
  buffer: BufferOutcome,
  download: { success: true; bytesWritten: number } | { success: false; reason: string; statusCode?: number }
): { client: GitHubArchiveClient; getBuffer: ReturnType<typeof vi.fn>; downloadToFile: ReturnType<typeof vi.fn> } {
  const getBuffer = vi.fn(async (): Promise<BufferOutcome> => buffer);
  const downloadToFile = vi.fn(async () => download);
  const http = { getBuffer, downloadToFile } as unknown as PluginHttpDownloadService;
  return {
    client: new GitHubArchiveClient({ http, appVersion: "test" }),
    getBuffer,
    downloadToFile,
  };
}

void (null as unknown as HttpDouble);

const IDENTITY = {
  owner: "owner",
  repository: "repo",
  canonicalUrl: "https://github.com/owner/repo",
};

const okBody = (obj: unknown): BufferOutcome => ({
  success: true,
  body: Buffer.from(JSON.stringify(obj)),
  statusCode: 200,
  finalUrl: "https://api.github.com/whatever",
  responseHeaders: {},
});

describe("GitHubArchiveClient.resolveRevision", () => {
  it("resolves an explicit ref to a full lowercase SHA and requests it URL-encoded", async () => {
    const { client, getBuffer } = makeClient(okBody({ sha: "ABCDEF0123ABCDEF0123ABCDEF0123ABCDEF0123" }), { success: true, bytesWritten: 10 });
    const result = await client.resolveRevision(IDENTITY, "feature/x");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision.commitSha).toBe("abcdef0123abcdef0123abcdef0123abcdef0123");
    expect(result.revision.requestedRef).toBe("feature/x");
    const url = (getBuffer.mock.calls[0]?.[0] as { url: URL }).url;
    expect(url.toString()).toBe(
      "https://api.github.com/repos/owner/repo/commits/feature%2Fx"
    );
  });

  it("resolves the default-branch head from the first array item", async () => {
    const { client, getBuffer } = makeClient(okBody([{ sha: "a".repeat(40) }]), { success: true, bytesWritten: 1 });
    const result = await client.resolveRevision(IDENTITY, undefined);
    expect(result.ok).toBe(true);
    const url = (getBuffer.mock.calls[0]?.[0] as { url: URL }).url;
    expect(url.search).toBe("?per_page=1");
  });

  it("maps an empty default-branch list to github-ref-not-found (no commits)", async () => {
    const { client } = makeClient(okBody([]), { success: true, bytesWritten: 1 });
    const result = await client.resolveRevision(IDENTITY, undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("github-ref-not-found");
  });

  it("maps 401 and plain 403 to repository-unavailable — never 'private'", async () => {
    for (const statusCode of [401, 403]) {
      const { client } = makeClient(
        { success: false, reason: "http-status", statusCode, responseHeaders: {} },
        { success: true, bytesWritten: 1 }
      );
      const result = await client.resolveRevision(IDENTITY, undefined);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("github-repository-unavailable");
      expect(result.error.message).not.toContain("private");
    }
  });

  it("maps 403/429 with exhausted quota to github-rate-limited", async () => {
    const specs: { statusCode: number; headers: Record<string, string> }[] = [
      { statusCode: 403, headers: { "x-ratelimit-remaining": "0" } },
      { statusCode: 429, headers: {} },
    ];
    for (const spec of specs) {
      const { client } = makeClient(
        { success: false, reason: "http-status", statusCode: spec.statusCode, responseHeaders: spec.headers },
        { success: true, bytesWritten: 1 }
      );
      const result = await client.resolveRevision(IDENTITY, "main");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("github-rate-limited");
    }
  });

  it("distinguishes a missing ref on a public repo via the bounded probe", async () => {
    // First call (commit lookup) 404; probe succeeds.
    let call = 0;
    const getBuffer = vi.fn(async (): Promise<BufferOutcome> => {
      call += 1;
      return call === 1
        ? { success: false, reason: "http-status", statusCode: 404, responseHeaders: {} }
        : { success: true, body: Buffer.from("{}"), statusCode: 200, finalUrl: "x", responseHeaders: {} };
    });
    const http = { getBuffer } as unknown as PluginHttpDownloadService;
    const client = new GitHubArchiveClient({ http, appVersion: "t" });
    const result = await client.resolveRevision(IDENTITY, "nope");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("github-ref-not-found");
    expect(getBuffer).toHaveBeenCalledTimes(2);
  });

  it("maps malformed metadata to source-download-failed", async () => {
    const { client } = makeClient(okBody({ no: "sha" }), { success: true, bytesWritten: 1 });
    const result = await client.resolveRevision(IDENTITY, "main");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source-download-failed");
  });
});

describe("GitHubArchiveClient.downloadArchive", () => {
  it("requests the zipball by the RESOLVED full SHA", async () => {
    const { client, downloadToFile } = makeClient(okBody({ sha: "b".repeat(40) }), { success: true, bytesWritten: 123 });
    await client.resolveRevision(IDENTITY, "v1");
    const result = await client.downloadArchive(
      IDENTITY,
      { requestedRef: "v1", commitSha: "b".repeat(40) },
      "/tmp/x.zip",
      1024
    );
    expect(result.ok).toBe(true);
    const arg = downloadToFile.mock.calls[0]?.[0] as unknown as { url: URL };
    expect(arg.url.pathname).toBe(`/repos/owner/repo/zipball/${"b".repeat(40)}`);
  });

  it("maps oversize to non-recoverable install-io-failed; 404 to repository-unavailable; timeout to source-timeout", async () => {
    const cases: [{ success: false; reason: string; statusCode?: number }, string][] = [
      [{ success: false, reason: "too-large" }, "install-io-failed"],
      [{ success: false, reason: "http-status", statusCode: 404 }, "github-repository-unavailable"],
      [{ success: false, reason: "timeout" }, "source-timeout"],
      [{ success: false, reason: "aborted" }, "source-cancelled"],
      [{ success: false, reason: "redirect-rejected" }, "source-redirect-rejected"],
    ];
    for (const [download, code] of cases) {
      const { client } = makeClient(okBody({ sha: "c".repeat(40) }), download);
      const result = await client.downloadArchive(
        IDENTITY,
        { commitSha: "c".repeat(40) },
        "/tmp/y.zip",
        1024
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(code);
    }
  });
});
