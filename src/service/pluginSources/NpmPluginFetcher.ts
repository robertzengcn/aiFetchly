import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { applyDirectoryLimits } from "./pluginSourceLimits";
import {
  err,
  type PluginAcquireResult,
  type PluginSourceFetcher,
  type PluginSourceRequest,
} from "./pluginSourceTypes";

/**
 * Plugin source fetcher that uses `npm pack` to download a package tarball
 * without running lifecycle scripts.
 *
 * Security: `--ignore-scripts` is mandatory. Auth tokens are written to a
 * 0600 .npmrc in the workdir, never on the CLI. The package name is
 * validated against a strict allowlist before it reaches spawn.
 *
 * Source of truth: Spec §5.5, §9.
 */

const NPM_TIMEOUT_MS = 60_000;
const PACKAGE_NAME_RE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const VERSION_RE = /^[a-zA-Z0-9._^~>=< *\s-]+$/;

export interface NpmSpec {
  pkg: string;
  version?: string;
  registry?: string;
}

export function buildNpmArgs(spec: NpmSpec): string[] {
  const args = ["pack"];
  const id = spec.version ? `${spec.pkg}@${spec.version}` : spec.pkg;
  args.push(id);
  args.push("--ignore-scripts", "--json");
  if (spec.registry) args.push(`--registry=${spec.registry}`);
  return args;
}

export class NpmPluginFetcher implements PluginSourceFetcher {
  readonly kind = "npm" as const;

  async acquire(req: PluginSourceRequest): Promise<PluginAcquireResult> {
    const pkg = req.npmPackage?.trim() ?? "";
    if (!pkg || !PACKAGE_NAME_RE.test(pkg)) {
      return {
        success: false,
        errors: [
          err(
            "permission-denied",
            "npmPackage is missing or contains invalid characters."
          ),
        ],
      };
    }
    const version = req.npmVersion?.trim() || undefined;
    if (version && !VERSION_RE.test(version)) {
      return {
        success: false,
        errors: [
          err(
            "permission-denied",
            "npmVersion contains invalid characters."
          ),
        ],
      };
    }
    const registry = req.npmRegistry?.trim() || undefined;
    if (registry && !/^https:\/\//i.test(registry)) {
      return {
        success: false,
        errors: [
          err(
            "permission-denied",
            "npmRegistry must use HTTPS."
          ),
        ],
      };
    }

    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-npm-"));

    if (req.npmAuthToken) {
      // Format: //registry.example.com/:_authToken=VALUE
      const registryRoot = (registry ?? "https://registry.npmjs.org/").replace(
        /^https?:/,
        ""
      );
      const line = `${registryRoot}:_authToken=${req.npmAuthToken}\n`;
      fs.writeFileSync(path.join(workdir, ".npmrc"), line, { mode: 0o600 });
    }

    const args = buildNpmArgs({ pkg, version, registry });

    const spawnResult = await new Promise<{
      code: number;
      stdout: string;
      tarball: string | null;
    }>((resolve) => {
      let stdout = "";
      let resolved = false;
      const finish = (code: number) => {
        if (resolved) return;
        resolved = true;
        let tarball: string | null = null;
        try {
          const parsed = JSON.parse(stdout) as Array<{ filename?: string }>;
          if (Array.isArray(parsed) && parsed[0]?.filename) {
            tarball = parsed[0].filename;
          }
        } catch {
          /* leave null */
        }
        resolve({ code, stdout, tarball });
      };
      const timer = setTimeout(() => finish(1), NPM_TIMEOUT_MS);
      const child = spawn("npm", args, {
        cwd: workdir,
        env: process.env,
        shell: false,
      });
      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString();
      });
      child.on("close", (c) => {
        clearTimeout(timer);
        finish(c ?? 0);
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish(1);
      });
    });

    if (spawnResult.code !== 0 || !spawnResult.tarball) {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      return {
        success: false,
        errors: [
          err(
            "install-io-failed",
            `npm pack failed (exit ${spawnResult.code}).`
          ),
        ],
      };
    }

    const tarball = path.join(workdir, spawnResult.tarball);
    const extractDir = path.join(workdir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    const extracted = await new Promise<boolean>((resolve) => {
      const child = spawn(
        "tar",
        ["-xzf", tarball, "-C", extractDir],
        { env: process.env, shell: false }
      );
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), NPM_TIMEOUT_MS);
      child.on("close", (c) => {
        clearTimeout(timer);
        finish(c === 0);
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish(false);
      });
    });

    if (!extracted) {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      return {
        success: false,
        errors: [err("install-io-failed", "Failed to extract npm tarball.")],
      };
    }

    // npm tarballs extract to a single `package/` directory by convention.
    const localRoot = path.join(extractDir, "package");
    if (!fs.existsSync(localRoot)) {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      return {
        success: false,
        errors: [
          err("install-io-failed", "npm tarball layout was unexpected."),
        ],
      };
    }

    const limits = applyDirectoryLimits(localRoot);
    if (!limits.ok) {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      const msg =
        limits.reason === "too-many-files"
          ? `npm package has too many files (${limits.fileCount}).`
          : `npm package is too large (${limits.totalBytes.toString()} bytes).`;
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
            fs.rmSync(workdir, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        },
      },
    };
  }
}
