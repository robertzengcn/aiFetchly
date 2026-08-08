export function formatPastedTextRef(
  pasteId: number,
  lineCount: number
): string {
  if (lineCount <= 0) return `[Pasted text #${pasteId}]`;
  return `[Pasted text #${pasteId} +${lineCount} lines]`;
}

export function formatTruncatedPastedTextRef(
  pasteId: number,
  lineCount: number
): string {
  if (lineCount <= 0) return `[...Truncated text #${pasteId}...]`;
  return `[...Truncated text #${pasteId} +${lineCount} lines...]`;
}

/**
 * Returns the marker string inserted into the visible display text for the
 * truncated tier.
 *
 * We intentionally keep a stable human-readable marker so the main-process
 * can expand it later.
 */
export function formatTruncatedTierMarker(
  pasteId: number,
  lineCount: number
): string {
  // Marker intentionally does not include head/tail preview strings.
  // Those are computed via the stored full paste content.
  return formatTruncatedPastedTextRef(pasteId, lineCount);
}
