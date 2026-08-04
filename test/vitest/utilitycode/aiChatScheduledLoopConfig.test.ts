import { describe, expect, it } from "vitest";
import {
  checkedMultiply,
  clampIntervalMs,
  clampMaxLifetimeMs,
  clampMaxRuns,
  isValidIntervalMs,
  isValidMaxLifetimeMs,
  isValidMaxRuns,
  nextFutureOccurrence,
  occurrenceOfSlot,
  SCHEDULED_LOOP_MAX_INTERVAL_MS,
  SCHEDULED_LOOP_MAX_LIFETIME_MS,
  SCHEDULED_LOOP_MAX_RUNS,
  SCHEDULED_LOOP_MIN_INTERVAL_MS,
} from "@/config/aiChatScheduledLoopConfig";

const MIN = SCHEDULED_LOOP_MIN_INTERVAL_MS;
const MAXI = SCHEDULED_LOOP_MAX_INTERVAL_MS;
const MAXL = SCHEDULED_LOOP_MAX_LIFETIME_MS;

describe("checkedMultiply", () => {
  it("multiplies safe integers", () => {
    expect(checkedMultiply(5, 60_000)).toBe(300_000);
  });
  it("returns null on overflow beyond safe integer", () => {
    expect(checkedMultiply(Number.MAX_SAFE_INTEGER, 2)).toBeNull();
  });
  it("returns null for non-integer inputs", () => {
    expect(checkedMultiply(1.5, 2)).toBeNull();
  });
});

describe("bounds validators", () => {
  it("isValidIntervalMs accepts 1m and 24h, rejects outside", () => {
    expect(isValidIntervalMs(MIN)).toBe(true);
    expect(isValidIntervalMs(MAXI)).toBe(true);
    expect(isValidIntervalMs(MIN - 1)).toBe(false);
    expect(isValidIntervalMs(MAXI + 1)).toBe(false);
  });
  it("isValidMaxRuns accepts 1..100, rejects outside", () => {
    expect(isValidMaxRuns(1)).toBe(true);
    expect(isValidMaxRuns(SCHEDULED_LOOP_MAX_RUNS)).toBe(true);
    expect(isValidMaxRuns(0)).toBe(false);
    expect(isValidMaxRuns(SCHEDULED_LOOP_MAX_RUNS + 1)).toBe(false);
  });
  it("isValidMaxLifetimeMs accepts up to 7d", () => {
    expect(isValidMaxLifetimeMs(MIN)).toBe(true);
    expect(isValidMaxLifetimeMs(MAXL)).toBe(true);
    expect(isValidMaxLifetimeMs(MAXL + 1)).toBe(false);
  });
});

describe("clamps", () => {
  it("clamps interval into range", () => {
    expect(clampIntervalMs(5 * 60_000)).toBe(5 * 60_000);
    expect(clampIntervalMs(1)).toBe(MIN);
    expect(clampIntervalMs(MAXI + 1000)).toBe(MAXI);
  });
  it("clamps run count and lifetime", () => {
    expect(clampMaxRuns(0)).toBe(1);
    expect(clampMaxRuns(999)).toBe(SCHEDULED_LOOP_MAX_RUNS);
    expect(clampMaxLifetimeMs(1)).toBe(MIN);
    expect(clampMaxLifetimeMs(MAXL + 1)).toBe(MAXL);
  });
});

describe("cadence math", () => {
  const anchor = 1_000_000;
  const interval = 60_000;

  it("occurrenceOfSlot maps cadence slots to occurrence numbers", () => {
    expect(occurrenceOfSlot(anchor, interval, anchor + interval)).toBe(1);
    expect(occurrenceOfSlot(anchor, interval, anchor + 5 * interval)).toBe(5);
  });

  it("occurrenceOfSlot rejects non-grid times", () => {
    expect(occurrenceOfSlot(anchor, interval, anchor)).toBeNull();
    expect(occurrenceOfSlot(anchor, interval, anchor + 1.5 * interval)).toBeNull();
    expect(occurrenceOfSlot(anchor, 0, anchor + interval)).toBeNull();
  });

  it("nextFutureOccurrence returns occurrence 1 before the first slot", () => {
    expect(nextFutureOccurrence(anchor, interval, anchor)).toEqual({
      occurrence: 1,
      timeMs: anchor + interval,
    });
    expect(nextFutureOccurrence(anchor, interval, anchor - 100)).toEqual({
      occurrence: 1,
      timeMs: anchor + interval,
    });
  });

  it("nextFutureOccurrence advances strictly past now", () => {
    // exactly at slot 1 -> next future is slot 2
    expect(nextFutureOccurrence(anchor, interval, anchor + interval)).toEqual({
      occurrence: 2,
      timeMs: anchor + 2 * interval,
    });
    // between slot 2 and 3 -> next future is slot 3
    expect(
      nextFutureOccurrence(anchor, interval, anchor + 2.5 * interval)
    ).toEqual({ occurrence: 3, timeMs: anchor + 3 * interval });
  });
});
