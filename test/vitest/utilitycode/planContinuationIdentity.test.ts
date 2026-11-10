import { describe, expect, it } from "vitest";
import { planContinuationRequestId } from "@/views/utils/planContinuationIdentity";

/**
 * T2/D6 (audit, AD-007): the plan-continuation request id must be a
 * deterministic function of the persisted transition — same inputs, same id
 * — and must satisfy the strict clientRequestId schema (charset, length) so
 * replays dedupe instead of minting second jobs.
 */
describe("planContinuationRequestId (AD-007)", () => {
  it("is deterministic for the same (planId, version, decision)", async () => {
    const a = await planContinuationRequestId("plan-1", 2, "approve-plan");
    const b = await planContinuationRequestId("plan-1", 2, "approve-plan");
    expect(a).toBe(b);
  });

  it("differs across plans, versions, and decisions", async () => {
    const base = await planContinuationRequestId("plan-1", 2, "approve-plan");
    expect(await planContinuationRequestId("plan-2", 2, "approve-plan")).not.toBe(base);
    expect(await planContinuationRequestId("plan-1", 3, "approve-plan")).not.toBe(base);
    expect(await planContinuationRequestId("plan-1", 2, "reject-plan")).not.toBe(base);
    expect(
      await planContinuationRequestId("plan-1", 2, "request-plan-changes")
    ).not.toBe(base);
  });

  it("matches the clientRequestId contract (charset + length)", async () => {
    const id = await planContinuationRequestId("plan-1", 2, "approve-plan");
    expect(id).toMatch(/^plan-cont-[a-f0-9]{48}$/);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.length).toBeGreaterThanOrEqual(8);
  });
});
