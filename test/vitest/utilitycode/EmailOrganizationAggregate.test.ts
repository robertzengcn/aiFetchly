import { describe, it, expect } from "vitest";
import {
  deriveOperationStatus,
  countItemsForDisplay,
} from "@/model/emailOrganizationAggregate";

describe("deriveOperationStatus", () => {
  it("returns prepared for no items without cancellation", () => {
    expect(deriveOperationStatus([], false)).toBe("prepared");
  });

  it("returns cancelled for no items with cancellation", () => {
    expect(deriveOperationStatus([], true)).toBe("cancelled");
  });

  it("gives needs_reconciliation precedence over open work", () => {
    expect(deriveOperationStatus(["claimed", "outcome_unknown"], false)).toBe(
      "needs_reconciliation"
    );
  });

  it("reports running while pending/claimed items remain", () => {
    expect(deriveOperationStatus(["pending", "succeeded"], false)).toBe("running");
    expect(deriveOperationStatus(["claimed"], false)).toBe("running");
  });

  it("returns cancelled when cancellation stops pending work", () => {
    expect(deriveOperationStatus(["pending", "succeeded"], true)).toBe("cancelled");
  });

  it("stays cancelled with completed items when cancellation was requested", () => {
    expect(deriveOperationStatus(["succeeded", "cancelled"], true)).toBe(
      "cancelled"
    );
  });

  it("derives partial success from mixed outcomes", () => {
    expect(deriveOperationStatus(["succeeded", "failed"], false)).toBe(
      "partially_succeeded"
    );
    expect(deriveOperationStatus(["succeeded", "partially_succeeded"], false)).toBe(
      "partially_succeeded"
    );
  });

  it("derives failure when every item failed", () => {
    expect(deriveOperationStatus(["failed", "failed"], false)).toBe("failed");
  });

  it("derives success including proven no-ops", () => {
    expect(deriveOperationStatus(["succeeded", "noop"], false)).toBe("succeeded");
  });
});

describe("countItemsForDisplay", () => {
  it("folds noop and partial into completed", () => {
    expect(
      countItemsForDisplay(["succeeded", "noop", "partially_succeeded"])
    ).toEqual({
      completed: 3,
      failed: 0,
      unresolved: 0,
      pending: 0,
      cancelled: 0,
    });
  });

  it("counts claimed and unknown as unresolved", () => {
    expect(countItemsForDisplay(["claimed", "outcome_unknown", "failed"])).toEqual({
      completed: 0,
      failed: 1,
      unresolved: 2,
      pending: 0,
      cancelled: 0,
    });
  });

  it("keeps pending and cancelled separate", () => {
    expect(countItemsForDisplay(["pending", "cancelled"])).toEqual({
      completed: 0,
      failed: 0,
      unresolved: 0,
      pending: 1,
      cancelled: 1,
    });
  });
});
