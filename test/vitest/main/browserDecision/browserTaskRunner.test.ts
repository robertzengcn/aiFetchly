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
    deps.runActions = async (
      _sessionId: string,
      _input: { actions: RunnerAction[] }
    ): Promise<RunnerExecutionResult> => ({
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

  it("attempts bounded recovery after three equivalent failures, then stops (D-FR-25/22)", async () => {
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
    // The fake deps.decide only serves the initial script; the recovery
    // call goes through the same client, so give it a script-tail answer.
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_r4", conversationId: "conv-1", goal: "click go" },
      deps
    );
    const result = await runner.run();
    // 3 failing decide() calls + 1 recovery decide() call; the recovered
    // decision is consumed WITHOUT a new call (pendingRecovery), and its
    // follow-up sees the exhausted script -> llm_required (decisionRequests 5).
    expect(calls).toBe(4);
    expect(result.counts.recoveryCalls).toBe(1);
    // The recovered decision also failed; the follow-up decision saw the
    // exhausted script and escalated honestly -> partial, not failed.
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("escalated:script_end");
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
    deps.runActions = async (
      _sessionId: string,
      input: { actions: RunnerAction[] }
    ): Promise<RunnerExecutionResult> => {
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

describe("F05 lifecycle checks at every await boundary", () => {
  const decisionInput: import("@/entityTypes/browserDecisionTypes").BrowserDecisionInput = {
    schema_version: 1 as const,
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
  };

  it("stop during the fresh DONE observation yields cancelled, not completed", async () => {
    const aborter = new AbortController();
    const deps = makeRunnerDeps([doneEntry()]);
    let observeCalls = 0;
    deps.observe = async (): Promise<RunnerObservation | null> => {
      observeCalls++;
      // 1st: loop-top observe. 2nd: the fresh DONE verification observe —
      // the user's Stop lands while it is in flight.
      if (observeCalls === 2) {
        aborter.abort();
      }
      return observation();
    };
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_f05a",
        conversationId: "conv-1",
        goal: "finish",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      { ...deps, signal: aborter.signal }
    );
    const result = await runner.run();
    expect(result.status).toBe("cancelled");
    expect(result.reason).toBe("task_cancelled");
  });

  it("an action held across a pause+resume during persistActionIntent is discarded, never dispatched", async () => {
    let runner: BrowserTaskRunner;
    const deps = makeRunnerDeps([
      {
        status: "decided",
        action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: null },
      },
      doneEntry(),
    ]);
    const dispatched: RunnerAction[] = [];
    deps.runActions = async (
      _sessionId: string,
      input: { actions: RunnerAction[] }
    ): Promise<RunnerExecutionResult> => {
      dispatched.push(...input.actions);
      return { effect: "known", pageRevision: 3, results: [{ success: true, errorCode: null }] };
    };
    // A user pause+resume (takeover round-trip) lands while the journal
    // write is in flight — generation bumps and the held action is stale.
    const persistActionIntent = async (): Promise<void> => {
      deps.control.setState(runner.taskId, "paused");
      deps.control.resume(runner.taskId);
    };
    runner = new BrowserTaskRunner(
      {
        sessionId: "mb_f05b",
        conversationId: "conv-1",
        goal: "click",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      { ...deps, persistActionIntent }
    );
    const result = await runner.run();
    // The held CLICK never reached the page.
    expect(dispatched).toEqual([]);
    expect(result.status).toBe("completed");
    expect(result.evidence).toContain("action_discarded_after_resume");
  });

  it("chat client never invokes complete() on an already-aborted signal", async () => {
    let calls = 0;
    const client = new ChatCompletionDecisionClient(
      async () => {
        calls++;
        return {};
      }
    );
    const controller = new AbortController();
    controller.abort();
    const decision = await client.decide(decisionInput, controller.signal);
    expect(calls).toBe(0);
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("request_aborted");
    }
  });

  it("chat client discards a response when the provider config changed in flight", async () => {
    let configKey: string | null = "k1";
    const client = new ChatCompletionDecisionClient(
      async () => {
        // The provider change lands WHILE the request is in flight.
        configKey = "k2";
        return {
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
        };
      },
      undefined,
      () => configKey
    );
    client.freezeRoute("k1");
    const decision = await client.decide(decisionInput, new AbortController().signal);
    expect(decision).toEqual({
      status: "provider_error",
      reason_code: "provider_config_changed",
    });
  });

  it("chat client discards a late response that arrives after the abort", async () => {
    const controller = new AbortController();
    const client = new ChatCompletionDecisionClient(
      async (_request, signal) => {
        controller.abort(); // the deadline/task abort lands while awaiting
        void signal;
        return {
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
        };
      }
    );
    const decision = await client.decide(decisionInput, controller.signal);
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("request_aborted");
    }
  });

  it("hosted client never posts on an already-aborted signal", async () => {
    let calls = 0;
    const client = new HostedDecisionClient(
      async () => {
        calls++;
        return {};
      }
    );
    const controller = new AbortController();
    controller.abort();
    const decision = await client.decide(decisionInput, controller.signal);
    expect(calls).toBe(0);
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("request_aborted");
    }
  });
});

