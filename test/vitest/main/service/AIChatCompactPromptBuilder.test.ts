import { describe, expect, it } from "vitest";
import {
  buildSessionMemorySystemPrompt,
  buildSessionMemoryUserPrompt,
  buildFullCompactSystemPrompt,
  buildFullCompactUserPrompt,
  normalizeSessionMemorySummary,
  normalizeFullCompactSummary,
  SESSION_MEMORY_HEADINGS,
  FULL_COMPACT_HEADINGS,
} from "@/service/AIChatCompactPromptBuilder";

describe("AIChatCompactPromptBuilder", () => {
  it("session memory system prompt forbids secrets", () => {
    const p = buildSessionMemorySystemPrompt();
    expect(p.toLowerCase()).toContain("secret");
    expect(p.toLowerCase()).toContain("token");
  });

  it("session memory user prompt embeds existing memory and new messages", () => {
    const u = buildSessionMemoryUserPrompt("old memory", [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(u).toContain("old memory");
    expect(u).toContain("hi");
    expect(u).toContain("hello");
    for (const h of SESSION_MEMORY_HEADINGS) {
      expect(u).toContain(h);
    }
  });

  it("full compact user prompt embeds all messages", () => {
    const u = buildFullCompactUserPrompt([
      { role: "user", content: "do X" },
      { role: "assistant", content: "ok" },
    ]);
    expect(u).toContain("do X");
    expect(u).toContain("ok");
    for (const h of FULL_COMPACT_HEADINGS) {
      expect(u).toContain(h);
    }
  });

  it("normalizeSessionMemorySummary injects missing headings", () => {
    const { summary, ok } = normalizeSessionMemorySummary(
      "## Current Goal\nship"
    );
    expect(ok).toBe(true);
    for (const h of SESSION_MEMORY_HEADINGS) {
      expect(summary).toContain(h);
    }
  });

  it("normalizeSessionMemorySummary rejects empty content", () => {
    const { ok } = normalizeSessionMemorySummary("   ");
    expect(ok).toBe(false);
  });

  it("normalizeFullCompactSummary injects missing headings", () => {
    const { summary, ok } = normalizeFullCompactSummary(
      "## Primary Request\nship it"
    );
    expect(ok).toBe(true);
    for (const h of FULL_COMPACT_HEADINGS) {
      expect(summary).toContain(h);
    }
  });
});
