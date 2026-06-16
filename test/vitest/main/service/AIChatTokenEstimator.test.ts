import { describe, expect, it } from "vitest";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import type { OpenAIChatMessage } from "@/api/aiChatApi";

describe("AIChatTokenEstimator", () => {
  it("uses ceil(length/4) for plain text", () => {
    const est = new AIChatTokenEstimator();
    expect(est.estimateText("")).toBe(0);
    expect(est.estimateText("hello")).toBe(2); // 5/4 = 1.25 -> 2
    expect(est.estimateText("12345678")).toBe(2); // 8/4 = 2
  });

  it("counts role + content per message", () => {
    const est = new AIChatTokenEstimator();
    const msg: OpenAIChatMessage = { role: "user", content: "hello world" };
    const t = est.estimateMessage(msg);
    expect(t).toBeGreaterThan(0);
  });

  it("sums an array of messages with overhead", () => {
    const est = new AIChatTokenEstimator();
    const total = est.estimateMessages([
      { role: "system", content: "abc" },
      { role: "user", content: "defghi" },
    ]);
    expect(total).toBeGreaterThan(0);
  });
});
