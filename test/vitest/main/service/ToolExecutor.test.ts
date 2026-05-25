"use strict";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolExecutor } from "@/service/ToolExecutor";
import { FileOperationTracker } from "@/service/FileOperationTracker";

// Mock FileToolService to avoid real file operations
const mockFileToolExecute = vi.fn();

// Spy on FileOperationTracker.emit
let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Reset all mocks before each test
  mockFileToolExecute.mockReset();

  // Spy on FileOperationTracker.emit (suppress actual emission)
  emitSpy = vi.spyOn(FileOperationTracker, "emit").mockImplementation(() => {
    /* suppress emission in tests */
  });
});

afterEach(() => {
  emitSpy.mockRestore();
});

/**
 * Helper: call ToolExecutor.execute with a mocked FileToolService.
 * We access the private getFileToolService via the class prototype
 * and replace it to return our mock.
 */
async function executeWithMock(
  toolName: string,
  toolParams: Record<string, unknown>,
  conversationId: string,
  result: Record<string, unknown>
): Promise<Record<string, unknown>> {
  mockFileToolExecute.mockResolvedValueOnce(result);

  // Spy on the private static getFileToolService to return our mock
  const getServiceSpy = vi
    .spyOn(
      ToolExecutor as unknown as {
        getFileToolService: () => { execute: typeof mockFileToolExecute };
      },
      "getFileToolService"
    )
    .mockReturnValue({
      execute: mockFileToolExecute,
    });

  try {
    const returnValue = await ToolExecutor.execute(
      toolName,
      toolParams,
      conversationId
    );
    return returnValue;
  } finally {
    getServiceSpy.mockRestore();
  }
}

/**
 * Helper: call ToolExecutor.execute expecting an error from FileToolService.
 */
async function executeWithMockError(
  toolName: string,
  toolParams: Record<string, unknown>,
  conversationId: string,
  error: Error
): Promise<void> {
  mockFileToolExecute.mockRejectedValueOnce(error);

  const getServiceSpy = vi
    .spyOn(
      ToolExecutor as unknown as {
        getFileToolService: () => { execute: typeof mockFileToolExecute };
      },
      "getFileToolService"
    )
    .mockReturnValue({
      execute: mockFileToolExecute,
    });

  try {
    await ToolExecutor.execute(toolName, toolParams, conversationId);
  } finally {
    getServiceSpy.mockRestore();
  }
}

describe("ToolExecutor file operation tracking", () => {
  // EXEC-01: conversationId threaded through
  test("EXEC-01: threads conversationId to emitted record", async () => {
    await executeWithMock(
      "file_write",
      { path: "/test/new-file.ts", content: "hello" },
      "conv-123",
      {
        success: true,
        path: "/test/new-file.ts",
        mode: "created",
        bytesWritten: 5,
      }
    );

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const emittedRecord = emitSpy.mock.calls[0][0];
    expect(emittedRecord.conversationId).toBe("conv-123");
  });

  // EXEC-02: file_write maps mode to create/overwrite
  test('EXEC-02: file_write with mode "created" emits type "create"', async () => {
    await executeWithMock(
      "file_write",
      { path: "/test/new-file.ts", content: "hello" },
      "conv-1",
      {
        success: true,
        path: "/test/new-file.ts",
        mode: "created",
        bytesWritten: 5,
      }
    );

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.mock.calls[0][0].type).toBe("create");
  });

  test('EXEC-02: file_write with mode "overwritten" emits type "overwrite"', async () => {
    await executeWithMock(
      "file_write",
      { path: "/test/existing-file.ts", content: "updated" },
      "conv-1",
      {
        success: true,
        path: "/test/existing-file.ts",
        mode: "overwritten",
        bytesWritten: 7,
      }
    );

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.mock.calls[0][0].type).toBe("overwrite");
  });

  // EXEC-03: file_edit emits edit with linesChanged
  test('EXEC-03: file_edit emits type "edit" with linesChanged from replacements', async () => {
    await executeWithMock(
      "file_edit",
      { path: "/test/file.ts", old_text: "foo", new_text: "bar" },
      "conv-1",
      { success: true, path: "/test/file.ts", replacements: 3 }
    );

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const emittedRecord = emitSpy.mock.calls[0][0];
    expect(emittedRecord.type).toBe("edit");
    expect(emittedRecord.linesChanged).toBe(3);
  });

  // EXEC-04: error cases emit failure records
  test("EXEC-04: file_write failure emits record with success=false and error message", async () => {
    await expect(
      executeWithMockError(
        "file_write",
        { path: "/test/protected.ts", content: "hack" },
        "conv-1",
        new Error("permission denied")
      )
    ).rejects.toThrow("permission denied");

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const emittedRecord = emitSpy.mock.calls[0][0];
    expect(emittedRecord.success).toBe(false);
    expect(emittedRecord.error).toContain("permission denied");
  });

  // EXEC-05: read-only tools produce no records
  test("EXEC-05: file_read does not emit any record", async () => {
    await executeWithMock("file_read", { path: "/test/file.ts" }, "conv-1", {
      success: true,
      path: "/test/file.ts",
      content: "file contents",
    });

    expect(emitSpy).not.toHaveBeenCalled();
  });

  test("EXEC-05: glob_files does not emit any record", async () => {
    await executeWithMock("glob_files", { pattern: "**/*.ts" }, "conv-1", {
      success: true,
      files: ["/test/a.ts", "/test/b.ts"],
    });

    expect(emitSpy).not.toHaveBeenCalled();
  });

  test("EXEC-05: grep_files does not emit any record", async () => {
    await executeWithMock(
      "grep_files",
      { pattern: "TODO", path: "/test" },
      "conv-1",
      { success: true, matches: [] }
    );

    expect(emitSpy).not.toHaveBeenCalled();
  });

  // EXEC-06: original behavior preserved
  test("EXEC-06: file_write returns the exact result object from FileToolService", async () => {
    const originalResult = {
      success: true,
      path: "/test/file.ts",
      mode: "created" as const,
      bytesWritten: 10,
    };

    const returnValue = await executeWithMock(
      "file_write",
      { path: "/test/file.ts", content: "hello" },
      "conv-1",
      originalResult
    );

    // Same reference — no wrapping or transformation
    expect(returnValue).toBe(originalResult);
  });

  test("EXEC-06: file_edit error is re-thrown after emitting failure record", async () => {
    const error = new Error("edit failed");
    await expect(
      executeWithMockError(
        "file_edit",
        { path: "/test/file.ts", old_text: "a", new_text: "b" },
        "conv-1",
        error
      )
    ).rejects.toThrow("edit failed");

    // Failure record was emitted before re-throw
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.mock.calls[0][0].success).toBe(false);
  });
});
