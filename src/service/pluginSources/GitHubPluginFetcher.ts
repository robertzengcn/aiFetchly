import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URL } from "url";
import { LocalZipPluginFetcher } from "./LocalZipPluginFetcher";
import { GitPluginFetcher } from "./GitPluginFetcher";
import {
  err,
  type PluginAcquireResult,
  type PluginSourceFetcher,
  type PluginSourceRequest,
} from "./pluginSourceTypes";
import type { PluginError } from "@/entityTypes/pluginTypes";
import { PLUGIN_PACKAGE_LIMITS } from "@/entityTypes/pluginTypes";
import {
  GITHUB_RELEASE_ASSET_REDIRECT_HOSTS,
  GitHubArchiveClient,
  type GitHubRepositoryIdentity,
} from "./GitHubArchiveClient";
import {
  PLUGIN_HTTP_MAX_REDIRECTS,
  PluginHttpDownloadService,
  allowlistRedirectPolicy,
  type PluginHttpDownloadResult,
} from "./PluginHttpDownloadService";

/**
 * GitHub plugin source — a FIRST-CLASS archive source, not a Git wrapper
 * (git-free GitHub plugin installation PRD §4.1, design §10.4). Accepts:
 *   - repo URL (https://github.com/<owner>/<repo>[.git]) → resolve the ref
 *     to an immutable commit SHA via the GitHub REST API, download that
 *     commit as a ZIP, extract through the SAME bounded pipeline as a local
 *     ZIP. No Git executable, no token, no account (PRD FR-01/FR-22).
 *   - release asset URL (.../releases/download/<tag>/<asset>) → HTTPS download
 *   - latest release URL (.../releases/latest) → resolve + download
 *
 * `tree/<ref>` / `commit/<sha>` browser URLs are REJECTED with guidance to
 * use the repository URL + the Ref field (design §6.4) — never a silently
 * different revision. The feature-flagged compat fallback keeps the old
 * native-Git repository behavior for rollback (design §17).
 */

export type GitHubClass =
  | { type: "repo"; owner: string; repo: string }
  | { type: "asset"; owner: string; repo: string; tag: string; asset: string }
  | { type: "latest"; owner: string; repo: string }
  | {
      type: "convenience";
      owner: string;
      repo: string;
      kind: "tree" | "commit";
    }
  | { type: "unknown" };

export function classifyGitHubUrl(raw: string): GitHubClass {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { type: "unknown" };
  }
  if (u.hostname !== "github.com") return { type: "unknown" };
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return { type: "unknown" };
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");

  if (
    parts.length === 6 &&
    parts[2] === "releases" &&
    parts[3] === "download"
  ) {
    return {
      type: "asset",
      owner,
      repo,
      tag: parts[4],
      asset: parts[5],
    };
  }
  if (parts.length === 4 && parts[2] === "releases" && parts[3] === "latest") {
    return { type: "latest", owner, repo };
  }
  // Browser convenience URLs are ambiguous to parse safely (branch names
  // may contain '/') — v1 rejects with correction guidance (design §6.4).
  if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "commit")) {
    return {
      type: "convenience",
      owner,
      repo,
      kind: parts[2] as "tree" | "commit",
    };
  }
  if (parts.length === 2) {
    return { type: "repo", owner, repo };
  }
  return { type: "unknown" };
}

/**
 * Map a shared-transport failure for a release-asset / latest download onto
 * the stable error codes (design §9.2 matrix applies to GitHub hosts; the
 * dialog renders these directly, so messages stay safe and non-specific).
 */
function mapAssetDownloadFailure(
  res: Extract<PluginHttpDownloadResult, { success: false }>
): PluginError {
  switch (res.reason) {
    case "aborted":
      return err("source-cancelled", "The installation was cancelled.", {
        recoverable: true,
      });
    case "timeout":
      return err(
        "source-timeout",
        "The GitHub download timed out. Check the connection and retry.",
        { recoverable: true }
      );
    case "redirect-rejected":
    case "redirect-loop":
    case "redirect-limit":
    case "redirect-missing-location":
      return err(
        "source-redirect-rejected",
        "GitHub redirected to an untrusted location, so the download was stopped."
      );
    case "too-large":
      return err(
        "install-io-failed",
        "The release asset is too large to install safely."
      );
    case "http-status": {
      const status = res.statusCode ?? 0;
      if (status === 403 || status === 429) {
        const remaining = res.responseHeaders?.["x-ratelimit-remaining"];
        if (status === 429 || remaining === "0") {
          return err(
            "github-rate-limited",
            "GitHub temporarily limited public download requests. Wait and retry, or import a ZIP.",
            { recoverable: true }
          );
        }
      }
      if (status === 404 || status === 401 || status === 403) {
        return err(
          "github-repository-unavailable",
          "The release asset was not found or is not publicly accessible. Check the tag and asset name.",
          { recoverable: true }
        );
      }
      return err(
        status >= 500
          ? "source-download-failed"
          : "github-repository-unavailable",
        status >= 500
          ? "GitHub could not serve the request. Retry later."
          : "The release asset was not found or is not publicly accessible."
      );
    }
    default:
      return err(
        "source-download-failed",
        "The plugin could not be downloaded. Retry later.",
        { recoverable: true }
      );
  }
}

