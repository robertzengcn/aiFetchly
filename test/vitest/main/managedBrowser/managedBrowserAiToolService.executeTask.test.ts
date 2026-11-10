import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P0-1 acceptance: executeTask drives the REAL runner through the REAL
 * service — one CLICK decision, one ACTION_RESULT through the unguarded
 * core, one DONE with verified criteria → terminal "completed". Before the
 * P0-1 fix the runner's own lease guard aborted every task with
 * runner_error:session_not_owned.
 */

const scriptedDecisions: string[] = [];
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
      }),
    } as unknown as ManagedBrowserSettingsModule,
    classifier: new BrowserActionRiskClassifier(),
    isAiEnabled: () => true,
  } as unknown as ManagedBrowserAiToolServiceDeps);
}

describe("executeTask integration (P0-1 acceptance)", () => {
  beforeEach(() => {
    scriptedDecisions.length = 0;
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
