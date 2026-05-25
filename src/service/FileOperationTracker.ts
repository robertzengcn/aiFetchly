import { v4 as uuidv4 } from "uuid";
import type { WebContents } from "electron";
import { AI_FILE_OPERATION } from "@/config/channellist";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";

/** Maximum number of records stored per conversation (D-04) */
const MAX_RECORDS_PER_CONVERSATION = 500;

/**
 * Static service that emits file operation records to the renderer via IPC.
 * Designed so that emit() failures NEVER propagate to callers (D-06).
 * Follows the RateLimiterManager static class pattern (D-05).
 */
export class FileOperationTracker {
  private static webContents: WebContents | null = null;
  private static readonly records = new Map<string, FileOperationRecord[]>();

  /**
   * Set the webContents reference for IPC communication.
   * Called after BrowserWindow creation in background.ts (D-03).
   */
  static setWebContents(wc: WebContents): void {
    FileOperationTracker.webContents = wc;
  }

  /**
   * Clear the webContents reference and all stored records.
   * Called on window close event (D-03).
   */
  static clear(): void {
    FileOperationTracker.webContents = null;
    FileOperationTracker.records.clear();
  }

  /**
   * Emit a file operation record to the renderer.
   * Auto-generates id (D-01) and timestamp (D-11).
   * Caller provides all other fields.
   * Failures are caught -- tracking must never break tool execution (D-06).
   */
  static emit(
    record: Omit<FileOperationRecord, "id" | "timestamp">
  ): void {
    try {
      const fullRecord: FileOperationRecord = {
        ...record,
        id: uuidv4(),
        timestamp: Date.now(),
      };

      // Store in memory with cap (D-04)
      const conversationId = record.conversationId;
      const existing = FileOperationTracker.records.get(conversationId) ?? [];
      existing.push(fullRecord);
      if (existing.length > MAX_RECORDS_PER_CONVERSATION) {
        existing.shift(); // Evict oldest
      }
      FileOperationTracker.records.set(conversationId, existing);

      // Send to renderer if webContents is alive (D-07)
      if (
        FileOperationTracker.webContents &&
        !FileOperationTracker.webContents.isDestroyed()
      ) {
        FileOperationTracker.webContents.send(
          AI_FILE_OPERATION,
          fullRecord
        );
      }
    } catch {
      // Intentionally silent -- tracking must never break tool execution (D-06)
    }
  }

  /**
   * Get all stored records for a conversation.
   * Returns a readonly array to prevent external mutation.
   * Useful for Phase 7 frontend badge rendering.
   */
  static getRecords(conversationId: string): readonly FileOperationRecord[] {
    return FileOperationTracker.records.get(conversationId) ?? [];
  }
}
