import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn as realSpawn } from "child_process";
import { applyDirectoryLimits } from "./pluginSourceLimits";
import { redactUri } from "./pluginSourceRedact";
import {
  err,
  type PluginAcquireResult,
  type PluginSourceFetcher,
  type PluginSourceRequest,
} from "./pluginSourceTypes";

/**
 * Plugin source fetcher that performs a shallow `git clone` into a temp
 * directory. Authentication for private repos is inherited from the user's
 * environment (SSH agent, git credential helper) — credentials are never
 * passed on the command line.
 *
 * Source of truth: Spec §5.3, §9.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

export interface SpawnChildLike {
  on(event: "close", cb: (e?: { code: number }) => void): unknown;
  on(event: "error", cb: (e: Error) => void): unknown;
  stderr: { on(ev: "data", cb: (chunk: Buffer) => void): unknown };
  stdout: { on(ev: "data", cb: (chunk: Buffer) => void): unknown };
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv }
) => SpawnChildLike;

export class GitPluginFetcher implements PluginSourceFetcher {
  readonly kind = "git" as const;

  constructor(
    // Default to a thin wrapper around child_process.spawn with shell:false.
    private readonly spawnFn: SpawnFn = defaultSpawn
  ) {}

  async acquire(req: PluginSourceRequest): Promise<PluginAcquireResult> {
    const uri = req.uri?.trim();
    if (!uri) {
      return {
        success: false,
        errors: [
          err("install-io-failed", "uri is required for the git source."),
        ],
      };
    }
    if (!/^((https|ssh|git):\/\/|git@)/.test(uri)) {
      return {
        success: false,
        errors: [
          err(
            "permission-denied",
            "Only https, ssh, and git@ URLs are accepted for git sources."
          ),
        ],
      };
    }
    if (uri.startsWith("http://")) {
      return {
        success: false,
        errors: [
          err(
            "permission-denied",
            "Plain HTTP git URLs are not allowed. Use https, ssh, or git@."
          ),
        ],
      };
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-git-"));
    const target = path.join(tmp, "repo");

    const args = ["clone", "--depth", "1"];
    if (req.ref) args.push("--branch", req.ref);
    args.push(uri, target);

    await runUntilSettled(
      this.spawnFn("git", args, { cwd: tmp, env: process.env }),
      DEFAULT_TIMEOUT_MS
    );

    if (!fs.existsSync(target)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return {
        success: false,
        errors: [
          err("install-io-failed", `git clone failed for ${redactUri(uri)}.`),
        ],
      };
    }

    // Single-subdir unwrap: if the cloned repo root has no manifest but
    // contains exactly one subdirectory that does, treat the inner dir as
    // the plugin root. Handles the common "repo contains a wrapper folder"
    // case.
    let localRoot = target;
    if (!hasRootManifest(target)) {
      const entries = fs
        .readdirSync(target, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== ".git");
      if (entries.length === 1) {
        const inner = path.join(target, entries[0].name);
        if (hasRootManifest(inner)) {
          localRoot = inner;
        }
      }
    }

    const limits = applyDirectoryLimits(localRoot);
    if (!limits.ok) {
      fs.rmSync(tmp, { recursive: true, force: true });
      const msg =
        limits.reason === "too-many-files"
          ? `Cloned repository has too many files (${limits.fileCount}).`
          : `Cloned repository is too large (${limits.totalBytes.toString()} bytes).`;
      return {
        success: false,
        errors: [err("install-io-failed", msg)],
      };
    }

    return {
      success: true,
      source: {
        localRoot,
        cleanup: async () => {
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

function hasRootManifest(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, ".aifetchly-plugin", "plugin.json")) ||
    fs.existsSync(path.join(dir, "plugin.json"))
  );
}

/**
 * Resolve when the child either closes or errors, OR when the timeout fires
 * (whichever first). The caller then judges success by checking on-disk
 * state, so we don't care which path fired.
 */
function runUntilSettled(
  child: SpawnChildLike,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(() => {
      // Don't let a hung git process outlive the timeout.
      try {
        child.kill();
      } catch {
        /* best-effort */
      }
      finish();
    }, timeoutMs);
    // Capture stderr so it never reaches the renderer or logs unfiltered,
    // but we deliberately ignore the content here.
    child.stderr?.on("data", () => {
      /* swallow — stderr may contain auth hints */
    });
    child.stdout?.on("data", () => {
      /* swallow */
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish();
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function defaultSpawn(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv }
): SpawnChildLike {
  return realSpawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as SpawnChildLike;
}
