import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn as realSpawn } from "child_process";
import { redactUri } from "@/service/pluginSources/pluginSourceRedact";
import {
  mktErr,
  type PluginMarketplaceFetchResult,
  type PluginMarketplaceFetcher,
  type PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";

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

/** Locate the marketplace manifest: .claude-plugin/marketplace.json or ./marketplace.json. */
export function locateMarketplaceManifest(root: string): string | null {
  const candidates = [
    path.join(root, ".claude-plugin", "marketplace.json"),
    path.join(root, "marketplace.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export class GitMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "git" as const;

  constructor(private readonly spawnFn: SpawnFn = defaultSpawn) {}

  async fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
    const uri = req.source.uri?.trim();
    if (!uri) {
      return { success: false, errors: [mktErr("marketplace-source-invalid", "git source requires a uri.")] };
    }
    if (uri.startsWith("http://")) {
      return { success: false, errors: [mktErr("marketplace-source-invalid", "Plain HTTP git URLs are not allowed.")] };
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-git-"));
    const target = path.join(tmp, "repo");
    const args = ["clone", "--depth", "1"];
    if (req.source.ref) args.push("--branch", req.source.ref);
    args.push(uri, target);

    await runUntilSettled(this.spawnFn("git", args, { cwd: tmp, env: process.env }), DEFAULT_TIMEOUT_MS);

    if (!fs.existsSync(target)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return {
        success: false,
        errors: [mktErr("marketplace-fetch-failed", `git clone failed for ${redactUri(uri)}.`)],
      };
    }

    const manifestPath = locateMarketplaceManifest(target);
    if (!manifestPath) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return {
        success: false,
        errors: [mktErr("marketplace-manifest-not-found", "No .claude-plugin/marketplace.json found in repository.")],
      };
    }

    const manifestJson = fs.readFileSync(manifestPath, "utf-8");
    return {
      success: true,
      marketplace: {
        marketplaceRoot: target,
        manifestPath,
        manifestJson,
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

function runUntilSettled(child: SpawnChildLike, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* best-effort */
      }
      finish();
    }, timeoutMs);
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
