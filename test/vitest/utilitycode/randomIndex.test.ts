/**
 * Regression tests for the cryptographically secure index selector.
 *
 * Pins the CodeQL `js/insecure-randomness` fix (#46): scrapeManager used
 * `Math.floor(Math.random() * arr.length)` to pick a cookie account/proxy,
 * which is predictable. `pickRandomIndex` draws from `crypto.randomInt`
 * (OS CSPRNG, no modulo bias).
 */
import { describe, it, expect } from "vitest";
import { pickRandomIndex } from "@/modules/lib/randomIndex";

describe("pickRandomIndex", () => {
  it("returns 0 for a single-element array", () => {
    expect(pickRandomIndex(1)).toBe(0);
  });

  it("returns an index within [0, length) for various lengths", () => {
    for (const length of [2, 5, 10, 100, 1000]) {
      for (let i = 0; i < 200; i++) {
        const idx = pickRandomIndex(length);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(length);
        expect(Number.isInteger(idx)).toBe(true);
      }
    }
  });

  it("produces a non-degenerate distribution (every index observed)", () => {
    // Over many draws on a small space, every bucket should appear at least
    // once — a sanity check that the selector isn't stuck on one value.
    const length = 8;
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      seen.add(pickRandomIndex(length));
    }
    expect(seen.size).toBe(length);
  });

  it("throws for non-positive length", () => {
    expect(() => pickRandomIndex(0)).toThrow(RangeError);
    expect(() => pickRandomIndex(-1)).toThrow(RangeError);
  });
});