describe("BrowserTaskRunner F07 persistence and terminal correctness", () => {
  it("an execution exception finalizes failed — never completed", async () => {
    const deps = makeRunnerDeps([
      {
        status: "decided",
        action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: null },
      },
    ]);
    deps.runActions = async (): Promise<RunnerExecutionResult> => {
      throw new Error("worker exited");
    };
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_f07a", conversationId: "conv-1", goal: "click" },
      deps
    );
    const result = await runner.run();
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("runner_error:worker exited");
  });

  it("a known failed step journals no_effect — never confirmed", async () => {
    const outcomes: Array<"confirmed" | "no_effect" | "unknown"> = [];
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
      results: [{ success: false, errorCode: "stale_page_reference" }],
    });
    const persistActionOutcome = async (
      outcome: "confirmed" | "no_effect" | "unknown"
    ): Promise<void> => {
      outcomes.push(outcome);
    };
    // No completion criteria: the loop ends via budget with the failed
    // step already journaled honestly.
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_f07b", conversationId: "conv-1", goal: "click" },
      { ...deps, persistActionOutcome }
    );
    await runner.run();
    expect(outcomes).toEqual(["no_effect"]);
  });

  it("persists the RUNNING and TERMINAL cursor phases with real counters", async () => {
    const phases: Array<{ phase: string; leafSteps: number; decisionRequests: number }> = [];
    const deps = makeRunnerDeps([
      {
        status: "decided",
        action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
        uncertainty: { source: "unavailable", confidence: null },
      },
      doneEntry(),
    ]);
    const persistCursor = async (input: {
      phase: string;
      leafSteps: number;
      decisionRequests: number;
    }): Promise<void> => {
      phases.push({ phase: input.phase, leafSteps: input.leafSteps, decisionRequests: input.decisionRequests });
    };
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_f07c",
        conversationId: "conv-1",
        goal: "click",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      { ...deps, persistCursor }
    );
    const result = await runner.run();
    expect(result.status).toBe("completed");
    expect(phases[0]).toMatchObject({ phase: "running", leafSteps: 0 });
    const terminalPhase = phases[phases.length - 1]!;
    expect(terminalPhase.phase).toBe("completed");
    expect(terminalPhase.leafSteps).toBe(1);
    expect(terminalPhase.decisionRequests).toBe(2);
  });
});

describe("BrowserTaskRunner F06 in-job approval wait", () => {
  const approvalRequiredStop: RunnerExecutionResult = {
    effect: "known",
    pageRevision: 3,
    results: [],
    stopCode: "approval_required",
  };
  const clickDecision: import("@/entityTypes/browserDecisionTypes").BrowserDecisionResult = {
    status: "decided",
    action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
    uncertainty: { source: "unavailable", confidence: null },
  };

  it("re-dispatches the preserved pending step after approval", async () => {
    const dispatches: number[] = [];
    let dispatchCount = 0;
    const deps = makeRunnerDeps([clickDecision, doneEntry()]);
    deps.runActions = async (): Promise<RunnerExecutionResult> => {
      dispatchCount++;
      dispatches.push(dispatchCount);
      if (dispatchCount === 1) {
        return approvalRequiredStop;
      }
      return { effect: "known", pageRevision: 3, results: [{ success: true, errorCode: null }] };
    };
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_f06app",
        conversationId: "conv-1",
        goal: "click",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      {
        ...deps,
        awaitApproval: async () => "approved",
      }
    );
    const result = await runner.run();
    // The SAME pending step was re-dispatched (2 dispatches total) and the
    // task completed.
    expect(dispatches).toEqual([1, 2]);
    expect(result.status).toBe("completed");
    expect(result.evidence).toContain("CLICK:Go:approval_granted");
  });

  it("ends partial with approval_denied when the user denies", async () => {
    const deps = makeRunnerDeps([clickDecision]);
    deps.runActions = async (): Promise<RunnerExecutionResult> => approvalRequiredStop;
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_f06deny", conversationId: "conv-1", goal: "click" },
      { ...deps, awaitApproval: async () => "denied" }
    );
    const result = await runner.run();
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("approval_denied");
  });

  it("caps approval re-dispatches to avoid a pathological approve loop", async () => {
    let dispatchCount = 0;
    const deps = makeRunnerDeps([clickDecision]);
    deps.runActions = async (): Promise<RunnerExecutionResult> => {
      dispatchCount++;
      return approvalRequiredStop;
    };
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_f06loop", conversationId: "conv-1", goal: "click" },
      { ...deps, awaitApproval: async () => "approved" }
    );
    const result = await runner.run();
    // Initial dispatch + 3 approved re-dispatches, then the depth cap ends
    // the task with the honest approval_required terminal.
    expect(dispatchCount).toBe(4);
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("approval_required");
  });
});

