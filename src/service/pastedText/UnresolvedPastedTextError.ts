/**
 * Thrown when a display message still contains `[Pasted text #N]` (or
 * truncated) refs that cannot be expanded because the send-time paste map
 * is missing those bodies. Fail closed: never send the placeholder to the
 * model or persist a turn that the model cannot read.
 */
export const UNRESOLVED_PASTED_TEXT_MESSAGE =
  "Pasted text is no longer available. Please paste it again.";

export class UnresolvedPastedTextError extends Error {
  readonly unknownPasteIds: readonly number[];

  constructor(unknownPasteIds: readonly number[]) {
    super(UNRESOLVED_PASTED_TEXT_MESSAGE);
    this.name = "UnresolvedPastedTextError";
    this.unknownPasteIds = unknownPasteIds;
  }
}
