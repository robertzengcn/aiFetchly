/**
 * Unit tests for mapWithConcurrency.
 *
 * The contact-extraction worker uses this to process the `urls[]` batch from
 * extract_contact_info with a bounded number of concurrent Puppeteer
 * extractions (matching the existing ContactExtractionQueue, max 3) instead of
 * the previous sequential for..of loop — the main reason multi-URL batches
 * exceeded the 5-minute ceiling.
 */
import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "@/utils/concurrency";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("returns results in input order even when later items finish first", async () => {
    const items = ["a", "b", "c"];
    // "b" finishes before "a" — output must still be [A, B, C].
    const result = await mapWithConcurrency(items, 3, async (item) => {
      if (item === "a") {
        await delay(40);
      } else if (item === "b") {
        await delay(5);
      } else {
        await delay(20);
      }
      return item.toUpperCase();
    });
    expect(result).toEqual(["A", "B", "C"]);
  });

  it("never runs more than `limit` mappers concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 9 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(10);
      inFlight -= 1;
      return null;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBe(3); // should actually saturate the limit
  });

  it("resolves to an empty array for empty input", async () => {
    const result = await mapWithConcurrency([], 3, async () => 1);
    expect(result).toEqual([]);
  });

  it("handles limit larger than the number of items", async () => {
    const result = await mapWithConcurrency([1, 2], 10, async (n) => n * 2);
    expect(result).toEqual([2, 4]);
  });

  it("treats a non-positive limit as 1 (sequential)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency([1, 2, 3], 0, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight -= 1;
      return null;
    });
    expect(maxInFlight).toBe(1);
  });

  it("propagates a mapper rejection", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) {
          throw new Error("boom");
        }
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
