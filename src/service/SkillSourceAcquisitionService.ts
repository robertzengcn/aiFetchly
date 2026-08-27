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
import type { PluginSourceRequest } from "@/service/pluginSources/pluginSourceTypes";
import { SkillInstallationWorkerClient } from "@/service/SkillInstallationWorkerClient";
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
export function normalizeSkillSource(
  raw: string
): SkillSourceDescriptor | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const github = classifyGitHubUrl(trimmed);

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
  if (
    path.isAbsolute(trimmed) ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
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
  private readonly stagingClient: SkillInstallationWorkerClient;

  constructor(
    limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
    stagingRoot?: string,
    stagingClient?: SkillInstallationWorkerClient
  ) {
    this.limits = limits;
    this.stagingRoot = resolveStagingRoot(stagingRoot);
    this.stagingClient = stagingClient ?? new SkillInstallationWorkerClient();
  }

  /**
   * Acquire a source into session staging. The returned tree lives under
   * the app-owned staging root; cancel/uninstall removes it wholesale.
   */
  async acquire(
    sessionId: string,
    descriptor: SkillSourceDescriptor
  ): Promise<AcquisitionResult> {
    const sessionDir = this.sessionDir(sessionId);
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

    const acquired = await this.fetcherFor(descriptor.kind).acquire(
      request.req
    );
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

      // Stage through the worker client: the bounded copy + tree hash runs
      // in the skill-installation utility process when available (design
      // §15.2 — acquisition must not block the main process), falling back
      // to inline staging with IDENTICAL limits and hashes.
      const staged = await this.stagingClient.stage(localRoot, target, {
        maxFiles: this.limits.maxFiles,
        maxTotalBytes: this.limits.maxTotalBytes,
        maxDepth: 20,
      });
      if (!staged.ok) {
        return {
          ok: false,
          code:
            staged.code === "SOURCE_LIMIT_EXCEEDED"
              ? "SOURCE_LIMIT_EXCEEDED"
              : "SOURCE_ACQUISITION_FAILED",
          message: staged.message,
        };
      }

      const contentHash = staged.result.contentHash;
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
        code: "SOURCE_ACQUISITION_FAILED",
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

  /**
   * Resolve a session's staging directory with a hard containment guard:
   * the resolved path must sit strictly INSIDE <stagingRoot>/sessions
   * (separator-aware), and the id must match the strict charset. Guards
   * every recursive delete against traversal via model-controlled ids
   * (NFR-05 / review S1).
   */
  private sessionDir(sessionId: string): string {
    if (!/^[A-Za-z0-9:_-]+$/.test(sessionId)) {
      throw new Error("Invalid session id.");
    }
    const sessionsRoot = path.resolve(this.stagingRoot, "sessions");
    const resolved = path.resolve(sessionsRoot, sessionId);
    const rootWithSep = sessionsRoot.endsWith(path.sep)
      ? sessionsRoot
      : sessionsRoot + path.sep;
    if (resolved !== sessionsRoot && !resolved.startsWith(rootWithSep)) {
      throw new Error("Session path escapes the staging root.");
    }
    return resolved;
  }

  /** Remove one session's staging tree (cancel / cleanup path). */
  removeSession(sessionId: string): void {
    let sessionDir: string;
    try {
      sessionDir = this.sessionDir(sessionId);
    } catch {
      return; // invalid id — nothing we own to remove
    }
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

  private async resolveRevision(
    stagingRoot: string,
    descriptor: SkillSourceDescriptor
  ): Promise<string> {
    // Prompt skills without a semantic version use the content hash of the
    // staged tree as their immutable identity (PRD §11.2).
    if (
      descriptor.requestedRevision &&
      /^[0-9a-f]{40}$/i.test(descriptor.requestedRevision)
    ) {
      return descriptor.requestedRevision;
    }
    const { hashTree } = await import(
      "@/childprocess/skill-installation/stagePackage"
    );
    return hashTree(stagingRoot);
  }
}

