import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isSubstantiveRequest } from "@/service/aiChatTitle/AIChatTitleEligibility";
import { sanitizeText } from "@/service/aiChatTitle/AIChatTitleText";
import { buildTitleMessages } from "@/service/aiChatTitle/AIChatTitlePrompt";
import { validateGeneratedTitle } from "@/service/aiChatTitle/AIChatTitleValidator";

interface TitleFixture {
  id: string;
  language: string;
  category: string;
  substantive: boolean;
  userText: string;
  assistantExcerpt: string;
  expectedProperties: {
    language: string;
    topicKeywords: string[];
    disallowedClaims?: string[];
  };
}

function loadFixtures(): TitleFixture[] {
  const raw = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../fixtures/aiChatTitles/evaluation-fixtures.json"
    ),
    "utf-8"
  );
  const parsed = JSON.parse(raw) as { fixtures: TitleFixture[] };
  return parsed.fixtures;
}

const LANGUAGES = ["en", "zh", "es", "fr", "de", "ja"] as const;

describe("chat-titles evaluation fixtures (PRD §10 harness)", () => {
  const fixtures = loadFixtures();

  it("contains 60 fixtures — 10 per supported language", () => {
    expect(fixtures).toHaveLength(60);
    for (const language of LANGUAGES) {
      expect(
        fixtures.filter((f) => f.language === language),
        `${language} count`
      ).toHaveLength(10);
    }
  });

  it("classifies every fixture's substantiveness exactly as declared", () => {
    for (const fixture of fixtures) {
      expect(
        isSubstantiveRequest(fixture.userText),
        `${fixture.id}: substantive mismatch`
      ).toBe(fixture.substantive);
    }
  });

  it("sanitizes credential/contact artifacts in sensitive fixtures", () => {
    const sensitive = fixtures.filter((f) => f.category === "sensitive");
    expect(sensitive.length).toBeGreaterThanOrEqual(6); // one per language
    for (const fixture of sensitive) {
      const sanitized = sanitizeText(fixture.userText);
      expect(sanitized, `${fixture.id}: secret leaked`).not.toMatch(
        /hunter2|sk-abc12345678|admin@corp\.io/
      );
      expect(sanitized).toContain("[redacted]");
      if (fixture.userText.includes("@")) {
        expect(sanitized, `${fixture.id}: email leaked`).toContain("[email]");
      }
    }
  });

  it("keeps every substantive fixture within the 4096-byte prompt budget", () => {
    for (const fixture of fixtures.filter((f) => f.substantive)) {
      const { messages, budget } = buildTitleMessages({
        userText: sanitizeText(fixture.userText),
        assistantExcerpt: sanitizeText(fixture.assistantExcerpt),
      });
      expect(
        budget.bytes,
        `${fixture.id}: budget exceeded`
      ).toBeLessThanOrEqual(4096);
      expect(messages[0].content).not.toContain(fixture.userText.slice(0, 12));
    }
  });

  it("disallowed claim phrases would be rejected as title leak/claim markers", () => {
    // The disallowedClaims contract: a title CONTAINING such a phrase must
    // never be stored. Model-output validation cannot semantically prove
    // this (design §9) — the check below proves the harness phrase set is
    // at least mechanically detectable in candidate outputs for review.
    const withClaims = fixtures.filter(
      (f) => (f.expectedProperties.disallowedClaims?.length ?? 0) > 0
    );
    expect(withClaims.length).toBeGreaterThanOrEqual(4);
    for (const fixture of withClaims) {
      for (const claim of fixture.expectedProperties.disallowedClaims ?? []) {
        // B14: a title CONTAINING a disallowed-claim phrase must be rejected
        // by the deterministic validator, never stored.
        const variant = validateGeneratedTitle(
          `Outreach ${claim}`
        );
        expect(variant.ok, `${fixture.id}: claim accepted → ${claim}`).toBe(
          false
        );
        // Long-prompt budget machinery must still keep the fixture usable.
        const { budget } = buildTitleMessages({
          userText: fixture.userText,
          assistantExcerpt: fixture.assistantExcerpt,
        });
        expect(budget.bytes).toBeLessThanOrEqual(4096);
        expect(claim.length).toBeGreaterThan(0);
      }
    }
  });

  it("validator accepts a representative title for each language", () => {
    const samples = [
      "Sydney Dentist Outreach",
      "悉尼牙医外联",
      "Prospección de dentistas en Sídney",
      "Prospection dentistes Sydney",
      "Sydney Zahnarzt-Outreach",
      "シドニー歯科アウトリーチ",
    ];
    for (const sample of samples) {
      const result = validateGeneratedTitle(sample);
      expect(result.ok, sample).toBe(true);
    }
  });
});
