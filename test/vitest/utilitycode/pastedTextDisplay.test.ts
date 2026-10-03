import { describe, expect, it } from "vitest";
import {
  buildPastedContentsFromBlocks,
  expandPastedTextForDisplay,
  pastedBlocksFromSend,
} from "@/service/pastedText/PastedTextDisplay";

describe("PastedTextDisplay", () => {
  it("expands placeholders from inline pastedBlocks", () => {
    const display = "before [Pasted text #1 +2 lines] after";
    const contents = buildPastedContentsFromBlocks([
      {
        id: 1,
        lineCount: 2,
        charCount: 8,
        kind: "full",
        inlineContent: "a\nb\nc",
      },
    ]);
    expect(expandPastedTextForDisplay(display, contents)).toBe(
      "before a\nb\nc after"
    );
  });

  it("uses cache bodies keyed by contentHash", () => {
    const display = "[Pasted text #1]";
    const contents = buildPastedContentsFromBlocks(
      [
        {
          id: 1,
          lineCount: 0,
          charCount: 4,
          kind: "full",
          contentHash: "abc",
        },
      ],
      { abc: "full body" }
    );
    expect(expandPastedTextForDisplay(display, contents)).toBe("full body");
  });

  it("builds optimistic pastedBlocks from send-time contents", () => {
    const display = "[Pasted text #1 +2 lines]";
    const blocks = pastedBlocksFromSend(display, { "1": "a\nb\nc" });
    expect(blocks).toEqual([
      {
        id: 1,
        lineCount: 2,
        charCount: 5,
        kind: "full",
        inlineContent: "a\nb\nc",
      },
    ]);
  });
});