describe("normalizeWireResult F14 bounds and honest uncertainty", () => {
  const bareFill = {
    operation: "FILL",
    target_id: "c1",
    option_id: null,
    key: null,
    url: null,
    text: "x",
  };

  it("rejects an oversized bare FILL text (same bound as the strict schema)", () => {
    const oversized = normalizeWireResult({
      ...bareFill,
      text: "x".repeat(2001),
    });
    expect(oversized).toEqual({
      status: "invalid_input",
      reason_code: "schema_violation",
    });
    // Exactly at the bound is accepted.
    const atBound = normalizeWireResult({
      ...bareFill,
      text: "x".repeat(2000),
    });
    expect(atBound.status).toBe("decided");
  });

  it("rejects an oversized bare NAVIGATE url", () => {
    const oversized = normalizeWireResult({
      operation: "NAVIGATE",
      target_id: null,
      option_id: null,
      key: null,
      url: `https://example.test/${"x".repeat(2100)}`,
      text: null,
    });
    expect(oversized).toEqual({
      status: "invalid_input",
      reason_code: "schema_violation",
    });
  });

  it("strips claimed native_distribution from chat responses (D-FR-19)", () => {
    const claimed = {
      status: "decided",
      action: bareFill,
      uncertainty: { source: "native_distribution", confidence: 0.99 },
    };
    // Chat path: the claim is untrusted.
    const chat = normalizeWireResult(claimed, { allowNativeDistribution: false });
    expect(chat).toEqual({
      status: "decided",
      action: bareFill,
      uncertainty: { source: "unavailable", confidence: null },
    });
    // Hosted native path: the claim is honored.
    const hosted = normalizeWireResult(claimed);
    if (hosted.status === "decided") {
      expect(hosted.uncertainty).toEqual({
        source: "native_distribution",
        confidence: 0.99,
      });
    } else {
      throw new Error("expected decided");
    }
  });
});

describe("BrowserTaskRunner F14 SELECT option mapping", () => {
  it("maps the decided positional option id to the OBSERVED value", async () => {
    const seen: RunnerAction[] = [];
    const obs = observation({
      elements: [
        {
          ref: "e_sel",
          role: "combobox",
          name: "Country",
          option_ids: ["o_0", "o_1", "o_2"],
          option_values: ["de", "fr", "jp"],
        },
      ],
    });
    const deps = makeRunnerDeps(
      [
        {
          status: "decided",
          action: { operation: "SELECT", target_id: "e_sel", option_id: "o_1", key: null, url: null, text: null },
          uncertainty: { source: "unavailable", confidence: null },
        },
        doneEntry(),
      ],
      obs
    );
    deps.runActions = async (
      _sessionId: string,
      input: { actions: RunnerAction[] }
    ): Promise<RunnerExecutionResult> => {
      seen.push(...input.actions);
      return { effect: "known", pageRevision: 3, results: [{ success: true, errorCode: null }] };
    };
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_f14sel",
        conversationId: "conv-1",
        goal: "pick country",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      deps
    );
    const result = await runner.run();
    // o_1 resolved to the REAL observed value "fr" — never the raw token.
    expect(seen[0]).toMatchObject({ type: "select", values: ["fr"] });
    expect(result.status).toBe("completed");
  });

  it("refuses an option id outside the observed list", async () => {
    const seen: RunnerAction[] = [];
    const obs = observation({
      elements: [
        {
          ref: "e_sel",
          role: "combobox",
          name: "Country",
          option_ids: ["o_0"],
          option_values: ["de"],
        },
      ],
    });
    const deps = makeRunnerDeps(
      [
        {
          status: "decided",
          action: { operation: "SELECT", target_id: "e_sel", option_id: "o_7", key: null, url: null, text: null },
          uncertainty: { source: "unavailable", confidence: null },
        },
        doneEntry(),
      ],
      obs
    );
    deps.runActions = async (
      _sessionId: string,
      input: { actions: RunnerAction[] }
    ): Promise<RunnerExecutionResult> => {
      seen.push(...input.actions);
      return { effect: "known", pageRevision: 3, results: [{ success: true, errorCode: null }] };
    };
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_f14sel2",
        conversationId: "conv-1",
        goal: "pick country",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      deps
    );
    const result = await runner.run();
    // The unobserved option never dispatched; the loop continued to DONE.
    expect(seen).toEqual([]);
    expect(result.status).toBe("completed");
  });
});

