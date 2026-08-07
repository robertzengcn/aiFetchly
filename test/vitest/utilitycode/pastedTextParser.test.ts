import { describe, expect, it } from "vitest";
import { parsePastedTextRefs } from "@/service/pastedText/PastedTextParser";

describe("pastedText parser", () => {
  it("parses full pasted-text refs (with and without line counts)", () => {
    const input = "Hi [Pasted text #1 +2 lines] there [Pasted text #2] end";
    const refs = parsePastedTextRefs(input);

    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ kind: "full", pasteId: 1, lineCount: 2 });
    expect(input.slice(refs[0].start, refs[0].end)).toBe(
      "[Pasted text #1 +2 lines]"
    );

    expect(refs[1]).toMatchObject({ kind: "full", pasteId: 2, lineCount: 0 });
    expect(input.slice(refs[1].start, refs[1].end)).toBe("[Pasted text #2]");
  });

  it("parses truncated tier markers", () => {
    const input = "A[...Truncated text #3 +5 lines...]B";
    const refs = parsePastedTextRefs(input);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "truncated",
      pasteId: 3,
      lineCount: 5,
    });
    expect(input.slice(refs[0].start, refs[0].end)).toBe(
      "[...Truncated text #3 +5 lines...]"
    );
  });

  it("returns refs ordered by start offset", () => {
    const input =
      "[Pasted text #2] and [...Truncated text #1 +0 lines...] then [Pasted text #3 +1 lines]";
    const refs = parsePastedTextRefs(input);

    expect(refs.map((r) => r.pasteId)).toEqual([2, 1, 3]);
  });
});
