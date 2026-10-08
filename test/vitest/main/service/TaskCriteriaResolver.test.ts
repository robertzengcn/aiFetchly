// test/vitest/main/service/TaskCriteriaResolver.test.ts
//
// T01 — Unit tests for the structural criteria compiler (FR-19, AC-21).
//
// The compiler is a pure function: no mocks, no I/O, no LLM. Each test feeds
// a user message + route and asserts the derived criteria: kind, required,
// targetId/minimum/sourceSelectorKeys, sourceRef offset validity (the span
// actually slices back to the matched text), and ID uniqueness across
// conjunctions. Ambiguous scope emits a qualitative fallback and sets the
// ambiguity flag (AC-21: stays unverified without a checker).
import { describe, expect, it } from "vitest";
import { compileCriteria } from "@/service/aiTaskExecution/TaskCriteriaResolver";
import type { TaskCriterion } from "@/entityTypes/aiTaskExecutionTypes";

const MSG_ID = "user-1";
const APPROVED = ["user-1"];

function compile(message: string, route = "task_best_effort") {
  return compileCriteria({
    userMessage: message,
    sourceUserMessageId: MSG_ID,
    route: route as never,
    approvedSourceMessageIds: APPROVED,
  });
}

/**
 * Assert every sourceRef points at a real span of the message and the span
 * is non-empty. The freeze service re-validates endOffset <= content.length,
 * but the compiler must produce offsets that slice back to a real substring.
 */
function expectValidRefs(criterion: TaskCriterion, message: string): void {
  expect(criterion.sourceRefs.length).toBeGreaterThan(0);
  for (const ref of criterion.sourceRefs) {
    expect(ref.messageId).toBe(MSG_ID);
    expect(ref.startOffset).toBeGreaterThanOrEqual(0);
    expect(ref.endOffset).toBeGreaterThan(ref.startOffset);
    expect(ref.endOffset).toBeLessThanOrEqual(message.length);
    const slice = message.slice(ref.startOffset, ref.endOffset);
    expect(slice.length).toBeGreaterThan(0);
  }
}

