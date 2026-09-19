import { describe, expect, it } from "vitest";
import {
  SMALL_MODEL_ALIAS,
  isSmallModelAlias,
} from "@/service/aiProvider/SmallModelAlias";

describe("SmallModelAlias", () => {
  it("exposes the hosted virtual small-model alias", () => {
    expect(SMALL_MODEL_ALIAS).toBe("small");
  });

  it("accepts the small alias in any case with surrounding whitespace", () => {
    for (const candidate of ["small", "Small", "SMALL", " small ", "\tsmall\n"]) {
      expect(isSmallModelAlias(candidate)).toBe(true);
    }
  });

  it("accepts the haiku alias (backend treats both as the cheap-model alias)", () => {
    for (const candidate of ["haiku", "Haiku", "HAIKU"]) {
      expect(isSmallModelAlias(candidate)).toBe(true);
    }
  });

  it("rejects literal model ids and empty strings", () => {
    for (const candidate of [
      "deepseek-v4-flash",
      "llama3.1",
      "qwen3.7-plus",
      "gpt-4o",
      "",
      "   ",
      "smallish",
      "haikus",
    ]) {
      expect(isSmallModelAlias(candidate)).toBe(false);
    }
  });

  it("rejects missing and non-string values", () => {
    for (const candidate of [undefined, null, 123, {}, [], true]) {
      expect(isSmallModelAlias(candidate)).toBe(false);
    }
  });
});
