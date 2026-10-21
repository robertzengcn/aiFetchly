import { describe, expect, it, vi } from "vitest";

// R06: exercise the REAL audit DTO mapper the UI reads — supplied vs
// retrieved grounding counts must reflect the sources actually supplied to
// the model prompt, never the raw retrieval total.
//
// emailReceive-ipc.ts registers handlers only inside
// registerEmailReceiveIpcHandlers(); importing it has no side effects, but
// mock electron + Logger defensively (precedent:
// EmailReplyIpcStructuredFailure.test.ts).
vi.mock("electron", () => ({}));
vi.mock("@/modules/Logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { toAutoReplyAuditDto } from "@/main-process/communication/emailReceive-ipc";

function row(knowledgeSourcesJson: string | null) {
  return {
    id: 1,
    emailServiceId: 7,
    messageId: 100,
    draftId: null,
    ruleId: null,
    action: "auto_replied",
    decisionStatus: "replied",
    classification: null,
    confidence: null,
    reason: null,
    knowledgeQuery: "q",
    knowledgeSourcesJson,
    generatedSubject: null,
    generatedBodyPreview: null,
    sentSubject: null,
    sentBodyPreview: null,
    requiresUserApproval: 0,
    approvedByUser: 0,
    errorMessage: null,
    metadataJson: null,
    createdAt: new Date("2026-10-08T00:00:00.000Z"),
  };
}

describe("toAutoReplyAuditDto supplied-vs-retrieved grounding (R06)", () => {
  it("counts only supplied sources, keeps the retrieved total", () => {
    const dto = toAutoReplyAuditDto(
      row(
        JSON.stringify([
          { toolName: "t", chunkId: "c1", suppliedToPrompt: true },
          { toolName: "t", chunkId: "c2", suppliedToPrompt: false },
          { toolName: "t", chunkId: "c3", suppliedToPrompt: false },
        ])
      )
    );
    expect(dto.knowledgeSourceCount).toBe(1);
    expect(dto.retrievedKnowledgeSourceCount).toBe(3);
  });

  it("treats legacy rows without the flag as supplied", () => {
    const dto = toAutoReplyAuditDto(
      row(
        JSON.stringify([
          { toolName: "t", chunkId: "c1" },
          { toolName: "t", chunkId: "c2" },
        ])
      )
    );
    expect(dto.knowledgeSourceCount).toBe(2);
    expect(dto.retrievedKnowledgeSourceCount).toBe(2);
  });

  it("counts zero of zero on malformed JSON", () => {
    const dto = toAutoReplyAuditDto(row("not-json{{{"));
    expect(dto.knowledgeSourceCount).toBe(0);
    expect(dto.retrievedKnowledgeSourceCount).toBe(0);
  });
});
