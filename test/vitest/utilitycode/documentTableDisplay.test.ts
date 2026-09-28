import { describe, it, expect } from "vitest";
import {
  displayAuthor,
  visibleTags,
  DEFAULT_AUTHOR,
  DEFAULT_TAGS,
  type DocumentTableRow,
} from "@/views/pages/knowledge/documentTableDisplay";

function row(overrides?: Partial<DocumentTableRow>): DocumentTableRow {
  return { author: undefined, tags: undefined, ...overrides };
}

describe("DEFAULT_AUTHOR / DEFAULT_TAGS", () => {
  it("exposes the upload default author", () => {
    expect(DEFAULT_AUTHOR).toBe("User");
  });

  it("exposes the upload default tags", () => {
    expect(DEFAULT_TAGS).toEqual(["uploaded", "knowledge"]);
  });
});

describe("displayAuthor", () => {
  it("returns the author when a real name is stored", () => {
    expect(displayAuthor(row({ author: "Alice Chen" }))).toBe("Alice Chen");
  });

  it("returns empty string for the default author 'User'", () => {
    expect(displayAuthor(row({ author: "User" }))).toBe("");
  });

  it("returns empty string when author is missing", () => {
    expect(displayAuthor(row({ author: undefined }))).toBe("");
  });

  it("does not mutate the input row", () => {
    const doc = row({ author: "User" });
    displayAuthor(doc);
    expect(doc.author).toBe("User");
  });
});

describe("visibleTags", () => {
  it("returns only user tags when defaults coexist with real tags", () => {
    // PRD §8.2.3: a doc tagged ["uploaded","knowledge","pricing"] shows just
    // ["pricing"] in the table — defaults are hidden unconditionally, not only
    // when they are the sole tags.
    expect(
      visibleTags(row({ tags: ["uploaded", "knowledge", "pricing"] }))
    ).toEqual(["pricing"]);
  });

  it("returns empty array when only the two defaults are stored", () => {
    expect(visibleTags(row({ tags: ["uploaded", "knowledge"] }))).toEqual([]);
  });

  it("returns all tags when none are defaults", () => {
    expect(
      visibleTags(row({ tags: ["refund-policy", "enterprise"] }))
    ).toEqual(["refund-policy", "enterprise"]);
  });

  it("returns empty array when tags are missing", () => {
    expect(visibleTags(row({ tags: undefined }))).toEqual([]);
  });

  it("returns empty array for an empty tags array", () => {
    expect(visibleTags(row({ tags: [] }))).toEqual([]);
  });

  it("hides defaults case-insensitively", () => {
    expect(
      visibleTags(row({ tags: ["Uploaded", "KNOWLEDGE", "Pricing"] }))
    ).toEqual(["Pricing"]);
  });

  it("preserves the original spelling and order of user tags", () => {
    expect(
      visibleTags(row({ tags: ["knowledge", "Pricing", "uploaded", "Q3"] }))
    ).toEqual(["Pricing", "Q3"]);
  });

  it("does not mutate the stored tags array", () => {
    const tags = ["uploaded", "knowledge", "pricing"];
    const doc = row({ tags });
    visibleTags(doc);
    expect(doc.tags).toBe(tags);
    expect(tags).toEqual(["uploaded", "knowledge", "pricing"]);
  });
});
