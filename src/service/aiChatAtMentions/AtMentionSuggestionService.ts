import fg from "fast-glob";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import type { ResolvedWorkspace } from "@/service/WorkspaceResolver";
import { AtMentionRankingService } from "./AtMentionRankingService";
import { buildDisplayText, buildInsertText, escapeGlob } from "./AtMentionPath";
import {
  AT_MENTION_IGNORE_PATTERNS,
  AT_MENTION_MAX_QUERY_CHARS,
  AT_MENTION_MAX_SUGGESTIONS,
} from "./AtMentionLimits";
import type {
  ChatV2AtMentionKind,
  ChatV2AtMentionSuggestionRequest,
  ChatV2AtMentionSuggestionResponse,
  ChatV2AtMentionSuggestionView,
} from "@/entityTypes/aiChatAtMentionTypes";

/** Workspace resolver surface used by the suggestion service (injectable). */
export interface AtMentionWorkspaceLike {
  resolve(conversationId: string): Promise<ResolvedWorkspace | null>;
}

interface MentionCandidate {
  readonly relativePath: string;
  readonly kind: ChatV2AtMentionKind;
}

function emptyWorkspaceRequired(): ChatV2AtMentionSuggestionResponse {
  return { suggestions: [], workspaceRequired: true, truncated: false };
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return AT_MENTION_MAX_SUGGESTIONS;
  }
  const rounded = Math.round(limit);
  if (rounded < 1) return 1;
  if (rounded > AT_MENTION_MAX_SUGGESTIONS) return AT_MENTION_MAX_SUGGESTIONS;
  return rounded;
}

function sanitizeQuery(query: string): string {
  return query.slice(0, AT_MENTION_MAX_QUERY_CHARS).trim();
}

/** Build prefix-first glob patterns from a (already sanitized) query. */
function buildSuggestionPatterns(query: string): string[] {
  const raw = query.replace(/\/+$/, "");
  if (!raw) return ["*"];
  const q = escapeGlob(raw);
  return [`${q}*`, `${q}*/**`, `**/${q}*`, `**/*${q}*`];
}

/** Defense-in-depth filter: reject absolute or traversal-relative paths. */
function isSafeRelative(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith("/")) return false;
  const segments = relativePath.split("/");
  if (segments.some((seg) => seg === "..")) return false;
  return true;
}

/**
 * Workspace-scoped @-mention suggestion lookup (technical design §8).
 *
 * Main-process only. Resolves the active approved workspace via
 * WorkspaceResolver, searches it with fast-glob (symlinks not followed),
 * ranks the results, and returns renderer-safe suggestion views.
 *
 * Never reads file content, never returns absolute paths, and fails closed
 * (workspaceRequired) when there is no approved workspace.
 */
export class AtMentionSuggestionService {
  constructor(
    private readonly workspaceResolver: AtMentionWorkspaceLike = new WorkspaceResolver(),
    private readonly ranking = new AtMentionRankingService()
  ) {}

  async suggest(
    request: ChatV2AtMentionSuggestionRequest
  ): Promise<ChatV2AtMentionSuggestionResponse> {
    const limit = clampLimit(request.limit);

    if (!request.conversationId) {
      return emptyWorkspaceRequired();
    }

    const workspace = await this.workspaceResolver.resolve(
      request.conversationId
    );
    if (!workspace) {
      return emptyWorkspaceRequired();
    }

    const query = sanitizeQuery(request.query);
    const patterns = buildSuggestionPatterns(query);

    let entries: string[] = [];
    try {
      entries = await fg(patterns, {
        cwd: workspace.rootPath,
        dot: false,
        onlyFiles: false,
        markDirectories: true,
        followSymbolicLinks: false,
        unique: true,
        ignore: [...AT_MENTION_IGNORE_PATTERNS],
        suppressErrors: true,
        stats: false,
        deep: 30,
      });
    } catch (err) {
      console.error("[at-mention] suggestion search failed:", err);
      return { suggestions: [], workspaceRequired: false, truncated: false };
    }

    const candidates: MentionCandidate[] = entries
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .map((p) => {
        const isDirectory = p.endsWith("/");
        const relativePath = isDirectory ? p.slice(0, -1) : p;
        const kind: ChatV2AtMentionKind = isDirectory ? "directory" : "file";
        return { relativePath, kind };
      })
      .filter((c) => isSafeRelative(c.relativePath));

    const ranked = this.ranking.rank(query, candidates, limit);

    const suggestions: ChatV2AtMentionSuggestionView[] = ranked.map((c) => ({
      id: `${c.kind}:${c.relativePath}`,
      displayText: buildDisplayText(c.relativePath, c.kind),
      insertText: buildInsertText(c.relativePath, c.kind),
      relativePath: c.relativePath,
      kind: c.kind,
    }));

    return {
      suggestions,
      workspaceRequired: false,
      truncated: candidates.length > ranked.length,
    };
  }
}
