/**
 * GitHubArchiveClient — resolves a requested ref to an immutable commit SHA
 * and downloads that commit as a ZIP archive, over the shared bounded HTTPS
 * transport (git-free GitHub plugin installation design §7/§9).
 *
 * Protocol (public, NO authentication in v1):
 *   resolve ref  : GET api.github.com/repos/{o}/{r}/commits/{ref}   (explicit)
 *                  GET api.github.com/repos/{o}/{r}/commits?per_page=1 (default)
 *   download zip : GET api.github.com/repos/{o}/{r}/zipball/{fullSha}
 *
 * Status mapping follows design §9.2: a 404 is NEVER reported as "private";
 * an explicit-ref 404 triggers one bounded repository probe to distinguish
 * github-ref-not-found from github-repository-unavailable; 403/429 map to
 * github-rate-limited only with quota proof. No token is ever requested,
 * discovered, or sent (§9.3).
 */

import type { PluginError } from "@/entityTypes/pluginTypes";
import {
  PLUGIN_GITHUB_METADATA_MAX_BYTES,
  PLUGIN_HTTP_MAX_REDIRECTS,
  PluginHttpDownloadService,
  allowlistRedirectPolicy,
} from "@/service/pluginSources/PluginHttpDownloadService";

export interface GitHubRepositoryIdentity {
  readonly owner: string;
  readonly repository: string;
  readonly canonicalUrl: string;
}

export interface GitHubResolvedRevision {
  readonly requestedRef?: string;
  readonly commitSha: string;
}

export type GitHubResolveResult =
  | { readonly ok: true; readonly revision: GitHubResolvedRevision }
  | { readonly ok: false; readonly error: PluginError };

export type GitHubDownloadResult =
  | { readonly ok: true; readonly zipPath: string; readonly bytes: number }
  | { readonly ok: false; readonly error: PluginError };

export interface GitHubArchiveClientDependencies {
  readonly http: PluginHttpDownloadService;
  readonly appVersion: string;
}

/** Redirect allowlists (design §8.4). */
export const GITHUB_API_REDIRECT_HOSTS = ["api.github.com"] as const;
export const GITHUB_ARCHIVE_REDIRECT_HOSTS = [
  "api.github.com",
  "codeload.github.com",
] as const;

const API_HOST = "api.github.com";
const SHA_RE = /^[0-9a-f]{40}$/;

const err = (code: PluginError["code"], message: string, recoverable = true): PluginError => ({
  code,
  message,
  recoverable,
});

export class GitHubArchiveClient {
  constructor(private readonly deps: GitHubArchiveClientDependencies) {}

