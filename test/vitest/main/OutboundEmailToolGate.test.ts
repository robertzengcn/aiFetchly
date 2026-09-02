import { describe, expect, it } from "vitest";
import { OutboundEmailToolGate } from "@/service/outboundEmail/OutboundEmailToolGate";
import type { OutboundEmailDeliveryMode } from "@/entityTypes/outboundEmailDeliveryTypes";

describe("OutboundEmailToolGate", () => {
  const intent = (mode: OutboundEmailDeliveryMode) => ({ mode });

  it("blocks draft_required when no intent decision exists", () => {
    expect(OutboundEmailToolGate.evaluate(null, null, null)).toEqual({
      allowed: false,
      code: "draft_required",
      batchId: null,
    });
  });

  it("blocks draft_required for a draft_only intent", () => {
    expect(OutboundEmailToolGate.evaluate(intent("draft_only"), null, null)).toEqual({
      allowed: false,
      code: "draft_required",
      batchId: null,
    });
  });

  it("blocks review_required for a review_first intent", () => {
    expect(OutboundEmailToolGate.evaluate(intent("review_first"), null, null)).toEqual({
      allowed: false,
      code: "review_required",
      batchId: null,
    });
  });

  it("blocks authorization_missing for a send_now intent without authorization", () => {
    expect(OutboundEmailToolGate.evaluate(intent("send_now"), null, null)).toEqual({
      allowed: false,
      code: "authorization_missing",
      batchId: null,
    });
  });

  it("allows a send_now intent with a valid authorization (Phase 3 shape)", () => {
    const result = OutboundEmailToolGate.evaluate(
      intent("send_now"),
      { batchId: 42, authorizationId: 7 },
      null
    );
    // TypeScript narrows the discriminated union; assert the allowed branch.
    if (!result.allowed) {
      throw new Error("expected allowed");
    }
    expect(result.batchId).toBe(42);
    expect(result.authorizationId).toBe(7);
  });

  it("propagates the target batchId on blocked results", () => {
    expect(OutboundEmailToolGate.evaluate(null, null, 99)).toEqual({
      allowed: false,
      code: "draft_required",
      batchId: 99,
    });
  });
});