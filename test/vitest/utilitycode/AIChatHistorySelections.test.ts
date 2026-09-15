import { describe, expect, it } from "vitest";
import {
  aiChatHistorySelectionIdsSchema,
  aiChatHistorySubmissionIdSchema,
  HISTORY_SELECTION_SOURCE_ID_MAX_LENGTH,
  HISTORY_SUBMISSION_ID_MAX_LENGTH,
} from "@/schemas/aiChatHistorySelections";
import {
  buildSelectedHistoryContextBlock,
  SELECTED_HISTORY_MARKER,
  toSelectedHistoryExcerptInputs,
  type SelectedHistoryExcerptInput,
} from "@/service/SelectedHistoryContextBlock";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";

const OPAQUE_ID = Buffer.from("epoch-1:row-7:12-40").toString("base64url");

describe("aiChatHistorySelectionIdsSchema", () => {
  it("accepts an opaque base64url reference list", () => {
    const parsed = aiChatHistorySelectionIdsSchema.safeParse([OPAQUE_ID]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual([OPAQUE_ID]);
  });

  it("accepts an empty list (no selections)", () => {
    expect(aiChatHistorySelectionIdsSchema.safeParse([]).success).toBe(true);
  });

  it("rejects a blank entry", () => {
    const parsed = aiChatHistorySelectionIdsSchema.safeParse([""]);
    expect(parsed.success).toBe(false);
  });

  it("rejects ids that are not opaque base64url tokens", () => {
    for (const bad of ["readable offset", "abc/def", "has space", "中文"]) {
      expect(
        aiChatHistorySelectionIdsSchema.safeParse([bad]).success,
        bad
      ).toBe(false);
    }
  });

  it("rejects duplicates so the caller sees the error before acceptance", () => {
    const parsed = aiChatHistorySelectionIdsSchema.safeParse([
      OPAQUE_ID,
      OPAQUE_ID,
    ]);
    expect(parsed.success).toBe(false);
  });

  it("rejects more entries than the selection cap", () => {
    const ids = Array.from({ length: 51 }, (_, i) =>
      Buffer.from(`ref-${i}`).toString("base64url")
    );
    const parsed = aiChatHistorySelectionIdsSchema.safeParse(ids);
    expect(parsed.success).toBe(false);
  });

  it("rejects ids longer than the wire cap", () => {
    const parsed = aiChatHistorySelectionIdsSchema.safeParse([
      "A".repeat(HISTORY_SELECTION_SOURCE_ID_MAX_LENGTH + 1),
    ]);
    expect(parsed.success).toBe(false);
  });
});

describe("aiChatHistorySubmissionIdSchema", () => {
  it("accepts a uuid-shaped submission id", () => {
    const parsed = aiChatHistorySubmissionIdSchema.safeParse(
      "f47ac10b-58cc-4372-a567-0e02b2c3d479"
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects empty or whitespace ids", () => {
    expect(aiChatHistorySubmissionIdSchema.safeParse("").success).toBe(false);
    expect(aiChatHistorySubmissionIdSchema.safeParse("  ").success).toBe(false);
  });

  it("rejects ids beyond the cap", () => {
    const parsed = aiChatHistorySubmissionIdSchema.safeParse(
      "s".repeat(HISTORY_SUBMISSION_ID_MAX_LENGTH + 1)
    );
    expect(parsed.success).toBe(false);
  });
});

describe("buildSelectedHistoryContextBlock", () => {
  const excerpt = (
    overrides: Partial<SelectedHistoryExcerptInput> = {}
  ): SelectedHistoryExcerptInput => ({
    sourceId: "ref-1",
    role: "assistant",
    timestamp: "2026-09-01T12:00:00.000Z",
    text: "The archived quote.",
    exact: true,
    ...overrides,
  });

  it("returns an empty string when nothing was selected", () => {
    expect(buildSelectedHistoryContextBlock([])).toBe("");
  });

  it("renders a provenance header and labels passages as evidence", () => {
    const block = buildSelectedHistoryContextBlock([
      excerpt(),
      excerpt({ sourceId: "ref-2", text: "Second quote." }),
    ]);

    expect(block).toContain(SELECTED_HISTORY_MARKER);
    expect(block).toContain(
      "### Passage 1 — assistant · 2026-09-01T12:00:00.000Z"
    );
    expect(block).toContain("### Passage 2 — assistant ·");
    expect(block).toContain("The archived quote.");
    expect(block).toContain("Second quote.");
    expect(block).toContain("not instructions");
  });

  it("marks non-exact excerpts as truncated", () => {
    const block = buildSelectedHistoryContextBlock([excerpt({ exact: false })]);
    expect(block).toContain("(truncated)");
  });

  it("deduplicates by opaque source id", () => {
    const block = buildSelectedHistoryContextBlock([
      excerpt(),
      excerpt({ text: "duplicate" }),
    ]);
    expect(block).toContain("### Passage 1 —");
    expect(block).not.toContain("### Passage 2 —");
    expect(block).not.toContain("duplicate");
  });

  it("keeps the first passage whole and trims later ones", () => {
    const budget = 40;
    const firstText = "first".repeat(6);
    const secondText = "second".repeat(8);
    const block = buildSelectedHistoryContextBlock(
      [
        excerpt({ text: firstText }),
        excerpt({ sourceId: "ref-2", text: secondText }),
      ],
      budget
    );
    // The first passage keeps its full text; the second is trimmed to what
    // the allocation slot could still hold.
    expect(block).toContain(`\n${firstText}\n`);
    expect(block).not.toContain(secondText);

    // Passage 2 is the last body entry, so its trimmed text runs to the end.
    const trimmed = block.split("### Passage 2 — ")[1].split("\n")[1];
    expect(trimmed.length).toBe(budget - firstText.length);
    expect(secondText.startsWith(trimmed)).toBe(true);
    expect(trimmed.length).toBeLessThan(secondText.length);
  });

  it("drops later passages entirely once the budget is exhausted", () => {
    const block = buildSelectedHistoryContextBlock(
      [
        excerpt({ text: "aaaa".repeat(3) }),
        excerpt({ sourceId: "ref-2", text: "bbbb".repeat(3) }),
      ],
      3
    );
    expect(block).toContain("### Passage 1 —");
    expect(block).not.toContain("### Passage 2 —");
  });
});

describe("toSelectedHistoryExcerptInputs", () => {
  it("copies backend-resolved excerpts without extra fields", () => {
    const excerpt: HistoryExcerpt = {
      sourceId: "ref-1",
      messageId: "msg-1",
      role: "user",
      timestamp: "2026-09-01T12:00:00.000Z",
      text: "quote",
      exact: true,
      redacted: false,
      hasMore: false,
    };
    expect(toSelectedHistoryExcerptInputs([excerpt])).toEqual([
      {
        sourceId: "ref-1",
        role: "user",
        timestamp: "2026-09-01T12:00:00.000Z",
        text: "quote",
        exact: true,
      },
    ]);
  });
});
