import { describe, expect, it } from "vitest";
import { runPlanner, sanitizePlan } from "@/service/browserDecision/TaskPlanner";
import type { BrowserDecisionClient } from "@/entityTypes/browserDecisionTypes";

/** N02/D-FR-05/D-FR-20: the one-shot task planner. */

const plannerInput = {
  goal: "search suppliers",
  constraints: [],
  completionCriteria: [],
  url: "https://www.example.test/",
  title: "Example",
};

const decidedWithPlan = (text: string) => ({
  status: "decided" as const,
  action: {
    operation: "DONE" as const,
    target_id: null,
    option_id: null,
    key: null,
    url: null,
    text,
  },
  uncertainty: { source: "unavailable" as const, confidence: null },
});

describe("runPlanner (N02/D-FR-05)", () => {
  it("returns the sanitized plan from a DONE-with-JSON decision", async () => {
    const client: BrowserDecisionClient = {
      getCapabilities: async () => ({}) as never,
      decide: async () =>
        decidedWithPlan(
          JSON.stringify({
            completion_criteria: [
              { kind: "url_contains", value: "/results" },
            ],
            bindings: [
              { field: "search", value: "widgets" },
            ],
            first_subgoal: "type the query and submit",
          })
        ),
    };
    const plan = await runPlanner(client, plannerInput, new AbortController().signal);
    expect(plan).not.toBeNull();
    expect(plan!.completionCriteria).toEqual([
      { kind: "url_contains", value: "/results" },
    ]);
    expect(plan!.bindings).toEqual([{ field: "search", value: "widgets" }]);
    expect(plan!.firstSubgoal).toBe("type the query and submit");
  });

  it("null on any non-decided outcome (planner failure is its own reason)", async () => {
    const client: BrowserDecisionClient = {
      getCapabilities: async () => ({}) as never,
      decide: async () => ({
        status: "provider_error",
        reason_code: "chat_request_failed",
      }),
    };
    const plan = await runPlanner(client, plannerInput, new AbortController().signal);
    expect(plan).toBeNull();
  });

  it("null on malformed plan JSON", async () => {
    const client: BrowserDecisionClient = {
      getCapabilities: async () => ({}) as never,
      decide: async () => decidedWithPlan("not json at all"),
    };
    expect(
      await runPlanner(client, plannerInput, new AbortController().signal)
    ).toBeNull();
  });
});

describe("sanitizePlan (N02/D-FR-20)", () => {
  it("drops secret-shaped binding values, keeps the rest", () => {
    const plan = sanitizePlan({
      bindings: [
        { field: "search", value: "widgets" },
        { field: "token", value: "sk-abcdefghijklmnopqrst" },
      ],
      completion_criteria: [{ kind: "url_contains", value: "/results" }],
      first_subgoal: "go",
    });
    expect(plan).not.toBeNull();
    expect(plan!.bindings).toHaveLength(1);
    expect(plan!.bindings[0]!.value).toBe("widgets");
  });

  it("an entirely empty plan is a failure (null)", () => {
    expect(sanitizePlan({ bindings: [], completion_criteria: [], first_subgoal: null })).toBeNull();
  });

  it("caps bindings at 8 and values at 2000 chars", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      field: `f${i}`,
      value: "x".repeat(1999),
    }));
    const plan = sanitizePlan({ bindings: many, completion_criteria: [], first_subgoal: "go" });
    expect(plan!.bindings).toHaveLength(8);
    const tooLong = sanitizePlan({
      bindings: [{ field: "f", value: "x".repeat(2001) }],
      completion_criteria: [],
      first_subgoal: "go",
    });
    expect(tooLong!.bindings).toHaveLength(0);
  });
});
