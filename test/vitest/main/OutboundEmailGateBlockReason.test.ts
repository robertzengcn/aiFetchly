import { describe, expect, it } from "vitest";
import { explainOutboundGateBlock } from "@/service/outboundEmail/OutboundEmailGateBlockReason";

/**
 * Unit tests for the model-facing gate-block reason text (technical design
 * §14.2/§19). The previous single hardcoded string was returned for every
 * blocking code, including `draft_required`, giving the model no signal how
 * to unblock — it kept re-drafting batches and re-calling the send tool in a
 * loop. Each code must now yield a distinct, actionable instruction that
 * references the batch id (when present) and tells the model to stop retrying.
 */
describe("explainOutboundGateBlock", () => {
  it("tells the model to draft first for draft_required", () => {
    const reason = explainOutboundGateBlock("draft_required", null);
    expect(reason).toContain("draft_outbound_email_batch");
    expect(reason).not.toContain("batch 42");
  });

  it("references the batch id when present for draft_required", () => {
    const reason = explainOutboundGateBlock("draft_required", 42);
    expect(reason).toContain("batch 42");
    expect(reason).toContain("draft_outbound_email_batch");
  });

  it("tells the model to stop re-drafting for review_required", () => {
    const reason = explainOutboundGateBlock("review_required", 7);
    expect(reason).toContain("batch 7");
    expect(reason).toContain("Do NOT re-draft");
    expect(reason).toContain("review");
  });

  it("tells the model to ask the user to confirm for authorization_missing", () => {
    const reason = explainOutboundGateBlock("authorization_missing", 9);
    expect(reason).toContain("batch 9");
    expect(reason).toContain("confirm");
    expect(reason).toContain("do not re-draft");
  });

  it("says the authorization expired for authorization_expired", () => {
    const reason = explainOutboundGateBlock("authorization_expired", 3);
    expect(reason).toContain("expired");
    expect(reason).toContain("confirm");
  });

  it("explains draft edits for authorization_invalidated", () => {
    const reason = explainOutboundGateBlock("authorization_invalidated", 3);
    expect(reason).toContain("invalidated");
    expect(reason).toContain("edited");
  });

  it("explains envelope changes for batch_hash_mismatch", () => {
    const reason = explainOutboundGateBlock("batch_hash_mismatch", 5);
    expect(reason).toContain("changed");
    expect(reason).toContain("Re-draft");
  });

  it("forbids retries for permission_denied", () => {
    const reason = explainOutboundGateBlock("permission_denied", 1);
    expect(reason).toContain("Do not retry");
  });

  it("never leaks the legacy single-string reason for any code", () => {
    const legacy =
      "Outbound email sending requires a request-scoped authorization";
    for (const code of [
      "draft_required",
      "review_required",
      "authorization_missing",
      "authorization_expired",
      "authorization_invalidated",
      "batch_hash_mismatch",
      "permission_denied",
    ] as const) {
      expect(explainOutboundGateBlock(code, null)).not.toContain(legacy);
    }
  });
});
