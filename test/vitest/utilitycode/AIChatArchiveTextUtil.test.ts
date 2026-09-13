import { describe, it, expect } from "vitest";
import {
  codePointLength,
  sliceByCodePoints,
  codePointOffsetToSqlSubstr,
} from "@/service/AIChatArchiveTextUtil";

describe("AIChatArchiveTextUtil", () => {
  describe("codePointLength", () => {
    it("counts ASCII characters as 1 code point each", () => {
      expect(codePointLength("hello")).toBe(5);
    });

    it("counts an empty string as 0", () => {
      expect(codePointLength("")).toBe(0);
    });

    it("counts a surrogate pair (emoji) as a single code point", () => {
      // 🚀 = U+1F680, two UTF-16 code units but one code point.
      expect(codePointLength("🚀")).toBe(1);
    });

    it("counts mixed BMP + supplementary plane text correctly", () => {
      // "a🚀b" = a(1) + 🚀(1) + b(1) = 3 code points, 4 UTF-16 units.
      expect(codePointLength("a🚀b")).toBe(3);
    });

    it("counts CJK characters (BMP) as 1 each", () => {
      expect(codePointLength("你好世界")).toBe(4);
    });
  });

  describe("sliceByCodePoints", () => {
    it("returns the full string for [0, length)", () => {
      expect(sliceByCodePoints("hello", 0, 5)).toBe("hello");
    });

    it("returns empty string when start >= end", () => {
      expect(sliceByCodePoints("hello", 3, 3)).toBe("");
    });

    it("clamps negative offsets to 0", () => {
      expect(sliceByCodePoints("hello", -5, 3)).toBe("hel");
    });

    it("slices correctly across a surrogate pair boundary", () => {
      // "a🚀bc": code points a(0) 🚀(1) b(2) c(3)
      // Slice [1, 3) should yield "🚀b"
      expect(sliceByCodePoints("a🚀bc", 1, 3)).toBe("🚀b");
    });

    it("does not split a surrogate pair when end lands between pair units", () => {
      // "🚀🚀": code points at 0 and 1. Slice [0,1) = first emoji only.
      expect(sliceByCodePoints("🚀🚀", 0, 1)).toBe("🚀");
    });

    it("returns suffix when end exceeds length", () => {
      expect(sliceByCodePoints("abc", 1, 100)).toBe("bc");
    });

    it("returns empty string when start is at or past length", () => {
      expect(sliceByCodePoints("abc", 3, 5)).toBe("");
    });
  });

  describe("codePointOffsetToSqlSubstr", () => {
    it("returns 1-based start and code-point length for valid offsets", () => {
      const result = codePointOffsetToSqlSubstr("hello", 1, 4);
      expect(result).toEqual({ startPlusOne: 2, lengthCodePoints: 3 });
    });

    it("returns null when start offset is beyond the string", () => {
      expect(codePointOffsetToSqlSubstr("hi", 5, 10)).toBeNull();
    });

    it("clamps end to the total code-point length", () => {
      // string has 2 code points; start=1, end=99 → clamped to 2.
      const result = codePointOffsetToSqlSubstr("hi", 1, 99);
      expect(result).toEqual({ startPlusOne: 2, lengthCodePoints: 1 });
    });

    it("handles supplementary-plane characters", () => {
      // "🚀🚀" = 2 code points; start=0, end=1.
      const result = codePointOffsetToSqlSubstr("🚀🚀", 0, 1);
      expect(result).toEqual({ startPlusOne: 1, lengthCodePoints: 1 });
    });
  });
});
