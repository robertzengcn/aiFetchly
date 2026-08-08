/**
 * Pure TypeScript types for Chat V2 "pasted text placeholders".
 *
 * These types are shared between main-process logic, renderer code, and
 * utility tests. They MUST NOT import Electron, Vue, TypeORM, fs/path, or
 * any other side-effectful modules.
 */

export type ChatV2PastedBlockKind = "full" | "truncated";

export interface ChatV2PastedBlockMetadata {
  /**
   * 1-based paste identifier assigned by the composer during send.
   * Stored only for UI chips/preview selection; not required for model.
   */
  readonly id: number;

  /**
   * "Lines" in Claude-Code UI are represented as newline count.
   * For example, "a\nb\nc" has +2 lines.
   */
  readonly lineCount: number;

  /** Full pasted content character length (after cleaning). */
  readonly charCount: number;

  /** Whether display was a full placeholder or a truncated preview tier. */
  readonly kind: ChatV2PastedBlockKind;

  /** Present when we keep the paste inline (small pastes / v1 persistence). */
  readonly inlineContent?: string;

  /** Present when we persist paste bodies in a cache (v1 persistence). */
  readonly contentHash?: string;
}
