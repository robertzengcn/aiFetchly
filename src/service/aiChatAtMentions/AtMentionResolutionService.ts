import * as fs from "fs";
import { isBinaryFile } from "isbinaryfile";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import type { ResolvedWorkspace } from "@/service/WorkspaceResolver";
import { FilePathGuard } from "@/service/FilePathGuard";
import { AtMentionParser } from "./AtMentionParser";
import { AtMentionContextBuilder } from "./AtMentionContextBuilder";
import { normalizePathText } from "./AtMentionPath";
import type { AtMentionWorkspaceLike } from "./AtMentionSuggestionService";
import {
  AT_MENTION_MAX_CONTENT_BYTES_PER_MENTION,
  AT_MENTION_MAX_DIRECTORY_ENTRIES,
  AT_MENTION_MAX_LINE_RANGE_LINES,
  AT_MENTION_MAX_MENTIONS_PER_MESSAGE,
  AT_MENTION_MAX_TOTAL_CONTEXT_BYTES,
} from "./AtMentionLimits";
import type {
  ChatV2AtMentionMetadata,
  ChatV2AtMentionParsed,
  ChatV2AtMentionResolution,
  ChatV2AtMentionResolutionResult,
  ChatV2AtMentionStatus,
} from "@/entityTypes/aiChatAtMentionTypes";

interface ByteBudget {
  remaining: number;
}

/** Mention statuses surfaced as model warnings (mirrors the context builder). */
const WARNING_STATUSES: ReadonlySet<ChatV2AtMentionStatus> = new Set([
  "workspace_required",
  "missing",
  "rejected",
  "invalid_line_range",
  "too_large",
  "binary",
  "read_error",
]);

/**
 * Send-time mention resolution (technical design §9).
 *
 * Re-parses the submitted message, resolves the conversation workspace,
 * validates each mention with FilePathGuard, stats it, and reads bounded
 * content (explicit line ranges) or shallow directory listings only. The
 * original user text is always preserved; the model receives an enriched
 * message with a compact context block.
 *
 * Per-mention failures never abort the whole message: they become metadata
 * statuses (missing / rejected / read_error / ...) and, where useful, model
 * warnings.
 */
export class AtMentionResolutionService {
  constructor(
    private readonly workspaceResolver: AtMentionWorkspaceLike = new WorkspaceResolver(),
    private readonly contextBuilder = new AtMentionContextBuilder(),
    private readonly parser = new AtMentionParser()
  ) {}

  async resolveMessage(
    conversationId: string,
    message: string
  ): Promise<ChatV2AtMentionResolutionResult> {
    const parsed = this.parser.extract(message, {
      maxMentions: AT_MENTION_MAX_MENTIONS_PER_MESSAGE,
    });
    if (parsed.mentions.length === 0) {
      return {
        originalMessage: message,
        modelMessage: message,
        metadata: [],
        warnings: [],
        hasResolvedMentions: false,
      };
    }

    const unique = dedupeByResolvedKey(parsed.mentions);

    let workspace: ResolvedWorkspace | null = null;
    try {
      workspace = await this.workspaceResolver.resolve(conversationId);
    } catch (err) {
      console.error("[at-mention] workspace resolution failed:", err);
      workspace = null;
    }

    const guard = workspace ? new FilePathGuard([workspace.rootPath]) : null;
    const budget: ByteBudget = { remaining: AT_MENTION_MAX_TOTAL_CONTEXT_BYTES };

    const resolutions: ChatV2AtMentionResolution[] = [];
    for (const mention of unique) {
      resolutions.push(await this.resolveOne(mention, workspace, guard, budget));
    }

    const built = this.contextBuilder.build(message, resolutions);
    const metadata = resolutions.map((r) => r.metadata);
    const warnings = metadata.filter((m) => WARNING_STATUSES.has(m.status));
    const hasResolvedMentions = metadata.some((m) => m.status === "resolved");

    return {
      originalMessage: message,
      modelMessage: built.modelMessage,
      metadata,
      warnings,
      hasResolvedMentions,
    };
  }

