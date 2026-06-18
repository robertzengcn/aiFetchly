import * as fs from "fs";
import * as https from "https";
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
import { PLUGIN_PACKAGE_LIMITS } from "@/entityTypes/pluginTypes";

/**
 * GitHub plugin source. Accepts:
 *   - repo URL (https://github.com/<owner>/<repo>[.git]) → shallow git clone
 *   - release asset URL (.../releases/download/<tag>/<asset>) → HTTPS download
 *   - latest release URL (.../releases/latest) → resolve + download
 *
 * Private repos and PAT-only assets are out of scope for v1: the git path
 * relies on the user's SSH agent / credential helper, and the asset path is
 * public only. A 401/403 returns permission-denied with a hint to use git.
 *
 * Source of truth: Spec §5.4.
 */

export type GitHubClass =
  | { type: "repo"; owner: string; repo: string }
  | { type: "asset"; owner: string; repo: string; tag: string; asset: string }
  | { type: "latest"; owner: string; repo: string }
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
  if (
    parts.length === 4 &&
    parts[2] === "releases" &&
    parts[3] === "latest"
  ) {
    return { type: "latest", owner, repo };
  }
  // Anything else with 2 segments (or extras like /tree/<ref>) is treated as
  // a repo for cloning.
  if (parts.length === 2) {
    return { type: "repo", owner, repo };
  }
  return { type: "unknown" };
}

async function downloadZip(url: string, dest: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let redirects = 0;
    let aborted = false;
    const req = (target: string) => {
      const r = https.get(
        target,
        { timeout: 60_000 },
        (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            if (++redirects > 5) {
              reject(new Error("Too many redirects"));
              return;
            }
            res.destroy();
            req(res.headers.location);
            return;
          }
          if (!res.statusCode || res.statusCode !== 200) {
            res.destroy();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const out = fs.createWriteStream(dest);
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > PLUGIN_PACKAGE_LIMITS.maxZipBytes && !aborted) {
              aborted = true;
              r.destroy();
              out.destroy();
              fs.rmSync(dest, { force: true });
              reject(new Error("Package exceeds max size"));
            }
          });
          res.pipe(out);
          out.on("finish", () => resolve());
          out.on("error", (e) => {
            if (!aborted) reject(e);
          });
        }
      );
      r.on("error", (e) => {
        if (!aborted) reject(e);
      });
    };
    req(url);
  });
}

export class GitHubPluginFetcher implements PluginSourceFetcher {
  readonly kind = "github" as const;

  constructor(
    private readonly deps: {
      git: GitPluginFetcher;
      zip: LocalZipPluginFetcher;
    } = {
      git: new GitPluginFetcher(),
      zip: new LocalZipPluginFetcher(),
    }
  ) {}

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

    if (cls.type === "repo") {
      const uri = `https://github.com/${cls.owner}/${cls.repo}.git`;
      return this.deps.git.acquire({ ...req, kind: "git", uri, ref: req.ref });
    }

    const assetUrl =
      cls.type === "asset"
        ? `https://github.com/${cls.owner}/${cls.repo}/releases/download/${cls.tag}/${cls.asset}`
        : `https://github.com/${cls.owner}/${cls.repo}/releases/latest/download/plugin.zip`;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-gh-"));
    const zipPath = path.join(tmp, "asset.zip");
    try {
      await downloadZip(assetUrl, zipPath);
    } catch (e: unknown) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return {
        success: false,
        errors: [
          err(
            "permission-denied",
            e instanceof Error
              ? `GitHub download failed: ${e.message}. For private repos, use the git source with a credential helper.`
              : "GitHub download failed."
          ),
        ],
      };
    }

    const inner = await this.deps.zip.acquire({
      kind: "local-zip",
      zipPath,
    });
    if (!inner.success) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return inner;
    }
    const innerCleanup = inner.source.cleanup;
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
      },
    };
  }
}
