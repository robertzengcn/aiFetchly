import { describe, expect, it } from "vitest";
import { BrowserTaskRunner } from "@/service/browserDecision/BrowserTaskRunner";
import type {
  RunnerAction,
  RunnerExecutionResult,
  RunnerObservation,
} from "@/service/browserDecision/BrowserTaskRunner";
import {
  ChatCompletionDecisionClient,
  HostedDecisionClient,
  buildChatDecisionPrompt,
  normalizeWireResult,
} from "@/service/browserDecision/DecisionClients";
import { buildDecisionCandidates } from "@/service/browserDecision/BrowserCandidateBuilder";
import { AgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";

/** PRD D-FR-05..25: the runner loop, budgets, verification, and adapters. */

function observation(overrides: Partial<RunnerObservation> = {}): RunnerObservation {
  return {
    observationId: "obs-1",
    pageRevision: 3,
    url: "https://example.test/search",
    title: "Example",
    elements: [
      { ref: "e_aaa", role: "textbox", name: "Search" },
      { ref: "e_bbb", role: "button", name: "Go" },
      { ref: "e_ccc", role: "textbox", name: "Card number", valueSummary: "[password-like]" },
    ],
    visibleText: "Example Market",
    ...overrides,
  };
}

function makeRunnerDeps(
  script: Array<BrowserDecisionResultWireLike>,
  observationOverrides: Partial<RunnerObservation> = {},
  onAction?: (action: RunnerAction) => void
) {
  const obs = observation(observationOverrides);
  return {
    observe: async (): Promise<RunnerObservation | null> => obs,
    runActions: async (
      _sessionId: string,
      input: { actions: RunnerAction[] }
    ): Promise<RunnerExecutionResult> => {
      onAction?.(input.actions[0]!);
      return {
        effect: "known",
        pageRevision: obs.pageRevision,
        results: [{ success: true, errorCode: null }],
      };
    },
    decisionClient: {
      getCapabilities: async () => ({}) as never,
      decide: async () => script.shift() ?? { status: "llm_required", reason_code: "script_end" },
    },
    route: "chat" as const,
    control: new AgentTaskControlService(),
  };
}

function doneEntry() {
  return {
    status: "decided" as const,
    action: { operation: "DONE" as const, target_id: null, option_id: null, key: null, url: null, text: null },
    uncertainty: { source: "unavailable" as const, confidence: null },
  };
}

type BrowserDecisionResultWireLike = import("@/entityTypes/browserDecisionTypes").BrowserDecisionResult;

describe("BrowserTaskRunner (D-FR-05..25)", () => {
  it("completes a fill + click script and verifies with criteria", async () => {
    const clicks: RunnerAction[] = [];
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_r1",
        conversationId: "conv-1",
        goal: "Search for widgets",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      makeRunnerDeps(
        [
          {
            status: "decided",
            action: { operation: "FILL", target_id: "e_aaa", option_id: null, key: null, url: null, text: "supplier prices" },
            uncertainty: { source: "unavailable", confidence: null },
          },
          {
            status: "decided",
            action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
            uncertainty: { source: "unavailable", confidence: null },
          },
          {
            status: "decided",
            action: { operation: "DONE", target_id: null, option_id: null, key: null, url: null, text: null },
            uncertainty: { source: "unavailable", confidence: null },
          },
        ],
        {},
        (action) => clicks.push(action)
      )
    );
    const result = await runner.run();
    expect(result.status).toBe("completed");
    expect(result.reason).toBe("verified");
    expect(result.counts.leafSteps).toBe(2);
    expect(clicks.map((a) => a.type)).toEqual(["fill", "click"]);
    // The decision's text channel reaches the fill — never an empty value.
    expect(clicks[0]).toMatchObject({ type: "fill", value: "supplier prices" });
    // D-FR-10b: compact final observation for follow-up turns.
    expect(result.finalObservation?.url).toBe("https://example.test/search");
  });

  it("never trusts a DONE without independent verification (D-AC-09)", async () => {
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_r2",
        conversationId: "conv-1",
        goal: "Open the second result",
        completionCriteria: [{ kind: "url_contains", value: "/result-2" }],
      },
      makeRunnerDeps([
        doneEntry(),
        doneEntry(),
        doneEntry(),
      ])
    );
    const result = await runner.run();
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("verification_failed_budget_exhausted");
  });

  it("excludes password-like controls from candidates (D-AC-04)", () => {
    const candidates = buildDecisionCandidates({ elements: observation().elements });
    expect(candidates.map((c) => c.candidate_id)).toEqual(["e_aaa", "e_bbb"]);
  });

  it("stops on unknown effect and never retries the mutation (D-FR-26)", async () => {
    const deps = makeRunnerDeps([
      {
        status: "decided",
        action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: null },
      },
    ]);
    deps.runActions = async (): Promise<RunnerExecutionResult> => ({
      effect: "unknown",
      pageRevision: 3,
      results: [{ success: false, errorCode: "internal_error" }],
    });
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_r3", conversationId: "conv-1", goal: "click go" },
      deps
    );
    const result = await runner.run();
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("unknown_execution_effect");
    expect(result.counts.leafSteps).toBe(1);
  });

  it("stops after three equivalent failures (D-FR-25)", async () => {
    let calls = 0;
    const deps = makeRunnerDeps(
      [0, 1, 2, 3].map(() => ({
        status: "decided" as const,
        action: { operation: "CLICK" as const, target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable" as const, confidence: null },
      }))
    );
    deps.runActions = async (): Promise<RunnerExecutionResult> => {
      calls++;
      return {
        effect: "known",
        pageRevision: 3,
        results: [{ success: false, errorCode: "internal_error" }],
      };
    };
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_r4", conversationId: "conv-1", goal: "click go" },
      deps
    );
    const result = await runner.run();
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("three_equivalent_failures");
    expect(calls).toBe(3);
  });

  it("normalizes ESCALATE to a truthful partial result", async () => {
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_r5", conversationId: "conv-1", goal: "ambiguous" },
      makeRunnerDeps([{ status: "llm_required", reason_code: "escalated" }])
    );
    const result = await runner.run();
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("escalated:escalated");
  });
});