  private async resolveOne(
    parsed: ChatV2AtMentionParsed,
    workspace: ResolvedWorkspace | null,
    guard: FilePathGuard | null,
    budget: ByteBudget
  ): Promise<ChatV2AtMentionResolution> {
    const baseMetadata: ChatV2AtMentionMetadata = {
      rawText: parsed.rawText,
      relativePath: parsed.pathText,
      lineStart: parsed.lineStart,
      lineEnd: parsed.lineEnd,
      status: "rejected",
    };

    if (parsed.parseError === "invalid_line_range") {
      return {
        parsed,
        metadata: { ...baseMetadata, status: "invalid_line_range" },
      };
    }

    const normalized = normalizePathText(parsed.pathText);
    if (!normalized.ok) {
      return {
        parsed,
        metadata: {
          ...baseMetadata,
          status: "rejected",
          errorCode: normalized.error === "empty" ? "EMPTY" : "MALFORMED_INPUT",
        },
      };
    }

    if (!workspace || !guard) {
      return {
        parsed,
        metadata: { ...baseMetadata, status: "workspace_required" },
      };
    }

    const validation = guard.validate(normalized.path);
    if (!validation.safe) {
      return {
        parsed,
        metadata: {
          ...baseMetadata,
          status: "rejected",
          errorCode: validation.code,
        },
      };
    }

    const absolutePath = validation.resolvedPath;
    const relativePath =
      validation.relativePath ?? normalized.path.replace(/\/+$/, "");

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absolutePath);
    } catch {
      return {
        parsed,
        metadata: { ...baseMetadata, relativePath, status: "missing" },
      };
    }

    if (stat.isDirectory()) {
      return this.resolveDirectory(parsed, absolutePath, relativePath, budget);
    }
    if (!stat.isFile()) {
      return {
        parsed,
        metadata: { ...baseMetadata, relativePath, status: "missing" },
      };
    }
    return this.resolveFile(parsed, absolutePath, relativePath, stat, budget);
  }

  private async resolveDirectory(
    parsed: ChatV2AtMentionParsed,
    absolutePath: string,
    relativePath: string,
    budget: ByteBudget
  ): Promise<ChatV2AtMentionResolution> {
    const baseMetadata: ChatV2AtMentionMetadata = {
      rawText: parsed.rawText,
      relativePath,
      kind: "directory",
      status: "resolved",
    };

    let children: fs.Dirent[];
    try {
      children = await fs.promises.readdir(absolutePath, { withFileTypes: true });
    } catch (err) {
      console.error("[at-mention] directory listing failed:", err);
      return {
        parsed,
        metadata: { ...baseMetadata, status: "read_error" },
        relativePath,
      };
    }

    const named = children
      .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const entries: string[] = [];
    let truncated = false;
    for (const item of named) {
      if (entries.length >= AT_MENTION_MAX_DIRECTORY_ENTRIES) {
        truncated = true;
        break;
      }
      const label = item.isDir ? `${item.name}/` : item.name;
      const cost = label.length + 4;
      if (budget.remaining - cost < 0) {
        truncated = true;
        break;
      }
      entries.push(label);
      budget.remaining -= cost;
    }

    return {
      parsed,
      metadata: { ...baseMetadata, truncated: truncated || undefined },
      relativePath,
      directoryEntriesForModel: entries,
    };
  }

  private async resolveFile(
    parsed: ChatV2AtMentionParsed,
    absolutePath: string,
    relativePath: string,
    stat: fs.Stats,
    budget: ByteBudget
  ): Promise<ChatV2AtMentionResolution> {
    const baseMetadata: ChatV2AtMentionMetadata = {
      rawText: parsed.rawText,
      relativePath,
      kind: "file",
      status: "resolved",
      sizeBytes: stat.size,
      lineStart: parsed.lineStart,
      lineEnd: parsed.lineEnd,
    };

    let binary = false;
    try {
      binary = await isBinaryFile(absolutePath, stat.size);
    } catch (err) {
      console.error("[at-mention] binary detection failed:", err);
      binary = true; // fail safe: do not inject undecodable content
    }
    if (binary) {
      return {
        parsed,
        metadata: { ...baseMetadata, status: "binary" },
        relativePath,
      };
    }

    // No explicit line range → reference only (Decision 2: no full-file injection in MVP).
    if (!parsed.lineStart) {
      return { parsed, metadata: baseMetadata, relativePath };
    }

    let body: string;
    try {
      body = await fs.promises.readFile(absolutePath, "utf8");
    } catch (err) {
      console.error("[at-mention] file read failed:", err);
      return {
        parsed,
        metadata: { ...baseMetadata, status: "read_error" },
        relativePath,
      };
    }

    const allLines = body.split("\n");
    const start = Math.max(1, Math.min(parsed.lineStart, allLines.length));
    let end = parsed.lineEnd ?? start;
    end = Math.min(end, start + AT_MENTION_MAX_LINE_RANGE_LINES - 1);
    end = Math.min(end, allLines.length);

    const formatted: string[] = [];
    let truncated = false;
    for (let i = start; i <= end; i++) {
      const line = `${i}: ${allLines[i - 1] ?? ""}`;
      const cost = line.length + 1;
      if (bytesWouldExceed(cost, AT_MENTION_MAX_CONTENT_BYTES_PER_MENTION, formatted) ||
          budget.remaining - cost < 0) {
        truncated = true;
        break;
      }
      formatted.push(line);
      budget.remaining -= cost;
    }
    if (start <= end && formatted.length === 0) {
      truncated = true;
    }

    const actualEnd =
      formatted.length > 0 ? start + formatted.length - 1 : parsed.lineEnd;
    return {
      parsed,
      metadata: {
        ...baseMetadata,
        lineStart: start,
        lineEnd: actualEnd,
        truncated: truncated || undefined,
      },
      relativePath,
      contentForModel: formatted.join("\n"),
    };
  }
}

function bytesWouldExceed(
  cost: number,
  perMentionBudget: number,
  formatted: string[]
): boolean {
  let used = 0;
  for (const line of formatted) used += line.length + 1;
  return used + cost > perMentionBudget;
}

function dedupeByResolvedKey(
  mentions: readonly ChatV2AtMentionParsed[]
): ChatV2AtMentionParsed[] {
  const seen = new Set<string>();
  const result: ChatV2AtMentionParsed[] = [];
  for (const m of mentions) {
    const normalized = normalizePathText(m.pathText);
    const keyPath = normalized.ok ? normalized.path : m.pathText;
    const key = `${keyPath}|${m.lineStart ?? ""}|${m.lineEnd ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(m);
  }
  return result;
}
