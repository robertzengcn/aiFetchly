/**
 * ConversationFilesystemContextService — the single main-process resolver
 * that answers "what is the filesystem world for this conversation?".
 *
 * Source of truth: natural-language-skill-installation technical design §6,
 * PRD §15.
 *
 * WHY THIS EXISTS
 * `ToolExecutor` scoped file tools through `WorkspaceResolver`, while
 * `ShellToolService` independently called `getDefaultWorkspaceRoots()` and
 * chose its own current directory. A repository could therefore be cloned
 * successfully by shell into a location the file tools were forbidden to
 * read — the exact loop observed in the motivating video-use conversation.
 * Every path-bearing tool now resolves ONE context through this service.
 *
 * Hard invariants (design §6.2):
 *   - `WorkspaceResolver` remains the authority for the approved workspace.
 *   - A missing/unapproved workspace is `WORKSPACE_NOT_APPROVED`, never a
 *     silent fallback to home or `userData`.
 *   - Legacy non-chat callers may request an explicitly named legacy context
 *     (current default-roots behaviour) — conversation tools may not.
 *   - Resolution results are cached per conversation+approval revision so
 *     every tool in one batch observes the identical roots.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import { getDefaultWorkspaceRoots } from "@/config/fileToolConfig";
import type {
  ConversationFilesystemContext,
  FilesystemCapability,
  FilesystemPathOperationRequest,
  FilesystemPathOperationResult,
  FilesystemRootCapability,
  FilesystemContextResolution,
} from "@/entityTypes/filesystemContextTypes";

/** Capabilities granted on the approved workspace root. */
const WORKSPACE_CAPABILITIES: ReadonlySet<FilesystemCapability> = new Set([
  "read",
  "write",
  "execute",
  "watch",
]);

function canonicalize(p: string): string {
  try {
    return fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
  } catch {
    return path.resolve(p);
  }
}

/** Windows device / reserved-name / alternate-stream rejection (design §6.3.6). */
function isHostilePathSegment(p: string): boolean {
  if (p.includes("\0")) return true;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(p)) return true;
  // Alternate data streams (Windows): "file.txt:stream"
  if (process.platform === "win32" && /:[^:\\/]+$/.test(p)) return true;
  if (process.platform === "win32") {
    const last = path.basename(p).replace(/\.[^.]*$/, "").toUpperCase();
    const reserved = new Set([
      "CON",
      "PRN",
      "AUX",
      "NUL",
      "COM1",
      "COM2",
      "COM3",
      "COM4",
      "COM5",
      "COM6",
      "COM7",
      "COM8",
      "COM9",
      "LPT1",
      "LPT2",
      "LPT3",
      "LPT4",
      "LPT5",
      "LPT6",
      "LPT7",
      "LPT8",
      "LPT9",
    ]);
    if (reserved.has(last)) return true;
  }
  // Device files anywhere on POSIX
  if (/^\/dev\//.test(p)) return true;
  return false;
}

export class ConversationFilesystemContextService {
  private readonly resolver: WorkspaceResolver;
  /**
   * Cache keyed by conversationId. Cleared wholesale — a per-conversation
   * revision makes stale hits impossible because the same resolver instance
   * re-resolves on approval changes via WorkspaceModule state.
   */
  private readonly cache = new Map<
    string,
    { context: ConversationFilesystemContext; at: number }
  >();
  private static readonly CACHE_TTL_MS = 5_000;

  constructor(resolver: WorkspaceResolver = new WorkspaceResolver()) {
    this.resolver = resolver;
  }

