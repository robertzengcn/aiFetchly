import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as https from "https";
import { GitHubPluginFetcher } from "./GitHubPluginFetcher";
import { GitPluginFetcher } from "./GitPluginFetcher";
import { LocalZipPluginFetcher } from "./LocalZipPluginFetcher";
import { PLUGIN_PACKAGE_LIMITS } from "@/entityTypes/pluginTypes";
import {
  err,
  type PluginAcquireResult,
  type PluginSourceFetcher,
  type PluginSourceRequest,
} from "./pluginSourceTypes";

/**
 * URL dispatcher: inspects the URL shape and delegates to the appropriate
 * concrete fetcher. Supports:
 *   - direct .zip download → LocalZip after fetch
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
  if (/^git@/.test(raw) || /^ssh:\/\//.test(raw) || raw.endsWith(".git")) {
    return "git";
  }
  if (/^https:\/\/github\.com\//i.test(raw)) return "github";
  if (/\.zip(\?.*)?$/i.test(raw)) return "zip";
  return "unknown";
}

export class UrlPluginFetcher implements PluginSourceFetcher {
  readonly kind = "url" as const;

  constructor(
    private readonly deps: {
      zip: LocalZipPluginFetcher;
      git: GitPluginFetcher;
      github: GitHubPluginFetcher;
    } = {
      zip: new LocalZipPluginFetcher(),
      git: new GitPluginFetcher(),
      github: new GitHubPluginFetcher(),
    }
  ) {}

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

    // zip — download first
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-url-"));
    const dest = path.join(workdir, "asset.zip");
    const ok = await downloadTo(uri, dest);
    if (!ok) {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      return {
        success: false,
        errors: [err("install-io-failed", "Failed to download URL.")],
      };
    }
    const inner = await this.deps.zip.acquire({
      kind: "local-zip",
      zipPath: dest,
    });
    if (!inner.success) {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
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
            fs.rmSync(workdir, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        },
      },
    };
  }
}

function downloadTo(url: string, dest: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let redirects = 0;
    let aborted = false;
    const done = (ok: boolean) => {
      if (!aborted) {
        aborted = true;
        resolve(ok);
      }
    };
    const req = (target: string) => {
      const r = https.get(target, { timeout: 60_000 }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (++redirects > 5) return done(false);
          res.destroy();
          req(res.headers.location);
          return;
        }
        if (!res.statusCode || res.statusCode !== 200) {
          res.destroy();
          return done(false);
        }
        const out = fs.createWriteStream(dest);
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > PLUGIN_PACKAGE_LIMITS.maxZipBytes) {
            r.destroy();
            out.destroy();
            try {
              fs.rmSync(dest, { force: true });
            } catch {
              /* ignore */
            }
            done(false);
          }
        });
        res.pipe(out);
        out.on("finish", () => done(true));
        out.on("error", () => done(false));
      });
      r.on("error", () => done(false));
      // The `timeout` option only emits a 'timeout' event — without this
      // handler a stalled server hangs the install forever.
      r.on("timeout", () => {
        if (!aborted) {
          aborted = true;
          r.destroy(new Error("Request timed out"));
        }
      });
    };
    req(url);
  });
}
