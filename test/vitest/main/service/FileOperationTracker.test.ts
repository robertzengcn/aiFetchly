"use strict";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { FileOperationTracker } from "@/service/FileOperationTracker";
import { AI_FILE_OPERATION } from "@/config/channellist";

// Mock uuid to control ID generation in tests
vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-00000000-0000-0000-0000-000000000001"),
}));

/**
 * Create a mock WebContents with vitest spies.
 * Returns the mock object with extra control methods for test assertions.
 */
function createMockWebContents() {
  const sendFn = vi.fn();
  const isDestroyedFn = vi.fn(() => false);

  return {
    /** The mock object to pass to setWebContents (typed as electron WebContents) */
    webContents: {
      send: sendFn,
      isDestroyed: isDestroyedFn,
    } as unknown as import("electron").WebContents,
    /** Vitest spies for assertions */
    spies: {
      send: sendFn,
      isDestroyed: isDestroyedFn,
    },
  };
}

describe("FileOperationTracker", () => {
  beforeEach(() => {
    FileOperationTracker.clear();
  });

  describe("AI_FILE_OPERATION constant", () => {
    test('has value "ai-chat:file-operation"', () => {
      expect(AI_FILE_OPERATION).toBe("ai-chat:file-operation");
    });
  });

  describe("emit()", () => {
    test("sends to live webContents with AI_FILE_OPERATION channel", () => {
      const { webContents, spies } = createMockWebContents();
      FileOperationTracker.setWebContents(webContents);

      FileOperationTracker.emit({
        type: "create",
        filePath: "/test/file.ts",
        success: true,
        conversationId: "conv-1",
        skillName: "file_write",
      });

      expect(spies.send).toHaveBeenCalledTimes(1);
      expect(spies.send).toHaveBeenCalledWith(
        AI_FILE_OPERATION,
        expect.objectContaining({
          id: "test-uuid-00000000-0000-0000-0000-000000000001",
          type: "create",
          filePath: "/test/file.ts",
          success: true,
          conversationId: "conv-1",
          skillName: "file_write",
        })
      );
    });

    test("does not throw when webContents is null", () => {
      FileOperationTracker.clear();

      expect(() => {
        FileOperationTracker.emit({
          type: "create",
          filePath: "/test/file.ts",
          success: true,
          conversationId: "conv-1",
          skillName: "file_write",
        });
      }).not.toThrow();
    });

    test("does not throw when webContents is destroyed", () => {
      const { webContents, spies } = createMockWebContents();
      spies.isDestroyed.mockReturnValue(true);
      FileOperationTracker.setWebContents(webContents);

      expect(() => {
        FileOperationTracker.emit({
          type: "create",
          filePath: "/test/file.ts",
          success: true,
          conversationId: "conv-1",
          skillName: "file_write",
        });
      }).not.toThrow();

      expect(spies.send).not.toHaveBeenCalled();
    });

    test("does not throw when send() throws synchronously", () => {
      const { webContents, spies } = createMockWebContents();
      spies.send.mockImplementation(() => {
        throw new Error("IPC send failed");
      });
      FileOperationTracker.setWebContents(webContents);

      expect(() => {
        FileOperationTracker.emit({
          type: "create",
          filePath: "/test/file.ts",
          success: true,
          conversationId: "conv-1",
          skillName: "file_write",
        });
      }).not.toThrow();
    });

    test("auto-generates UUID id and Date.now() timestamp", () => {
      const { webContents, spies } = createMockWebContents();
      FileOperationTracker.setWebContents(webContents);

      const beforeEmit = Date.now();
      FileOperationTracker.emit({
        type: "edit",
        filePath: "/test/file.ts",
        success: true,
        conversationId: "conv-1",
        skillName: "file_edit",
        linesChanged: 5,
      });
      const afterEmit = Date.now();

      // Verify the sent record has auto-generated id and timestamp
      expect(spies.send).toHaveBeenCalledWith(
        AI_FILE_OPERATION,
        expect.objectContaining({
          id: "test-uuid-00000000-0000-0000-0000-000000000001",
          timestamp: expect.any(Number),
        })
      );
      // Extract the call to verify timestamp range
      const sentRecord = spies.send.mock.calls[0][1] as {
        id: string;
        timestamp: number;
      };
      // Verify id is a non-empty string (auto-generated)
      expect(typeof sentRecord.id).toBe("string");
      expect(sentRecord.id.length).toBeGreaterThan(0);
      // Verify timestamp is within reasonable range
      expect(sentRecord.timestamp).toBeGreaterThanOrEqual(beforeEmit);
      expect(sentRecord.timestamp).toBeLessThanOrEqual(afterEmit);
    });

    test("stores records per conversationId", () => {
      FileOperationTracker.emit({
        type: "create",
        filePath: "/test/file1.ts",
        success: true,
        conversationId: "conv-1",
        skillName: "file_write",
      });

      FileOperationTracker.emit({
        type: "edit",
        filePath: "/test/file2.ts",
        success: true,
        conversationId: "conv-1",
        skillName: "file_edit",
      });

      const records = FileOperationTracker.getRecords("conv-1");
      expect(records).toHaveLength(2);
      expect(records[0].filePath).toBe("/test/file1.ts");
      expect(records[1].filePath).toBe("/test/file2.ts");
    });

    test("enforces 500-record cap per conversation, evicting oldest first", () => {
      const { webContents } = createMockWebContents();
      FileOperationTracker.setWebContents(webContents);

      // Emit 501 records for the same conversation
      for (let i = 0; i < 501; i++) {
        FileOperationTracker.emit({
          type: "create",
          filePath: `/test/file-${i}.ts`,
          success: true,
          conversationId: "conv-1",
          skillName: "file_write",
        });
      }

      const records = FileOperationTracker.getRecords("conv-1");
      expect(records).toHaveLength(500);
      // The first record emitted (file-0) should have been evicted
      // So the oldest remaining record should be file-1
      expect(records[0].filePath).toBe("/test/file-1.ts");
      // The newest record should be file-500
      expect(records[499].filePath).toBe("/test/file-500.ts");
    });
  });

  describe("getRecords()", () => {
    test("returns empty array for unknown conversationId", () => {
      const result = FileOperationTracker.getRecords("nonexistent");
      expect(result).toEqual([]);
    });

    test("returns stored records for known conversationId", () => {
      FileOperationTracker.emit({
        type: "create",
        filePath: "/test/file.ts",
        success: true,
        conversationId: "conv-1",
        skillName: "file_write",
      });

      const records = FileOperationTracker.getRecords("conv-1");
      expect(records).toHaveLength(1);
      expect(records[0].filePath).toBe("/test/file.ts");
      expect(records[0].type).toBe("create");
    });
  });

  describe("clear()", () => {
    test("resets webContents to null and empties the records Map", () => {
      const { webContents } = createMockWebContents();
      FileOperationTracker.setWebContents(webContents);

      FileOperationTracker.emit({
        type: "create",
        filePath: "/test/file.ts",
        success: true,
        conversationId: "conv-1",
        skillName: "file_write",
      });

      // Verify data was stored
      expect(FileOperationTracker.getRecords("conv-1")).toHaveLength(1);

      // Clear
      FileOperationTracker.clear();

      // Records are gone
      expect(FileOperationTracker.getRecords("conv-1")).toEqual([]);

      // Emit after clear does not throw (webContents is null)
      expect(() => {
        FileOperationTracker.emit({
          type: "create",
          filePath: "/test/file2.ts",
          success: true,
          conversationId: "conv-1",
          skillName: "file_write",
        });
      }).not.toThrow();
    });
  });
});