  /**
   * Resolve the immutable filesystem context for a conversation.
   * Fail closed: no approved workspace → `WORKSPACE_NOT_APPROVED`.
   */
  async resolve(
    conversationId: string
  ): Promise<FilesystemContextResolution> {
    if (!conversationId) {
      return {
        ok: false,
        code: "INVALID_CONVERSATION",
        message: "A conversation id is required to resolve a filesystem scope.",
      };
    }

    const cached = this.cache.get(conversationId);
    if (cached && Date.now() - cached.at < ConversationFilesystemContextService.CACHE_TTL_MS) {
      return { ok: true, context: cached.context };
    }

    let rootPath: string;
    let workspaceId: number;
    try {
      const resolved = await this.resolver.resolve(conversationId);
      if (!resolved) {
        return {
          ok: false,
          code: "WORKSPACE_NOT_APPROVED",
          message:
            "No approved workspace for this conversation. Approve a workspace " +
            "before running filesystem or shell tools — the home directory is " +
            "not a substitute.",
        };
      }
      workspaceId = resolved.workspaceId;
      rootPath = resolved.rootPath;
    } catch (err) {
      return {
        ok: false,
        code: "WORKSPACE_RESOLUTION_FAILED",
        message: `Failed to resolve the approved workspace: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    const canonicalRoot = canonicalize(rootPath);
    const workspaceRoot: FilesystemRootCapability = {
      id: `workspace:${workspaceId}`,
      kind: "workspace",
      canonicalPath: canonicalRoot,
      capabilities: WORKSPACE_CAPABILITIES,
    };

    const context: ConversationFilesystemContext = {
      conversationId,
      workspaceId,
      defaultCwd: canonicalRoot,
      workspaceRoot: rootPath,
      canonicalWorkspaceRoot: canonicalRoot,
      roots: [workspaceRoot],
      revision: crypto
        .createHash("sha256")
        .update(`${workspaceId}:${canonicalRoot}`)
        .digest("hex")
        .slice(0, 12),
    };

    this.cache.set(conversationId, { context, at: Date.now() });
    return { ok: true, context };
  }

  /**
   * Explicitly-named legacy context for non-chat callers (design §6.2).
   * Conversation-driven tools MUST NOT use this — it exists so background
   * jobs that pre-date workspace approval keep a working scope.
   */
  legacyContext(owner: string): ConversationFilesystemContext {
    const roots = getDefaultWorkspaceRoots().map(
      (p, i): FilesystemRootCapability => ({
        id: `legacy:${owner}:${i}`,
        kind: "legacy-default",
        canonicalPath: canonicalize(p),
        capabilities: WORKSPACE_CAPABILITIES,
      })
    );
    return {
      conversationId: `legacy:${owner}`,
      workspaceId: -1,
      defaultCwd: roots[0]?.canonicalPath ?? process.cwd(),
      workspaceRoot: roots[0]?.canonicalPath ?? "",
      canonicalWorkspaceRoot: roots[0]?.canonicalPath ?? "",
      roots,
      revision: "legacy",
    };
  }

  /** Drop cached state (used when workspace approval changes). */
  invalidate(conversationId: string): void {
    this.cache.delete(conversationId);
  }
}

/**
 * Capability-aware path policy (design §6.3).
 *
 * Checks the requested path + operation against the roots in a context:
 *   1. normalize separators/drives
 *   2. realpath existing segments (resolve closest existing ancestor for
 *      new paths, then append unresolved segments)
 *   3. reject symlink/junction escape and hostile path shapes
 *   4. platform-appropriate prefix comparison
 *   5. require the operation to be granted by the matched root
 */
export function assertFilesystemPathAllowed(
  request: FilesystemPathOperationRequest
): FilesystemPathOperationResult {
  const { context } = request;
  const raw = request.path;

  if (isHostilePathSegment(raw)) {
    return {
      allowed: false,
      code: "PATH_MALFORMED",
      message: "Path contains null bytes, control characters, or a reserved shape.",
    };
  }

  let resolved: string;
  if (path.isAbsolute(raw)) {
    resolved = path.normalize(raw);
  } else {
    resolved = path.resolve(context.defaultCwd, raw);
  }

  // Resolve the deepest existing ancestor, then append the non-existent tail.
  try {
    if (fs.existsSync(resolved)) {
      resolved = fs.realpathSync(resolved);
    } else {
      const parts = resolved.split(path.sep);
      const tail: string[] = [];
      let probe = resolved;
      while (parts.length > 0 && !fs.existsSync(probe)) {
        tail.unshift(parts.pop() as string);
        probe = parts.length > 0 ? parts.join(path.sep) : path.sep;
        if (probe === "") break;
      }
      if (fs.existsSync(probe)) {
        const realProbe = fs.realpathSync(probe);
        resolved = tail.length > 0 ? path.join(realProbe, ...tail) : realProbe;
      }
    }
  } catch {
    return {
      allowed: false,
      code: "PATH_REALPATH_FAILED",
      message: "Failed to resolve the real path for this request.",
    };
  }

  const caseInsensitive = process.platform === "win32";
  const matches = (
    candidate: string,
    root: string
  ): boolean => {
    const c = caseInsensitive ? candidate.toLowerCase() : candidate;
    const r = caseInsensitive ? root.toLowerCase() : root;
    return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
  };

  for (const root of context.roots) {
    if (!matches(resolved, root.canonicalPath)) continue;
    if (!root.capabilities.has(request.operation)) {
      return {
        allowed: false,
        code: "PATH_CAPABILITY_DENIED",
        message: `Root ${root.id} does not grant the '${request.operation}' capability.`,
      };
    }
    return { allowed: true, resolvedPath: resolved, rootId: root.id };
  }

  return {
    allowed: false,
    code: "PATH_OUTSIDE_ROOTS",
    message: "Path is outside every root granted to this conversation.",
  };
}

/** Process-wide default instance (main process owns one). */
let defaultService: ConversationFilesystemContextService | null = null;

export function getDefaultFilesystemContextService(): ConversationFilesystemContextService {
  if (!defaultService) {
    defaultService = new ConversationFilesystemContextService();
  }
  return defaultService;
}
