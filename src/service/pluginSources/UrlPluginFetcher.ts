import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URL } from "url";
import { GitHubPluginFetcher } from "./GitHubPluginFetcher";
import { GitPluginFetcher } from "./GitPluginFetcher";
import { LocalZipPluginFetcher } from "./LocalZipPluginFetcher";
import { PLUGIN_PACKAGE_LIMITS } from "@/entityTypes/pluginTypes";
import type { PluginError } from "@/entityTypes/pluginTypes";
import {
  PLUGIN_HTTP_MAX_REDIRECTS,
  PluginHttpDownloadService,
  type PluginHttpDownloadResult,
} from "./PluginHttpDownloadService";
import {
  err,
  type PluginAcquireResult,
  type PluginSourceFetcher,
  type PluginSourceRequest,
} from "./pluginSourceTypes";

/**
 * URL dispatcher: inspects the URL shape and delegates to the appropriate
 * concrete fetcher. Supports:
 *   - direct .zip download → LocalZip after fetch (shared bounded transport,
 *     design §8/§25: redirect allowlist = the ORIGINAL host only)
 *   - git URL (.git / git@ / ssh://) → GitPluginFetcher
 *   - github.com URL → GitHubPluginFetcher
 *
 * Plain HTTP is rejected; HTTPS only.
 *
 * Source of truth: Spec §5.6.
 */

export type UrlClass = "zip" | "git" | "github" | "rejected" | "unknown";

export function classifyUrlKind(raw: string): UrlClass {
  if (!raw) return "unknown";
  if (raw.startsWith("http://")) return "rejected";
  // GitHub FIRST (git-free GitHub plugin installation design §6.3): an
  // eligible github.com URL — including a trailing .git — must take the
  // archive path, never native Git. Non-GitHub .git stays Git.
  if (/^https:\/\/github\.com\//i.test(raw)) return "github";
  if (/^git@/.test(raw) || /^ssh:\/\//.test(raw) || raw.endsWith(".git")) {
    return "git";
  }
  if (/\.zip(\?.*)?$/i.test(raw)) return "zip";
  return "unknown";
}

/** Generic-ZIP failure mapping onto the stable codes (design §12/§25). */
function mapZipDownloadFailure(
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
        "The download timed out. Check the connection and retry.",
        { recoverable: true }
      );
    case "redirect-rejected":
    case "redirect-loop":
    case "redirect-limit":
    case "redirect-missing-location":
      return err(
        "source-redirect-rejected",
        "The download was redirected to a different host, so it was stopped."
      );
    case "too-large":
      return err(
        "install-io-failed",
        "The archive is too large to install safely."
      );
    default:
      return err(
        "source-download-failed",
        "The plugin could not be downloaded. Check the URL and retry.",
        { recoverable: true }
      );
  }
}

export class UrlPluginFetcher implements PluginSourceFetcher {
  readonly kind = "url" as const;
  /** Shared bounded transport; the registry injects the SAME instance used
   *  by the GitHub fetcher so limits and redirect rules stay identical. */
  private readonly http: PluginHttpDownloadService;

  constructor(
    private readonly deps: {
      zip: LocalZipPluginFetcher;
      git: GitPluginFetcher;
      github: GitHubPluginFetcher;
      http?: PluginHttpDownloadService;
      /** Temp-dir seam (design §10.4): tests observe cleanup without
       *  spying on the ESM fs namespace. */
      createTempDir?: () => string;
    } = {
      // Shared-instance composition happens in PluginInstallService's
      // defaultRegistry; these defaults stay for isolated construction.
      zip: new LocalZipPluginFetcher(),
      git: new GitPluginFetcher(),
      github: new GitHubPluginFetcher(),
    }
  ) {
    this.http = deps.http ?? new PluginHttpDownloadService();
  }

  async acquire(req: PluginSourceRequest): Promise<PluginAcquireResult> {
    const uri = req.uri ?? "";
    const cls = classifyUrlKind(uri);
    if (cls === "rejected") {
      return {
        success: false,
        errors: [err("permission-denied", "Plain HTTP URLs are not allowed.")],
      };
    }
    if (cls === "unknown") {
      return {
        success: false,
        errors: [
          err(
            "manifest-schema-invalid",
            "Unsupported URL. Provide a .zip URL, git URL, or GitHub URL."
          ),
        ],
      };
    }
    if (cls === "git") {
      return this.deps.git.acquire({ ...req, kind: "git" });
    }
    if (cls === "github") {
      return this.deps.github.acquire({ ...req, kind: "github" });
    }

    // zip — download first over the shared bounded transport. Redirects may
    // only stay on the ORIGINAL exact host (design §8.4); cross-host
    // redirects are rejected rather than followed.
    const parsed = new URL(uri);
    const workdir = this.deps.createTempDir
      ? this.deps.createTempDir()
      : fs.mkdtempSync(path.join(os.tmpdir(), "plugin-url-"));
    const dest = path.join(workdir, "asset.zip");
    // Ownership handoff: the returned cleanup() owns workdir on success;
    // every other terminal path removes it here (design §16.1, FR-12).
    let handedOff = false;
    try {
      const downloaded = await this.http.downloadToFile({
        url: parsed,
        destinationPath: dest,
        headers: { accept: "application/octet-stream" },
        maxBytes: PLUGIN_PACKAGE_LIMITS.maxZipBytes,
        timeoutMs: 60_000,
        maxRedirects: PLUGIN_HTTP_MAX_REDIRECTS,
        redirectPolicy: ({ to }) => to.host === parsed.host,
        ...(req.signal ? { signal: req.signal } : {}),
        ...(req.onProgress
          ? {
              onProgress: (received: number, total?: number) =>
                req.onProgress!(
                  "downloading archive",
                  total ? Math.round((received / total) * 100) : undefined
                ),
            }
          : {}),
      });
      if (!downloaded.success) {
        return { success: false, errors: [mapZipDownloadFailure(downloaded)] };
      }
      const inner = await this.deps.zip.acquire({
        kind: "local-zip",
        zipPath: dest,
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
              fs.rmSync(workdir, { recursive: true, force: true });
            } catch {
              /* best-effort */
            }
          },
        },
      };
    } catch (e) {
      return {
        success: false,
        errors: [
          err(
            "source-download-failed",
            `The download failed: ${e instanceof Error ? e.message : String(e)}`
          ),
        ],
      };
    } finally {
      if (!handedOff) {
        try {
          fs.rmSync(workdir, { recursive: true, force: true });
        } catch {
          /* best-effort — the primary failure governs */
        }
      }
    }
  }
}
