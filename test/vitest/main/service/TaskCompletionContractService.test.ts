import { describe, expect, it } from "vitest";
import { TaskCompletionContractService } from "@/service/aiTaskExecution/TaskCompletionContractService";
import type { TaskCriterion } from "@/entityTypes/aiTaskExecutionTypes";

function recordCountCriterion(
  id: string,
  minimum: number,
  scope: "execution" | "lineage" | "cumulative"
): TaskCriterion {
  return {
    id,
    required: true,
    kind: "record_count",
    description: `save ${minimum} contacts`,
    adapterKey: "contact-campaign",
    targetId: "camp-1",
    scope,
    minimum,
    sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 20 }],
  };
}

describe("TaskCompletionContractService.freeze", () => {
  it("produces a stable hash for the same objective/criteria/sources", () => {
    const svc = new TaskCompletionContractService();
    const criteria = [recordCountCriterion("rec-1", 100, "cumulative")];
    const c1 = svc.freeze({
      objective: "Save 100 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria,
    });
    const c2 = svc.freeze({
      objective: "Save 100 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria,
    });
    expect(c2.contractHash).toBe(c1.contractHash);
    expect(c2.contractId).not.toBe(c1.contractId); // distinct IDs
  });

  it("changes the hash when the objective changes (scope change detection)", () => {
    const svc = new TaskCompletionContractService();
    const criteria = [recordCountCriterion("rec-1", 100, "cumulative")];
    const c1 = svc.freeze({
      objective: "Save 100 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria,
    });
    const c2 = svc.freeze({
      objective: "Save 200 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria,
    });
    expect(c2.contractHash).not.toBe(c1.contractHash);
  });

  it("rejects a criterion whose sourceRef messageId is not in approvedSourceMessageIds", () => {
    const svc = new TaskCompletionContractService();
    expect(() =>
      svc.freeze({
        objective: "do x",
        sourceUserMessageId: "msg-1",
        approvedSourceMessageIds: ["msg-1"],
        mode: "verified",
        criteria: [
          {
            id: "rec-1",
            required: true,
            kind: "record_count",
            description: "save 100",
            adapterKey: "contact-campaign",
            targetId: "camp-1",
            scope: "cumulative",
            minimum: 100,
            sourceRefs: [
              { messageId: "msg-NOT-APPROVED", startOffset: 0, endOffset: 5 },
            ],
          },
        ],
      })
    ).toThrow();
  });

  it("rejects a zero-required-criteria verified contract (no vacuous pass, FR-04)", () => {
    const svc = new TaskCompletionContractService();
    expect(() =>
      svc.freeze({
        objective: "do x",
        sourceUserMessageId: "msg-1",
        approvedSourceMessageIds: ["msg-1"],
        mode: "verified",
        criteria: [],
      })
    ).toThrow();
  });

  it("accepts a best-effort contract with zero required criteria (unverified by default)", () => {
    const svc = new TaskCompletionContractService();
    const c = svc.freeze({
      objective: "draft something",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "best_effort",
      criteria: [],
    });
    expect(c.mode).toBe("best_effort");
    expect(c.contractHash.length).toBeGreaterThan(0);
  });

  it("hash is invariant to criteria order and duplicate approved IDs (§5.1)", () => {
    // Two semantically identical contracts with criteria in different array
    // order must hash identically — otherwise unchanged Continue contracts
    // hash differently and scope-change detection produces false positives.
    const svc = new TaskCompletionContractService();
    const a = recordCountCriterion("rec-1", 100, "cumulative");
    const b: TaskCriterion = {
      ...recordCountCriterion("rec-2", 1, "execution"),
      required: false,
    };
    const base = {
      objective: "x",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1", "msg-2"],
      mode: "best_effort" as const,
    };
    const h1 = svc.freeze({ ...base, criteria: [a, b] }).contractHash;
    const h2 = svc.freeze({ ...base, criteria: [b, a] }).contractHash;
    expect(h2).toBe(h1);
  });

  it("hash is invariant to approvedSourceMessageIds order (§5.1)", () => {
    const svc = new TaskCompletionContractService();
    const criteria = [recordCountCriterion("rec-1", 100, "cumulative")];
    const h1 = svc.freeze({
      objective: "x",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1", "msg-2", "msg-3"],
      mode: "best_effort",
      criteria,
    }).contractHash;
    const h2 = svc.freeze({
      objective: "x",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-3", "msg-2", "msg-1"],
      mode: "best_effort",
      criteria,
    }).contractHash;
    expect(h2).toBe(h1);
  });

  it("schema-validates the frozen output: rejects empty objective (schema parity)", () => {
    const svc = new TaskCompletionContractService();
    expect(() =>
      svc.freeze({
        objective: "",
        sourceUserMessageId: "msg-1",
        approvedSourceMessageIds: ["msg-1"],
        mode: "best_effort",
        criteria: [],
      })
    ).toThrow();
  });

  it("schema-validates the frozen output: rejects negative startOffset (schema parity)", () => {
    const svc = new TaskCompletionContractService();
    expect(() =>
      svc.freeze({
        objective: "do x",
        sourceUserMessageId: "msg-1",
        approvedSourceMessageIds: ["msg-1"],
        mode: "best_effort",
        criteria: [
          {
            id: "rec-1",
            required: false,
            kind: "record_count",
            description: "save 100",
            adapterKey: "contact-campaign",
            targetId: "camp-1",
            scope: "cumulative",
            minimum: 100,
            sourceRefs: [
              { messageId: "msg-1", startOffset: -5, endOffset: 20 },
            ],
          },
        ],
      })
    ).toThrow();
  });
});

describe("TaskCompletionContractService.verifyHash (FR-19)", () => {
  it("round-trips: verifyHash returns true for an unmodified frozen contract", () => {
    const svc = new TaskCompletionContractService();
    const contract = svc.freeze({
      objective: "Save 100 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria: [recordCountCriterion("rec-1", 100, "cumulative")],
    });
    expect(svc.verifyHash(contract)).toBe(true);
  });

  it("detects tampering: verifyHash returns false when objective is changed", () => {
    const svc = new TaskCompletionContractService();
    const contract = svc.freeze({
      objective: "Save 100 contacts to camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria: [recordCountCriterion("rec-1", 100, "cumulative")],
    });
    const tampered = { ...contract, objective: "Save 200 contacts to camp-1" };
    expect(svc.verifyHash(tampered)).toBe(false);
  });

  it("frozen contract is immune to post-freeze caller mutation (structuredClone deep-copy)", () => {
    // A caller mutating a criterion's nested sourceRefs after freeze must
    // not alter the frozen contract or flip verifyHash to false.
    const svc = new TaskCompletionContractService();
    const criterion = recordCountCriterion("rec-1", 100, "cumulative");
    const contract = svc.freeze({
      objective: "x",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified",
      criteria: [criterion],
    });
    criterion.sourceRefs[0].messageId = "tampered";
    expect(contract.criteria[0].sourceRefs[0].messageId).toBe("msg-1");
    expect(svc.verifyHash(contract)).toBe(true);
  });
});