  private baseHeaders(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": `AiFetchly/${this.deps.appVersion}`,
    };
  }

  /** Resolve the requested ref (or the default-branch head) to a full SHA. */
  async resolveRevision(
    repository: GitHubRepositoryIdentity,
    requestedRef: string | undefined,
    signal?: AbortSignal
  ): Promise<GitHubResolveResult> {
    const trimmed = requestedRef?.trim();
    const lookupUrl = trimmed
      ? new URL(
          `https://${API_HOST}/repos/${encodeURIComponent(
            repository.owner
          )}/${encodeURIComponent(repository.repository)}/commits/${encodeURIComponent(trimmed)}`
        )
      : new URL(
          `https://${API_HOST}/repos/${encodeURIComponent(
            repository.owner
          )}/${encodeURIComponent(repository.repository)}/commits?per_page=1`
        );

    const res = await this.deps.http.getBuffer({
      url: lookupUrl,
      headers: this.baseHeaders(),
      maxBytes: PLUGIN_GITHUB_METADATA_MAX_BYTES,
      timeoutMs: 60_000,
      maxRedirects: PLUGIN_HTTP_MAX_REDIRECTS,
      redirectPolicy: allowlistRedirectPolicy([...GITHUB_API_REDIRECT_HOSTS]),
      ...(signal ? { signal } : {}),
    });

    if (!res.success) {
      if (res.reason === "http-status") {
        // Route HTTP failures through the same §9.2 status matrix the
        // success path uses (401/403/429/404 mappings).
        return this.mapStatusFailure(
          res.statusCode ?? 0,
          res.responseHeaders ?? {},
          repository,
          trimmed,
          signal
        );
      }
      return { ok: false, error: this.mapTransportFailure(res.reason, trimmed) };
    }

    if (res.statusCode >= 400) {
      return this.mapStatusFailure(res.statusCode, res.responseHeaders, repository, trimmed, signal);
    }

    // An empty default-branch commit list = a repository with no commits
    // (design §7.5): ref-not-found, not a transport failure.
    const body = Buffer.from(res.body).toString("utf8");
    if (!trimmed && this.isEmptyCommitList(body)) {
      return {
        ok: false,
        error: err(
          "github-ref-not-found",
          "The repository has no commits to install."
        ),
      };
    }
    const sha = this.extractSha(body);
    if (!sha) {
      return {
        ok: false,
        error: err("source-download-failed", "GitHub returned an unreadable response. Retry later."),
      };
    }
    return {
      ok: true,
      revision: {
        ...(trimmed ? { requestedRef: trimmed } : {}),
        commitSha: sha,
      },
    };
  }

  /** Download the IMMUTABLE archive for an already-resolved full SHA. */
  async downloadArchive(
    repository: GitHubRepositoryIdentity,
    revision: GitHubResolvedRevision,
    destinationPath: string,
    maxBytes: number,
    signal?: AbortSignal,
    onProgress?: (received: number, total?: number) => void
  ): Promise<GitHubDownloadResult> {
    const url = new URL(
      `https://${API_HOST}/repos/${encodeURIComponent(
        repository.owner
      )}/${encodeURIComponent(repository.repository)}/zipball/${revision.commitSha}`
    );
    const res = await this.deps.http.downloadToFile({
      url,
      destinationPath,
      headers: this.baseHeaders(),
      maxBytes,
      timeoutMs: 60_000,
      maxRedirects: PLUGIN_HTTP_MAX_REDIRECTS,
      redirectPolicy: allowlistRedirectPolicy([...GITHUB_ARCHIVE_REDIRECT_HOSTS]),
      ...(signal ? { signal } : {}),
      ...(onProgress ? { onProgress } : {}),
    });
    if (res.success) {
      return { ok: true, zipPath: destinationPath, bytes: res.bytesWritten };
    }
    if (res.reason === "too-large") {
      return {
        ok: false,
        error: err(
          "install-io-failed",
          "The repository archive is too large to install safely. Use a smaller package or a release asset.",
          false
        ),
      };
    }
    if (res.reason === "http-status" && res.statusCode === 404) {
      return {
        ok: false,
        error: err(
          "github-repository-unavailable",
          "The repository was not found or is not publicly accessible."
        ),
      };
    }
    return {
      ok: false,
      error: this.mapTransportFailure(res.reason, undefined),
    };
  }


  /** §9.2 status matrix shared by the success-path and failure-path
   *  HTTP-status branches. */
  private async mapStatusFailure(
    statusCode: number,
    responseHeaders: Record<string, string>,
    repository: GitHubRepositoryIdentity,
    trimmed: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<GitHubResolveResult> {
    if (statusCode === 401) {
      return {
        ok: false,
        error: err(
          "github-repository-unavailable",
          "The repository was not found or is not publicly accessible."
        ),
      };
    }
    if (statusCode === 403 || statusCode === 429) {
      const remaining = responseHeaders["x-ratelimit-remaining"];
      if (statusCode === 429 || remaining === "0") {
        return {
          ok: false,
          error: err(
            "github-rate-limited",
            "GitHub temporarily limited public archive requests. Wait and retry, or import a ZIP."
          ),
        };
      }
      return {
        ok: false,
        error: err(
          "github-repository-unavailable",
          "The repository was not found or is not publicly accessible."
        ),
      };
    }
    if (statusCode === 404 && trimmed) {
      // Ambiguous by itself: one bounded probe distinguishes a public repo
      // with a missing ref from an inaccessible repository (§9.2).
      const probe = await this.probeRepositoryAccessible(repository, signal);
      if (probe === "rate-limited") {
        return {
          ok: false,
          error: err(
            "github-rate-limited",
            "GitHub temporarily limited public archive requests. Wait and retry."
          ),
        };
      }
      if (probe === "accessible") {
        return {
          ok: false,
          error: err(
            "github-ref-not-found",
            "The branch, tag, or commit was not found. Check the ref, or leave it empty for the default branch."
          ),
        };
      }
      return {
        ok: false,
        error: err(
          "github-repository-unavailable",
          "The repository was not found or is not publicly accessible."
        ),
      };
    }
    return {
      ok: false,
      error: err(
        statusCode >= 500
          ? "source-download-failed"
          : "github-repository-unavailable",
        statusCode >= 500
          ? "GitHub could not serve the request. Retry later."
          : "The repository was not found or is not publicly accessible."
      ),
    };
  }

  private async probeRepositoryAccessible(
    repository: GitHubRepositoryIdentity,
    signal?: AbortSignal
  ): Promise<"accessible" | "inaccessible" | "rate-limited"> {
    const url = new URL(
      `https://${API_HOST}/repos/${encodeURIComponent(
        repository.owner
      )}/${encodeURIComponent(repository.repository)}`
    );
    const res = await this.deps.http.getBuffer({
      url,
      headers: this.baseHeaders(),
      maxBytes: 4 * 1024,
      timeoutMs: 60_000,
      maxRedirects: PLUGIN_HTTP_MAX_REDIRECTS,
      redirectPolicy: allowlistRedirectPolicy([...GITHUB_API_REDIRECT_HOSTS]),
      ...(signal ? { signal } : {}),
    });
    if (res.success) return "accessible";
    if (res.reason === "http-status" && (res.statusCode === 403 || res.statusCode === 429)) {
      return "rate-limited";
    }
    return "inaccessible";
  }

  private mapTransportFailure(
    reason: string,
    _requestedRef: string | undefined
  ): PluginError {
    switch (reason) {
      case "aborted":
        return err("source-cancelled", "The installation was cancelled.");
      case "timeout":
        return err("source-timeout", "The GitHub download timed out. Check the connection and retry.");
      case "redirect-rejected":
      case "redirect-loop":
      case "redirect-limit":
      case "redirect-missing-location":
        return err(
          "source-redirect-rejected",
          "GitHub redirected to an untrusted location, so the download was stopped.",
          false
        );
      case "too-large":
        return err(
          "install-io-failed",
          "The repository archive is too large to install safely.",
          false
        );
      default:
        return err("source-download-failed", "The plugin could not be downloaded. Retry later.");
    }
  }

  private isEmptyCommitList(body: string): boolean {
    try {
      const parsed = JSON.parse(body) as unknown;
      return Array.isArray(parsed) && parsed.length === 0;
    } catch {
      return false;
    }
  }

  private extractSha(body: string): string | null {
    try {
      const parsed = JSON.parse(body) as unknown;
      const item = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!item || typeof item !== "object") return null;
      const sha = (item as { sha?: unknown }).sha;
      if (typeof sha !== "string") return null;
      const lowered = sha.toLowerCase();
      return SHA_RE.test(lowered) ? lowered : null;
    } catch {
      return null;
    }
  }
}
