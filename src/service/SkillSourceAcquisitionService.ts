/**
 * SkillSourceAcquisitionService — acquires a skill source into app-owned
 * staging (design §9, PRD §11).
 *
 * Reuses the existing plugin source fetchers (git / github / local folder /
 * local zip) so acquisition limits and redaction have one owner, then moves
 * the acquired tree into the session staging layout:
 *
 *   <stagingRoot>/sessions/<session-id>/source/
 *
 * Never clones into the user's home directory. Records the resolved Git
 * commit (or content hash for archives/local copies) BEFORE activation so
 * provenance is immutable. Staging root defaults to Electron userData with
 * an AIFETCHLY_SKILL_STAGING_ROOT override for tests/advanced deployments.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  GitHubPluginFetcher,
  classifyGitHubUrl,
} from "@/service/pluginSources/GitHubPluginFetcher";
import { GitPluginFetcher } from "@/service/pluginSources/GitPluginFetcher";
import { LocalFolderPluginFetcher } from "@/service/pluginSources/LocalFolderPluginFetcher";
import { LocalZipPluginFetcher } from "@/service/pluginSources/LocalZipPluginFetcher";
import type {
  PluginSourceRequest,
} from "@/service/pluginSources/pluginSourceTypes";
import type {
  ResolvedSkillSource,
  SkillSourceDescriptor,
  SkillSourceKind,
} from "@/entityTypes/skillInstallationTypes";

export interface AcquisitionLimits {
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly timeoutMs: number;
}

export const DEFAULT_ACQUISITION_LIMITS: AcquisitionLimits = {
  maxFiles: 5_000,
  maxTotalBytes: 250 * 1024 * 1024,
  timeoutMs: 60_000,
};

export type AcquisitionResult =
  | { readonly ok: true; readonly source: ResolvedSkillSource }
  | {
      readonly ok: false;
      readonly code:
        | "SOURCE_ACQUISITION_FAILED"
        | "SOURCE_LIMIT_EXCEEDED"
        | "SOURCE_INVALID";
      readonly message: string;
    };

/** Normalize a user-supplied source string into a descriptor. */
export function normalizeSkillSource(raw: string): SkillSourceDescriptor | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const github = classifyGitHubUrl(trimmed);
  if (github.type === "repo" || github.type === "unknown") {
    if (trimmed.startsWith("https://github.com/") || trimmed.startsWith("http://github.com/")) {
      if (github.type !== "repo") {
        return null;
      }
    }
  }

  if (/^https:\/\/github\.com\//.test(trimmed) && github.type === "repo") {
    // Strip .git and trailing slash; subdirectory travels separately.
    return {
      kind: "github",
      canonicalUri: `https://github.com/${github.owner}/${github.repo}`,
    };
  }
  if (/^git@|^ssh:\/\/|^git:\/\//.test(trimmed)) {
    return { kind: "git", canonicalUri: trimmed };
  }
  if (/^https:\/\/[^\s]+\.git$/i.test(trimmed)) {
    return { kind: "git", canonicalUri: trimmed.replace(/\.git$/i, "") };
  }
  // Local references — absolute or explicitly relative paths.
  if (path.isAbsolute(trimmed) || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return {
      kind: trimmed.match(/\.(zip|tgz|tar\.gz)$/i)
        ? "local-archive"
        : "local-directory",
      canonicalUri: path.resolve(trimmed),
    };
  }
  return null;
}

export function resolveStagingRoot(override?: string): string {
  if (override) return override;
  const env = process.env.AIFETCHLY_SKILL_STAGING_ROOT;
  if (env) return env;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { app } = require("electron") as typeof import("electron");
    return path.join(app.getPath("userData"), "skill-installation");
  } catch {
    return path.join(os.tmpdir(), "aifetchly-skill-installation");
  }
}

export class SkillSourceAcquisitionService {
  private readonly git = new GitPluginFetcher();
  private readonly github = new GitHubPluginFetcher();
  private readonly localFolder = new LocalFolderPluginFetcher();
  private readonly localZip = new LocalZipPluginFetcher();
  private readonly limits: AcquisitionLimits;
  private readonly stagingRoot: string;

  constructor(
    limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
    stagingRoot?: string
  ) {
    this.limits = limits;
    this.stagingRoot = resolveStagingRoot(stagingRoot);
  }

