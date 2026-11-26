import { describe, expect, it } from "vitest";
import { SystemOneDecisionClient } from "@/service/browserDecision/SystemOneDecisionClient";

/**
 * N01/design §9.3: the user-NATIVE route. Explicitly configured only —
 * an incomplete profile (apiKeyRef "none") is INERT; native distribution
 * is allowed because the profile IS a native route; the frozen config
 * key is re-checked.
 */

const profile = {
  displayName: "My native profile",
  baseUrl: "https://native.example.test/v1",
  model: "jev-1",
  apiKeyRef: "chat" as const,
};

import type { BrowserDecisionInput } from "@/entityTypes/browserDecisionTypes";

const baseInput: BrowserDecisionInput = {
  schema_version: 1,
  request_id: "req_1",
  task_id: "task_1",
  step_id: "step_1",
  observation_id: "obs_1",
  page_revision: 1,
  goal: "g",
  subgoal: null,
  constraints: [],
  completion_criteria: [],
  url: "https://www.example.test/",
  title: "Example",
  candidates: [],
  recent_actions: [],
  allowed_operations: ["CLICK", "DONE"],
  deadline_ms: 3_000,
};

describe("SystemOneDecisionClient (N01)", () => {
  it("an INERT profile (apiKeyRef none) refuses to construct", () => {
    expect(
      () =>
        new SystemOneDecisionClient(
          { ...profile, apiKeyRef: "none" },
          { postQuestion: async () => undefined }
        )
    ).toThrow("native_profile_incomplete");
  });

  it("posts the typed question to the profile endpoint and preserves native distribution", async () => {
    const posted: Array<{ endpoint: string; body: unknown }> = [];
    const client = new SystemOneDecisionClient(
      profile,
      {
        postQuestion: async (endpoint, body) => {
          posted.push({ endpoint, body });
          return {
            status: "decided",
            action: {
              operation: "CLICK",
              target_id: "e_1",
              option_id: null,
              key: null,
              url: null,
              text: null,
            },
            uncertainty: { source: "native_distribution", confidence: 0.8 },
          };
        },
      }
    );
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.endpoint).toBe(profile.baseUrl);
    expect(decision.status).toBe("decided");
    if (decision.status === "decided") {
      expect(decision.uncertainty.source).toBe("native_distribution");
    }
  });

  it("re-checks the frozen config key before and after the request", async () => {
    let configKey: string | null = "cfg-1";
    let posts = 0;
    const client = new SystemOneDecisionClient(
      profile,
      { postQuestion: async () => { posts++; return {}; } },
      () => configKey
    );
    client.freezeRoute("cfg-1");
    configKey = "cfg-2";
    const decision = await client.decide(baseInput, new AbortController().signal);
    expect(posts).toBe(0);
    expect(decision.status).toBe("provider_error");
    if (decision.status === "provider_error") {
      expect(decision.reason_code).toBe("provider_config_changed");
    }
  });
});
