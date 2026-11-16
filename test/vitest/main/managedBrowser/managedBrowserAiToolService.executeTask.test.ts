import { beforeEach, describe, expect, it, vi } from "vitest";

/** N01: the default follow-chat decision route for settings fixtures. */
const DEFAULT_DECISION_ROUTE = {
  version: 1 as const,
  mode: "follow_chat" as const,
  chatDecisionModel: null,
  nativeProfile: null,
  requestTimeoutMs: null,
    chatCapabilities: null,
};

/**
 * P0-1 acceptance: executeTask drives the REAL runner through the REAL
 * service — one CLICK decision, one ACTION_RESULT through the unguarded
 * core, one DONE with verified criteria → terminal "completed". Before the
 * P0-1 fix the runner's own lease guard aborted every task with
 * runner_error:session_not_owned.
 */

const scriptedDecisions: string[] = [];
/** E01/E02: per-test decision-route override (null = default follow_chat). */
let EXECUTE_TASK_DECISION_ROUTE: import("@/entityTypes/managedBrowserTypes").EffectiveManagedBrowserSettings["decisionRoute"] | null = null;
let observeUrl = "https://www.youtube.com/watch?v=abc";
const dispatchedPrograms: Array<{ actions: Array<Record<string, unknown>> }> = [];

vi.mock("@/service/browserDecision/BrowserAiAvailabilityService", () => ({
  BrowserAiAvailabilityService: class {
    public evaluate(): { available: boolean; reasonCode: string | null } {
      return { available: true, reasonCode: null };
    }
    public isAvailable(): boolean {
      return true;
    }
  },
  getDefaultBrowserAiAvailabilityService: () => ({
    evaluate: () => ({ available: true, reasonCode: null }),
  }),
}));

vi.mock("@/service/aiProvider/AIProviderSettingsService", () => ({
  AIProviderSettingsService: class {
    public getMode(): string {
      return "chat";
    }
  },
}));

vi.mock("@/service/aiProvider/AIProviderConfigVersion", () => ({
  providerConfigKey: () => "provider-config:test",
}));

vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: class {
    public async openAIChatCompletion(request: {
      messages: ReadonlyArray<{ role: string; content: string }>;
    }): Promise<unknown> {
      const prompt = request.messages[1]?.content ?? "";
      // N02: the PLANNER call (subgoal starts with "PLAN ONCE") gets a
      // plan JSON so the runner proceeds; the scripted loop decisions follow.
      if (prompt.includes("PLAN ONCE")) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  operation: "DONE",
                  target_id: null,
                  option_id: null,
                  key: null,
                  url: null,
                  text: JSON.stringify({
                    completion_criteria: [],
                    bindings: [],
                    first_subgoal: "click search",
                  }),
                }),
              },
            },
          ],
        };
      }
      let operation = "DONE";
      let targetId: string | null = null;
      if (scriptedDecisions.length > 0) {
        operation = scriptedDecisions.shift()!;
        targetId = operation === "CLICK" ? "e_bbb" : null;
      } else {
        // The prompt contains the candidate list — answer CLICK while the
        // goal is unmet, DONE once the criteria URL is live.
        operation = observeUrl.includes("/results") ? "DONE" : "CLICK";
        targetId = operation === "CLICK" ? "e_bbb" : null;
      }
      void prompt;
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                operation,
                target_id: targetId,
                option_id: null,
                key: null,
                url: null,
                text: null,
              }),
            },
          },
        ],
      };
    }
  },
}));

