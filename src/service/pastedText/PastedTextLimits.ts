/**
 * Thresholds and caps for Chat V2 "pasted text placeholder" behavior.
 *
 * These constants are intentionally shared by renderer and main-process
 * logic, but this file contains only pure values (no Electron imports).
 */

export const PASTED_TEXT_COLLAPSE_MAX_CHARS = 500;
export const PASTED_TEXT_COLLAPSE_MAX_NEWLINES = 3; // newline count

export const PASTED_TEXT_TRUNCATE_MAX_CHARS = 10_000;

export const PASTED_TEXT_TRUNCATE_HEAD_CHARS = 500;
export const PASTED_TEXT_TRUNCATE_TAIL_CHARS = 500;

export const PASTED_TEXT_MAX_BLOCKS_PER_MESSAGE = 10;

export const PASTED_TEXT_MAX_TOTAL_EXPANDED_CHARS = 100_000;

export const PASTED_TEXT_INLINE_MAX_CHARS = 1024; // used later by cache persistence

export const PASTED_TEXT_MAX_PASTED_REF_IDS_IN_INPUT = 10; // defensive guard
