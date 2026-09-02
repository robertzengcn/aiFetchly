import { describe, expect, it } from "vitest";
import { OutboundEmailPreflightService } from "@/service/outboundEmail/OutboundEmailPreflightService";
import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { BatchEnvelopeEntry } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import type { OutboundEmailDraftRevisionEntity } from "@/entity/OutboundEmailDraftRevision.entity";

interface DraftView {
  draft: Pick<
    OutboundEmailDraftEntity,
    | "id"
    | "batchId"
    | "recipientAddress"
    | "currentRevisionId"
    | "revisionNumber"
  >;
  revision: OutboundEmailDraftRevisionEntity | null;
}

function makeView(
  overrides: Partial<{
    draftId: number;
    batchId: number;
    recipientAddress: string;
    revisionNumber: number;
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    emailServiceId: number;
    senderAddress: string;
    contentHash: string;
  }> = {}
): DraftView {
  const draftId = overrides.draftId ?? 1;
  const revisionNumber = overrides.revisionNumber ?? 1;
  const contentHash = overrides.contentHash ?? "a".repeat(64);
  return {
    draft: {
      id: draftId,
      batchId: overrides.batchId ?? 1,
      recipientAddress: overrides.recipientAddress ?? "a@example.com",
      currentRevisionId: draftId * 100,
      revisionNumber,
    },
    revision: {
      id: draftId * 100,
      draftId,
      revisionNumber,
      actor: "ai",
      emailServiceId: overrides.emailServiceId ?? 1,
      senderAddress: overrides.senderAddress ?? "sender@example.com",
      recipientAddress: overrides.recipientAddress ?? "a@example.com",
      subject: overrides.subject ?? "Hello",
      bodyText: overrides.bodyText ?? "Hi there",
      bodyHtml: overrides.bodyHtml ?? null,
      contentHash,
      personalizationEvidenceJson: null,
      knowledgeSourcesJson: null,
      generationMetadataJson: null,
      validationFindingsJson: null,
    } as OutboundEmailDraftRevisionEntity,
  };
}

function envelopeFor(view: DraftView): BatchEnvelopeEntry {
  const r = view.revision!;
  return {
    version: 1,
    draftId: view.draft.id,
    emailServiceId: r.emailServiceId,
    senderAddress: r.senderAddress,
    recipientAddress: r.recipientAddress,
    subject: r.subject,
    bodyText: r.bodyText,
    bodyHtml: r.bodyHtml,
  };
}

describe("OutboundEmailPreflightService", () => {
  const service = new OutboundEmailPreflightService();

  it("blocks an empty batch", () => {
    const result = service.run([]);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "batch_empty")).toBe(true);
    expect(result.batchHash).toBeNull();
  });

  it("blocks an invalid recipient address", () => {
    const view = makeView({ recipientAddress: "not-an-email" });
    const result = service.run([
      {
        view,
        envelope: envelopeFor(view),
        storedHash: view.revision!.contentHash,
      },
    ]);
    expect(result.passed).toBe(false);
    expect(
      result.findings.some((f) => f.code === "invalid_recipient_address")
    ).toBe(true);
  });

  it("blocks a draft with no current revision", () => {
    const view = makeView();
    view.revision = null;
    const result = service.run([{ view, envelope: null, storedHash: null }]);
    expect(result.passed).toBe(false);
    expect(
      result.findings.some((f) => f.code === "missing_current_revision")
    ).toBe(true);
  });

  it("blocks when the recomputed envelope hash mismatches the stored hash", () => {
    const view = makeView();
    const result = service.run([
      {
        view,
        envelope: envelopeFor(view),
        storedHash: "b".repeat(64),
      },
    ]);
    expect(result.passed).toBe(false);
    expect(
      result.findings.some((f) => f.code === "envelope_hash_mismatch")
    ).toBe(true);
  });

  it("blocks an oversize batch with batch_limit_exceeded", () => {
    const views = Array.from({ length: 101 }, (_, i) =>
      makeView({ draftId: i + 1, recipientAddress: `r${i}@example.com` })
    ).map((view) => ({
      view,
      envelope: envelopeFor(view),
      storedHash: view.revision!.contentHash,
    }));
    const result = service.run(views);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "batch_limit_exceeded")).toBe(
      true
    );
  });

  it("blocks an oversize HTML body with batch_limit_exceeded", () => {
    const view = makeView({ bodyHtml: "<p>" + "x".repeat(50_001) + "</p>" });
    const result = service.run([
      {
        view,
        envelope: envelopeFor(view),
        storedHash: view.revision!.contentHash,
      },
    ]);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "batch_limit_exceeded")).toBe(
      true
    );
  });

  it("passes a valid complete batch and returns the batch hash", () => {
    const v1 = makeView({ draftId: 1, recipientAddress: "a@example.com" });
    const v2 = makeView({ draftId: 2, recipientAddress: "b@example.com" });
    // The stored hash must equal the recomputed envelope hash to pass.
    const hashOf = (v: DraftView) =>
      OutboundEmailEnvelopeHasher.hashEnvelope(envelopeFor(v));
    const result = service.run([
      { view: v1, envelope: envelopeFor(v1), storedHash: hashOf(v1) },
      { view: v2, envelope: envelopeFor(v2), storedHash: hashOf(v2) },
    ]);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.batchHash).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic: same input -> same batch hash (order-independent).
    const again = service.run([
      { view: v2, envelope: envelopeFor(v2), storedHash: hashOf(v2) },
      { view: v1, envelope: envelopeFor(v1), storedHash: hashOf(v1) },
    ]);
    expect(again.batchHash).toBe(result.batchHash);
  });
});
