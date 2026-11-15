import { describe, expect, it } from "vitest";
import { HostedDecisionClient } from "@/service/browserDecision/DecisionClients";
import type { BrowserDecisionInput } from "@/entityTypes/browserDecisionTypes";

/**
 * N01/design §9.2: the hosted decision contract v1 client — capabilities
 * discovery via the decision-models probe (a missing endpoint means
 * honest unavailability, D-AC-11), correlation echo validation, and
 * config-version re-checks (D-FR-02).
 */

const baseInput: BrowserDecisionInput = {
  schema_version: 1,
  request_id: "req_1",
  task_id: "task_1",
  step_id: "step_1",
  observation_id: "obs_1",
  page_revision: 2,
  goal: "open search",
  subgoal: null,
  constraints: [],
  completion_criteria: [],
  url: "https://www.example.test/",
  title: "Example",
  candidates: [],
  recent_actions: [],
  allowed_operations: ["CLICK", "DONE", "ESCALATE"],
  deadline_ms: 3_000,
};

const decidedEnvelope = {
  status: "decided",
  action: {
    operation: "CLICK",
    target_id: "e_1",
    option_id: null,
    key: null,
    url: null,
    text: null,
  },
  uncertainty: { source: "native_distribution", confidence: 0.9 },
  request_id: "req_1",
  task_id: "task_1",
  step_id: "step_1",
  observation_id: "obs_1",
  page_revision: 2,
};

describe("HostedDecisionClient capabilities (N01)", () => {
  it("reports advertised capabilities from the decision-models probe", async () => {
    const client = new HostedDecisionClient(
      async () => ({
        advertised: true,
        operations: ["CLICK", "FILL", "DONE", "ESCALATE"],
        maxCandidates: 100,
        deadlineDefaultMs: 2_500,
        deadlineHardMs: 8_000,
      }),
      async () => undefined
    );
    const caps = await client.getCapabilities(new AbortController().signal);
    expect(caps.advertised).toBe(true);
    expect(caps.operations).toContain("CLICK");
    expect(caps.maxCandidates).toBe(100);
  });

  it("an unadvertised route (older server) reports honest unavailability", async () => {
    const client = new HostedDecisionClient(
      async () => ({ advertised: false }),
      async () => undefined
    );
    const caps = await client.getCapabilities(new AbortController().signal);
    expect(caps.advertised).toBe(false);
    // A probe failure (throw) is the same honest unavailability.
    const failing = new HostedDecisionClient(
      async () => {
        throw new Error("network down");
      },
      async () => undefined
    );
    const caps2 = await failing.getCapabilities(new AbortController().signal);
    expect(caps2.advertised).toBe(false);
  });
});

describe("HostedDecisionClient correlation validation (N01/design §9.2)", () => {
  it("accepts an envelope whose echoed correlation matches", async () => {
    const client = new HostedDecisionClient(
      async () => ({ advertised: true }),
      async () => decidedEnvelope
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(decision.status).toBe("decided");
    if (decision.status === "decided") {
      // Native distribution is PRESERVED on the hosted route.
      expect(decision.uncertainty.source).toBe("native_distribution");
    }
  });

  it("rejects a replayed/misrouted envelope with a mismatched correlation", async () => {
    const mismatched = {
      ...decidedEnvelope,
      request_id: "req_OTHER",
    };
    const client = new HostedDecisionClient(
      async () => ({ advertised: true }),
      async () => mismatched
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("correlation_mismatch");
    }
  });

  it("rejects a stale page revision echo", async () => {
    const stale = { ...decidedEnvelope, page_revision: 1 };
    const client = new HostedDecisionClient(
      async () => ({ advertised: true }),
      async () => stale
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("correlation_mismatch");
    }
  });
});

describe("HostedDecisionClient config-version re-check (D-FR-02)", () => {
  it("aborts the decision when the frozen config key changed", async () => {
    let configKey: string | null = "cfg-1";
    let posts = 0;
    const client = new HostedDecisionClient(
      async () => ({ advertised: true }),
      async () => {
        posts++;
        return decidedEnvelope;
      },
      () => configKey
    );
    client.freezeRoute("cfg-1");
    configKey = "cfg-2"; // the provider config changed mid-task
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("provider_config_changed");
    }
    expect(posts).toBe(0);
  });

  // W01/D-FR-02: a request HELD OPEN by the provider must be aborted when
  // the configuration changes mid-flight — the late body cannot act.
  it("aborts a held-open request when the config changes mid-flight", async () => {
    let configKey: string | null = "cfg-1";
    const client = new HostedDecisionClient(
      async () => ({ advertised: true }),
      async (_input, signal) =>
        await new Promise<never>((_resolve, reject) => {
          // Simulate a hung upstream: it only settles when aborted.
          signal.addEventListener("abort", () => {
            reject(new Error("This operation was aborted"));
          });
        }),
      () => configKey
    );
    client.freezeRoute("cfg-1");
    const decisionPromise = client.decide(baseInput, new AbortController().signal);
    // The config watch polls every 500ms; flip the key after the request
    // is already in flight.
    setTimeout(() => {
      configKey = "cfg-2";
    }, 50);
    const decision = await decisionPromise;
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("provider_config_changed");
    }
  });

  it("treats an outer-abort rejection as request_aborted, not a transport failure", async () => {
    const client = new HostedDecisionClient(
      async () => ({ advertised: true }),
      async (_input, signal) =>
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("This operation was aborted"));
          });
        })
    );
    const controller = new AbortController();
    const decisionPromise = client.decide(baseInput, controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 50);
    const decision = await decisionPromise;
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("request_aborted");
    }
  });
});