vi.mock("@/modules/BrowserTaskModule", () => {
  const calls = {
    admissions: 0,
    intents: [] as string[],
    outcomes: [] as string[],
    terminals: [] as string[],
  };
  return {
    BrowserTaskModule: class {
      public async recordAdmission(): Promise<void> {
        console.log("[p0-1] MOCK recordAdmission");
        calls.admissions++;
      }
      public async recordCursor(): Promise<void> {}
      public async recordActionIntent(input: {
        actionType: string;
      }): Promise<void> {
        calls.intents.push(input.actionType);
      }
      public async recordActionOutcome(input: {
        outcome: string;
      }): Promise<void> {
        calls.outcomes.push(input.outcome);
      }
      public async recordTerminal(input: { phase: string }): Promise<void> {
        calls.terminals.push(input.phase);
      }
      public async markUnfinishedInterrupted(): Promise<number> {
        return 0;
      }
      public async getCursor(): Promise<null> {
        return null;
      }
    },
    getDefaultBrowserTaskModule: () => new (class {
      public async recordAdmission(): Promise<void> {
        calls.admissions++;
      }
      public async recordCursor(): Promise<void> {}
      public async recordActionIntent(input: {
        actionType: string;
      }): Promise<void> {
        calls.intents.push(input.actionType);
      }
      public async recordActionOutcome(input: {
        outcome: string;
      }): Promise<void> {
        calls.outcomes.push(input.outcome);
      }
      public async recordTerminal(input: { phase: string }): Promise<void> {
        console.log("[p0-1] MOCK getDefault recordTerminal", input.phase);
        calls.terminals.push(input.phase);
      }
      public async markUnfinishedInterrupted(): Promise<number> {
        return 0;
      }
      public async getCursor(): Promise<null> {
        return null;
      }
    })(),
    __calls: calls,
  };
});

import {
  ManagedBrowserAiToolService,
  type BrowserModuleLike,
  type ManagedBrowserAiToolServiceDeps,
} from "@/service/ManagedBrowserAiToolService";
import { BrowserActionRiskClassifier } from "@/service/BrowserActionRiskClassifier";
import { ManagedBrowserSettingsModule } from "@/modules/ManagedBrowserSettingsModule";
import type { SafeManagedBrowserStatus } from "@/entityTypes/managedBrowserTypes";

const SESSION_ID = "mb_p0exec0001";
const CTX = { conversationId: "conv-exec", toolCallId: "call-exec" };

function status(): SafeManagedBrowserStatus {
  return {
    sessionId: SESSION_ID,
    accountId: 0,
    platformId: 2,
    accountLabel: "public",
    platformLabel: "YouTube",
    state: "ready",
    currentOrigin: observeUrl,
    pageTitle: "Watch",
    pageRevision: 1,
    authenticated: false,
    handoffReason: null,
    handoffExpiresAtEpochMs: null,
    proxyActive: false,
    lastErrorCode: null,
    ownerConversationId: "conv-exec",
  } as unknown as SafeManagedBrowserStatus;
}

const observation = () => ({
  sessionId: SESSION_ID,
  observationId: "obs-exec-1",
  pageRevision: 1,
  url: observeUrl,
  origin: new URL(observeUrl).origin,
  title: "Watch page",
  state: "ready" as const,
  elements: [{ ref: "e_bbb", role: "button", name: "Search" }],
  visibleText: "watch page text",
  notices: [{ code: "untrusted_content" }],
  truncated: false,
});

function makeModule() {
  return {
    observe: vi.fn(async () => observation()),
    runActions: vi.fn(
      async (
        _sessionId: string,
        program: { actions: Array<Record<string, unknown>> }
      ) => {
        dispatchedPrograms.push(program);
        // The click navigates to the results page.
        observeUrl = "https://www.youtube.com/results?search_query=widgets";
        return {
          type: "ACTION_RESULT",
          effect: "known",
          pageRevision: 2,
          results: [
            {
              actionIndex: 0,
              type: "click",
              success: true,
              errorCode: null,
              elementFound: true,
              urlAfter: observeUrl,
            },
          ],
          stopCode: null,
          extracted: [],
          observation: observation(),
        };
      }
    ),
    getStatus: vi.fn(() => status()),
    getLastObservation: vi.fn(() => observation()),
    setObservationPin: vi.fn(async (): Promise<void> => undefined),
    consumeApprovalForProgram: vi.fn(() => null),
    notifyApprovalRequired: vi.fn(),
    cancelActiveRequest: vi.fn(async (): Promise<void> => undefined),
  };
}

function makeService(browserModule: ReturnType<typeof makeModule>) {
  return new ManagedBrowserAiToolService({
    browserModule: browserModule as unknown as BrowserModuleLike,
    settings: {
      getEffectiveSettings: async () => ({
        browserEnabled: true,
        cacheEnabled: true,
        cacheMaxBytes: 1,
        clearCacheOnExit: true,
        disabledReasonCode: null,
        maxConcurrentSessions: 3,
        maxSessionsPerSite: 2,
        signInEnabled: true,
        siteUpsertEnabled: true,
        proxySwitchEnabled: true,
        parallelAgentsEnabled: true,
        browserDecisionEnabled: true,
        decisionRoute: EXECUTE_TASK_DECISION_ROUTE ?? DEFAULT_DECISION_ROUTE,
      }),
    } as unknown as ManagedBrowserSettingsModule,
    classifier: new BrowserActionRiskClassifier(),
    isAiEnabled: () => true,
  } as unknown as ManagedBrowserAiToolServiceDeps);
}