export interface GitHubPluginFetcherDependencies {
  readonly archiveClient: GitHubArchiveClient;
  readonly zip: LocalZipPluginFetcher;
  /** Compat fallback (feature-flagged, design §17): native-Git repository
   *  acquisition while archive install is disabled for rollback. */
  readonly git?: GitPluginFetcher;
  /** Shared bounded HTTPS transport (design §8/§25): release assets and
   *  `releases/latest` downloads ride the same redirect/stream/cancel
   *  guarantees as repository archives. */
  readonly http?: PluginHttpDownloadService;
  /** Temp-dir seam (design §10.4): tests observe creation + cleanup without
   *  spying on the ESM fs namespace. Defaults to os.tmpdir mkdtemp. */
  readonly createTempDir?: () => string;
}

export class GitHubPluginFetcher implements PluginSourceFetcher {
  readonly kind = "github" as const;
  /** Shared transport for release-asset downloads; defaults once so the
   *  registry can inject the SAME instance used by the archive client. */
  private readonly http: PluginHttpDownloadService;

  constructor(
    private readonly deps: GitHubPluginFetcherDependencies = {
      archiveClient: new GitHubArchiveClient({
        http: new PluginHttpDownloadService(),
        appVersion: "1.0.0",
      }),
      zip: new LocalZipPluginFetcher(),
      git: new GitPluginFetcher(),
      http: new PluginHttpDownloadService(),
    }
  ) {
    this.http = deps.http ?? new PluginHttpDownloadService();
  }

