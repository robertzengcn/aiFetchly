import { describe, expect, it } from "vitest";

/**
 * P04/Q-01: the opt-in submit boundary — the schema carries the WHOLE
 * reviewed cohort (a large Decline fits; malformed entries fail closed),
 * and the pending-prompt set preserves prior consent (already opted-in
 * rows never re-enter) while declined rows stay marked asked.
 */

import { socialAccountAiOptInBulkSchema } from "@/schemas/ipc/socialAccount";

function cohort(count: number): Array<{ id: number; enabled: boolean }> {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    enabled: false,
  }));
}

describe("opt-in submit schema boundary (P04)", () => {
  it("accepts a 300-account Decline cohort in one call", () => {
    const parsed = socialAccountAiOptInBulkSchema().safeParse({
      decisions: cohort(300),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed decision entry (fail closed)", () => {
    const parsed = socialAccountAiOptInBulkSchema().safeParse({
      decisions: [{ id: 1, enabled: false }, { id: "x", enabled: true }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty cohort and a zero id", () => {
    expect(
      socialAccountAiOptInBulkSchema().safeParse({ decisions: [] }).success
    ).toBe(false);
    expect(
      socialAccountAiOptInBulkSchema().safeParse({
        decisions: [{ id: 0, enabled: true }],
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys (strict envelope)", () => {
    expect(
      socialAccountAiOptInBulkSchema().safeParse({
        decisions: [{ id: 1, enabled: true }],
        extra: true,
      }).success
    ).toBe(false);
  });
});
