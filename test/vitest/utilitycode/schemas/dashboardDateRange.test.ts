import { describe, expect, it } from "vitest";
import { dashboardDateRangeInputSchema } from "@/schemas/ipc/dashboard";

/**
 * Pins the zod v4 migration of the dynamic refine message
 * (v3 message-function → v4 error callback receiving the issue):
 * the user-facing text must still name the offending input.
 */
describe("dashboardDateRangeInputSchema (zod v4 error callback)", () => {
  it("emits the input-bearing message for unparseable dates", () => {
    const r = dashboardDateRangeInputSchema().safeParse({
      startDate: "not-a-date",
      endDate: "2026-01-01",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.message).toContain(
        'Invalid date format: "not-a-date"'
      );
    }
  });

  it("empty string is rejected by min(1), not the refine", () => {
    const r = dashboardDateRangeInputSchema().safeParse({
      startDate: "",
      endDate: "2026-01-01",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.message).not.toContain("Invalid date format");
    }
  });

  it("valid ISO dates still pass", () => {
    expect(
      dashboardDateRangeInputSchema().safeParse({
        startDate: "2026-01-01",
        endDate: "2026-02-01",
      }).success
    ).toBe(true);
  });
});
