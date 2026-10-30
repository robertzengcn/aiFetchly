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
    expect(h.moduleFake.failures).toEqual(["timeout"]);
    expect(h.broadcasts).toHaveLength(0);
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
