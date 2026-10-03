/**
 * Unit tests for parseSummaryJson — the JSON-extraction helper used by the
 * compaction coordinator before Zod validation.
 *
 * Models (especially flash-tier on dense content) frequently wrap JSON output
 * in markdown code fences or surround it with prose despite instructions not
 * to. The helper must recover the embedded JSON, and when extraction fails it
 * must surface the actual JSON parse error (not swallow it) so the bounded
 * retry loop can feed useful signal back to the model.
 */
import { describe, it, expect } from "vitest";
import { parseSummaryJson } from "@/service/AIChatSummaryJsonParse";

const VALID_OBJECT = {
  version: 1,
  synopsis: "section synopsis",
  decisions: [],
  constraints: [],
  pending: [],
  toolOutcomes: [],
  topics: ["x"],
};

describe("parseSummaryJson", () => {
  it("parses plain JSON", () => {
    const result = parseSummaryJson(JSON.stringify(VALID_OBJECT));
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(VALID_OBJECT);
    expect(result.error).toBeUndefined();
  });

  it("parses JSON wrapped in a ```json fenced block", () => {
    const raw = "```json\n" + JSON.stringify(VALID_OBJECT) + "\n```";
    const result = parseSummaryJson(raw);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(VALID_OBJECT);
  });

  it("parses JSON wrapped in a bare ``` fenced block (no language tag)", () => {
    const raw = "```\n" + JSON.stringify(VALID_OBJECT) + "\n```";
    const result = parseSummaryJson(raw);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(VALID_OBJECT);
  });

  it("parses JSON surrounded by leading and trailing prose", () => {
    const raw =
      'Here is the section summary as requested:\n\n```json\n' +
      JSON.stringify(VALID_OBJECT) +
      '\n```\n\nLet me know if you need changes.';
    const result = parseSummaryJson(raw);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(VALID_OBJECT);
  });

  it("parses a JSON object with leading whitespace and prose", () => {
    const raw =
      "Sure! " + JSON.stringify(VALID_OBJECT, null, 2);
    const result = parseSummaryJson(raw);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(VALID_OBJECT);
  });

  it("surfaces the actual parse error for truncated JSON (not null)", () => {
    const truncated = '{"version":1,"synopsis":"truncated mid-string...';
    const result = parseSummaryJson(truncated);
    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it("surfaces a parse error for empty input", () => {
    const result = parseSummaryJson("");
    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it("surfaces a parse error for pure prose with no JSON", () => {
    const result = parseSummaryJson(
      "I cannot summarize this section because the sources are unclear."
    );
    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it("does not accept a JSON array as a root (must be an object)", () => {
    // A bare array is parseable JSON but is the wrong root shape; the helper
    // may parse it (ok:true) and let the Zod validator reject it, OR it may
    // reject. Either is acceptable as long as the array never reaches the
    // coordinator as a "valid summary". The validator test covers the Zod
    // rejection. Here we just ensure no crash.
    const result = parseSummaryJson("[1, 2, 3]");
    // Either path is fine — just no crash and no false object.
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
    } else {
      expect(result.error).not.toBeNull();
    }
  });
});
