import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";
import type { FileOperationType } from "@/entityTypes/fileOperationTypes";

/** Minimal message shape needed to rebuild file-op chips from chat history. */
export interface MessageWithMaybeFileToolResult {
  id?: string;
  conversationId?: string;
  timestamp?: string;
  messageType?: unknown;
  metadata?: {
    toolCallId?: string;
    toolName?: string;
    toolArguments?: Record<string, unknown>;
    toolResult?: Record<string, unknown>;
  };
}

const FILE_MUTATION_TOOLS = new Set(["file_write", "file_edit"]);

function isAbsoluteFilePath(filePath: string): boolean {
  return (
    filePath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(filePath) ||
    filePath.startsWith("\\\\")
  );
}

export { isAbsoluteFilePath };

/**
 * Resolve a tool path against an optional workspace root so Open With can
 * receive an absolute path after history reopen.
 */
export function resolveFileOperationPath(
  filePath: string,
  workspaceRoot?: string | null
): string {
  const trimmed = filePath.trim();
  if (!trimmed || isAbsoluteFilePath(trimmed) || !workspaceRoot) {
    return trimmed;
  }
  const root = workspaceRoot.replace(/[/\\]+$/, "");
  const sep = workspaceRoot.includes("\\") ? "\\" : "/";
  return `${root}${sep}${trimmed.replace(/^[/\\]+/, "")}`;
}

/**
 * Build an absolute path suitable for AI_FILE_OPEN from a file-op record.
 * Prefers workspaceRoot on the record, then an optional UI fallback root.
 */
export function resolveOpenableFilePath(
  record: Pick<
    FileOperationRecord,
    "filePath" | "workspaceRoot" | "relativePath"
  >,
  workspaceRootFallback?: string | null
): string {
  const root = record.workspaceRoot ?? workspaceRootFallback ?? null;
  if (isAbsoluteFilePath(record.filePath)) {
    return record.filePath;
  }
  const candidate = record.relativePath || record.filePath;
  return resolveFileOperationPath(candidate, root);
}

function readStringField(
  source: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!source) return undefined;
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function operationTypeForTool(
  toolName: string,
  toolResult: Record<string, unknown> | undefined
): FileOperationType {
  if (toolName === "file_edit") return "edit";
  const mode = toolResult?.mode;
  return mode === "created" ? "create" : "overwrite";
}

/**
 * Rebuild one FileOperationRecord from a persisted tool_result message.
 * Returns null when the message is not a file mutation tool result.
 */
export function extractFileOperationFromMessage(
  message: MessageWithMaybeFileToolResult,
  conversationId: string,
  workspaceRoot?: string | null
): FileOperationRecord | null {
  if (message.messageType !== "tool_result") return null;
  const meta = message.metadata;
  const toolName = meta?.toolName;
  if (!toolName || !FILE_MUTATION_TOOLS.has(toolName)) return null;

  const toolResult =
    meta?.toolResult && typeof meta.toolResult === "object"
      ? meta.toolResult
      : undefined;
  const toolArguments =
    meta?.toolArguments && typeof meta.toolArguments === "object"
      ? meta.toolArguments
      : undefined;

  const rawPath =
    readStringField(toolResult, "path") ??
    readStringField(toolArguments, "path");
  if (!rawPath) return null;

  const filePath = resolveFileOperationPath(rawPath, workspaceRoot);
  const timestampMs = Date.parse(message.timestamp ?? "");
  const success = toolResult?.success !== false;
  const error =
    typeof toolResult?.error === "string" ? toolResult.error : undefined;
  const linesChanged =
    typeof toolResult?.replacements === "number"
      ? toolResult.replacements
      : undefined;
  const sizeBytes =
    typeof toolResult?.bytesWritten === "number"
      ? toolResult.bytesWritten
      : undefined;
  const diff =
    typeof toolResult?.diff === "string" ? toolResult.diff : undefined;

  const record: FileOperationRecord = {
    id: `history-file-op-${message.id ?? meta?.toolCallId ?? filePath}`,
    type: operationTypeForTool(toolName, toolResult),
    filePath,
    timestamp: Number.isNaN(timestampMs) ? 0 : timestampMs,
    success,
    conversationId: message.conversationId || conversationId,
    skillName: toolName,
    ...(meta?.toolCallId ? { toolCallId: meta.toolCallId } : {}),
    ...(linesChanged !== undefined ? { linesChanged } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(error ? { error } : {}),
    ...(diff ? { diff } : {}),
    ...(workspaceRoot
      ? {
          workspaceRoot,
          relativePath: isAbsoluteFilePath(rawPath)
            ? undefined
            : rawPath.replace(/^[/\\]+/, ""),
        }
      : {}),
  };
  return record;
}

function recordDedupeKey(record: FileOperationRecord): string {
  if (record.toolCallId) return `tc:${record.toolCallId}`;
  return `${record.type}:${record.filePath}`;
}

/**
 * Merge live IPC records with history-derived records.
 * Live records win on key collision (richer absolute paths / diffs).
 */
export function mergeFileOperationRecords(
  live: readonly FileOperationRecord[],
  fromHistory: readonly FileOperationRecord[]
): FileOperationRecord[] {
  const byKey = new Map<string, FileOperationRecord>();
  for (const record of fromHistory) {
    byKey.set(recordDedupeKey(record), record);
  }
  for (const record of live) {
    byKey.set(recordDedupeKey(record), record);
  }
  return [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Extract all file mutation records from a conversation's message list.
 * Used when reopening chat history so the bottom file-ops panel reappears.
 */
export function extractFileOperationsFromMessages(
  messages: readonly MessageWithMaybeFileToolResult[],
  conversationId: string,
  workspaceRoot?: string | null
): FileOperationRecord[] {
  const records: FileOperationRecord[] = [];
  for (const message of messages) {
    const record = extractFileOperationFromMessage(
      message,
      conversationId,
      workspaceRoot
    );
    if (record) records.push(record);
  }
  return mergeFileOperationRecords([], records);
}
