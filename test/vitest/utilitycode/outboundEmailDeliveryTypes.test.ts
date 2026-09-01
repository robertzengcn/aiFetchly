import { describe, it, expect } from "vitest";
import {
  outboundEmailDeliveryModeSchema,
  outboundEmailIntentReasonCodeSchema,
  outboundEmailBatchStatusSchema,
  outboundEmailDraftStatusSchema,
  outboundEmailAuthorizationTypeSchema,
  outboundEmailSendAttemptStatusSchema,
  outboundEmailRecipientOutcomeStatusSchema,
  outboundEmailIntentEvidenceSchema,
  authorizedOutboundEnvelopeSchema,
  authorizedEmailWorkerPayloadV2Schema,
} from "@/entityTypes/outboundEmailDeliveryTypes";

describe("outboundEmailDeliveryTypes schemas", () => {
  it("accepts the three delivery modes and rejects others", () => {
    expect(outboundEmailDeliveryModeSchema.parse("send_now")).toBe("send_now");
    expect(outboundEmailDeliveryModeSchema.parse("review_first")).toBe("review_first");
    expect(outboundEmailDeliveryModeSchema.parse("draft_only")).toBe("draft_only");
    expect(() => outboundEmailDeliveryModeSchema.parse("auto_send")).toThrow();
  });

  it("accepts all intent reason codes and rejects unknown ones", () => {
    for (const code of [
      "explicit_send_instruction",
      "explicit_review_instruction",
      "explicit_do_not_send",
      "conflicting_instruction",
      "ambiguous_instruction",
      "contextual_affirmation",
      "resolver_failure",
    ]) {
      expect(outboundEmailIntentReasonCodeSchema.parse(code)).toBe(code);
    }
    expect(() => outboundEmailIntentReasonCodeSchema.parse("model_decided")).toThrow();
  });

  it("accepts the full batch lifecycle statuses", () => {
    for (const s of [
      "drafting", "draft_ready", "preflight_failed", "awaiting_review",
      "direct_authorized", "review_authorized", "queued", "sending",
      "partially_sent", "sent", "delivery_unknown", "failed", "discarded",
    ]) {
      expect(outboundEmailBatchStatusSchema.parse(s)).toBe(s);
    }
    expect(() => outboundEmailBatchStatusSchema.parse("approved")).toThrow();
  });

  it("accepts draft, authorization, attempt, and recipient outcome statuses", () => {
    expect(outboundEmailDraftStatusSchema.parse("submitted")).toBe("submitted");
    expect(outboundEmailAuthorizationTypeSchema.parse("explicit_user_instruction")).toBe("explicit_user_instruction");
    expect(outboundEmailAuthorizationTypeSchema.parse("exact_draft_approval")).toBe("exact_draft_approval");
    expect(outboundEmailSendAttemptStatusSchema.parse("claimed")).toBe("claimed");
    expect(outboundEmailRecipientOutcomeStatusSchema.parse("suppressed")).toBe("suppressed");
    expect(() => outboundEmailRecipientOutcomeStatusSchema.parse("bounced")).toThrow();
  });

  it("validates evidence offsets are non-negative and ordered", () => {
    const ok = outboundEmailIntentEvidenceSchema.safeParse({
      start: 0, end: 4, normalizedPhrase: "send", category: "send",
    });
    expect(ok.success).toBe(true);
    const badOrder = outboundEmailIntentEvidenceSchema.safeParse({
      start: 5, end: 2, normalizedPhrase: "x", category: "send",
    });
    expect(badOrder.success).toBe(false);
    const badNegative = outboundEmailIntentEvidenceSchema.safeParse({
      start: -1, end: 2, normalizedPhrase: "x", category: "review",
    });
    expect(badNegative.success).toBe(false);
  });

  it("validates an authorized envelope requires a 64-char hash and nullable html", () => {
    const base = {
      draftId: 1, revisionId: 2, revisionNumber: 1,
      recipientAddress: "a@b.com", emailServiceId: 3,
      senderAddress: "s@b.com", subject: "Hi", bodyText: "Body",
      bodyHtml: null, envelopeHash: "x".repeat(64),
    };
    expect(authorizedOutboundEnvelopeSchema.safeParse(base).success).toBe(true);
    expect(authorizedOutboundEnvelopeSchema.safeParse({ ...base, envelopeHash: "short" }).success).toBe(false);
    expect(authorizedOutboundEnvelopeSchema.safeParse({ ...base, bodyHtml: "<p>hi</p>" }).success).toBe(true);
  });

  it("validates the v2 worker payload discriminated shape", () => {
    const payload = {
      version: 2 as const, mode: "authorized_envelopes" as const,
      batchId: 1, sendAttemptId: 2, batchHash: "h".repeat(64),
      envelopes: [], emailServices: [],
    };
    expect(authorizedEmailWorkerPayloadV2Schema.safeParse(payload).success).toBe(true);
    expect(authorizedEmailWorkerPayloadV2Schema.safeParse({ ...payload, version: 1 }).success).toBe(false);
    expect(authorizedEmailWorkerPayloadV2Schema.safeParse({ ...payload, mode: "legacy" }).success).toBe(false);
  });
});