describe("BrowserTaskRunner policy stops (D-AC-05)", () => {
  it("terminates partial on approval_required without retrying", async () => {
    const deps = makeRunnerDeps([
      {
        status: "decided",
        action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: null },
      },
    ]);
    deps.runActions = async (): Promise<RunnerExecutionResult> => ({
      effect: "known",
      pageRevision: 3,
      results: [],
      stopCode: "approval_required",
    });
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_stop1", conversationId: "conv-1", goal: "click go" },
      deps
    );
    const result = await runner.run();
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("approval_required");
  });

  it("refuses a FILL decision without text instead of typing an empty value", async () => {
    const seen: RunnerAction[] = [];
    const deps = makeRunnerDeps(
      [
        {
          status: "decided",
          action: { operation: "FILL", target_id: "e_aaa", option_id: null, key: null, url: null, text: null },
          uncertainty: { source: "unavailable", confidence: null },
        },
      ],
      {},
      (action) => seen.push(action)
    );
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_stop2", conversationId: "conv-1", goal: "fill search" },
      deps
    );
    const result = await runner.run();
    expect(seen).toEqual([]);
    expect(result.status).toBe("partial");
  });
});

describe("BrowserTaskRunner T06/T07/T08", () => {
  it("sends Enter for an untargeted PRESS_KEY decision (T06)", async () => {
    const seen: RunnerAction[] = [];
    const deps = makeRunnerDeps(
      [
        {
          status: "decided",
          action: { operation: "PRESS_KEY", target_id: null, option_id: null, key: "Enter", url: null, text: null },
          uncertainty: { source: "unavailable", confidence: null },
        },
        {
          status: "decided",
          action: { operation: "DONE", target_id: null, option_id: null, key: null, url: null, text: null },
          uncertainty: { source: "unavailable", confidence: null },
        },
      ],
      {},
      (action) => seen.push(action)
    );
    // No completion criteria: DONE would be unverified -> partial. Use a
    // url criterion matching the fixed observation so DONE verifies.
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_pk1",
        conversationId: "conv-1",
        goal: "submit search",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      deps
    );
    const result = await runner.run();
    expect(seen).toEqual([{ type: "press_key", key: "Enter" }]);
    expect(result.status).toBe("completed");
  });

  it("applies unknown-effect stop uniformly to GO_BACK (T07)", async () => {
    const deps = makeRunnerDeps([
      {
        status: "decided",
        action: { operation: "GO_BACK", target_id: null, option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: null },
      },
    ]);
    deps.runActions = async (): Promise<RunnerExecutionResult> => ({
      effect: "unknown",
      pageRevision: 3,
      results: [],
    });
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_gb1", conversationId: "conv-1", goal: "go back" },
      deps
    );
    const result = await runner.run();
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("unknown_execution_effect");
  });

  it("applies approval stops uniformly to SCROLL (T07)", async () => {
    const deps = makeRunnerDeps([
      {
        status: "decided",
        action: { operation: "SCROLL_DOWN", target_id: null, option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: null },
      },
    ]);
    deps.runActions = async (): Promise<RunnerExecutionResult> => ({
      effect: "known",
      pageRevision: 3,
      results: [],
      stopCode: "approval_required",
    });
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_sc1", conversationId: "conv-1", goal: "scroll" },
      deps
    );
    const result = await runner.run();
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("approval_required");
  });

  it("discards an in-flight decision when the task is cancelled mid-call (T08)", async () => {
    const aborter = new AbortController();
    const deps = makeRunnerDeps([
      {
        status: "decided",
        action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: null },
      },
    ]);
    const actions: RunnerAction[] = [];
    deps.runActions = async (input: { actions: RunnerAction[] }): Promise<RunnerExecutionResult> => {
      actions.push(...input.actions);
      return { effect: "known", pageRevision: 3, results: [{ success: true, errorCode: null }] };
    };
    deps.decisionClient = {
      getCapabilities: async () => ({}) as never,
      decide: async () => {
        aborter.abort(); // user Stop during inference
        return {
          status: "decided",
          action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
          uncertainty: { source: "unavailable", confidence: null },
        };
      },
    };
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_t08", conversationId: "conv-1", goal: "click" },
      { ...deps, signal: aborter.signal }
    );
    const result = await runner.run();
    expect(actions).toEqual([]);
    expect(result.status).toBe("cancelled");
  });
});

