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

    const settle = await runUntilSettled(
      this.spawnFn("git", args, { cwd: tmp, env: process.env }),
      DEFAULT_TIMEOUT_MS
    );

    if (!fs.existsSync(target)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      // FR-17 / design §11.3: a missing Git executable is a SPECIFIC,
      // recoverable condition — never a generic clone failure. Other spawn
      // errors and non-zero exits remain safe generic install failures.
      if (settle.kind === "spawn-error" && settle.errorCode === "ENOENT") {
        return {
          success: false,
          errors: [
            err(
              "git-not-installed",
              "Git is not installed or cannot be found. Choose the GitHub source for a public repository (no Git needed), import a ZIP, or install Git and restart AiFetchly.",
              { recoverable: true }
            ),
          ],
        };
      }
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
 * WHY the process settled (design §11.3): closed, spawn-error (with the
 * error code so ENOENT = missing Git), or timeout. The caller combines
 * this with on-disk state to produce a typed result.
 */
export type GitProcessResult =
  | { readonly kind: "closed"; readonly exitCode: number | null }
  | { readonly kind: "spawn-error"; readonly errorCode?: string }
  | { readonly kind: "timeout" };

/**
 * Resolve when the child either closes or errors, OR when the timeout fires
 * (whichever first), reporting WHICH path fired.
 */
function runUntilSettled(
  child: SpawnChildLike,
  timeoutMs: number
): Promise<GitProcessResult> {
  return new Promise<GitProcessResult>((resolve) => {
    let settled = false;
    const finish = (result: GitProcessResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const timer = setTimeout(() => {
      // Don't let a hung git process outlive the timeout.
      try {
        child.kill();
      } catch {
        /* best-effort */
      }
      finish({ kind: "timeout" });
    }, timeoutMs);
    // Capture stderr so it never reaches the renderer or logs unfiltered,
    // but we deliberately ignore the content here.
    child.stderr?.on("data", () => {
      /* swallow — stderr may contain auth hints */
    });
    child.stdout?.on("data", () => {
      /* swallow */
    });
    child.on("close", (e) => {
      clearTimeout(timer);
      finish({ kind: "closed", exitCode: e?.code ?? null });
    });
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      finish({
        kind: "spawn-error",
        errorCode: (e as { code?: string }).code,
      });
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
