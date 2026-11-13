import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  AIChatTitleService,
  type AIChatTitleModuleSurface,
  type AIChatTitleServiceDeps,
  type ResolvedTitleProvider,
} from "@/service/AIChatTitleService";
import type { PreparedTitleCandidate } from "@/service/aiChatTitle/AIChatTitleTypes";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";
import type { LocalAIProviderConfig } from "@/entityTypes/aiProviderTypes";

const HOSTED_PROVIDER: ResolvedTitleProvider = { kind: "hosted" };

const LOCAL_CONFIG: LocalAIProviderConfig = {
  preset: "ollama",
  name: "Ollama",
  baseUrl: "http://localhost:11434/v1",
  defaultModel: "llama3.1",
  apiKeyConfigured: false,
  titleModel: "llama3.1:3b",
};

function completionResponse(content: string): OpenAIChatCompletionResponse {
  return {
    id: "x",
    object: "chat.completion",
    created: 0,
    model: "cheap",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
  };
}


interface ModuleFake {
  module: AIChatTitleModuleSurface;
  candidates: number;
  claims: number;
  applies: Array<{ title: string; requestId: string }>;
  failures: string[];
  candidateSequence: PreparedTitleCandidate[];
  claimResult: boolean;
  applyResult:
    | { outcome: "applied"; title: string; revision: number }
    | { outcome: "stale" }
    | { outcome: "missing" };
}

function makeModuleFake(
  candidate: PreparedTitleCandidate = {
    kind: "eligible",
    userText: "Find dentists in Sydney",
    assistantExcerpt: "Sure — here is a plan.",
    epoch: 0,
    revision: 0,
    visibleTitle: "Find dentists in Sydney",
    titleSource: "excerpt",
    excerptRefreshed: false,
  }
): ModuleFake {
  const fake: ModuleFake = {
    candidates: 0,
    claims: 0,
    applies: [],
    failures: [],
    candidateSequence: [],
    claimResult: true,
    applyResult: { outcome: "applied", title: "", revision: 1 },
    module: null as unknown as AIChatTitleModuleSurface,
  };
  fake.module = {
    async prepareTitleCandidate(): Promise<PreparedTitleCandidate> {
      fake.candidates += 1;
      if (fake.candidateSequence.length > 0) {
        return fake.candidateSequence.shift()!;
      }
      return candidate;
    },
    async claimTitleAttempt(): Promise<boolean> {
      fake.claims += 1;
      return fake.claimResult;
    },
    async applyGeneratedTitle(input): Promise<ModuleFake["applyResult"]> {
      fake.applies.push({ title: input.title, requestId: input.requestId });
      return fake.applyResult;
    },
    async markTitleAttemptFailed(input): Promise<void> {
      fake.failures.push(input.failureCode);
    },
  };
  return fake;
}

interface Harness {
  service: AIChatTitleService;
  completeTitle: ReturnType<typeof vi.fn>;
  broadcasts: unknown[];
  providerVersion: { value: number };
  enabled: { value: boolean };
  foregroundBusy: { value: boolean };
  moduleFake: ModuleFake;
}