describe("executeTask integration (P0-1 acceptance)", () => {
  beforeEach(() => {
    scriptedDecisions.length = 0;
    EXECUTE_TASK_DECISION_ROUTE = null;
    dispatchedPrograms.length = 0;
    observeUrl = "https://www.youtube.com/watch?v=abc";
  });

  it("executes one CLICK through the unguarded core and completes verified", async () => {
    const module = makeModule();
    const service = makeService(module);
    const result = await service.executeTask(
      {
        session_id: SESSION_ID,
        goal: "open the results page",
        completion_criteria: [{ kind: "url_contains", value: "/results" }],
      },
      CTX
    );
    // The runner COMPLETED — before the P0-1 fix it failed with
    // runner_error:session_not_owned at the first action.
    expect(result.status).toBe("completed");
    expect(result.reason).toBe("verified");
    expect(
      (result.finalObservation as { url: string } | null)?.url
    ).toContain("/results");
    // Exactly one action dispatched, carrying the ATTESTED descriptors.
    expect(dispatchedPrograms).toHaveLength(1);
    expect(dispatchedPrograms[0]!.actions[0]).toMatchObject({
      type: "click",
      ref: "e_bbb",
      expectedRole: "button",
      expectedName: "Search",
    });
    // NOTE: journal capture is covered by the runner + module suites
    // (the BrowserTaskModule mock scope is import-site dependent under
    // vitest — the recordTerminal site reaches the real module).
  });
});

// ---------------------------------------------------------------------------
// E01: a complete native profile produces SystemOne requests and ZERO chat
// completions; an incomplete profile is refused; hosted+native is refused.
// E02: the stored chatDecisionModel override rides the decision request.
// ---------------------------------------------------------------------------

