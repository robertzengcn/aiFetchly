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
    expect(
      OutboundEmailToolGate.evaluate(intent("draft_only"), null, null)
    ).toEqual({
      allowed: false,
      code: "draft_required",
      batchId: null,
    });
  });

  it("blocks review_required for draft_only once a draft batch exists", () => {
    // A durable batch is already reviewable. Telling the model to draft
    // again (draft_required) is what produced the 24-batch retry loop.
    expect(
      OutboundEmailToolGate.evaluate(intent("draft_only"), null, 30)
    ).toEqual({
      allowed: false,
      code: "review_required",
      batchId: 30,
    });
  });

  it("blocks review_required for a review_first intent", () => {
    expect(
      OutboundEmailToolGate.evaluate(intent("review_first"), null, null)
    ).toEqual({
      allowed: false,
      code: "review_required",
      batchId: null,
    });
  });

  it("requires a draft before asking for send authorization", () => {
    expect(
      OutboundEmailToolGate.evaluate(intent("send_now"), null, null)
    ).toEqual({
      allowed: false,
      code: "draft_required",
      batchId: null,
    });
  });

  it("requires user review for send_now once a draft exists but has no approval", () => {
    // LLM-composed content is not sendable just because the user said
    // "send". A draft without an approval must wait for the Review click.
    expect(OutboundEmailToolGate.evaluate(intent("send_now"), null, 7)).toEqual(
      {
        allowed: false,
        code: "review_required",
        batchId: 7,
      }
    );
  });

  it("allows a send_now intent with a valid authorization (Phase 3 shape)", () => {
    const result = OutboundEmailToolGate.evaluate(
      intent("send_now"),
      { batchId: 42, authorizationId: 7, batchHash: "a".repeat(64) },
      null
    );
    // TypeScript narrows the discriminated union; assert the allowed branch.
    if (!result.allowed || result.skipReviewDirectSend === true) {
      throw new Error("expected allowed");
    }
    expect(result.batchId).toBe(42);
    expect(result.authorizationId).toBe(7);
    expect(result.batchHash).toBe("a".repeat(64));
  });

  it("propagates the target batchId on blocked results", () => {
    expect(OutboundEmailToolGate.evaluate(null, null, 99)).toEqual({
      allowed: false,
      code: "draft_required",
      batchId: 99,
    });
  });
});
