import { describe, expect, it } from "vitest";
import { expandPastedTextRefs } from "@/service/pastedText/PastedTextExpander";
import { formatTruncatedTierDisplay } from "@/service/pastedText/PastedTextTruncator";

describe("pastedText expander", () => {
  it("expands full pasted-text refs", () => {
    const display = "before [Pasted text #1 +2 lines] after";
    const expanded = expandPastedTextRefs(display, { "1": "a\nb\nc" });

    expect(expanded.expandedText).toBe("before a\nb\nc after");
    expect(expanded.unknownPasteIds).toEqual([]);
    expect(expanded.replacedPasteIds).toEqual([1]);
    expect(expanded.pastedBlocks).toHaveLength(1);
    expect(expanded.pastedBlocks[0]).toMatchObject({
      id: 1,
      kind: "full",
      lineCount: 2,
      charCount: "a\nb\nc".length,
    });
  });

  it("leaves unknown refs literal", () => {
    const display = "x [Pasted text #9 +1 lines] y";
    const expanded = expandPastedTextRefs(display, { "1": "nope" });

    expect(expanded.expandedText).toBe(display);
    expect(expanded.unknownPasteIds).toEqual([9]);
    expect(expanded.replacedPasteIds).toEqual([]);
    expect(expanded.pastedBlocks).toEqual([]);
  });

  it("expands truncated tier markers and replaces head+marker+tail window when it matches", () => {
    const fullText =
      "H".repeat(200) + "\n" + "M".repeat(10_500) + "\n" + "T".repeat(400);
    const pasteId = 2;
    const displayWindow = formatTruncatedTierDisplay(
      pasteId,
      fullText
    ).displayText;

    const display = `before ${displayWindow} after`;

    const expanded = expandPastedTextRefs(display, { "2": fullText });
    expect(expanded.unknownPasteIds).toEqual([]);
    expect(expanded.expandedText).toBe(`before ${fullText} after`);
    expect(expanded.pastedBlocks).toHaveLength(1);
    expect(expanded.pastedBlocks[0]).toMatchObject({
      id: 2,
      kind: "truncated",
    });
  });
});
