import { describe, expect, test } from "vitest";
import {
  compareInstallerSize,
  checkReductionVsPreSlim,
} from "../../../scripts/check-installer-size.mjs";

describe("compareInstallerSize", () => {
  test("passes when current <= baseline (no growth allowed by default)", () => {
    const r = compareInstallerSize(9_000_000, 10_000_000);
    expect(r.ok).toBe(true);
    expect(r.deltaBytes).toBe(-1_000_000);
    expect(r.deltaPercent).toBeCloseTo(-10, 5);
  });

  test("fails when current exceeds baseline", () => {
    const r = compareInstallerSize(10_100_000, 10_000_000);
    expect(r.ok).toBe(false);
    expect(r.deltaPercent).toBeCloseTo(1, 5);
  });

  test("honors a configured max-growth tolerance", () => {
    expect(compareInstallerSize(10_400_000, 10_000_000, { maxGrowthPercent: 5 }).ok).toBe(true);
    expect(compareInstallerSize(10_600_000, 10_000_000, { maxGrowthPercent: 5 }).ok).toBe(false);
  });
});

describe("checkReductionVsPreSlim (PRD >=15% goal)", () => {
  test("passes when the reduction meets the threshold", () => {
    // 100 MB pre-slim → 80 MB now = 20% reduction.
    const r = checkReductionVsPreSlim(80_000_000, 100_000_000, 15);
    expect(r.ok).toBe(true);
    expect(r.reductionPercent).toBeCloseTo(20, 5);
  });

  test("fails when the reduction is below the threshold", () => {
    // 100 MB pre-slim → 92 MB now = 8% reduction (< 15%).
    const r = checkReductionVsPreSlim(92_000_000, 100_000_000, 15);
    expect(r.ok).toBe(false);
  });

  test("skips when no pre-slim baseline is provided", () => {
    const r = checkReductionVsPreSlim(50_000_000, 0, 15);
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(true);
  });
});