describe("DecisionClients (D-FR-16..19)", () => {
  it("chat client returns a decided action from strict JSON", async () => {
    const client = new ChatCompletionDecisionClient(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              operation: "CLICK",
              target_id: "c1",
              option_id: null,
              key: null,
              url: null,
            }),
          },
        },
      ],
    }));
    const decision = await client.decide(
      {
        schema_version: 1,
        request_id: "r",
        task_id: "t",
        step_id: "s",
        observation_id: "o",
        page_revision: 1,
        goal: "g",
        constraints: [],
        url: "u",
        title: "t",
        candidates: [
          { candidate_id: "c1", role: "button", name: "Go", allowed_operations: ["CLICK"] },
        ],
        recent_actions: [],
        allowed_operations: ["CLICK"],
        deadline_ms: 1000,
      },
      new AbortController().signal
    );
    expect(decision.status).toBe("decided");
    if (decision.status === "decided") {
      // D-FR-19: no calibrated confidence for chat routes.
      expect(decision.uncertainty).toEqual({ source: "unavailable", confidence: null });
    }
  });

  it("chat client treats ESCALATE as a normal llm_required outcome", async () => {
    const client = new ChatCompletionDecisionClient(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              operation: "ESCALATE",
              target_id: null,
              option_id: null,
              key: null,
              url: null,
            }),
          },
        },
      ],
    }));
    const decision = await client.decide(
      {
        schema_version: 1,
        request_id: "r",
        task_id: "t",
        step_id: "s",
        observation_id: "o",
        page_revision: 1,
        goal: "g",
        constraints: [],
        url: "u",
        title: "t",
        candidates: [],
        recent_actions: [],
        allowed_operations: ["ESCALATE"],
        deadline_ms: 1000,
      },
      new AbortController().signal
    );
    expect(decision.status).toBe("decided");
    if (decision.status === "decided") {
      expect(decision.action.operation).toBe("ESCALATE");
    }
  });

  it("chat client caps provider attempts at two (D-FR-18)", async () => {
    let calls = 0;
    const client = new ChatCompletionDecisionClient(async () => {
      calls++;
      return { choices: [{ message: { content: "not json at all" } }] };
    });
    const decision = await client.decide(
      {
        schema_version: 1,
        request_id: "r",
        task_id: "t",
        step_id: "s",
        observation_id: "o",
        page_revision: 1,
        goal: "g",
        constraints: [],
        url: "u",
        title: "t",
        candidates: [],
        recent_actions: [],
        allowed_operations: ["CLICK"],
        deadline_ms: 1000,
      },
      new AbortController().signal
    );
    expect(decision.status).toBe("provider_error");
    expect(calls).toBe(2);
  });

  it("hosted client reports unavailable on a 404 (D-AC-11)", async () => {
    const client = new HostedDecisionClient(async () => {
      const error = new Error("404 not found");
      throw error;
    });
    const decision = await client.decide(
      {
        schema_version: 1,
        request_id: "r",
        task_id: "t",
        step_id: "s",
        observation_id: "o",
        page_revision: 1,
        goal: "g",
        constraints: [],
        url: "u",
        title: "t",
        candidates: [],
        recent_actions: [],
        allowed_operations: ["CLICK"],
        deadline_ms: 1000,
      },
      new AbortController().signal
    );
    expect(decision).toEqual({
      status: "provider_error",
      reason_code: "hosted_decision_unavailable",
    });
  });

  it("normalizes wire results and rejects fabricated confidence", () => {
    expect(
      normalizeWireResult({
        status: "decided",
        action: { operation: "WAIT", target_id: null, option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: 0.93 },
      })
    ).toEqual({
      status: "decided",
      action: { operation: "WAIT", target_id: null, option_id: null, key: null, url: null, text: null },
      uncertainty: { source: "unavailable", confidence: null },
    });
    expect(normalizeWireResult({ status: "garbage" })).toEqual({
      status: "invalid_input",
      reason_code: "schema_violation",
    });
  });

  it("includes ESCALATE guidance and the candidate set in the chat prompt", () => {
    const prompt = buildChatDecisionPrompt({
      schema_version: 1,
      request_id: "r",
      task_id: "t",
      step_id: "s",
      observation_id: "o",
      page_revision: 1,
      goal: "search",
      constraints: [],
      url: "u",
      title: "t",
      candidates: [{ candidate_id: "c1", role: "button", name: "Go", allowed_operations: ["CLICK"] }],
      recent_actions: [],
      allowed_operations: ["CLICK", "ESCALATE"],
      deadline_ms: 1000,
    });
    expect(prompt).toContain("c1");
    void prompt;
    expect(CHAT_PROMPT_CONTAINS_ESCALATE_GUIDANCE).toBe(true);
  });
});

import { CHAT_DECISION_SYSTEM_PROMPT } from "@/service/browserDecision/DecisionClients";
const CHAT_PROMPT_CONTAINS_ESCALATE_GUIDANCE = CHAT_DECISION_SYSTEM_PROMPT.includes("ESCALATE");