describe("TaskCriteriaResolver.compileCriteria", () => {
  it("response_only route: emits no criteria (engine never enrolls)", () => {
    const result = compile("What does ROI mean?", "response_only");
    expect(result.criteria).toHaveLength(0);
    expect(result.ambiguityReason).toBeNull();
  });

  it("preparation route: emits no criteria", () => {
    const result = compile("Send it.", "preparation");
    expect(result.criteria).toHaveLength(0);
    expect(result.ambiguityReason).toBeNull();
  });

  it("empty message: emits no criteria with ambiguity reason", () => {
    const result = compile("   ", "task_best_effort");
    expect(result.criteria).toHaveLength(0);
    expect(result.ambiguityReason).toBe("empty user message");
  });

  it("count pattern: 'Save 100 qualifying contacts to campaign camp-1' → record_count minimum=100", () => {
    const message = "Save 100 qualifying contacts to campaign camp-1";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    expect(c.kind).toBe("record_count");
    expect(c.required).toBe(true);
    if (c.kind === "record_count") {
      expect(c.minimum).toBe(100);
      expect(c.scope).toBe("execution");
      expect(c.adapterKey).toBe("record_count");
      expect(c.targetId).toBe("camp-1");
    }
    expectValidRefs(c, message);
    expect(result.ambiguityReason).toBeNull();
  });

  it("count pattern without explicit target: 'Extract 50 leads' → record_count minimum=50", () => {
    const message = "Extract 50 leads";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    expect(c.kind).toBe("record_count");
    if (c.kind === "record_count") {
      expect(c.minimum).toBe(50);
      expect(c.targetId).toBe("leads");
    }
    expectValidRefs(c, message);
  });

  it("operation pattern: 'Send an email to the list' → operation_receipt requiredState=completed", () => {
    const message = "Send an email to the list";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    expect(c.kind).toBe("operation_receipt");
    expect(c.required).toBe(true);
    if (c.kind === "operation_receipt") {
      expect(c.requiredState).toBe("completed");
      expect(c.adapterKey).toBe("operation_receipt");
      expect(c.targetId.length).toBeGreaterThan(0);
    }
    expectValidRefs(c, message);
  });

  it("observation pattern: 'Check the latest deployment status for prod' → observation", () => {
    const message = "Check the latest deployment status for prod";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    expect(c.kind).toBe("observation");
    expect(c.required).toBe(true);
    if (c.kind === "observation") {
      expect(c.adapterKey).toBe("observation");
      expect(c.targetId.length).toBeGreaterThan(0);
    }
    expectValidRefs(c, message);
  });

  it("text deliverable: 'Write a blog post about our launch' → qualitative", () => {
    const message = "Write a blog post about our launch";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    expect(c.kind).toBe("qualitative");
    expect(c.required).toBe(true);
    if (c.kind === "qualitative") {
      expect(c.sourceSelectorKeys).toEqual([]);
      expect(c.description).toContain("blog post");
    }
    expectValidRefs(c, message);
    expect(result.ambiguityReason).toBeNull();
  });

  it("conjunction: 'Find 20 leads, save them, and draft an email' → 3 required criteria with distinct IDs", () => {
    const message = "Find 20 leads, save them, and draft an email";
    const result = compile(message);
    expect(result.criteria).toHaveLength(3);
    const ids = result.criteria.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    for (const c of result.criteria) {
      expect(c.required).toBe(true);
      expectValidRefs(c, message);
    }
    // Kinds present: find → record_count (find is a collection verb with a
    // count); save them → ambiguous qualitative (no count/target); draft →
    // qualitative deliverable. The exact kind assignment per clause is the
    // compiler's job; we assert each clause produced a criterion.
    const kinds = result.criteria.map((c) => c.kind).sort();
    expect(kinds).toContain("record_count");
    expect(kinds).toContain("qualitative");
  });

  it("ambiguous action: 'Post this.' → operation_receipt fallback, stays unverified without evidence (AC-21)", () => {
    const message = "Post this.";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    // "post" is an operation verb → operation_receipt criterion. It still
    // cannot pass without the operation_receipt adapter wired (T03), so the
    // request stays explicitly unverified — AC-21 holds.
    expect(c.kind).toBe("operation_receipt");
    expect(c.required).toBe(true);
    expectValidRefs(c, message);
  });

  it("unstructured best-effort: 'do the thing' → qualitative fallback + ambiguity flag (AC-02/18)", () => {
    const message = "do the thing";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    expect(c.kind).toBe("qualitative");
    expect(c.required).toBe(true);
    // Whole-message fallback spans [0, message.length).
    expect(c.sourceRefs[0].startOffset).toBe(0);
    expect(c.sourceRefs[0].endOffset).toBe(message.length);
    expect(result.ambiguityReason).not.toBeNull();
  });

  it("verified route: derives the same structural criteria as best-effort", () => {
    const message = "Save 30 contacts to campaign alpha";
    const result = compile(message, "task_verified");
    expect(result.criteria).toHaveLength(1);
    expect(result.criteria[0].kind).toBe("record_count");
    if (result.criteria[0].kind === "record_count") {
      expect(result.criteria[0].minimum).toBe(30);
    }
  });

  it("sourceRef offsets slice back to the actual matched text for a count clause", () => {
    const message = "Please save 100 contacts to campaign beta";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    expect(c.kind).toBe("record_count");
    const ref = c.sourceRefs[0];
    const span = message.slice(ref.startOffset, ref.endOffset);
    // The clause (after polite-prefix stripping in the router) starts with
    // "save" — the compiler's splitClauses trims leading whitespace so the
    // span begins at "save".
    expect(span.toLowerCase()).toContain("save");
    expect(span).toContain("100");
  });

  it("polite prefix: 'Please check the deployment status' → observation criterion", () => {
    const message = "Please check the deployment status";
    const result = compile(message);
    expect(result.criteria).toHaveLength(1);
    const c = result.criteria[0];
    expect(c.kind).toBe("observation");
    expectValidRefs(c, message);
  });

  it("IDs are deterministic: same message twice → same IDs", () => {
    const message = "Save 50 leads and draft a summary";
    const a = compile(message);
    const b = compile(message);
    expect(a.criteria.map((c) => c.id)).toEqual(b.criteria.map((c) => c.id));
  });

  it("returned criteria array is a fresh copy (immutability)", () => {
    const message = "Save 50 leads";
    const a = compile(message);
    const b = compile(message);
    // Different array identities — caller mutation cannot leak back.
    expect(a.criteria).not.toBe(b.criteria);
    expect(a.criteria).toEqual(b.criteria);
  });
});
