import { describe, expect, it } from "vitest";
import {
  shouldUseTruncatedTier,
  formatTruncatedTierDisplay,
} from "@/service/pastedText/PastedTextTruncator";
import {
  PASTED_TEXT_TRUNCATE_HEAD_CHARS,
  PASTED_TEXT_TRUNCATE_TAIL_CHARS,
} from "@/service/pastedText/PastedTextLimits";
import { formatTruncatedPastedTextRef } from "@/service/pastedText/PastedTextFormatter";

describe("pastedText truncator", () => {
  it("uses truncated tier for >10k chars and includes head + marker + tail", () => {
    const pasteId = 1;
    const fullText =
      "H".repeat(1500) + "\n" + "M".repeat(9000) + "\n" + "T".repeat(2000);

    expect(fullText.length).toBeGreaterThan(10_000);
    expect(shouldUseTruncatedTier(fullText)).toBe(true);

    const lineCount = (fullText.match(/\n/g) ?? []).length;
    const expectedMarker = formatTruncatedPastedTextRef(pasteId, lineCount);

    const display = formatTruncatedTierDisplay(pasteId, fullText);
    expect(
      display.displayText.startsWith(
        "H".repeat(PASTED_TEXT_TRUNCATE_HEAD_CHARS)
      )
    ).toBe(true);
    expect(display.displayText.includes(expectedMarker)).toBe(true);
    expect(
      display.displayText.endsWith("T".repeat(PASTED_TEXT_TRUNCATE_TAIL_CHARS))
    ).toBe(true);
    expect(display.lineCount).toBe(lineCount);
  });

  it("falls back to normal placeholder when head/tail would overlap", () => {
    const pasteId = 2;
    const fullText = "X".repeat(900); // <= 500 + 500
    const display = formatTruncatedTierDisplay(pasteId, fullText);
    expect(display.displayText).toBe(`[Pasted text #${pasteId}]`);
  });
});
