import { describe, it, expect } from "vitest";
import { buildAutoPlanPromptSection } from "@/service/ChatModePromptSection";

describe("buildAutoPlanPromptSection", () => {
  it("returns a non-empty string ending with guidance", () => {
    const out = buildAutoPlanPromptSection();
    expect(out.length).toBeGreaterThan(100);
    expect(out).toContain("EnterPlanMode");
    expect(out).toContain("marketing");
  });

  it("includes do-not-enter examples", () => {
    const out = buildAutoPlanPromptSection();
    expect(out).toContain("Do NOT enter Plan Mode");
    expect(out.toLowerCase()).toContain("simple lookup");
  });

  it("uses ASCII punctuation so JSON logs do not contain unicode escapes", () => {
    const out = buildAutoPlanPromptSection();
    expect(out).not.toContain(String.fromCharCode(0x2014));
  });
});
