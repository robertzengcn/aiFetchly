import { describe, it, expect, beforeEach, vi } from "vitest";
import { createLightweightCompletionService } from "@/service/AIChatLightweightCompletionFactory";
import type { AIChatLightweightCompletionDeps } from "@/service/AIChatLightweightCompletionService";
import { HttpResponseError } from "@/modules/lib/httpResponseError";
import { AIChatLightweightFailure } from "@/service/AIChatLightweightTypes";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";

// Kill switch default is OFF. For small-route tests we flip the env before
// constructing the service.
process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = "true";

function okResponse(
  model = "resolved-small-model"
): OpenAIChatCompletionResponse {
  return {
    id: "resp-1",
    object: "chat.completion",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "summary" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

interface DepOverrides {
  providerKind?: "hosted" | "local";
  providerKindEnum?:
    | "hosted"
    | "ollama"
    | "lm_studio"
    | "openai"
    | "openrouter"
    | "vllm"
    | "localai"
    | "custom";
  /** Hosted small-model capability reported to the router. */
  smallModelCapability?: {
    available: boolean;
    resolved_model?: string;
    context_size?: number;
    max_tokens?: number;
  } | null;
}

function buildDeps(
  overrides: DepOverrides = {}
): AIChatLightweightCompletionDeps & {
  completeHosted: ReturnType<typeof vi.fn>;
  completeLocal: ReturnType<typeof vi.fn>;
  resolveProvider: ReturnType<typeof vi.fn>;
  getSmallModelCapability: ReturnType<typeof vi.fn>;
} {
  const completeHosted = vi.fn();
  const completeLocal = vi.fn();
  const kind = overrides.providerKind ?? "hosted";
  const resolveProvider = vi.fn(async () => ({
    kind,
    providerKind: overrides.providerKindEnum ?? "hosted",
  }));
  const getSmallModelCapability = vi.fn(async () => {
    if (!("smallModelCapability" in overrides)) return null;
    return overrides.smallModelCapability ?? null;
  });
  return {
    completeHosted,
    completeLocal,
    resolveProvider,
    getSmallModelCapability,
  } as AIChatLightweightCompletionDeps & {
    completeHosted: ReturnType<typeof vi.fn>;
    completeLocal: ReturnType<typeof vi.fn>;
    resolveProvider: ReturnType<typeof vi.fn>;
    getSmallModelCapability: ReturnType<typeof vi.fn>;
  };
}

describe("AIChatLightweightCompletionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("routing", () => {
    it("hosted + enabled sends model='small' on the first attempt", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockResolvedValueOnce(okResponse("haiku-resolved"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "summarize" }],
        manual: false,
      });

      expect(result.route).toBe("hosted_small");
      expect(result.resolvedModel).toBe("haiku-resolved");
      expect(result.attemptCount).toBe(1);
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeHosted).toHaveBeenCalledWith(
        expect.objectContaining({ model: "small", stream: false }),
        undefined
      );
    });

    it("local provider never receives the small alias; route is provider_normal", async () => {
      const deps = buildDeps({
        providerKind: "local",
        providerKindEnum: "ollama",
      });
      deps.completeLocal.mockResolvedValueOnce(okResponse("llama3"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      });

      expect(result.route).toBe("provider_normal");
      expect(result.resolvedModel).toBe("llama3");
      expect(deps.completeLocal).toHaveBeenCalledTimes(1);
      const req = deps.completeLocal.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBeUndefined(); // no alias sent
    });

    it("local provider preserves a requested real model", async () => {
      const deps = buildDeps({
        providerKind: "local",
        providerKindEnum: "openai",
      });
      deps.completeLocal.mockResolvedValueOnce(okResponse("gpt-4o-mini"));
      const svc = createLightweightCompletionService(deps);

      await svc.complete({
        workload: "session_memory_summary",
        messages: [{ role: "user", content: "x" }],
        normalModel: "gpt-4o-mini",
        manual: false,
      });

      const req = deps.completeLocal.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBe("gpt-4o-mini");
    });

    it("kill switch off routes to provider_normal without calling hosted small", async () => {
      const previous = process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED;
      process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = "false";
      // Re-import the config module to reset its cache.
      const { resetSmallModelRoutingCache } = await import(
        "@/config/aiLightweightRouting"
      );
      resetSmallModelRoutingCache();
      const { createLightweightCompletionService: createFresh } = await import(
        "@/service/AIChatLightweightCompletionFactory"
      );
      const deps = buildDeps();
      deps.completeHosted.mockResolvedValueOnce(okResponse("normal-model"));
      const svc = createFresh(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: false,
      });

      expect(result.route).toBe("provider_normal");
      const req = deps.completeHosted.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBe("normal-model");
      process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = previous;
      resetSmallModelRoutingCache();
    });
  });

  describe("capability gating (SMBW-001)", () => {
    it("valid capability lets conversation_compact use the small route with reported limits", async () => {
      const deps = buildDeps({
        smallModelCapability: {
          available: true,
          resolved_model: "haiku",
          context_size: 200_000,
          max_tokens: 1024,
        },
      });
      deps.completeHosted.mockResolvedValueOnce(okResponse("haiku"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: true,
      });

      expect(result.route).toBe("hosted_small");
      expect(result.routeReason).toBeUndefined();
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      const req = deps.completeHosted.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBe("small");
      // Discovered max output bounds the request's max_tokens.
      expect(req.max_tokens).toBe(1024);
    });

    it("missing capability routes conversation_compact directly to normal with zero small requests", async () => {
      const deps = buildDeps({ smallModelCapability: null });
      deps.completeHosted.mockResolvedValueOnce(okResponse("normal-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: true,
      });

      expect(result.route).toBe("provider_normal");
      expect(result.routeReason).toBe("capability_missing");
      // NOT a fallback: no small attempt preceded the normal request.
      expect(result.fallbackAttempted).toBe(false);
      expect(result.attemptCount).toBe(1);
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      const req = deps.completeHosted.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBe("normal-model");
      // No cooldown was opened for the capability-absent route.
      expect(svc.getCooldownState("conversation_compact")).toBeNull();
    });

    it("available:false routes to normal with capability_missing", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: false },
      });
      deps.completeHosted.mockResolvedValueOnce(okResponse("normal-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: true,
      });

      expect(result.route).toBe("provider_normal");
      expect(result.routeReason).toBe("capability_missing");
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
    });

    it("malformed context_size (zero) routes to normal with capability_missing", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: true, context_size: 0 },
      });
      deps.completeHosted.mockResolvedValueOnce(okResponse("normal-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: true,
      });

      expect(result.route).toBe("provider_normal");
      expect(result.routeReason).toBe("capability_missing");
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
    });

    it("missing context_size is treated as invalid capability", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: true },
      });
      deps.completeHosted.mockResolvedValueOnce(okResponse("normal-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: true,
      });

      expect(result.route).toBe("provider_normal");
      expect(result.routeReason).toBe("capability_missing");
    });

    it("capability errors (resolver failure) route to normal, never throw", async () => {
      const deps = buildDeps();
      deps.getSmallModelCapability.mockRejectedValueOnce(
        new Error("catalog unavailable")
      );
      deps.completeHosted.mockResolvedValueOnce(okResponse("normal-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: true,
      });

      expect(result.route).toBe("provider_normal");
      expect(result.routeReason).toBe("capability_missing");
    });

    it("capability is not consulted for workloads that do not require discovered context", async () => {
      const deps = buildDeps({ smallModelCapability: null });
      deps.completeHosted.mockResolvedValueOnce(okResponse("resolved"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      });

      expect(result.route).toBe("hosted_small");
      expect(deps.getSmallModelCapability).not.toHaveBeenCalled();
    });

    it("kill switch disabled routes to normal regardless of capability", async () => {
      const previous = process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED;
      process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = "false";
      const { resetSmallModelRoutingCache } = await import(
        "@/config/aiLightweightRouting"
      );
      resetSmallModelRoutingCache();
      const { createLightweightCompletionService: createFresh } = await import(
        "@/service/AIChatLightweightCompletionFactory"
      );
      const deps = buildDeps({
        smallModelCapability: {
          available: true,
          context_size: 200_000,
        },
      });
      deps.completeHosted.mockResolvedValueOnce(okResponse("normal-model"));
      const svc = createFresh(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: true,
      });

      expect(result.route).toBe("provider_normal");
      expect(result.routeReason).toBeUndefined();
      expect(deps.getSmallModelCapability).not.toHaveBeenCalled();

      process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = previous;
      resetSmallModelRoutingCache();
    });

    it("local/custom provider never consults capability and never receives the alias", async () => {
      const deps = buildDeps({
        providerKind: "local",
        providerKindEnum: "ollama",
        smallModelCapability: null,
      });
      deps.completeLocal.mockResolvedValueOnce(okResponse("llama3"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "llama3",
        manual: true,
      });

      expect(result.route).toBe("provider_normal");
      expect(deps.completeLocal).toHaveBeenCalledTimes(1);
      const req = deps.completeLocal.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBe("llama3");
      expect(deps.getSmallModelCapability).not.toHaveBeenCalled();
    });
  });

  describe("failure classification & retry", () => {
    it("missing small-model (404) opens cooldown with no fallback for optional work", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("Not Found", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });

      // Exactly one request — no retry, no fallback.
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeLocal).not.toHaveBeenCalled();
      // Cooldown opened.
      const cd = svc.getCooldownState("user_auto_dream");
      expect(cd?.reason).toBe("small_model_unavailable");
      expect(cd?.cooldownUntil).toBeGreaterThan(Date.now());
    });

    it("cooldown suppresses a subsequent background call (cooldown_skip)", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("Not Found", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      // First call fails and opens cooldown.
      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toBeInstanceOf(AIChatLightweightFailure);

      // Second background call is skipped before any server call.
      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "y" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1); // unchanged
    });

    it("manual execution bypasses scheduling cooldown without enabling fallback", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("Not Found", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      // Open cooldown via a background failure.
      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toBeInstanceOf(AIChatLightweightFailure);

      // Manual call bypasses cooldown — still hits the server, still no fallback.
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("Not Found", 404, "{}")
      );
      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "y" }],
          manual: true,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("429 performs one same-route retry then succeeds", async () => {
      const deps = buildDeps();
      deps.completeHosted
        .mockRejectedValueOnce(new HttpResponseError("rl", 429, "", 1))
        .mockResolvedValueOnce(okResponse());
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "session_memory_summary",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      });

      expect(result.route).toBe("hosted_small");
      expect(result.attemptCount).toBe(2);
      expect(result.retryReason).toBe("rate_limit");
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
    });

    it("generic 5xx retries once without broad fallback (optional workload)", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValue(
        new HttpResponseError("boom", 500, "")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "server_error" });
      // Initial + one retry = 2, no fallback to local.
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("ambiguous timeout produces exactly one total request (no retry, no fallback)", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new DOMException("aborted", "AbortError")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "timeout_ambiguous" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("authentication failure does not retry or fall back", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValue(
        new HttpResponseError("unauth", 401, "")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "authentication" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });
  });

  describe("JSON repair bounding (SMBW-009)", () => {
    it("allowSameRouteRetry=false suppresses the same-route retry on a 429", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: true, context_size: 200_000 },
      });
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("rl", 429, "", 1)
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
          allowSameRouteRetry: false,
        })
      ).rejects.toMatchObject({ reason: "rate_limit" });
      // No retry — exactly one request, leaving budget for a domain repair.
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
    });

    it("allowSameRouteRetry=true (default) still retries a 429 once", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: true, context_size: 200_000 },
      });
      deps.completeHosted
        .mockRejectedValueOnce(new HttpResponseError("rl", 429, "", 1))
        .mockResolvedValueOnce(okResponse());
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      });
      expect(result.attemptCount).toBe(2);
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
    });

    it("repairAttempted=true is propagated to the result and event", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: true, context_size: 200_000 },
      });
      deps.completeHosted.mockResolvedValueOnce(okResponse("resolved"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
        repairAttempted: true,
      });
      expect(result.repairAttempted).toBe(true);
    });
  });

  describe("observability + resolved model (SMBW-012/013/014)", () => {
    it("emits contextWindow, inputTokenEstimate, and provider token usage on success", async () => {
      const deps = buildDeps({
        smallModelCapability: {
          available: true,
          resolved_model: "haiku",
          context_size: 200_000,
          max_tokens: 1024,
        },
      });
      deps.completeHosted.mockResolvedValueOnce({
        id: "r",
        object: "chat.completion",
        created: 1,
        model: "haiku-resolved",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "s" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
      });
      const svc = createLightweightCompletionService(deps);
      const events: unknown[] = [];
      const { log } = await import("@/modules/Logger");
      const spy = vi
        .spyOn(log, "info")
        .mockImplementation((...args: unknown[]) => {
          try {
            const first = args[0];
            if (
              typeof first === "string" &&
              first.startsWith("[ai-lightweight]")
            ) {
              // emitEvent logs (tag, json) as two arguments.
              const payload = args[1];
              events.push(
                typeof payload === "string"
                  ? JSON.parse(payload)
                  : JSON.parse(first.replace("[ai-lightweight] ", ""))
              );
            }
          } catch {
            // ignore unrelated log lines
          }
        });

      try {
        await svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "summarize this" }],
          manual: false,
        });
      } finally {
        spy.mockRestore();
      }

      expect(events).toHaveLength(1);
      const ev = events[0] as Record<string, unknown>;
      // user_auto_dream does not require discovered context — the capability
      // is NOT consulted, so the conservative 32k is reported (SMBW-001
      // contract preserved).
      expect(ev.contextWindow).toBe(32_000);
      expect(ev.inputTokenEstimate).toBeGreaterThan(0);
      expect(ev.outputTokens).toBe(7);
      expect(ev.providerInputTokens).toBe(42);
      expect(ev.requestedAlias).toBe("small");
      expect(ev.resolvedModel).toBe("haiku-resolved");
    });

    it("counts a small request + normal fallback as two attempts (SMBW-012)", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: true, context_size: 200_000 },
      });
      deps.completeHosted
        .mockRejectedValueOnce(new HttpResponseError("nf", 404, "{}"))
        .mockResolvedValueOnce(okResponse("normal-compact"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-compact",
        manual: false,
      });
      expect(result.attemptCount).toBe(2);
      expect(result.fallbackAttempted).toBe(true);
      expect(result.fallbackReason).toBe("small_model_unavailable");
    });

    it("never persists the virtual alias as the resolved model (SMBW-014)", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: true, context_size: 200_000 },
      });
      // Server incorrectly echoes the alias back as the resolved model.
      deps.completeHosted.mockResolvedValueOnce(okResponse("small"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      });
      expect(result.resolvedModel).not.toBe("small");
      expect(result.resolvedModel).not.toBe("haiku");
    });

    it("missing response.model resolves to a non-alias placeholder (SMBW-014)", async () => {
      const deps = buildDeps({
        smallModelCapability: { available: true, context_size: 200_000 },
      });
      deps.completeHosted.mockResolvedValueOnce({
        id: "r",
        object: "chat.completion",
        created: 1,
        // no model field
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "s" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      });
      expect(result.resolvedModel).not.toBe("small");
      expect(result.resolvedModel.length).toBeGreaterThan(0);
    });
  });

  describe("compact controlled fallback", () => {
    // Router-level fallback tests: provide a valid capability so the small
    // route is eligible (SMBW-001 gate) and the fallback path can fire.
    const capable = {
      smallModelCapability: { available: true, context_size: 200_000 },
    } satisfies DepOverrides;

    it("conversation_compact falls back exactly once on small_model_unavailable", async () => {
      const deps = buildDeps(capable);
      deps.completeHosted
        .mockRejectedValueOnce(new HttpResponseError("nf", 404, "{}"))
        .mockResolvedValueOnce(okResponse("normal-compact-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-compact-model",
        manual: false,
      });

      expect(result.route).toBe("normal_fallback");
      expect(result.fallbackAttempted).toBe(true);
      expect(result.fallbackReason).toBe("small_model_unavailable");
      expect(result.resolvedModel).toBe("normal-compact-model");
      // One small attempt + one normal fallback = 2 total.
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
      // The provider is resolved exactly once per logical completion — the
      // fallback reuses it rather than re-resolving (no mid-flight switch).
      expect(deps.resolveProvider).toHaveBeenCalledTimes(1);
    });

    it("conversation_compact falls back on context_overflow (HTTP 413)", async () => {
      const deps = buildDeps(capable);
      deps.completeHosted
        .mockRejectedValueOnce(new HttpResponseError("too big", 413, ""))
        .mockResolvedValueOnce(okResponse("normal-compact-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-compact-model",
        manual: false,
      });

      expect(result.route).toBe("normal_fallback");
      expect(result.fallbackAttempted).toBe(true);
      expect(result.fallbackReason).toBe("context_overflow");
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("conversation_compact falls back on model_specific_overload (server code)", async () => {
      const deps = buildDeps(capable);
      deps.completeHosted
        .mockRejectedValueOnce(
          new HttpResponseError(
            "overloaded",
            503,
            '{"error":{"code":"small_model_overloaded"}}',
            undefined,
            "small_model_overloaded"
          )
        )
        .mockResolvedValueOnce(okResponse("normal-compact-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-compact-model",
        manual: false,
      });

      expect(result.route).toBe("normal_fallback");
      expect(result.fallbackAttempted).toBe(true);
      expect(result.fallbackReason).toBe("model_specific_overload");
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
    });

    it("conversation_compact preserves the ORIGINAL reason when the fallback itself fails", async () => {
      const deps = buildDeps(capable);
      // Small attempt: 404. Fallback attempt: also fails (server_error 500).
      deps.completeHosted
        .mockRejectedValueOnce(new HttpResponseError("nf", 404, "{}"))
        .mockRejectedValueOnce(new HttpResponseError("boom", 500, ""));
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "conversation_compact",
          messages: [{ role: "user", content: "x" }],
          normalModel: "normal-compact-model",
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });
      // One small attempt + one (failed) normal fallback = 2 total.
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
    });

    it("conversation_compact does NOT fall back on ambiguous timeout", async () => {
      const deps = buildDeps(capable);
      deps.completeHosted.mockRejectedValueOnce(
        new DOMException("aborted", "AbortError")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "conversation_compact",
          messages: [{ role: "user", content: "x" }],
          normalModel: "normal",
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "timeout_ambiguous" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("conversation_compact does NOT fall back on authentication failure", async () => {
      const deps = buildDeps(capable);
      deps.completeHosted.mockRejectedValue(
        new HttpResponseError("u", 401, "")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "conversation_compact",
          messages: [{ role: "user", content: "x" }],
          normalModel: "normal",
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "authentication" });
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("optional workloads never fall back to the normal model", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValue(
        new HttpResponseError("nf", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "session_memory_summary",
          messages: [{ role: "user", content: "x" }],
          normalModel: "normal",
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });
  });

  describe("cancellation", () => {
    it("cancellation before retry prevents the second request", async () => {
      const deps = buildDeps();
      // 429 with a 100ms retry delay so the caller abort lands deterministically
      // during the retry sleep (before the second completion call).
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("rl", 429, "", 100)
      );
      const svc = createLightweightCompletionService(deps);

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10);

      await expect(
        svc.complete({
          workload: "session_memory_summary",
          messages: [{ role: "user", content: "x" }],
          manual: false,
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ reason: "cancelled" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
    });
  });

  describe("cooldown reset", () => {
    it("resetCooldowns clears a config cooldown so a background call can probe again", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("nf", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toBeInstanceOf(AIChatLightweightFailure);
      expect(svc.getCooldownState("user_auto_dream")).not.toBeNull();

      svc.resetCooldowns();
      expect(svc.getCooldownState("user_auto_dream")).toBeNull();
    });

    it("a transient cooldown expires after one hour (fake timers)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      try {
        const deps = buildDeps();
        // timeout_ambiguous is transient but NOT same-route-retryable, so
        // each call makes exactly one request with no retry backoff sleep
        // (a 500 would sleep 2s under fake timers and hang the test).
        deps.completeHosted.mockRejectedValue(
          new DOMException("aborted", "AbortError")
        );
        const svc = createLightweightCompletionService(deps);
        // Three consecutive transient failures open the one-hour cooldown.
        for (let i = 0; i < 3; i++) {
          await expect(
            svc.complete({
              workload: "user_auto_dream",
              messages: [{ role: "user", content: "x" }],
              manual: false,
            })
          ).rejects.toMatchObject({ reason: "timeout_ambiguous" });
        }
        const state = svc.getCooldownState("user_auto_dream");
        expect(state?.cooldownUntil).toBeGreaterThan(Date.now());

        // Still inside the window: the next background call is skipped.
        deps.completeHosted.mockClear();
        await expect(
          svc.complete({
            workload: "user_auto_dream",
            messages: [{ role: "user", content: "y" }],
            manual: false,
          })
        ).rejects.toBeInstanceOf(AIChatLightweightFailure);
        expect(deps.completeHosted).not.toHaveBeenCalled();

        // After one hour the cooldown expires and a probe may run.
        vi.setSystemTime(new Date("2026-01-01T01:00:01Z"));
        deps.completeHosted.mockResolvedValueOnce(okResponse());
        const result = await svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "z" }],
          manual: false,
        });
        expect(result.route).toBe("hosted_small");
      } finally {
        vi.useRealTimers();
      }
    });

    it("a success clears the transient failure count and cooldown (SMBW-017)", async () => {
      const deps = buildDeps();
      // timeout_ambiguous: transient (counts) but not retryable (no 2s sleep
      // per failure, which would blow the test timeout).
      deps.completeHosted.mockRejectedValue(
        new DOMException("aborted", "AbortError")
      );
      const svc = createLightweightCompletionService(deps);
      // Two transient failures (below the threshold of three).
      for (let i = 0; i < 2; i++) {
        await expect(
          svc.complete({
            workload: "user_auto_dream",
            messages: [{ role: "user", content: "x" }],
            manual: false,
          })
        ).rejects.toMatchObject({ reason: "timeout_ambiguous" });
      }
      expect(
        svc.getCooldownState("user_auto_dream")?.consecutiveTransientFailures
      ).toBe(2);

      // A success resets the counter.
      deps.completeHosted.mockResolvedValueOnce(okResponse());
      await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "y" }],
        manual: false,
      });
      const state = svc.getCooldownState("user_auto_dream");
      expect(state).toBeNull();

      // Two MORE failures after the reset do not open a cooldown (count
      // restarted from zero — threshold is three).
      for (let i = 0; i < 2; i++) {
        await expect(
          svc.complete({
            workload: "user_auto_dream",
            messages: [{ role: "user", content: "x" }],
            manual: false,
          })
        ).rejects.toMatchObject({ reason: "timeout_ambiguous" });
      }
      expect(
        svc.getCooldownState("user_auto_dream")?.cooldownUntil
      ).toBeUndefined();
    });
  });
});