describe("BrowserTaskRunner F15 progress and recovery", () => {
  it("a successful FILL counts as progress even when URL/text stand still", async () => {
    // A mutable observation: each FILL changes the field's valueSummary.
    const obs = observation();
    const mutableElements = obs.elements as Array<{
      ref: string;
      role: string;
      name: string;
      valueSummary?: string;
    }>;
    const deps = makeRunnerDeps(
      Array.from({ length: 7 }, (_, i) => ({
        status: "decided" as const,
        action: {
          operation: i === 6 ? ("DONE" as const) : ("FILL" as const),
          target_id: "e_aaa",
          option_id: null,
          key: null,
          url: null,
          text: `query ${i}`,
        },
        uncertainty: { source: "unavailable" as const, confidence: null },
      })),
      obs
    );
    deps.runActions = async (): Promise<RunnerExecutionResult> => {
      // The fill mutates the page state: the next observation's field
      // summary differs.
      const kept = mutableElements.filter((el) => el.ref !== "e_aaa");
      mutableElements.length = 0;
      mutableElements.push(
        ...kept,
        {
          ref: "e_aaa",
          role: "textbox",
          name: "Search",
          valueSummary: `query-${Date.now()}-${Math.random()}`,
        },
      );
      return { effect: "known", pageRevision: obs.pageRevision, results: [{ success: true, errorCode: null }] };
    };
    const runner = new BrowserTaskRunner(
      {
        sessionId: "mb_f15fill",
        conversationId: "conv-1",
        goal: "search",
        completionCriteria: [{ kind: "url_contains", value: "/search" }],
      },
      deps
    );
    const result = await runner.run();
    // 6 fills + DONE: form-state progress kept the task alive to DONE.
    expect(result.status).toBe("completed");
  });

  it("5+ steps that change NOTHING end as no_progress", async () => {
    const deps = makeRunnerDeps([]);
    deps.decisionClient = {
      getCapabilities: async () => ({}) as never,
      decide: async (input: unknown) => {
        // The recovery attempt FAILS (llm_required): no alternative exists.
        if ((input as { step_id?: string }).step_id?.includes("_recovery")) {
          return { status: "llm_required", reason_code: "no_alternative" };
        }
        return {
          status: "decided" as const,
          action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
          uncertainty: { source: "unavailable" as const, confidence: null },
        };
      },
    } as unknown as typeof deps.decisionClient;
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_f15stuck", conversationId: "conv-1", goal: "click" },
      deps
    );
    const result = await runner.run();
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("no_progress");
  });

  it("recovery decide runs under its OWN bounded attempt signal, not the outer one", async () => {
    // 5 no-progress steps trigger recovery; the recovery decide captures
    // the signal it received — it must be a DIFFERENT (bounded) signal.
    let recoverySignal: AbortSignal | null = null;
    let recoveryCalls = 0;
    const deps = makeRunnerDeps([]);
    deps.decisionClient = {
      getCapabilities: async () => ({}) as never,
      decide: async (input: unknown, signal: AbortSignal) => {
        if ((input as { step_id?: string }).step_id?.includes("_recovery")) {
          recoveryCalls++;
          recoverySignal = signal;
          // The recovery proposal: ESCALATE ends the task honestly.
          return {
            status: "decided" as const,
            action: { operation: "ESCALATE", target_id: null, option_id: null, key: null, url: null, text: null },
            uncertainty: { source: "unavailable" as const, confidence: null },
          };
        }
        return {
          status: "decided" as const,
          action: { operation: "CLICK", target_id: "e_bbb", option_id: null, key: null, url: null, text: null },
          uncertainty: { source: "unavailable" as const, confidence: null },
        };
      },
    } as unknown as typeof deps.decisionClient;
    const outer = new AbortController();
    const runner = new BrowserTaskRunner(
      { sessionId: "mb_f15rec", conversationId: "conv-1", goal: "click" },
      { ...deps, signal: outer.signal }
    );
    const result = await runner.run();
    expect(recoveryCalls).toBe(1);
    // A DIFFERENT signal than the outer task signal (bounded attempt).
    expect(recoverySignal).not.toBe(outer.signal);
    expect(recoverySignal!.aborted).toBe(false);
    // The ESCALATE recovery proposal ends the task as an escalation.
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("escalated_by_decision");
  });
});
