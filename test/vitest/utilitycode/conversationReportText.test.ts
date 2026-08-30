import { describe, expect, it } from "vitest";
import {
  MAX_CONVERSATION_AGGREGATE_TEXT,
  MAX_CONVERSATION_ITEM_TEXT,
  normalizeConversationTexts,
} from "@/views/components/aiContentReport/conversationReportText";

describe("normalizeConversationTexts", () => {
  it("returns items unchanged when under both limits", () => {
    const out = normalizeConversationTexts([
      { itemId: "a", text: "hello" },
      { itemId: "b", text: "world" },
    ]);
    expect(out.texts.map((t) => t.text)).toEqual(["hello", "world"]);
    expect(out.texts.every((t) => !t.truncated)).toBe(true);
    expect(out.aggregateTruncated).toBe(false);
  });

  it("clamps a single item over 8000 chars", () => {
    const huge = "x".repeat(9000);
    const out = normalizeConversationTexts([{ itemId: "a", text: huge }]);
    expect(out.texts[0].text!.length).toBeLessThanOrEqual(MAX_CONVERSATION_ITEM_TEXT);
    expect(out.texts[0].truncated).toBe(true);
    // head + marker + tail preserved
    expect(out.texts[0].text!.startsWith("x")).toBe(true);
    expect(out.texts[0].text!.includes("[truncated]")).toBe(true);
  });

  it("preserves head and tail on truncation", () => {
    const text = "HEAD" + "x".repeat(9000) + "TAIL";
    const out = normalizeConversationTexts([{ itemId: "a", text }]);
    expect(out.texts[0].text!.startsWith("HEAD")).toBe(true);
    expect(out.texts[0].text!.endsWith("TAIL")).toBe(true);
  });

  it("distributes aggregate budget across many items", () => {
    // 20 items each 3000 chars = 60000 total > 32000 aggregate
    const inputs = Array.from({ length: 20 }, (_, i) => ({
      itemId: `i${i}`,
      text: "y".repeat(3000),
    }));
    const out = normalizeConversationTexts(inputs);
    const total = out.texts.reduce((n, t) => n + t.text!.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_CONVERSATION_AGGREGATE_TEXT);
    // Every non-empty item retains at least 1600 chars (design §8)
    expect(out.texts.every((t) => t.text!.length >= 1600)).toBe(true);
    expect(out.aggregateTruncated).toBe(true);
  });

  it("preserves item order", () => {
    const out = normalizeConversationTexts([
      { itemId: "first", text: "a" },
      { itemId: "second", text: "b" },
      { itemId: "third", text: "c" },
    ]);
    expect(out.texts.map((t) => t.itemId)).toEqual(["first", "second", "third"]);
  });

  it("is deterministic for identical input", () => {
    const inputs = [{ itemId: "a", text: "x".repeat(9000) }];
    const a = normalizeConversationTexts(inputs);
    const b = normalizeConversationTexts(inputs);
    expect(a).toEqual(b);
  });
});