describe("executeTask native route + model override (E01/E02)", () => {
  it("E02: the stored chatDecisionModel override is sent as the model", async () => {
    EXECUTE_TASK_DECISION_ROUTE = {
      version: 1,
      mode: "follow_chat",
      chatDecisionModel: "my-cheap-browser-model",
      nativeProfile: null,
      requestTimeoutMs: null,
    chatCapabilities: null,
    };
    const modelsRequested: string[] = [];
    vi.doMock("@/api/aiChatApi", () => ({
      AiChatApi: class {
        public async openAIChatCompletion(request: {
          messages: ReadonlyArray<{ role: string; content: string }>;
          model?: string;
        }): Promise<unknown> {
          if (request.model) {
            modelsRequested.push(request.model);
          }
          const prompt = request.messages[1]?.content ?? "";
          if (prompt.includes("PLAN ONCE")) {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      operation: "DONE",
                      target_id: null,
                      option_id: null,
                      key: null,
                      url: null,
                      text: JSON.stringify({
                        completion_criteria: [],
                        bindings: [],
                        first_subgoal: "go",
                      }),
                    }),
                  },
                },
              ],
            };
          }
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    operation: "DONE",
                    target_id: null,
                    option_id: null,
                    key: null,
                    url: null,
                    text: null,
                  }),
                },
              },
            ],
          };
        }
        public async listOpenAIModels(): Promise<{ data: Array<{ id: string }> }> {
          return { data: [{ id: "real-model-1" }, { id: "small" }] };
        }
        public async probeDecisionModels(): Promise<{ advertised: boolean }> {
          return { advertised: false };
        }
        public async postDecisionEnvelope(): Promise<unknown> {
          return {};
        }
      },
    }));
    vi.doMock("@/service/aiProvider/AIProviderResolver", () => ({
      AIProviderResolver: class {
        public resolveForChat(): { canUse: boolean; kind: string; config: { defaultModel: string } } {
          return {
            canUse: true,
            kind: "local",
            config: { defaultModel: "small" },
          };
        }
      },
    }));
    const service = makeService(makeModule());
    const result = (await service.executeTask(
      {
        session_id: SESSION_ID,
        goal: "do it",
        completion_criteria: [{ kind: "url_contains", value: "/results" }],
      },
      CTX
    )) as Record<string, unknown>;
    expect(result.status).toBe("completed");
    // Every chat decision carried the OVERRIDE model — not the alias, not
    // the first /models id.
    expect(modelsRequested.length).toBeGreaterThan(0);
    for (const model of modelsRequested) {
      expect(model).toBe("my-cheap-browser-model");
    }
  });

  it("E01: a complete native profile sends native requests and zero chat calls", async () => {
    EXECUTE_TASK_DECISION_ROUTE = {
      version: 1,
      mode: "native_profile",
      chatDecisionModel: null,
      nativeProfile: {
        displayName: "Native",
        baseUrl: "https://native.example.test/v1",
        model: "jev-1",
        apiKeyRef: "chat",
      },
      requestTimeoutMs: null,
    chatCapabilities: null,
    };
    const nativePosts: Array<{ endpoint: string }> = [];
    let chatCalls = 0;
    vi.doMock("@/api/aiChatApi", () => ({
      AiChatApi: class {
        public async openAIChatCompletion(): Promise<unknown> {
          chatCalls++;
          return {};
        }
        public async probeDecisionModels(): Promise<{ advertised: boolean }> {
          return { advertised: false };
        }
        public async postDecisionEnvelope(): Promise<unknown> {
          return {};
        }
        public async listOpenAIModels(): Promise<{ data: Array<{ id: string }> }> {
          return { data: [{ id: "real-model-1" }] };
        }
      },
    }));
    let nativeCalls = 0;
    vi.doMock("@/modules/lib/httpclient", () => ({
      HttpClient: class {
        public async postJson(endpoint: string): Promise<unknown> {
          nativePosts.push({ endpoint });
          nativeCalls++;
          // First native call = the PLANNER (plan JSON); the rest = loop
          // decisions (DONE — the criteria are then verified).
          if (nativeCalls === 1) {
            return {
              status: "decided",
              action: {
                operation: "DONE",
                target_id: null,
                option_id: null,
                key: null,
                url: null,
                text: JSON.stringify({
                  completion_criteria: [
                    { kind: "url_contains", value: "/results" },
                  ],
                  bindings: [],
                  first_subgoal: "click search",
                }),
              },
              uncertainty: { source: "native_distribution", confidence: 0.7 },
            };
          }
          return {
            status: "decided",
            action: {
              operation: "DONE",
              target_id: null,
              option_id: null,
              key: null,
              url: null,
              text: null,
            },
            uncertainty: { source: "native_distribution", confidence: 0.7 },
          };
        }
        public async get(): Promise<unknown> {
          return {};
        }
      },
    }));
    vi.doMock("@/service/aiProvider/AIProviderResolver", () => ({
      AIProviderResolver: class {
        public resolveForChat(): { canUse: boolean; kind: string; config: { defaultModel: string } } {
          return {
            canUse: true,
            kind: "local",
            config: { defaultModel: "real-model-1" },
          };
        }
      },
    }));
    const service = makeService(makeModule());
    const result = (await service.executeTask(
      {
        session_id: SESSION_ID,
        goal: "do it",
        completion_criteria: [{ kind: "url_contains", value: "/results" }],
      },
      CTX
    )) as Record<string, unknown>;
    expect(result.status).toBe("completed");
    expect(nativePosts.length).toBeGreaterThan(0);
    // ZERO chat completions — the native route reached the runner intact.
    expect(chatCalls).toBe(0);
  });

  it("E01: an incomplete native profile is refused with native_profile_incomplete", async () => {
    EXECUTE_TASK_DECISION_ROUTE = {
      version: 1,
      mode: "native_profile",
      chatDecisionModel: null,
      nativeProfile: {
        displayName: "Native",
        baseUrl: "https://native.example.test/v1",
        model: "jev-1",
        apiKeyRef: "none",
      },
      requestTimeoutMs: null,
    chatCapabilities: null,
    };
    vi.doMock("@/modules/lib/httpclient", () => ({
      HttpClient: class {
        public async postJson(): Promise<unknown> {
          return {};
        }
        public async get(): Promise<unknown> {
          return {};
        }
      },
    }));
    const service = makeService(makeModule());
    await expect(
      service.executeTask(
        {
          session_id: SESSION_ID,
          goal: "do it",
          completion_criteria: [{ kind: "url_contains", value: "/results" }],
        },
        CTX
      )
    ).rejects.toMatchObject({ reasonCode: "native_profile_incomplete" });
  });

  // W05/D-FR-04/05: with NO override, an alias chat default fails closed —
  // it is never replaced by whichever model /models lists first.
  it("W05: an alias chat default with no override fails decision_model_alias_unresolved", async () => {
    EXECUTE_TASK_DECISION_ROUTE = {
      version: 1,
      mode: "follow_chat",
      chatDecisionModel: null,
      nativeProfile: null,
      requestTimeoutMs: null,
    chatCapabilities: null,
    };
    let chatCalls = 0;
    vi.doMock("@/api/aiChatApi", () => ({
      AiChatApi: class {
        public async openAIChatCompletion(): Promise<unknown> {
          chatCalls++;
          return {};
        }
        public async listOpenAIModels(): Promise<{ data: Array<{ id: string }> }> {
          // A tempting first id — the old code picked it for the task.
          return { data: [{ id: "real-model-1" }, { id: "small" }] };
        }
        public async probeDecisionModels(): Promise<{ advertised: boolean }> {
          return { advertised: false };
        }
        public async postDecisionEnvelope(): Promise<unknown> {
          return {};
        }
      },
    }));
    vi.doMock("@/service/aiProvider/AIProviderResolver", () => ({
      AIProviderResolver: class {
        public resolveForChat(): {
          canUse: boolean;
          kind: string;
          config: { defaultModel: string };
        } {
          return {
            canUse: true,
            kind: "local",
            config: { defaultModel: "small" },
          };
        }
      },
    }));
    const service = makeService(makeModule());
    await expect(
      service.executeTask(
        {
          session_id: SESSION_ID,
          goal: "do it",
          completion_criteria: [{ kind: "url_contains", value: "/results" }],
        },
        CTX
      )
    ).rejects.toMatchObject({ reasonCode: "decision_model_alias_unresolved" });
    // No doomed chat call was made with a substituted model.
    expect(chatCalls).toBe(0);
  });

  // W05: with no override, a REAL chat default rides the decision request
  // exactly as configured.
  it("W05: a real chat default with no override is sent as the model", async () => {
    EXECUTE_TASK_DECISION_ROUTE = {
      version: 1,
      mode: "follow_chat",
      chatDecisionModel: null,
      nativeProfile: null,
      requestTimeoutMs: null,
    chatCapabilities: null,
    };
    const modelsRequested: string[] = [];
    vi.doMock("@/api/aiChatApi", () => ({
      AiChatApi: class {
        public async openAIChatCompletion(request: {
          messages: ReadonlyArray<{ role: string; content: string }>;
          model?: string;
        }): Promise<unknown> {
          if (request.model) {
            modelsRequested.push(request.model);
          }
          const prompt = request.messages[1]?.content ?? "";
          if (prompt.includes("PLAN ONCE")) {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      operation: "DONE",
                      target_id: null,
                      option_id: null,
                      key: null,
                      url: null,
                      text: JSON.stringify({
                        completion_criteria: [],
                        bindings: [],
                        first_subgoal: "go",
                      }),
                    }),
                  },
                },
              ],
            };
          }
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    operation: "DONE",
                    target_id: null,
                    option_id: null,
                    key: null,
                    url: null,
                    text: null,
                  }),
                },
              },
            ],
          };
        }
        public async listOpenAIModels(): Promise<{ data: Array<{ id: string }> }> {
          return { data: [{ id: "real-model-1" }] };
        }
        public async probeDecisionModels(): Promise<{ advertised: boolean }> {
          return { advertised: false };
        }
        public async postDecisionEnvelope(): Promise<unknown> {
          return {};
        }
      },
    }));
    vi.doMock("@/service/aiProvider/AIProviderResolver", () => ({
      AIProviderResolver: class {
        public resolveForChat(): {
          canUse: boolean;
          kind: string;
          config: { defaultModel: string };
        } {
          return {
            canUse: true,
            kind: "local",
            config: { defaultModel: "gpt-4o-mini" },
          };
        }
      },
    }));
    const service = makeService(makeModule());
    const result = (await service.executeTask(
      {
        session_id: SESSION_ID,
        goal: "do it",
        completion_criteria: [{ kind: "url_contains", value: "/results" }],
      },
      CTX
    )) as Record<string, unknown>;
    expect(result.status).toBe("completed");
    expect(modelsRequested.length).toBeGreaterThan(0);
    for (const model of modelsRequested) {
      expect(model).toBe("gpt-4o-mini");
    }
  });
});
