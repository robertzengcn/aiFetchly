// test/vitest/main/communication/aiChatV2PlanAnswerSchema.test.ts
//
// Validates the Zod schema that guards the `answer-question` IPC boundary.
// The handler must accept well-formed answers (with and without customText,
// single and multi-select) and reject malformed shapes / oversized free text
// before they reach the engine, SQLite answersJson, or the AI tool message.

import { describe, expect, it } from "vitest";
import {
  AnswerPlanQuestionAnswersSchema,
  AskUserQuestionAnswerSchema,
} from "@/main-process/communication/aiChatV2PlanAnswerSchema";

const validSingle = {
  question: "Pick a fruit",
  answer: "Mango",
  customText: "Mango",
};

const validMulti = {
  question: "Pick fruits",
  answer: ["Apple", "Banana", "Cherry"],
};

describe("AskUserQuestionAnswerSchema", () => {
  it("accepts a single-select answer with customText", () => {
    const r = AskUserQuestionAnswerSchema.safeParse(validSingle);
    expect(r.success).toBe(true);
  });

  it("accepts a multi-select array answer without customText", () => {
    const r = AskUserQuestionAnswerSchema.safeParse(validMulti);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.customText).toBeUndefined();
  });

  it("rejects an oversized customText (>2000 chars)", () => {
    const r = AskUserQuestionAnswerSchema.safeParse({
      question: "q",
      answer: "a",
      customText: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an oversized answer string", () => {
    const r = AskUserQuestionAnswerSchema.safeParse({
      question: "q",
      answer: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing/empty question", () => {
    expect(
      AskUserQuestionAnswerSchema.safeParse({ question: "", answer: "a" })
        .success
    ).toBe(false);
    expect(
      AskUserQuestionAnswerSchema.safeParse({ answer: "a" } as {
        answer: string;
      }).success
    ).toBe(false);
  });

  it("rejects a non-string answer (e.g. number)", () => {
    const r = AskUserQuestionAnswerSchema.safeParse({
      question: "q",
      answer: 42,
    });
    expect(r.success).toBe(false);
  });
});

describe("AnswerPlanQuestionAnswersSchema", () => {
  it("accepts a valid answers array", () => {
    const r = AnswerPlanQuestionAnswersSchema.safeParse([validSingle, validMulti]);
    expect(r.success).toBe(true);
  });

  it("rejects a non-array payload", () => {
    expect(
      AnswerPlanQuestionAnswersSchema.safeParse(validSingle).success
    ).toBe(false);
  });

  it("rejects more than 20 answers", () => {
    const tooMany = Array.from({ length: 21 }, () => ({
      question: "q",
      answer: "a",
    }));
    expect(
      AnswerPlanQuestionAnswersSchema.safeParse(tooMany).success
    ).toBe(false);
  });

  it("rejects an array containing a malformed answer", () => {
    const r = AnswerPlanQuestionAnswersSchema.safeParse([
      validSingle,
      { question: "q", answer: 42 },
    ]);
    expect(r.success).toBe(false);
  });
});