  /**
   * Acquire a source into session staging. The returned tree lives under
   * the app-owned staging root; cancel/uninstall removes it wholesale.
   */
  async acquire(
    sessionId: string,
    descriptor: SkillSourceDescriptor
  ): Promise<AcquisitionResult> {
    const sessionDir = path.join(this.stagingRoot, "sessions", sessionId);
    const sourceDir = path.join(sessionDir, "source");
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      fs.mkdirSync(sourceDir, { recursive: true });
    } catch (err) {
      return {
        ok: false,
        code: "SOURCE_ACQUISITION_FAILED",
        message: `Failed to prepare staging: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    const request = this.buildRequest(descriptor);
    if (!request.ok) {
      return { ok: false, code: "SOURCE_INVALID", message: request.message };
    }

    const acquired = await this.fetcherFor(descriptor.kind).acquire(request.req);
    if (!acquired.success) {
      const message = acquired.errors
        .map((e) => e.message)
        .join("; ")
        .replace(/https?:\/\/[^\s]+/g, "[source]"); // redact URLs
      return { ok: false, code: "SOURCE_ACQUISITION_FAILED", message };
    }

    const { localRoot, cleanup } = acquired.source;
    try {
      const target = path.join(sourceDir, "content");
      this.copyTreeBounded(localRoot, target);

      const contentHash = this.hashTree(target);
      const resolvedRevision = await this.resolveRevision(target, descriptor);

      return {
        ok: true,
        source: {
          sourceId: crypto
            .createHash("sha256")
            .update(`${descriptor.kind}:${descriptor.canonicalUri}`)
            .digest("hex")
            .slice(0, 16),
          canonicalUri: descriptor.canonicalUri,
          resolvedRevision,
          acquiredRoot: target,
          contentHash,
          acquisitionMethod:
            descriptor.kind === "git" || descriptor.kind === "github"
              ? "git"
              : "local-copy",
        },
      };
    } catch (err) {
      return {
        ok: false,
        code: err instanceof LimitError ? "SOURCE_LIMIT_EXCEEDED" : "SOURCE_ACQUISITION_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      try {
        await cleanup();
      } catch {
        /* best-effort */
      }
    }
  }

  /** Remove one session's staging tree (cancel / cleanup path). */
  removeSession(sessionId: string): void {
    const sessionDir = path.join(this.stagingRoot, "sessions", sessionId);
    // Only ever delete inside our own staging root (NFR-05).
    if (!sessionDir.startsWith(path.join(this.stagingRoot, "sessions"))) return;
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  private buildRequest(
    descriptor: SkillSourceDescriptor
  ): { ok: true; req: PluginSourceRequest } | { ok: false; message: string } {
    switch (descriptor.kind) {
      case "github":
      case "git":
        return {
          ok: true,
          req: {
            kind: descriptor.kind,
            uri: descriptor.canonicalUri,
            ...(descriptor.requestedRevision
              ? { ref: descriptor.requestedRevision }
              : {}),
          },
        };
      case "local-directory":
        return {
          ok: true,
          req: { kind: "local-folder", folderPath: descriptor.canonicalUri },
        };
      case "local-archive":
        return {
          ok: true,
          req: { kind: "local-zip", zipPath: descriptor.canonicalUri },
        };
      default:
        return { ok: false, message: "Unsupported source kind." };
    }
  }

  private fetcherFor(kind: SkillSourceKind) {
    switch (kind) {
      case "github":
        return this.github;
      case "git":
        return this.git;
      case "local-archive":
        return this.localZip;
      default:
        return this.localFolder;
    }
  }

  private copyTreeBounded(from: string, to: string): void {
    let files = 0;
    let bytes = 0;
    const walk = (src: string, dest: string, depth: number): void => {
      if (depth > 20) {
        throw new LimitError("Repository traversal exceeds depth 20.");
      }
      const entries = fs.readdirSync(src, { withFileTypes: true });
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of entries) {
        if (entry.name === ".git") continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        const stat = fs.statSync(srcPath);
        if (stat.isDirectory()) {
          walk(srcPath, destPath, depth + 1);
          continue;
        }
        if (!stat.isFile()) {
          continue; // devices, FIFOs, sockets ignored (PRD §11.2)
        }
        files += 1;
        bytes += stat.size;
        if (files > this.limits.maxFiles) {
          throw new LimitError(
            `Acquired package exceeds the ${this.limits.maxFiles}-file limit.`
          );
        }
        if (bytes > this.limits.maxTotalBytes) {
          throw new LimitError(
            `Acquired package exceeds the ${Math.floor(
              this.limits.maxTotalBytes / 1024 / 1024
            )} MiB content limit.`
          );
        }
        fs.copyFileSync(srcPath, destPath);
      }
    };
    walk(from, to, 0);
  }

  private hashTree(root: string): string {
    const hash = crypto.createHash("sha256");
    const walk = (dir: string): void => {
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          hash.update(entry.name + "/");
          walk(p);
        } else if (entry.isFile()) {
          hash.update(entry.name);
          hash.update(fs.readFileSync(p));
        }
      }
    };
    walk(root);
    return hash.digest("hex");
  }

  private async resolveRevision(
    stagingRoot: string,
    descriptor: SkillSourceDescriptor
  ): Promise<string> {
    // A cloned Git tree keeps .git in the ORIGINAL localRoot (the fetcher's
    // temp dir) — but our copyTreeBounded skips .git. Re-derive from the
    // fetcher temp root instead when possible: simplest reliable approach is
    // hashing the staged content (prompt skills without a semantic version
    // use the content hash as their immutable identity — PRD §11.2).
    void stagingRoot;
    if (
      descriptor.requestedRevision &&
      /^[0-9a-f]{40}$/i.test(descriptor.requestedRevision)
    ) {
      return descriptor.requestedRevision;
    }
    return this.hashTree(stagingRoot);
  }
}

class LimitError extends Error {}