  /** v1 archive-first repository acquisition (design §10.4). */
  private async acquireRepoViaArchive(
    cls: { owner: string; repo: string },
    req: PluginSourceRequest
  ): Promise<PluginAcquireResult> {
    const identity: GitHubRepositoryIdentity = {
      owner: cls.owner,
      repository: cls.repo,
      canonicalUrl: `https://github.com/${cls.owner}/${cls.repo}`,
    };
    const tmp = this.deps.createTempDir
      ? this.deps.createTempDir()
      : fs.mkdtempSync(path.join(os.tmpdir(), "plugin-gh-archive-"));
    const zipPath = path.join(tmp, "source.zip");
    // Ownership handoff: on success the returned cleanup() owns tmp; on
    // every OTHER terminal path (resolve/download/extract failure,
    // exception, abort) this finally removes it (design §16.1, FR-12).
    let handedOff = false;
    try {
      const resolved = await this.deps.archiveClient.resolveRevision(
        identity,
        req.ref,
        req.signal
      );
      if (!resolved.ok) {
        return { success: false, errors: [resolved.error] };
      }
      const downloaded = await this.deps.archiveClient.downloadArchive(
        identity,
        resolved.revision,
        zipPath,
        PLUGIN_PACKAGE_LIMITS.maxZipBytes,
        req.signal,
        req.onProgress
          ? (received, total) =>
              req.onProgress!(
                "downloading archive",
                total ? Math.round((received / total) * 100) : undefined
              )
          : undefined
      );
      if (!downloaded.ok) {
        return { success: false, errors: [downloaded.error] };
      }
      const inner = await this.deps.zip.acquire({
        kind: "local-zip",
        zipPath,
        ...(req.signal ? { signal: req.signal } : {}),
      });
      if (!inner.success) {
        return inner;
      }
      const innerCleanup = inner.source.cleanup;
      handedOff = true;
      return {
        success: true,
        source: {
          localRoot: inner.source.localRoot,
          cleanup: async () => {
            await innerCleanup();
            try {
              fs.rmSync(tmp, { recursive: true, force: true });
            } catch {
              /* best-effort */
            }
          },
          // Trusted acquisition provenance (design §10.2/§14.1): the
          // fetcher-generated SHA and canonical URI cannot be spoofed by
          // renderer-supplied sourceMeta — the install service gives these
          // keys precedence.
          provenance: {
            sourceUri: identity.canonicalUrl,
            ...(req.ref ? { sourceRef: req.ref } : {}),
            sourceMeta: {
              acquisition: "github-archive",
              resolvedCommitSha: resolved.revision.commitSha,
              repositoryHost: "github.com",
            },
          },
        },
      };
    } catch (e) {
      return {
        success: false,
        errors: [
          err(
            "source-download-failed",
            `GitHub archive acquisition failed: ${
              e instanceof Error ? e.message : String(e)
            }`
          ),
        ],
      };
    } finally {
      if (!handedOff) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
          /* best-effort — the primary failure governs */
        }
      }
    }
  }

  async acquire(req: PluginSourceRequest): Promise<PluginAcquireResult> {
    const cls = classifyGitHubUrl(req.uri ?? "");
    if (cls.type === "unknown") {
      return {
        success: false,
        errors: [
          err(
            "manifest-schema-invalid",
            "Unsupported GitHub URL. Use a repo URL, a release asset URL, or .../releases/latest."
          ),
        ],
      };
    }

    if (cls.type === "convenience") {
      return {
        success: false,
        errors: [
          err(
            "manifest-schema-invalid",
            "This looks like a GitHub browser URL. Enter the repository URL (https://github.com/OWNER/REPO) and put the branch, tag, or commit in the Ref field."
          ),
        ],
      };
    }

    if (cls.type === "repo") {
      // Compat fallback (design §17): when archive install is disabled in
      // the main-process Token store, repository URLs keep the pre-archive
      // native-Git behavior so a release can be rolled back.
      if (!isGitHubArchiveInstallEnabled() && this.deps.git) {
        return this.deps.git.acquire({
          ...req,
          kind: "git",
          uri: `https://github.com/${cls.owner}/${cls.repo}.git`,
          ref: req.ref,
        });
      }
      return this.acquireRepoViaArchive(cls, req);
    }

    return this.acquireReleaseAsset(cls, req);
  }

  /** Release-asset / `releases/latest` acquisition over the SHARED bounded
   *  transport (design §7.8/§25): no commit resolution, publisher-supplied
   *  content, source-specific redirect allowlist, same cleanup ownership
   *  contract as repository archives. */
  private async acquireReleaseAsset(
    cls:
      | {
          type: "asset";
          owner: string;
          repo: string;
          tag: string;
          asset: string;
        }
      | { type: "latest"; owner: string; repo: string },
    req: PluginSourceRequest
  ): Promise<PluginAcquireResult> {
    const assetUrl =
      cls.type === "asset"
        ? `https://github.com/${cls.owner}/${
            cls.repo
          }/releases/download/${encodeURIComponent(
            cls.tag
          )}/${encodeURIComponent(cls.asset)}`
        : `https://github.com/${cls.owner}/${cls.repo}/releases/latest/download/plugin.zip`;
    const tmp = this.deps.createTempDir
      ? this.deps.createTempDir()
      : fs.mkdtempSync(path.join(os.tmpdir(), "plugin-gh-"));
    const zipPath = path.join(tmp, "asset.zip");
    // Same ownership handoff as the archive path: the returned cleanup()
    // owns tmp on success; every other terminal path removes it here.
    let handedOff = false;
    try {
      const downloaded = await this.http.downloadToFile({
        url: new URL(assetUrl),
        destinationPath: zipPath,
        headers: {
          accept: "application/octet-stream",
          "user-agent": "AiFetchly/plugin-install",
        },
        maxBytes: PLUGIN_PACKAGE_LIMITS.maxZipBytes,
        timeoutMs: 60_000,
        maxRedirects: PLUGIN_HTTP_MAX_REDIRECTS,
        redirectPolicy: allowlistRedirectPolicy([
          ...GITHUB_RELEASE_ASSET_REDIRECT_HOSTS,
        ]),
        ...(req.signal ? { signal: req.signal } : {}),
        ...(req.onProgress
          ? {
              onProgress: (received: number, total?: number) =>
                req.onProgress!(
                  "downloading release asset",
                  total ? Math.round((received / total) * 100) : undefined
                ),
            }
          : {}),
      });
      if (!downloaded.success) {
        return {
          success: false,
          errors: [mapAssetDownloadFailure(downloaded)],
        };
      }
      const inner = await this.deps.zip.acquire({
        kind: "local-zip",
        zipPath,
        ...(req.signal ? { signal: req.signal } : {}),
      });
      if (!inner.success) {
        return inner;
      }
      const innerCleanup = inner.source.cleanup;
      handedOff = true;
      return {
        success: true,
        source: {
          localRoot: inner.source.localRoot,
          cleanup: async () => {
            await innerCleanup();
            try {
              fs.rmSync(tmp, { recursive: true, force: true });
            } catch {
              /* best-effort */
            }
          },
          provenance: {
            sourceUri: `https://github.com/${cls.owner}/${cls.repo}`,
            ...(cls.type === "asset" ? { sourceRef: cls.tag } : {}),
            sourceMeta: { acquisition: "github-release-asset" },
          },
        },
      };
    } catch (e) {
      return {
        success: false,
        errors: [
          err(
            "source-download-failed",
            `GitHub release download failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
            { recoverable: true }
          ),
        ],
      };
    } finally {
      if (!handedOff) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
          /* best-effort — the primary failure governs */
        }
      }
    }
  }
}

/** Live main-process flag read (design §17.1): archive install is enabled
 *  unless the Token store holds the exact value "false"; read failures
 *  leave it enabled (fail-open to the SAFER archive path). */
export function isGitHubArchiveInstallEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { Token } = require("@/modules/token") as {
      Token: new () => { getValue: (k: string) => string };
    };
    const { GITHUB_ARCHIVE_INSTALL_FLAG } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("@/config/featureFlags") as {
        GITHUB_ARCHIVE_INSTALL_FLAG: string;
      };
    return new Token().getValue(GITHUB_ARCHIVE_INSTALL_FLAG) !== "false";
  } catch {
    return true;
  }
}
