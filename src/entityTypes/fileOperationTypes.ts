/**
 * Type definitions for AI Chat File Operation Recording.
 * Tracks write-like file mutations performed by AI chat skills.
 */

/**
 * Types of file mutations tracked by FileOperationTracker.
 * Only write-like operations are recorded (no reads).
 * Per D-09.
 */
export type FileOperationType = "create" | "overwrite" | "edit";

/**
 * Immutable record of a single file mutation performed by an AI chat skill.
 * All fields are readonly per project immutability standards (D-08).
 */
export interface FileOperationRecord {
  /** Unique identifier (UUID v4, auto-generated per D-01) */
  readonly id: string;
  /** The type of file mutation (D-09) */
  readonly type: FileOperationType;
  /** Absolute path of the file that was modified */
  readonly filePath: string;
  /** Unix epoch in milliseconds (Date.now() per D-11) */
  readonly timestamp: number;
  /** Whether the operation succeeded */
  readonly success: boolean;
  /** The chat conversation this operation belongs to */
  readonly conversationId: string;
  /** Name of the AI skill that triggered the operation */
  readonly skillName: string;
  /** Optional: ID of the tool call that produced this operation */
  readonly toolCallId?: string;
  /** Optional: number of lines changed (for edit operations) */
  readonly linesChanged?: number;
  /** Optional: file size in bytes after the operation */
  readonly sizeBytes?: number;
  /** Optional: error message if success is false */
  readonly error?: string;
  /** Optional: unified diff for edit operations (D-03) */
  readonly diff?: string;
}
