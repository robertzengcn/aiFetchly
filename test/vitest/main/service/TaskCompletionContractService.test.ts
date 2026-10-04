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
});
