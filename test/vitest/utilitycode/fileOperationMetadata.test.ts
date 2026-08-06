/**
 * Tests for rebuilding the AI chat file-ops panel from persisted history.
 * Mirrors the artifactMetadata history-reopen regression coverage.
 */
import { describe, it, expect } from "vitest";
import {
  extractFileOperationFromMessage,
  extractFileOperationsFromMessages,
  mergeFileOperationRecords,
  resolveFileOperationPath,
  resolveOpenableFilePath,
  type MessageWithMaybeFileToolResult,
} from "@/views/components/aiChatV2/fileOperationMetadata";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";

function toolResultMessage(
  overrides: Partial<MessageWithMaybeFileToolResult> & {
    toolName?: string;
    toolResult?: Record<string, unknown>;
    toolArguments?: Record<string, unknown>;
    toolCallId?: string;
  }
): MessageWithMaybeFileToolResult {
  const { toolName, toolResult, toolArguments, toolCallId, metadata, ...rest } =
    overrides;
  return {
    id: "msg-1",
    conversationId: "v2-conv",
    timestamp: "2026-01-02T03:04:05.000Z",
    messageType: "tool_result",
    metadata: {
      toolName: toolName ?? "file_write",
      toolCallId: toolCallId ?? "call-1",
      toolResult: toolResult ?? {
        success: true,
        path: "/tmp/created.md",
        mode: "created",
        bytesWritten: 12,
      },
      ...(toolArguments ? { toolArguments } : {}),
      ...metadata,
    },
    ...rest,
  };
}

describe("resolveFileOperationPath", () => {
  it("keeps absolute POSIX and Windows paths", () => {
    expect(resolveFileOperationPath("/tmp/a.md")).toBe("/tmp/a.md");
    expect(resolveFileOperationPath("C:\\Users\\a\\b.txt")).toBe(
      "C:\\Users\\a\\b.txt"
    );
    expect(resolveFileOperationPath("\\\\wsl$\\Ubuntu\\home\\x")).toBe(
      "\\\\wsl$\\Ubuntu\\home\\x"
    );
  });

  it("joins relative paths to workspace root", () => {
    expect(resolveFileOperationPath("notes/a.md", "/Users/me/proj")).toBe(
      "/Users/me/proj/notes/a.md"
    );
    expect(resolveFileOperationPath("notes\\a.md", "C:\\proj")).toBe(
      "C:\\proj\\notes\\a.md"
    );
  });
});

describe("resolveOpenableFilePath", () => {
  it("returns absolute filePath unchanged", () => {
    expect(
      resolveOpenableFilePath({
        filePath: "/tmp/a.md",
        workspaceRoot: "/workspace",
      })
    ).toBe("/tmp/a.md");
  });

  it("joins relative history paths with workspace root for AI_FILE_OPEN", () => {
    expect(
      resolveOpenableFilePath(
        {
          filePath: "notes/a.md",
          relativePath: "notes/a.md",
          workspaceRoot: undefined,
        },
        "/Users/me/proj"
      )
    ).toBe("/Users/me/proj/notes/a.md");
  });

  it("prefers record.workspaceRoot over the UI fallback", () => {
    expect(
      resolveOpenableFilePath(
        {
          filePath: "a.md",
          workspaceRoot: "/from-record",
        },
        "/from-ui"
      )
    ).toBe("/from-record/a.md");
  });
});

describe("extractFileOperationFromMessage", () => {
  it("rebuilds a create record from file_write tool_result history", () => {
    const record = extractFileOperationFromMessage(
      toolResultMessage({}),
      "v2-conv"
    );
    expect(record).toMatchObject({
      type: "create",
      filePath: "/tmp/created.md",
      success: true,
      skillName: "file_write",
      sizeBytes: 12,
      toolCallId: "call-1",
      conversationId: "v2-conv",
    });
    expect(record?.timestamp).toBe(Date.parse("2026-01-02T03:04:05.000Z"));
  });

  it("maps file_write overwritten mode and file_edit to the right types", () => {
    expect(
      extractFileOperationFromMessage(
        toolResultMessage({
          toolResult: {
            success: true,
            path: "/tmp/a.md",
            mode: "overwritten",
            bytesWritten: 1,
          },
        }),
        "v2-conv"
      )?.type
    ).toBe("overwrite");

    expect(
      extractFileOperationFromMessage(
        toolResultMessage({
          toolName: "file_edit",
          toolResult: {
            success: true,
            path: "/tmp/a.md",
            replacements: 2,
            diff: "@@",
          },
        }),
        "v2-conv"
      )
    ).toMatchObject({
      type: "edit",
      linesChanged: 2,
      diff: "@@",
    });
  });

  it("falls back to toolArguments.path when toolResult lacks path", () => {
    const record = extractFileOperationFromMessage(
      toolResultMessage({
        toolResult: { success: false, error: "denied" },
        toolArguments: { path: "rel/file.md" },
      }),
      "v2-conv",
      "/workspace"
    );
    expect(record).toMatchObject({
      filePath: "/workspace/rel/file.md",
      success: false,
      error: "denied",
      relativePath: "rel/file.md",
      workspaceRoot: "/workspace",
    });
  });

  it("returns null for non file-mutation tool results", () => {
    expect(
      extractFileOperationFromMessage(
        toolResultMessage({ toolName: "file_read" }),
        "v2-conv"
      )
    ).toBeNull();
    expect(
      extractFileOperationFromMessage(
        { messageType: "assistant", metadata: { toolName: "file_write" } },
        "v2-conv"
      )
    ).toBeNull();
  });
});

describe("extractFileOperationsFromMessages (history reopen)", () => {
  it("collects all file mutation records from a conversation", () => {
    const records = extractFileOperationsFromMessages(
      [
        toolResultMessage({
          id: "m1",
          toolCallId: "c1",
          toolResult: {
            success: true,
            path: "/a.md",
            mode: "created",
            bytesWritten: 1,
          },
        }),
        {
          messageType: "assistant",
          content: "ok",
        } as MessageWithMaybeFileToolResult,
        toolResultMessage({
          id: "m2",
          toolCallId: "c2",
          toolName: "file_edit",
          toolResult: { success: true, path: "/a.md", replacements: 1 },
        }),
      ],
      "v2-conv"
    );
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.type)).toEqual(["create", "edit"]);
  });
});

describe("mergeFileOperationRecords", () => {
  it("lets live IPC records win over history for the same toolCallId", () => {
    const history: FileOperationRecord = {
      id: "hist",
      type: "create",
      filePath: "relative.md",
      timestamp: 1,
      success: true,
      conversationId: "v2-conv",
      skillName: "file_write",
      toolCallId: "call-9",
    };
    const live: FileOperationRecord = {
      id: "live",
      type: "create",
      filePath: "/abs/relative.md",
      timestamp: 2,
      success: true,
      conversationId: "v2-conv",
      skillName: "file_write",
      toolCallId: "call-9",
    };
    const merged = mergeFileOperationRecords([live], [history]);
    expect(merged).toHaveLength(1);
    expect(merged[0].filePath).toBe("/abs/relative.md");
    expect(merged[0].id).toBe("live");
  });
});