function makeHarness(
  provider: ResolvedTitleProvider | null = HOSTED_PROVIDER,
  candidate?: PreparedTitleCandidate
): Harness {
  const moduleFake = makeModuleFake(candidate);
  const completeTitle = vi.fn(
    async (
      _provider: ResolvedTitleProvider,
      _request: OpenAIChatCompletionRequest,
      _signal: AbortSignal
    ): Promise<OpenAIChatCompletionResponse> =>
      completionResponse("Sydney Dentist Outreach")
  );
  const broadcasts: unknown[] = [];
  const providerVersion = { value: 1 };
  const enabled = { value: true };
  const foregroundBusy = { value: false };
  const deps: AIChatTitleServiceDeps = {
    createModule: () => moduleFake.module,
    resolveTitleProvider: () => provider,
    completeTitle: (
      p: ResolvedTitleProvider,
      request: OpenAIChatCompletionRequest,
      signal: AbortSignal
    ) => completeTitle(p, request, signal),
    broadcastTitle: (event) => {
      broadcasts.push(event);
    },
    providerConfigVersion: () => providerVersion.value,
    isAutoTitlesEnabled: () => enabled.value,
    isForegroundBusy: () => foregroundBusy.value,
    requestIdFactory: () => `req-${Math.random().toString(36).slice(2, 8)}`,
  };
  return {
    service: new AIChatTitleService(deps),
    completeTitle,
    broadcasts,
    providerVersion,
    enabled,
    foregroundBusy,
    moduleFake,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4000
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AIChatTitleService", () => {
  it("deduplicates duplicate notifications from both owners into one dispatch (AC-03)", async () => {
    const h = makeHarness();
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-dup",
      assistantMessageId: "a1",
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-dup",
      assistantMessageId: "a1",
    });
    await waitFor(() => h.completeTitle.mock.calls.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.completeTitle).toHaveBeenCalledTimes(1);
    expect(h.moduleFake.claims).toBe(1);
    expect(h.broadcasts).toHaveLength(1);
  });

  it("drops the 21st unclaimed candidate when the queue is full", async () => {
    const h = makeHarness();
    // Occupy the runner with a never-resolving first job.
    const release = { fn: null as null | (() => void) };
    h.completeTitle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release.fn = () => resolve(completionResponse("T"));
        })
    );
    for (let i = 0; i < 21; i += 1) {
      h.service.notifyInteractiveTurnCompleted({
        conversationId: `v2-q${i}`,
        assistantMessageId: null,
      });
    }
    expect(h.service.getDiagnostics().queueFull).toBe(1);
    release.fn?.();
  });

  it("makes zero provider calls while the greeting window stays open, then suppresses (AC-02)", async () => {
    const h = makeHarness(HOSTED_PROVIDER, { kind: "pending_window" });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-greet",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.candidates >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-greet",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.candidates >= 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.moduleFake.claims).toBe(0);
  });

  it("makes zero calls in custom mode without an explicitly configured title model (AC-05)", async () => {
    const provider: ResolvedTitleProvider = {
      kind: "local",
      config: { ...LOCAL_CONFIG, titleModel: undefined },
      apiKey: "",
    };
    const h = makeHarness(provider);
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-local",
      assistantMessageId: null,
    });
    await waitFor(() => h.service.getDiagnostics().droppedMissingModel >= 1);
    expect(h.completeTitle).not.toHaveBeenCalled();
    // Configuration errors are detected BEFORE claiming so they do not
    // consume the single attempt (titles design §5.1).
    expect(h.moduleFake.claims).toBe(0);
  });

  it("hosted failure marks the attempt failed once with no retry (AC-04/AC-16)", async () => {
    const h = makeHarness();
    h.completeTitle.mockRejectedValueOnce(
      Object.assign(new Error("HTTP 404"), { name: "HttpResponseError" })
    );
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-fail",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.completeTitle).toHaveBeenCalledTimes(1);
    expect(h.moduleFake.failures).toEqual(["error"]);
    expect(h.broadcasts).toHaveLength(0);
  });

  it("a manual rename winning the race yields stale: no broadcast (AC-09)", async () => {
    const h = makeHarness();
    const gate = {
      resolve: null as null | ((value: OpenAIChatCompletionResponse) => void),
    };
    h.completeTitle.mockImplementationOnce(
      () =>
        new Promise<OpenAIChatCompletionResponse>((resolve) => {
          gate.resolve = resolve;
        })
    );
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-race",
      assistantMessageId: null,
    });
    await waitFor(() => h.completeTitle.mock.calls.length === 1);
    // User renames while the title request is in flight.
    h.moduleFake.applyResult = { outcome: "stale" };
    gate.resolve?.(completionResponse("Late AI Title"));
    await waitFor(() => h.moduleFake.applies.length === 1);
    expect(h.broadcasts).toHaveLength(0);
    expect(h.service.getDiagnostics().stale).toBe(1);
  });

  it("provider config change after claim marks the attempt failed without any network call", async () => {
    const h = makeHarness();
    const originalClaim = h.moduleFake.module.claimTitleAttempt.bind(
      h.moduleFake.module
    );
    h.moduleFake.module.claimTitleAttempt = async (input) => {
      const won = await originalClaim(input);
      if (won) {
        h.providerVersion.value += 1; // settings changed right after the claim
      }
      return won;
    };
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-version",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.moduleFake.failures).toEqual(["provider_changed"]);
  });

  it("broadcasts the committed title only after applyGeneratedTitle succeeds", async () => {
    const h = makeHarness();
    h.moduleFake.applyResult = {
      outcome: "applied",
      title: "Sydney Dentist Outreach",
      revision: 2,
    };
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-ok",
      assistantMessageId: null,
    });
    await waitFor(() => h.broadcasts.length === 1);
    expect(h.broadcasts[0]).toEqual({
      conversationId: "v2-ok",
      title: "Sydney Dentist Outreach",
      titleRevision: 2,
      titleSource: "ai",
    });
    // Strict request shape (AC-04/AC-06): forbid policy, purpose, output cap.
    const request = h.completeTitle.mock.calls[0]?.[1] as OpenAIChatCompletionRequest;
    expect(request.smallModelFallbackPolicy).toBe("forbid");
    expect(request.requestPurpose).toBe("chat_title");
    expect(request.max_tokens).toBe(64);
    expect(request.stream).toBe(false);
    expect(request.model).toBe("small");
    // AC-06: 10 s deadline including response body consumption (hosted B13).
    expect(request.callBudgetMs).toBe(10_000);
  });

  it("local mode sends the literal configured title model", async () => {
    const h = makeHarness({
      kind: "local",
      config: LOCAL_CONFIG,
      apiKey: "sk-local",
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-lit",
      assistantMessageId: null,
    });
    await waitFor(() => h.completeTitle.mock.calls.length === 1);
    const request = h.completeTitle.mock.calls[0]?.[1] as OpenAIChatCompletionRequest;
    expect(request.model).toBe("llama3.1:3b");
    expect(request.literalModel).toBe(true);
    expect(request.callBudgetMs).toBeUndefined();
  });

  it("feature disable drops queued jobs without touching the provider", async () => {
    const h = makeHarness();
    h.enabled.value = false;
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-off",
      assistantMessageId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.service.getDiagnostics().droppedFeatureDisabled).toBe(1);
  });

  it("cancelConversation aborts an in-flight dispatch", async () => {
    const h = makeHarness();
    h.completeTitle.mockImplementationOnce(
      (_p, _r, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-cancel",
      assistantMessageId: null,
    });
    await waitFor(() => h.completeTitle.mock.calls.length === 1);
    h.service.cancelConversation("v2-cancel");
    await waitFor(() => h.moduleFake.failures.length >= 1);
    // B24: a manual invalidation classifies as interrupted, not timeout.
    expect(h.moduleFake.failures).toEqual(["interrupted"]);
    expect(h.broadcasts).toHaveLength(0);
  });

  it("B10: the production foreground-busy source counts ACTIVE dispatches, not just queue depth", async () => {
    const { AIChatExecutionScheduler } = await import(
      "@/service/AIChatExecutionScheduler"
    );
    const scheduler = new AIChatExecutionScheduler({ generalCapacity: 4 });
    scheduler.submit({
      runId: "run-active",
      conversationId: "v2-fg",
      owner: "interactive",
    });
    scheduler.pump(() => undefined); // dispatch — moves OUT of the queue
    // Audit B10 reproduction: dispatched run with an empty queue.
    expect(scheduler.queueDepth()).toBe(0);
    expect(scheduler.activeCount()).toBe(1);
    // The runtime's busy expression must now see it.
    const busy = scheduler.queueDepth() > 0 || scheduler.activeCount() > 0;
    expect(busy).toBe(true);
    scheduler.complete("run-active");
    expect(scheduler.activeCount()).toBe(0);
  });

  it.each([
    ["length", "Sydney Dentist Outreach"],
    ["content_filter", "Partial text"],
  ])("B13: finish_reason=%s with valid text is rejected before persistence", async (reason, content) => {
    const h = makeHarness();
    const base = completionResponse(content);
    h.completeTitle.mockResolvedValueOnce({
      ...base,
      choices: [
        {
          ...base.choices[0],
          finish_reason: reason,
        },
      ],
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-envelope",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    expect(h.moduleFake.applies).toHaveLength(0);
    expect(h.moduleFake.failures).toEqual(["invalid_output"]);
    expect(h.broadcasts).toHaveLength(0);
  });

  it("review-#15: an absent finish_reason (local servers) is accepted with valid text", async () => {
    const h = makeHarness();
    const base = completionResponse("Local Server Title");
    h.completeTitle.mockImplementationOnce(async () => {
      const { usage: _u, ...rest } = base;
      return {
        ...rest,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Local Server Title" },
          },
        ],
      } as typeof base;
    });
    h.moduleFake.applyResult = {
      outcome: "applied",
      title: "Local Server Title",
      revision: 1,
    };
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-nofinish",
      assistantMessageId: null,
    });
    await waitFor(() => h.broadcasts.length >= 1);
    expect(h.broadcasts[0]).toMatchObject({ title: "Local Server Title" });
  });

  it("B13: a tool_calls envelope is rejected even with clean finish_reason", async () => {
    const h = makeHarness();
    h.completeTitle.mockResolvedValueOnce({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: "cheap",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Looks fine",
            tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }],
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-tools",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    expect(h.moduleFake.applies).toHaveLength(0);
    expect(h.moduleFake.failures).toEqual(["invalid_output"]);
  });

  it("B15: a refreshed excerpt publishes a revisioned excerpt event before dispatch", async () => {
    const h = makeHarness();
    h.moduleFake.candidateSequence = [
      {
        kind: "eligible",
        userText: "Find dentists in Sydney",
        assistantExcerpt: "Sure.",
        epoch: 0,
        revision: 2,
        visibleTitle: "Find dentists in Sydney",
        titleSource: "excerpt",
        excerptRefreshed: true,
      },
    ];
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-exc-ev",
      assistantMessageId: null,
    });
    await waitFor(() => h.broadcasts.length >= 2);
    expect(h.broadcasts[0]).toEqual({
      conversationId: "v2-exc-ev",
      title: "Find dentists in Sydney",
      titleRevision: 2,
      titleSource: "excerpt",
    });
    expect(h.broadcasts[1]).toMatchObject({ titleSource: "ai" });
  });

  it("F18: an unavailable provider skips context preparation entirely", async () => {
    const h = makeHarness(null); // resolveTitleProvider -> null
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-earlygate",
      assistantMessageId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(h.moduleFake.candidates).toBe(0); // zero preparation work
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.service.getDiagnostics().droppedProviderUnavailable).toBe(1);
  });

  it("F16: per-attempt records keep provider usage and unknown distinct", async () => {
    const h = makeHarness();
    // First dispatch reports usage; second returns none — its record must be
    // "unknown", never inheriting the prior request's numbers.
    h.completeTitle.mockImplementationOnce(async () => {
      const base = completionResponse("First Title");
      return {
        ...base,
        usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 },
      };
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-usage1",
      assistantMessageId: null,
    });
    await waitFor(() => h.broadcasts.length >= 1);
    h.moduleFake.candidateSequence = [
      {
        kind: "eligible",
        userText: "Second task",
        assistantExcerpt: "ok",
        epoch: 0,
        revision: 0,
        visibleTitle: "Second task",
        titleSource: "excerpt",
        excerptRefreshed: false,
      },
    ];
    // Second response reports NO usage — its record must be "unknown".
    h.completeTitle.mockImplementationOnce(async () => {
      const { usage: _usage, ...rest } = completionResponse("Second Title");
      return rest;
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-usage2",
      assistantMessageId: null,
    });
    await waitFor(() => h.broadcasts.length >= 2);
    const records = h.service.getDiagnostics().attemptRecords;
    const succeeded = records.filter((r) => r.outcome === "succeeded");
    expect(succeeded).toHaveLength(2);
    expect(succeeded[0]).toMatchObject({
      usage: { promptTokens: 120, completionTokens: 8 },
      usageSource: "provider",
    });
    expect(succeeded[1]).toMatchObject({
      usage: null,
      usageSource: "unknown",
    });
  });

  it("F16: a provider-charged invalid envelope records unknown-or-reported usage", async () => {
    const h = makeHarness();
    const base = completionResponse("Truncated");
    h.completeTitle.mockImplementationOnce(async () => ({
      ...base,
      choices: [{ ...base.choices[0], finish_reason: "length" }],
    }));
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-charged",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    const records = h.service.getDiagnostics().attemptRecords;
    expect(records.at(-1)).toMatchObject({ outcome: "invalid_output" });
  });

  it("G11: two attempts failing with the same code both count", async () => {
    const h = makeHarness();
    h.completeTitle.mockRejectedValue(
      Object.assign(new Error("HTTP 500"), { name: "HttpResponseError" })
    );
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-g11a",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-g11b",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 2);
    expect(h.moduleFake.failures).toEqual(["error", "error"]);
    expect(h.service.getDiagnostics().failedByCode["error"]).toBe(2);
  });

  it("G11: a specific outcome is never relabeled by the catch (records once)", async () => {
    const h = makeHarness();
    const originalFail = h.moduleFake.module.markTitleAttemptFailed.bind(
      h.moduleFake.module
    );
    let failCount = 0;
    h.moduleFake.module.markTitleAttemptFailed = async (input) => {
      failCount += 1;
      if (failCount === 1 && input.failureCode === "invalid_output") {
        // Specific outcome recorded; then the finally/catch path runs —
        // the diagnostics must show invalid_output, not a second error.
        await originalFail(input);
        return;
      }
      await originalFail(input);
    };
    h.completeTitle.mockImplementationOnce(async () => completionResponse(""));
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-g11c",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    expect(h.service.getDiagnostics().failedByCode["invalid_output"]).toBe(1);
    expect(h.service.getDiagnostics().failedByCode["error"]).toBeUndefined();
  });

  it("G04: a cancel during the network call (transport controller) seals the result", async () => {
    const h = makeHarness();
    h.completeTitle.mockImplementationOnce(async (_p, _r, signal) => {
      // Noncooperative completion: the response resolves DESPITE the abort.
      h.service.cancelConversation("v2-g04net");
      return completionResponse("Late After Cancel");
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-g04net",
      assistantMessageId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.moduleFake.applies).toHaveLength(0);
    expect(h.broadcasts).toHaveLength(0);
  });

  it("G04: foreground work starting during preparation prevents dispatch (no attempt consumed)", async () => {
    const h = makeHarness();
    const originalPrepare = h.moduleFake.module.prepareTitleCandidate.bind(
      h.moduleFake.module
    );
    h.moduleFake.module.prepareTitleCandidate = async (...args) => {
      h.foregroundBusy.value = true; // foreground starts mid-preparation
      return originalPrepare(...args);
    };
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-g04fg",
      assistantMessageId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.moduleFake.claims).toBe(0); // attempt unconsumed
    h.foregroundBusy.value = false;
  });

  it("G04: an entry aged past the TTL during preparation never dispatches", async () => {
    const h = makeHarness();
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-g04ttl",
      assistantMessageId: null,
    });
    // Age the entry out while it is queued/preparing — the pump's setTimeout
    // has not run yet, so the map still holds the live entry object.
    const queue = (h.service as unknown as {
      queue: Map<string, { enqueuedAt: number }>;
    }).queue;
    const entry = queue.get("v2-g04ttl");
    if (entry) entry.enqueuedAt = Date.now() - 61_000;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.moduleFake.claims).toBe(0);
  });

  it("F05: a cancel landing during the awaited claim dispatches nothing", async () => {
    const h = makeHarness();
    const originalClaim = h.moduleFake.module.claimTitleAttempt.bind(
      h.moduleFake.module
    );
    h.moduleFake.module.claimTitleAttempt = async (input) => {
      const won = await originalClaim(input);
      if (won) h.service.cancelConversation("v2-claimcancel"); // cancel DURING claim
      return won;
    };
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-claimcancel",
      assistantMessageId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.broadcasts).toHaveLength(0);
  });

  it("F05: dispose during the claim seals the attempt with zero dispatch", async () => {
    const h = makeHarness();
    const originalClaim = h.moduleFake.module.claimTitleAttempt.bind(
      h.moduleFake.module
    );
    h.moduleFake.module.claimTitleAttempt = async (input) => {
      const won = await originalClaim(input);
      if (won) h.service.dispose();
      return won;
    };
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-claimdispose",
      assistantMessageId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.broadcasts).toHaveLength(0);
    expect(h.moduleFake.failures).toEqual(["interrupted"]);
  });

  it("F05: dispose during the network call discards the late result", async () => {
    const h = makeHarness();
    h.completeTitle.mockImplementationOnce(async () => {
      h.service.dispose();
      return completionResponse("Late After Dispose");
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-netdispose",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    expect(h.moduleFake.applies).toHaveLength(0);
    expect(h.broadcasts).toHaveLength(0);
  });

  it("B03: a provider change between notification and pump discards the job before any work", async () => {
    const h = makeHarness();
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-srcswitch",
      assistantMessageId: "a1",
    });
    // Settings change BEFORE the deferred pump starts.
    h.providerVersion.value += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(h.completeTitle).not.toHaveBeenCalled();
    expect(h.moduleFake.candidates).toBe(0); // dropped before preparation
    expect(h.service.getDiagnostics().failedByCode["provider_changed"]).toBe(1);
  });

  it("B11: a preparation rejection is contained — no unhandled rejection, queue continues", async () => {
    const h = makeHarness();
    const originalPrepare = h.moduleFake.module.prepareTitleCandidate.bind(
      h.moduleFake.module
    );
    h.moduleFake.module.prepareTitleCandidate = async (...args) => {
      h.moduleFake.candidates += 1;
      if (h.moduleFake.candidates === 1) {
        throw new Error("database unavailable");
      }
      return originalPrepare(...args);
    };
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-prepfail",
      assistantMessageId: null,
    });
    await waitFor(() => h.service.getDiagnostics().failedByCode["error"] === 1);
    // The queue must still serve a later job.
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-prepfail2",
      assistantMessageId: null,
    });
    await waitFor(() => h.completeTitle.mock.calls.length >= 1);
    expect(h.broadcasts).toHaveLength(1);
  });

  it("a provider change during the in-flight request discards the late result (FR-10)", async () => {
    const h = makeHarness();
    h.completeTitle.mockImplementationOnce(async () => {
      // Settings change while the title request is in flight.
      h.providerVersion.value += 1;
      return completionResponse("Late AI Title");
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-late",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    expect(h.completeTitle).toHaveBeenCalledTimes(1);
    expect(h.moduleFake.applies).toHaveLength(0);
    expect(h.moduleFake.failures).toEqual(["provider_changed"]);
    expect(h.broadcasts).toHaveLength(0);
  });

  it("disabling the feature during the in-flight request discards the late result (FR-08)", async () => {
    const h = makeHarness();
    h.completeTitle.mockImplementationOnce(async () => {
      h.enabled.value = false;
      return completionResponse("Late AI Title");
    });
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-late-off",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    expect(h.moduleFake.applies).toHaveLength(0);
    expect(h.moduleFake.failures).toEqual(["feature_disabled"]);
    expect(h.broadcasts).toHaveLength(0);
  });

  it("invalid model output keeps the excerpt and records invalid_output", async () => {
    const h = makeHarness();
    h.completeTitle.mockResolvedValueOnce(completionResponse(""));
    h.service.notifyInteractiveTurnCompleted({
      conversationId: "v2-declined",
      assistantMessageId: null,
    });
    await waitFor(() => h.moduleFake.failures.length >= 1);
    expect(h.moduleFake.failures).toEqual(["invalid_output"]);
    expect(h.broadcasts).toHaveLength(0);
  });
});
